import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { openDb } from './db.js'
import { loadInventory } from './inventory.js'
import { parseTranscript } from './parse.js'
import { isHookInstalled } from './settings.js'
import { readdirSync } from 'node:fs'

export interface Check {
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}

export interface DoctorResult {
  checks: Check[]
  hardFailure: boolean
}

export function doctor(dbPath: string, claudeDir: string): DoctorResult {
  const checks: Check[] = []

  const claudeExists = existsSync(claudeDir) && statSync(claudeDir).isDirectory()
  checks.push({
    name: 'claude-dir',
    status: claudeExists ? 'ok' : 'warn',
    detail: claudeExists ? claudeDir : `${claudeDir} does not exist`,
  })

  checks.push(nodeSqliteCheck())
  checks.push(parseRateCheck(claudeDir))
  checks.push({
    name: 'hook installed',
    status: isHookInstalled(claudeDir) ? 'ok' : 'warn',
    detail: isHookInstalled(claudeDir)
      ? 'PostToolUse Skill hook present'
      : 'run `skill-stats install` for live capture',
  })
  checks.push(dbWritableCheck(dbPath))

  const inventoryCount = safeInventoryCount(claudeDir)
  checks.push({
    name: 'skill inventory',
    status: 'ok',
    detail: `${inventoryCount} skill(s) on disk`,
  })

  const hardFailure = checks.some((c) => c.status === 'fail')
  return { checks, hardFailure }
}

function nodeSqliteCheck(): Check {
  try {
    openDb(':memory:').close()
    return { name: 'node:sqlite', status: 'ok', detail: 'available' }
  } catch (err) {
    return { name: 'node:sqlite', status: 'fail', detail: describe(err) }
  }
}

function parseRateCheck(claudeDir: string): Check {
  const projectsDir = join(claudeDir, 'projects')
  let files = 0
  let corrupt = 0
  let activations = 0
  try {
    for (const project of readdirSync(projectsDir)) {
      const dir = join(projectsDir, project)
      if (!statSync(dir).isDirectory()) continue
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue
        files++
        const res = parseTranscript(join(dir, name))
        corrupt += res.corrupt
        activations += res.activations.length
      }
    }
  } catch {
    return { name: 'transcript parse', status: 'warn', detail: 'no transcripts found' }
  }
  return {
    name: 'transcript parse',
    status: 'ok',
    detail: `${files} file(s), ${activations} activation(s), ${corrupt} corrupt line(s)`,
  }
}

function dbWritableCheck(dbPath: string): Check {
  try {
    const db = openDb(dbPath)
    db.close()
    return { name: 'db writable', status: 'ok', detail: dbPath }
  } catch (err) {
    return { name: 'db writable', status: 'fail', detail: describe(err) }
  }
}

function safeInventoryCount(claudeDir: string): number {
  try {
    return loadInventory({ claudeDir }).size
  } catch {
    return 0
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
