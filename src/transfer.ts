import type { DatabaseSync } from 'node:sqlite'
import { all, get } from './db.js'
import { currentMachine, makeInserter } from './ingest.js'

// JSONL interchange for multi-machine sync. One line per row:
//   {kind:"event", ...all event columns incl. machine, plus hard signals}
//   {kind:"outcome", ...all outcome columns}
// Import preserves machine + session from the file so events from different
// machines never dedup against each other.

interface EventExportRow {
  harness: string
  skill: string
  source: string | null
  trigger: string | null
  session_id: string | null
  project: string | null
  ts: string | null
  skill_hash: string | null
  origin: string
  machine: string | null
  dedup_key: string | null
  tokens_after: number | null
  errors_after: number | null
}

interface OutcomeExportRow {
  skill: string
  session_id: string | null
  ts: string | null
  grade: string | null
  evidence: string | null
  followed: string | null
  ignored: string | null
  trusted: number
}

export function exportStream(db: DatabaseSync): string {
  const events = all<EventExportRow>(
    db,
    `SELECT e.harness, e.skill, e.source, e.trigger, e.session_id, e.project, e.ts,
            e.skill_hash, e.origin, e.machine, e.dedup_key,
            s.tokens_after, s.errors_after
       FROM events e
       LEFT JOIN signals s ON s.event_id = e.id
      ORDER BY e.id`
  )
  const outcomes = all<OutcomeExportRow>(
    db,
    `SELECT skill, session_id, ts, grade, evidence, followed, ignored, trusted
       FROM outcomes ORDER BY id`
  )
  const lines: string[] = []
  for (const e of events) lines.push(JSON.stringify({ kind: 'event', ...e }))
  for (const o of outcomes) lines.push(JSON.stringify({ kind: 'outcome', ...o }))
  return lines.length ? lines.join('\n') + '\n' : ''
}

export interface ImportStats {
  added: number
  skipped: number
}

export function importStream(db: DatabaseSync, text: string): ImportStats {
  const insert = makeInserter(db)
  const stats: ImportStats = { added: 0, skipped: 0 }
  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isRecord(parsed)) continue
    if (parsed.kind === 'event') importEvent(db, insert, parsed, stats)
    else if (parsed.kind === 'outcome') importOutcome(db, parsed, stats)
  }
  return stats
}

function importEvent(
  db: DatabaseSync,
  insert: ReturnType<typeof makeInserter>,
  o: Record<string, unknown>,
  stats: ImportStats
): void {
  const skill = str(o.skill)
  if (!skill) return
  const res = insert({
    harness: str(o.harness) ?? 'claude-code',
    skill,
    source: str(o.source),
    trigger: str(o.trigger),
    sessionId: str(o.session_id) ?? 'unknown',
    project: str(o.project),
    ts: str(o.ts),
    skillHash: str(o.skill_hash),
    origin: str(o.origin) ?? 'import',
    machine: str(o.machine) ?? currentMachine(),
    tokensAfter: num(o.tokens_after),
    errorsAfter: num(o.errors_after),
  })
  res === 'added' ? stats.added++ : stats.skipped++
}

// Outcomes have no unique key; dedup on the full tuple so re-import is a no-op.
function importOutcome(db: DatabaseSync, o: Record<string, unknown>, stats: ImportStats): void {
  const skill = str(o.skill)
  if (!skill) return
  const sessionId = str(o.session_id)
  const ts = str(o.ts)
  const grade = str(o.grade)
  const existing = get<{ c: number }>(
    db,
    `SELECT COUNT(*) AS c FROM outcomes
      WHERE skill = ? AND IFNULL(session_id,'') = IFNULL(?,'')
        AND IFNULL(ts,'') = IFNULL(?,'') AND IFNULL(grade,'') = IFNULL(?,'')`,
    skill,
    sessionId,
    ts,
    grade
  )
  if ((existing?.c ?? 0) > 0) {
    stats.skipped++
    return
  }
  db.prepare(
    `INSERT INTO outcomes (skill, session_id, ts, grade, evidence, followed, ignored, trusted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(skill, sessionId, ts, grade, str(o.evidence), str(o.followed), str(o.ignored), num(o.trusted))
  stats.added++
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
