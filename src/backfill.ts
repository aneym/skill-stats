import type { DatabaseSync } from 'node:sqlite'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseTranscript } from './parse.js'
import { parseRollout, rolloutFiles } from './codex.js'
import { loadInventory } from './inventory.js'
import { currentMachine, makeInserter } from './ingest.js'

export interface BackfillStats {
  scanned: number
  added: number
  skipped: number
  corrupt: number
}

export function backfillCodex(db: DatabaseSync, codexDir: string): BackfillStats {
  const insert = makeInserter(db)
  const machine = currentMachine()
  const stats: BackfillStats = { scanned: 0, added: 0, skipped: 0, corrupt: 0 }
  for (const file of rolloutFiles(codexDir)) {
    stats.scanned++
    const { activations, corrupt } = parseRollout(file)
    stats.corrupt += corrupt
    for (const a of activations) {
      const res = insert({
        harness: 'codex',
        skill: a.skill,
        source: file,
        trigger: 'model',
        sessionId: a.sessionId,
        project: a.project,
        ts: a.ts,
        skillHash: null,
        origin: 'backfill',
        machine,
      })
      res === 'added' ? stats.added++ : stats.skipped++
    }
  }
  return stats
}

export function backfill(db: DatabaseSync, claudeDir: string): BackfillStats {
  const inventory = loadInventory({ claudeDir })
  const insert = makeInserter(db)
  const machine = currentMachine()
  const stats: BackfillStats = { scanned: 0, added: 0, skipped: 0, corrupt: 0 }

  for (const file of transcriptFiles(claudeDir)) {
    stats.scanned++
    const { activations, corrupt } = parseTranscript(file)
    stats.corrupt += corrupt
    for (const a of activations) {
      const res = insert({
        harness: 'claude-code',
        skill: a.skill,
        source: a.source,
        trigger: a.trigger,
        sessionId: a.sessionId,
        project: a.project,
        ts: a.ts,
        skillHash: inventory.get(a.skill)?.hash ?? null,
        origin: 'backfill',
        machine,
        tokensAfter: a.tokensAfter,
        errorsAfter: a.errorsAfter,
      })
      res === 'added' ? stats.added++ : stats.skipped++
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
