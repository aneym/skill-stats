import type { DatabaseSync } from 'node:sqlite'
import { renameSync, mkdirSync, existsSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { all, get } from './db.js'
import { loadInventory, type InventoryOptions } from './inventory.js'
import { readSkillMeta, descBytes } from './skill-meta.js'
import { skillstatsHome } from './remotes.js'

const DAY_MS = 86_400_000

export interface SweepCandidate {
  name: string
  path: string
  source: string
  descBytes: number
  historyDays: number
  lastUsed: string | null
  // Set only on plugin-bound entries — moving their files breaks the plugin.
  note?: string
}

export interface SweepReport {
  days: number
  historyDays: number
  estTokensPerTurn: number
  candidates: SweepCandidate[]
  pluginBound: SweepCandidate[]
}

export interface ManifestEntry {
  name: string
  originalPath: string
  quarantinedAt: string
  quarantinePath: string
  source: string
}

const PLUGIN_NOTE = 'disable the plugin instead'

// A candidate is dead weight: in inventory, zero events inside the window on
// EVERY machine (i.e. no windowed events at all), not keep-listed. Plugin-source
// skills are routed to pluginBound — their files can't be moved without breaking
// the plugin, so we only ever advise disabling the plugin.
export function computeSweep(db: DatabaseSync, invOpts: InventoryOptions, days: number): SweepReport {
  const cutoffMs = Date.now() - days * DAY_MS
  const inventory = loadInventory(invOpts)
  const keep = new Set(readKeep())
  const historyDays = computeHistoryDays(db)
  const candidates: SweepCandidate[] = []
  const pluginBound: SweepCandidate[] = []

  for (const [name, entry] of inventory) {
    if (keep.has(name)) continue
    const events = eventsForSkill(db, name)
    const usedInWindow = events.some((e) => tsMs(e.ts) >= cutoffMs)
    if (usedInWindow) continue
    const meta = readSkillMeta(entry.path)
    const item: SweepCandidate = {
      name,
      path: entry.path,
      source: entry.source,
      descBytes: descBytes(meta, name),
      historyDays,
      lastUsed: lastUsedOf(events),
    }
    if (entry.source === 'plugin') pluginBound.push({ ...item, note: PLUGIN_NOTE })
    else candidates.push(item)
  }

  candidates.sort((a, b) => b.descBytes - a.descBytes || a.name.localeCompare(b.name))
  pluginBound.sort((a, b) => b.descBytes - a.descBytes || a.name.localeCompare(b.name))
  const estTokensPerTurn = Math.round(candidates.reduce((s, c) => s + c.descBytes, 0) / 4)
  return { days, historyDays, estTokensPerTurn, candidates, pluginBound }
}

interface EventTs {
  ts: string | null
  machine: string | null
}

function eventsForSkill(db: DatabaseSync, name: string): EventTs[] {
  return all<EventTs>(db, 'SELECT ts, machine FROM events WHERE skill = ?', name)
}

function lastUsedOf(events: EventTs[]): string | null {
  let best: string | null = null
  let bestMs = -1
  for (const e of events) {
    const ms = tsMs(e.ts)
    if (e.ts && ms > bestMs) {
      best = e.ts
      bestMs = ms
    }
  }
  return best
}

// Days from the OLDEST event in the db to now — how much history backs a
// dormancy claim. 0 when the db is empty.
function computeHistoryDays(db: DatabaseSync): number {
  const row = get<{ oldest: string | null }>(db, 'SELECT MIN(ts) AS oldest FROM events WHERE ts IS NOT NULL')
  if (!row || !row.oldest) return 0
  const ms = Date.parse(row.oldest)
  if (Number.isNaN(ms)) return 0
  return Math.max(0, Math.floor((Date.now() - ms) / DAY_MS))
}

function tsMs(ts: string | null): number {
  if (!ts) return 0
  const ms = Date.parse(ts)
  return Number.isNaN(ms) ? 0 : ms
}

// ---- keep-list -----------------------------------------------------------

function keepPath(): string {
  return join(skillstatsHome(), 'keep.json')
}

export function readKeep(): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(keepPath(), 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeKeep(names: string[]): void {
  mkdirSync(skillstatsHome(), { recursive: true })
  writeFileSync(keepPath(), JSON.stringify([...new Set(names)].sort(), null, 2) + '\n')
}

export function keepAdd(name: string): boolean {
  const names = readKeep()
  if (names.includes(name)) return false
  writeKeep([...names, name])
  return true
}

export function keepRemove(name: string): boolean {
  const names = readKeep()
  if (!names.includes(name)) return false
  writeKeep(names.filter((n) => n !== name))
  return true
}

// ---- quarantine (move, never delete) -------------------------------------

function quarantineDir(): string {
  return join(skillstatsHome(), 'quarantine')
}

function manifestPath(): string {
  return join(quarantineDir(), 'manifest.json')
}

export function readManifest(): ManifestEntry[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath(), 'utf8'))
    return Array.isArray(parsed) ? parsed.filter(isManifestEntry) : []
  } catch {
    return []
  }
}

