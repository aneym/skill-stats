import type { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { importStream } from './transfer.js'

// Agent-configurable multi-system registry. Lives beside the db so it travels
// with SKILLSTATS_HOME (hermetic tests, custom setups).
const DEFAULT_REMOTE_PATH = '~/repos/skill-stats'

export interface Remote {
  name: string
  host: string
  path: string
  lastSync?: string
}

export interface SyncResult {
  name: string
  added?: number
  skipped?: number
  error?: string
}

export function skillstatsHome(): string {
  return process.env.SKILLSTATS_HOME ?? join(homedir(), '.skill-analytics')
}

export function remotesPath(): string {
  return join(skillstatsHome(), 'remotes.json')
}

export function readRemotes(): Remote[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(remotesPath(), 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRemote)
  } catch {
    return []
  }
}

export function writeRemotes(remotes: Remote[]): void {
  const path = remotesPath()
  mkdirSync(skillstatsHome(), { recursive: true })
  writeFileSync(path, JSON.stringify(remotes, null, 2) + '\n')
}

export function addRemote(name: string, host: string, path?: string): Remote {
  const remote: Remote = { name, host, path: path && path.length ? path : DEFAULT_REMOTE_PATH }
  const remotes = readRemotes().filter((r) => r.name !== name)
  remotes.push(remote)
  writeRemotes(remotes)
  return remote
}

export function removeRemote(name: string): boolean {
  const remotes = readRemotes()
  const next = remotes.filter((r) => r.name !== name)
  if (next.length === remotes.length) return false
  writeRemotes(next)
  return true
}

// Pull one remote's export over ssh and import it. Failures are non-fatal —
// the caller keeps going with the other remotes.
export function syncRemote(db: DatabaseSync, remote: Remote): SyncResult {
  try {
    const out = execFileSync(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', remote.host, `node ${remote.path}/dist/cli.js export`],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
    )
    const { added, skipped } = importStream(db, out)
    return { name: remote.name, added, skipped }
  } catch (err) {
    return { name: remote.name, error: err instanceof Error ? err.message : String(err) }
  }
}

export function syncRemotes(db: DatabaseSync, name?: string): SyncResult[] {
  const all = readRemotes()
  const targets = name ? all.filter((r) => r.name === name) : all
  const results: SyncResult[] = []
  const now = new Date().toISOString()
  const synced = new Set<string>()
  for (const remote of targets) {
    const res = syncRemote(db, remote)
    results.push(res)
    if (!res.error) synced.add(remote.name)
  }
  if (synced.size) {
    writeRemotes(all.map((r) => (synced.has(r.name) ? { ...r, lastSync: now } : r)))
  }
  return results
}

function isRemote(value: unknown): value is Remote {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Remote).name === 'string' &&
    typeof (value as Remote).host === 'string' &&
    typeof (value as Remote).path === 'string'
  )
}
