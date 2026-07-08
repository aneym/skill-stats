import { readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

export interface Activation {
  skill: string
  trigger: 'model' | 'user-slash'
  sessionId: string
  project: string
  ts: string | null
  source: string
  tokensAfter: number
  errorsAfter: number
}

export interface ParseResult {
  activations: Activation[]
  corrupt: number
  entries: number
}

interface Entry {
  type?: string
  sessionId?: string
  timestamp?: string
  message?: {
    role?: string
    content?: unknown
    usage?: { output_tokens?: number }
  }
}

const COMMAND_RE = /<command-name>([^<]*)<\/command-name>/

export function parseTranscript(filePath: string): ParseResult {
  const raw = safeRead(filePath)
  const entries: Entry[] = []
  let corrupt = 0
  for (const rawLine of raw.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed) as Entry)
    } catch {
      corrupt++
    }
  }

  const sessionFallback = basename(filePath).replace(/\.jsonl$/, '')
  const project = basename(dirname(filePath))
  const activations: Activation[] = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const sessionId = entry.sessionId || sessionFallback
    const ts = entry.timestamp ?? null

    if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        const skill = skillFromToolUse(block)
        if (skill) {
          activations.push(build(skill, 'model', sessionId, project, ts, filePath, entries, i))
        }
      }
    } else if (entry.type === 'user') {
      const skill = skillFromSlash(entry.message?.content)
      if (skill) {
        activations.push(build(skill, 'user-slash', sessionId, project, ts, filePath, entries, i))
      }
    }
  }

  return { activations, corrupt, entries: entries.length }
}

function build(
  skill: string,
  trigger: Activation['trigger'],
  sessionId: string,
  project: string,
  ts: string | null,
  source: string,
  entries: Entry[],
  index: number
): Activation {
  const { tokensAfter, errorsAfter } = hardSignals(entries, index)
  return { skill, trigger, sessionId, project, ts, source, tokensAfter, errorsAfter }
}

// tokensAfter: output_tokens summed over the next up-to-5 assistant entries.
// errorsAfter: is_error tool_result blocks within the next 10 entries.
function hardSignals(entries: Entry[], index: number): { tokensAfter: number; errorsAfter: number } {
  let tokensAfter = 0
  let assistantSeen = 0
  for (let j = index + 1; j < entries.length && assistantSeen < 5; j++) {
    if (entries[j].type === 'assistant') {
      tokensAfter += toInt(entries[j].message?.usage?.output_tokens)
      assistantSeen++
    }
  }
  let errorsAfter = 0
  for (let j = index + 1; j < entries.length && j <= index + 10; j++) {
    const content = entries[j].message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (isRecord(block) && block.type === 'tool_result' && block.is_error === true) errorsAfter++
      }
    }
  }
  return { tokensAfter, errorsAfter }
}

function skillFromToolUse(block: unknown): string | null {
  if (!isRecord(block)) return null
  if (block.type !== 'tool_use' || block.name !== 'Skill') return null
  const input = block.input
  if (isRecord(input) && typeof input.skill === 'string' && input.skill) return input.skill
  return null
}

function skillFromSlash(content: unknown): string | null {
  const text = collectText(content)
  const match = text.match(COMMAND_RE)
  if (!match) return null
  const name = match[1].replace(/^\//, '').trim()
  return name || null
}

function collectText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
      .join('\n')
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}
