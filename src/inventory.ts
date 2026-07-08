import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

export type InventorySource = 'claude' | 'plugin' | 'command' | 'skills-root' | 'codex'

export interface InventoryEntry {
  name: string
  hash: string | null
  path: string
  source: InventorySource
}

export interface InventoryOptions {
  claudeDir?: string
  // Extra roots, each scanned for <root>/*/SKILL.md (repeatable --skills-root).
  skillsRoots?: string[]
  // When set and present on disk, <codexDir>/skills/*/SKILL.md are inventoried.
  codexDir?: string
}

// Best-effort read of the on-disk skill inventory across every configured source.
// Never throws — a missing or unreadable directory simply contributes no entries.
// First writer for a name wins, so an activated skill keeps its richest source.
export function loadInventory(opts: InventoryOptions): Map<string, InventoryEntry> {
  const out = new Map<string, InventoryEntry>()
  for (const e of scanEntries(opts)) {
    if (!out.has(e.name)) out.set(e.name, e)
  }
  return out
}

// Every on-disk entry across every source, DUPLICATES PRESERVED. loadInventory
// dedups by name (first writer wins); reconcile needs the collisions to detect
// the same skill copied into multiple roots.
export function scanEntries(opts: InventoryOptions): InventoryEntry[] {
  const out: InventoryEntry[] = []
  const add = (name: string, file: string, source: InventorySource): void => {
    if (!name) return
    out.push({ name, hash: hashFile(file), path: file, source })
  }

  if (opts.claudeDir) {
    // <claude-dir>/skills/*/SKILL.md
    for (const file of skillsUnder(join(opts.claudeDir, 'skills'))) {
      add(basename(dirname(file)), file, 'claude')
    }
    // <claude-dir>/plugins/**/skills/*/SKILL.md
    for (const file of pluginSkillFiles(opts.claudeDir)) {
      add(basename(dirname(file)), file, 'plugin')
    }
    // <claude-dir>/commands/*.md — slash commands are skills too.
    for (const file of markdownFiles(join(opts.claudeDir, 'commands'))) {
      add(basename(file).replace(/\.md$/, ''), file, 'command')
    }
  }

  for (const root of opts.skillsRoots ?? []) {
    for (const file of skillsUnder(root)) add(basename(dirname(file)), file, 'skills-root')
  }

  if (opts.codexDir) {
    for (const file of skillsUnder(join(opts.codexDir, 'skills'))) {
      add(basename(dirname(file)), file, 'codex')
    }
  }

  return out
}

export function isPluginSource(source: InventorySource): boolean {
  return source === 'plugin'
}

export function skillHash(claudeDir: string, name: string): string | null {
  return loadInventory({ claudeDir }).get(name)?.hash ?? null
}

// <claude-dir>/plugins/**/skills/*/SKILL.md
function pluginSkillFiles(claudeDir: string): string[] {
  const files: string[] = []
  walk(join(claudeDir, 'plugins'), 0, (path) => {
    if (basename(path) === 'SKILL.md' && basename(dirname(dirname(path))) === 'skills') {
      files.push(path)
    }
  })
  return files
}

// <dir>/*/SKILL.md
function skillsUnder(dir: string): string[] {
  const files: string[] = []
  for (const name of safeReaddir(dir)) {
    const candidate = join(dir, name, 'SKILL.md')
    if (isFile(candidate)) files.push(candidate)
  }
  return files
}

// <dir>/*.md
function markdownFiles(dir: string): string[] {
  const files: string[] = []
  for (const name of safeReaddir(dir)) {
    if (!name.endsWith('.md')) continue
    const candidate = join(dir, name)
    if (isFile(candidate)) files.push(candidate)
  }
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
