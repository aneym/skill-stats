import { readFileSync } from 'node:fs'

// The per-session context cost of a skill is its frontmatter name+description —
// that is what every harness loads into the system prompt each turn. These
// helpers are the single place we read that frontmatter, so sweep (cost ranking)
// and reconcile (content-dupe detection) agree on what a description is.
export interface SkillMeta {
  name?: string
  description?: string
}

export function readSkillMeta(path: string): SkillMeta {
  try {
    return parseFrontmatter(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

export function parseFrontmatter(text: string): SkillMeta {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!block) return {}
  const meta: SkillMeta = {}
  for (const raw of block[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(raw)
    if (!kv) continue
    const key = kv[1].toLowerCase()
    const value = kv[2].trim().replace(/^["']|["']$/g, '')
    if (key === 'name' && meta.name === undefined) meta.name = value
    else if (key === 'description' && meta.description === undefined) meta.description = value
  }
  return meta
}

// Bytes of the name+description that ship in the prompt. Falls back to the
// on-disk name when frontmatter omits it (commands often do).
export function descBytes(meta: SkillMeta, fallbackName: string): number {
  return Buffer.byteLength((meta.name ?? fallbackName) + (meta.description ?? ''), 'utf8')
}

// Lowercased word set of a description, for Jaccard content comparison.
export function wordSet(text: string | undefined): Set<string> {
  const out = new Set<string>()
  if (!text) return out
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) if (w) out.add(w)
  return out
}
