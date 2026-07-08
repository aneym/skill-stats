import type { DatabaseSync } from 'node:sqlite'
import { all } from './db.js'
import { scanEntries, loadInventory, type InventoryEntry, type InventoryOptions } from './inventory.js'
import { readSkillMeta, wordSet } from './skill-meta.js'

export type ReconcileKind = 'same-name' | 'similar-name' | 'similar-content'

export interface ReconcileMember {
  name: string
  path: string
  source: string
  invocations: number
  lastUsed: string | null
  machines: string[]
}

export interface ReconcileGroup {
  kind: ReconcileKind
  members: ReconcileMember[]
  recommendation: string
}

export interface ReconcileResult {
  groups: ReconcileGroup[]
}

interface Usage {
  invocations: number
  lastUsed: string | null
  machines: string[]
}

const JACCARD_THRESHOLD = 0.6
const MIN_CONTENT_WORDS = 5
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'with', 'skill', 'my', 'in', 'on'])

// Read-only duplicate detection over the on-disk inventory + recorded usage.
// Never mutates anything — reports collisions and a keeper recommendation.
export function computeReconcile(db: DatabaseSync, invOpts: InventoryOptions): ReconcileResult {
  const usage = usageByName(db)
  const entries = scanEntries(invOpts)
  const member = (e: InventoryEntry): ReconcileMember => {
    const u = usage.get(e.name) ?? { invocations: 0, lastUsed: null, machines: [] }
    return { name: e.name, path: e.path, source: e.source, invocations: u.invocations, lastUsed: u.lastUsed, machines: u.machines }
  }

  const groups: ReconcileGroup[] = []
  groups.push(...sameNameGroups(entries, member))

  // Similarity comparisons run over one representative entry per name
  // (first writer wins, matching loadInventory) so a name never pairs with itself.
  const unique = [...loadInventory(invOpts).values()]
  const descs = new Map(unique.map((e) => [e.name, readSkillMeta(e.path).description]))
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const a = unique[i]
      const b = unique[j]
      if (namesSimilar(a.name, b.name)) {
        groups.push(makeGroup('similar-name', [member(a), member(b)]))
      }
      if (descsSimilar(descs.get(a.name), descs.get(b.name))) {
        groups.push(makeGroup('similar-content', [member(a), member(b)]))
      }
    }
  }
  return { groups }
}

function sameNameGroups(entries: InventoryEntry[], member: (e: InventoryEntry) => ReconcileMember): ReconcileGroup[] {
  const byName = new Map<string, InventoryEntry[]>()
  for (const e of entries) {
    const list = byName.get(e.name) ?? []
    list.push(e)
    byName.set(e.name, list)
  }
  const groups: ReconcileGroup[] = []
  for (const [, list] of byName) {
    const distinct = dedupeByPath(list)
    if (distinct.length > 1) groups.push(makeGroup('same-name', distinct.map(member)))
  }
  return groups
}

function dedupeByPath(entries: InventoryEntry[]): InventoryEntry[] {
  const seen = new Set<string>()
  const out: InventoryEntry[] = []
  for (const e of entries) {
    if (seen.has(e.path)) continue
    seen.add(e.path)
    out.push(e)
  }
  return out
}

function usageByName(db: DatabaseSync): Map<string, Usage> {
  const rows = all<{ skill: string; ts: string | null; machine: string | null }>(
    db,
    'SELECT skill, ts, machine FROM events'
  )
  const map = new Map<string, { invocations: number; lastUsed: string | null; lastMs: number; machines: Set<string> }>()
  for (const r of rows) {
    const u = map.get(r.skill) ?? { invocations: 0, lastUsed: null, lastMs: -1, machines: new Set<string>() }
    u.invocations++
    const ms = r.ts ? Date.parse(r.ts) : NaN
    if (r.ts && !Number.isNaN(ms) && ms > u.lastMs) {
      u.lastMs = ms
      u.lastUsed = r.ts
    }
    u.machines.add(r.machine ?? 'unknown')
    map.set(r.skill, u)
  }
  const out = new Map<string, Usage>()
  for (const [name, u] of map) out.set(name, { invocations: u.invocations, lastUsed: u.lastUsed, machines: [...u.machines].sort() })
  return out
}

// ---- similarity ----------------------------------------------------------

function namesSimilar(a: string, b: string): boolean {
  if (a === b) return false
  if (editDistance(a.toLowerCase(), b.toLowerCase()) <= 2) return true
  return normalizeName(a) === normalizeName(b)
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .join('')
}

function descsSimilar(a: string | undefined, b: string | undefined): boolean {
  const wa = wordSet(a)
  const wb = wordSet(b)
  if (wa.size < MIN_CONTENT_WORDS || wb.size < MIN_CONTENT_WORDS) return false
  return jaccard(wa, wb) >= JACCARD_THRESHOLD
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > 2) return 3 // early out: we only care about <= 2
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const curr = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = curr
  }
  return prev[n]
}

// ---- recommendation ------------------------------------------------------

// Keeper by evidence: most invocations, then most recent, then most machines.
function makeGroup(kind: ReconcileKind, members: ReconcileMember[]): ReconcileGroup {
  return { kind, members, recommendation: recommend(kind, members) }
}

function recommend(kind: ReconcileKind, members: ReconcileMember[]): string {
  const ranked = [...members].sort(
    (a, b) =>
      b.invocations - a.invocations ||
      (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '') ||
      b.machines.length - a.machines.length
  )
  const keeper = ranked[0]
  const rest = members.filter((m) => m !== keeper)
  const restNames = rest.map((m) => m.name).join(', ') || keeper.name
  const action =
    kind === 'similar-content'
      ? `merge the descriptions into it and alias or drop ${restNames}`
      : `quarantine ${restNames} via \`skill-stats sweep quarantine\``

  if (members.every((m) => m.invocations === 0)) {
    return `No usage evidence — pick by content freshness, then ${action}.`
  }
  const last = keeper.lastUsed ? `, last used ${keeper.lastUsed}` : ''
  return `Keep ${keeper.name} at ${keeper.path} (${keeper.invocations} invocation(s)${last}); ${action}.`
}
