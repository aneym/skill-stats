import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

// Codex rollout adapter. A Codex session is a JSONL rollout at
// <codex-dir>/sessions/YYYY/MM/DD/rollout-*.jsonl. Its first line is a
// {type:"session_meta", payload:{session_id, cwd}} record; subsequent lines are
// response items. A skill activates when the model reads its SKILL.md via a
// function_call (exec_command / shell / any tool) whose serialized arguments
// reference a path ending in /SKILL.md. Skill name = basename of that file's
// parent directory. Progressive disclosure re-reads one file many times, so we
// keep only the FIRST read per (session, skill).

export interface CodexActivation {
  skill: string
  sessionId: string
  project: string
  ts: string | null
}

export interface CodexParseResult {
  activations: CodexActivation[]
  corrupt: number
}

// A path token ending in /SKILL.md, stopping at whitespace or a JSON quote.
const SKILL_PATH_RE = /([^\s"'\\]+)\/SKILL\.md/

export function parseRollout(filePath: string): CodexParseResult {
  const raw = safeRead(filePath)
  let sessionId = ''
  let project = ''
  let corrupt = 0
  const firstBySkill = new Map<string, string | null>()
  const order: string[] = []

  for (const rawLine of raw.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    let entry: unknown
    try {
      entry = JSON.parse(trimmed)
    } catch {
      corrupt++
      continue
    }
    if (!isRecord(entry)) continue
    const payload = isRecord(entry.payload) ? entry.payload : null

    if (entry.type === 'session_meta' && payload) {
      // Real rollouts key the id as `id`; some shapes also carry `session_id`.
      if (typeof payload.session_id === 'string') sessionId = payload.session_id
      else if (typeof payload.id === 'string') sessionId = payload.id
      if (typeof payload.cwd === 'string') project = payload.cwd
      continue
    }

    // Only function_call entries create events — SKILL.md paths appearing in
    // message / instruction text (the system prompt lists every skill) do not.
    if (!payload || payload.type !== 'function_call') continue
    const skill = skillFromArgs(payload.arguments)
    if (!skill) continue
    if (!firstBySkill.has(skill)) {
      firstBySkill.set(skill, typeof entry.timestamp === 'string' ? entry.timestamp : null)
      order.push(skill)
    }
  }

  const sid = sessionId || basename(filePath).replace(/\.jsonl$/, '')
  const activations = order.map((skill) => ({
    skill,
    sessionId: sid,
    project,
    ts: firstBySkill.get(skill) ?? null,
  }))
  return { activations, corrupt }
}

// arguments may arrive as a JSON string or an already-parsed object.
function skillFromArgs(args: unknown): string | null {
  const serialized =
    typeof args === 'string' ? args : args == null ? '' : safeStringify(args)
  const match = serialized.match(SKILL_PATH_RE)
  if (!match) return null
  const name = basename(match[1])
  return name || null
}

export function rolloutFiles(codexDir: string): string[] {
  const files: string[] = []
  walk(join(codexDir, 'sessions'), 0, (path) => {
    if (path.endsWith('.jsonl')) files.push(path)
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

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}