function writeManifest(entries: ManifestEntry[]): void {
  mkdirSync(quarantineDir(), { recursive: true })
  writeFileSync(manifestPath(), JSON.stringify(entries, null, 2) + '\n')
}

export interface MovePlan {
  name: string
  source: string
  src: string
  dest: string
}

// Skills own a whole directory (<root>/<name>/SKILL.md) — the directory moves.
// Commands are a bare <name>.md file — the file moves into quarantine/<name>/.
export function planMoves(candidates: SweepCandidate[]): MovePlan[] {
  return candidates.map((c) => {
    if (c.source === 'command') {
      return { name: c.name, source: c.source, src: c.path, dest: join(quarantineDir(), c.name, basename(c.path)) }
    }
    return { name: c.name, source: c.source, src: dirname(c.path), dest: join(quarantineDir(), c.name) }
  })
}

export function performQuarantine(candidates: SweepCandidate[]): string[] {
  const manifest = readManifest()
  const moved: string[] = []
  for (const plan of planMoves(candidates)) {
    if (!existsSync(plan.src)) continue
    mkdirSync(dirname(plan.dest), { recursive: true })
    move(plan.src, plan.dest)
    manifest.push({
      name: plan.name,
      originalPath: plan.src,
      quarantinePath: plan.dest,
      quarantinedAt: new Date().toISOString(),
      source: plan.source,
    })
    moved.push(plan.name)
  }
  writeManifest(manifest)
  return moved
}

export interface RestoreResult {
  restored: string[]
  missing: string[]
}

export function restore(target: string): RestoreResult {
  const manifest = readManifest()
  const wantAll = target === '--all'
  const restored: string[] = []
  const keep: ManifestEntry[] = []
  for (const entry of manifest) {
    if (!wantAll && entry.name !== target) {
      keep.push(entry)
      continue
    }
    if (!existsSync(entry.quarantinePath)) {
      keep.push(entry)
      continue
    }
    mkdirSync(dirname(entry.originalPath), { recursive: true })
    move(entry.quarantinePath, entry.originalPath)
    restored.push(entry.name)
  }
  writeManifest(keep)
  const missing = wantAll ? [] : restored.length ? [] : [target]
  return { restored, missing }
}

// rename is atomic on the same volume; fall back to copy+remove across devices.
// Never deletes without first placing a full copy at the destination.
function move(src: string, dest: string): void {
  try {
    renameSync(src, dest)
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EXDEV') {
      cpSync(src, dest, { recursive: true })
      rmSync(src, { recursive: true, force: true })
      return
    }
    throw err
  }
}

function isManifestEntry(v: unknown): v is ManifestEntry {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as ManifestEntry).name === 'string' &&
    typeof (v as ManifestEntry).originalPath === 'string' &&
    typeof (v as ManifestEntry).quarantinePath === 'string'
  )
}
