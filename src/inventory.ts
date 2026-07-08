import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

export interface InventoryEntry {
  name: string
  hash: string | null
  path: string
}

// Best-effort read of the on-disk skill inventory. Never throws — a missing or
// unreadable directory simply contributes no entries.
export function loadInventory(claudeDir: string | undefined): Map<string, InventoryEntry> {
  const out = new Map<string, InventoryEntry>()
  if (!claudeDir) return out
  for (const file of findSkillFiles(claudeDir)) {
    const name = basename(dirname(file))
    if (out.has(name)) continue
    out.set(name, { name, hash: hashFile(file), path: file })
  }
  return out
}

export function skillHash(claudeDir: string, name: string): string | null {
  return loadInventory(claudeDir).get(name)?.hash ?? null
}

function findSkillFiles(claudeDir: string): string[] {
  const files: string[] = []
  // <claude-dir>/skills/*/SKILL.md
  for (const dir of safeReaddir(join(claudeDir, 'skills'))) {
    const candidate = join(claudeDir, 'skills', dir, 'SKILL.md')
    if (isFile(candidate)) files.push(candidate)
  }
  // <claude-dir>/plugins/**/skills/*/SKILL.md
  walk(join(claudeDir, 'plugins'), 0, (path) => {
    if (basename(path) === 'SKILL.md' && basename(dirname(dirname(path))) === 'skills') {
      files.push(path)
    }
  })
  return files
}

function walk(dir: string, depth: number, visit: (path: string) => void): void {
  if (depth > 8) return
  for (const name of safeReaddir(dir)) {
    const full = join(dir, name)
    if (isDir(full)) walk(full, depth + 1, visit)
    else visit(full)
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function hashFile(path: string): string | null {
  try {
    const content = readFileSync(path, 'utf8')
    return createHash('sha256').update(content).digest('hex').slice(0, 16)
  } catch {
    return null
  }
}
