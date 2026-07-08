import type { DatabaseSync } from 'node:sqlite'
import { hostname } from 'node:os'
import { createHash } from 'node:crypto'
import { all } from './db.js'

// Every event carries the machine it was ingested on. Local ingests stamp this
// hostname; imports preserve the machine that produced the event.
export function currentMachine(): string {
  return hostname()
}

// The same (session, skill) activation can arrive twice — once live via the hook
// (stamped ~now) and once from the transcript backfill (stamped seconds earlier).
// Differing timestamps defeat the exact dedup_key, so we also reject a new event
// when a matching (session, skill, machine) one already sits within this window.
// A deterministic proximity test — no time-bucket boundary artifacts.
export const PROXIMITY_MS = 120_000

// Machine-scoped so events from different machines NEVER collide on import.
export function dedupKey(machine: string, sessionId: string, ts: string | null, skill: string): string {
  return createHash('sha256').update(`${machine}|${sessionId}|${ts ?? ''}|${skill}`).digest('hex')
}

export interface EventInput {
  harness: string
  skill: string
  source: string | null
  trigger: string | null
  sessionId: string
  project: string | null
  ts: string | null
  skillHash: string | null
  origin: string
  machine: string
  tokensAfter?: number
  errorsAfter?: number
}

export type InsertResult = 'added' | 'skipped'
export type EventInserter = (ev: EventInput) => InsertResult

interface TsRow {
  ts: string | null
}

const PROXIMITY_SQL = 'SELECT ts FROM events WHERE session_id = ? AND skill = ? AND machine = ?'

// Prepare the write statements once, reuse across a whole backfill/import pass.
export function makeInserter(db: DatabaseSync): EventInserter {
  const insertEvent = db.prepare(
    `INSERT OR IGNORE INTO events
       (harness, skill, source, trigger, session_id, project, ts, skill_hash, origin, machine, dedup_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertSignal = db.prepare(
    'INSERT OR REPLACE INTO signals (event_id, tokens_after, errors_after) VALUES (?, ?, ?)'
  )

  return (ev: EventInput): InsertResult => {
    const near = all<TsRow>(db, PROXIMITY_SQL, ev.sessionId, ev.skill, ev.machine)
    if (isProximate(near, ev.ts)) return 'skipped'
    const key = dedupKey(ev.machine, ev.sessionId, ev.ts, ev.skill)
    const res = insertEvent.run(
      ev.harness,
      ev.skill,
      ev.source,
      ev.trigger,
      ev.sessionId,
      ev.project,
      ev.ts,
      ev.skillHash,
      ev.origin,
      ev.machine,
      key
    )
    if (res.changes > 0) {
      insertSignal.run(res.lastInsertRowid, ev.tokensAfter ?? 0, ev.errorsAfter ?? 0)
      return 'added'
    }
    return 'skipped'
  }
}

function isProximate(existing: TsRow[], ts: string | null): boolean {
  if (existing.length === 0) return false
  const ms = ts ? Date.parse(ts) : NaN
  // No usable timestamp: any prior (session, skill, machine) row is a duplicate.
  if (Number.isNaN(ms)) return true
  return existing.some((r) => {
    const other = r.ts ? Date.parse(r.ts) : NaN
    return !Number.isNaN(other) && Math.abs(other - ms) <= PROXIMITY_MS
  })
}
