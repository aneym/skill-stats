import type { DatabaseSync } from 'node:sqlite'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseTranscript } from './parse.js'
import { loadInventory } from './inventory.js'

export interface BackfillStats {
  scanned: number
  added: number
  skipped: number
  corrupt: number
}

export function dedupKey(sessionId: string, ts: string | null, skill: string): string {
  return createHash('sha256').update(`${sessionId}|${ts ?? ''}|${skill}`).digest('hex')
}

export function backfill(db: DatabaseSync, claudeDir: string): BackfillStats {
  const inventory = loadInventory(claudeDir)
  const insertEvent = db.prepare(
    `INSERT OR IGNORE INTO events
       (harness, skill, source, trigger, session_id, project, ts, skill_hash, origin, dedup_key)
     VALUES ('claude-code', ?, ?, ?, ?, ?, ?, ?, 'backfill', ?)`
  )
  const insertSignal = db.prepare(
    `INSERT OR REPLACE INTO signals (event_id, tokens_after, errors_after) VALUES (?, ?, ?)`
  )

  const stats: BackfillStats = { scanned: 0, added: 0, skipped: 0, corrupt: 0 }

  for (const file of transcriptFiles(claudeDir)) {
    stats.scanned++
    const { activations, corrupt } = parseTranscript(file)
    stats.corrupt += corrupt
    for (const a of activations) {
      const hash = inventory.get(a.skill)?.hash ?? null
      const key = dedupKey(a.sessionId, a.ts, a.skill)
      const res = insertEvent.run(
        a.skill,
        a.source,
        a.trigger,
        a.sessionId,
        a.project,
        a.ts,
        hash,
        key
      )
      if (res.changes > 0) {
        stats.added++
        insertSignal.run(res.lastInsertRowid, a.tokensAfter, a.errorsAfter)
      } else {
        stats.skipped++
      }
    }
  }
  return stats
}

function transcriptFiles(claudeDir: string): string[] {
  const projectsDir = join(claudeDir, 'projects')
  const files: string[] = []
  for (const project of safeReaddir(projectsDir)) {
    const dir = join(projectsDir, project)
    if (!isDir(dir)) continue
    for (const name of safeReaddir(dir)) {
      if (name.endsWith('.jsonl')) files.push(join(dir, name))
    }
  }
  return files
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
