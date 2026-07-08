import type { DatabaseSync } from 'node:sqlite'
import { all } from './db.js'
import { loadInventory, type InventoryOptions } from './inventory.js'

export interface Outcomes {
  worked: number
  partial: number
  failed: number
  untrusted: number
}

export interface SkillRow {
  name: string
  invocations: number
  lastUsed: string | null
  tokensAfter: number
  errorsAfter: number
  dormant: boolean
  outcomes: Outcomes
  // Activations per day over the window, oldest bucket first (sparkline data).
  dailyCounts: number[]
  // Invocations in the equal-length window immediately before this one (trend).
  prevInvocations: number
  // Windowed activation counts keyed by harness ("claude-code", "codex").
  harnesses: Record<string, number>
  // Windowed activation counts keyed by trigger ("model", "user-slash", "hook").
  byTrigger: Record<string, number>
  // Windowed activation counts keyed by the machine that recorded them.
  machines: Record<string, number>
}

export interface Report {
  generatedAt: string
  days: number
  skills: SkillRow[]
}

export interface VersionRollup {
  skillHash: string | null
  invocations: number
  tokensAfter: number
  errorsAfter: number
}

export interface Activation {
  ts: string | null
  harness: string | null
  trigger: string | null
  origin: string | null
  sessionId: string | null
  project: string | null
  skillHash: string | null
  machine: string | null
  tokensAfter: number
  errorsAfter: number
}

export interface SkillDetail extends SkillRow {
  versions: VersionRollup[]
  recent: Activation[]
}

interface EventRow {
  ts: string | null
  harness: string | null
  trigger: string | null
  origin: string | null
  session_id: string | null
  project: string | null
  skill_hash: string | null
  machine: string | null
  tokens_after: number | null
  errors_after: number | null
}

interface OutcomeRow {
  grade: string | null
  trusted: number
}

const DAY_MS = 86_400_000

function tsMs(ts: string | null): number {
  if (!ts) return 0
  const ms = Date.parse(ts)
  return Number.isNaN(ms) ? 0 : ms
}

function eventsForSkill(db: DatabaseSync, name: string): EventRow[] {
  return all<EventRow>(
    db,
    `SELECT e.ts, e.harness, e.trigger, e.origin, e.session_id, e.project, e.skill_hash, e.machine,
            s.tokens_after, s.errors_after
       FROM events e
       LEFT JOIN signals s ON s.event_id = e.id
      WHERE e.skill = ?
      ORDER BY e.ts DESC`,
    name
  )
}

function outcomesForSkill(db: DatabaseSync, name: string): Outcomes {
  const rows = all<OutcomeRow>(db, 'SELECT grade, trusted FROM outcomes WHERE skill = ?', name)
  const out: Outcomes = { worked: 0, partial: 0, failed: 0, untrusted: 0 }
  for (const r of rows) {
    if (r.grade === 'worked') out.worked++
    else if (r.grade === 'partial') out.partial++
    else if (r.grade === 'failed') out.failed++
    if (r.trusted === 0) out.untrusted++
  }
  return out
}

function computeRow(
  db: DatabaseSync,
  name: string,
  inInventory: boolean,
  cutoffMs: number,
  days: number,
  machine?: string
): { row: SkillRow; events: EventRow[]; windowed: EventRow[] } {
  const allEvents = eventsForSkill(db, name)
  const events =
    machine === undefined ? allEvents : allEvents.filter((e) => (e.machine ?? 'unknown') === machine)
  const windowed = events.filter((e) => tsMs(e.ts) >= cutoffMs)
  const invocations = windowed.length
  const tokensAfter = windowed.reduce((a, e) => a + (e.tokens_after ?? 0), 0)
  const errorsAfter = windowed.reduce((a, e) => a + (e.errors_after ?? 0), 0)
  const lastUsed = events.length ? events[0].ts : null

  const prevCutoffMs = cutoffMs - days * DAY_MS
  const dailyCounts = new Array<number>(days).fill(0)
  const harnesses: Record<string, number> = {}
  const byTrigger: Record<string, number> = {}
  const machines: Record<string, number> = {}
  let prevInvocations = 0
  for (const e of events) {
    const ms = tsMs(e.ts)
    if (ms >= cutoffMs) {
      const idx = Math.min(days - 1, Math.floor((ms - cutoffMs) / DAY_MS))
      dailyCounts[idx]++
      const h = e.harness ?? 'claude-code'
      harnesses[h] = (harnesses[h] ?? 0) + 1
      const t = e.trigger ?? 'unknown'
      byTrigger[t] = (byTrigger[t] ?? 0) + 1
      const m = e.machine ?? 'unknown'
      machines[m] = (machines[m] ?? 0) + 1
    } else if (ms >= prevCutoffMs) {
      prevInvocations++
    }
  }

  const row: SkillRow = {
    name,
    invocations,
    lastUsed,
    tokensAfter,
    errorsAfter,
    dormant: invocations === 0 && inInventory,
    outcomes: outcomesForSkill(db, name),
    dailyCounts,
    prevInvocations,
    harnesses,
    byTrigger,
    machines,
  }
  return { row, events, windowed }
}

function skillUniverse(db: DatabaseSync, inventory: Iterable<string>): Set<string> {
  const names = new Set<string>()
  for (const r of all<{ skill: string }>(db, 'SELECT DISTINCT skill FROM events')) names.add(r.skill)
  for (const n of inventory) names.add(n)
  return names
}

export function computeReport(
  db: DatabaseSync,
  inventoryOpts: InventoryOptions,
  days: number,
  machine?: string
): Report {
  const cutoffMs = Date.now() - days * DAY_MS
  const inventory = loadInventory(inventoryOpts)
  const skills: SkillRow[] = []
  for (const name of skillUniverse(db, inventory.keys())) {
    skills.push(computeRow(db, name, inventory.has(name), cutoffMs, days, machine).row)
  }
  skills.sort((a, b) => b.invocations - a.invocations || a.name.localeCompare(b.name))
  return { generatedAt: new Date().toISOString(), days, skills }
}

export function computeSkillDetail(
  db: DatabaseSync,
  inventoryOpts: InventoryOptions,
  name: string,
  days: number
): SkillDetail {
  const cutoffMs = Date.now() - days * DAY_MS
  const inventory = loadInventory(inventoryOpts)
  const { row, events } = computeRow(db, name, inventory.has(name), cutoffMs, days)

  const versionMap = new Map<string | null, VersionRollup>()
  for (const e of events) {
    const key = e.skill_hash
    const v = versionMap.get(key) ?? { skillHash: key, invocations: 0, tokensAfter: 0, errorsAfter: 0 }
    v.invocations++
    v.tokensAfter += e.tokens_after ?? 0
    v.errorsAfter += e.errors_after ?? 0
    versionMap.set(key, v)
  }

  const recent: Activation[] = events.slice(0, 20).map((e) => ({
    ts: e.ts,
    harness: e.harness,
    trigger: e.trigger,
    origin: e.origin,
    sessionId: e.session_id,
    project: e.project,
    skillHash: e.skill_hash,
    machine: e.machine,
    tokensAfter: e.tokens_after ?? 0,
    errorsAfter: e.errors_after ?? 0,
  }))

  return { ...row, versions: [...versionMap.values()], recent }
}
