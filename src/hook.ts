import { openDb } from './db.js'
import { skillHash } from './inventory.js'
import { currentMachine, makeInserter } from './ingest.js'

// A PostToolUse hook must NEVER break the user's Claude session: every failure
// path — garbage stdin, non-Skill tools, db errors — exits 0 and stays silent.
export async function runHook(dbPath: string, claudeDir: string): Promise<void> {
  try {
    const payload = await readStdin()
    const parsed: unknown = JSON.parse(payload)
    if (!isRecord(parsed)) return
    if (parsed.tool_name !== 'Skill') return

    const skill = extractSkill(parsed.tool_input)
    if (!skill) return

    const sessionId = typeof parsed.session_id === 'string' ? parsed.session_id : 'unknown'
    const ts = new Date().toISOString()
    const hash = safeHash(claudeDir, skill)

    const db = openDb(dbPath)
    makeInserter(db)({
      harness: 'claude-code',
      skill,
      source: 'hook',
      trigger: 'hook',
      sessionId,
      project: null,
      ts,
      skillHash: hash,
      origin: 'hook',
      machine: currentMachine(),
    })
    db.close()
  } catch {
    // swallow — a broken hook must not block the session
  }
}

function extractSkill(toolInput: unknown): string | null {
  if (isRecord(toolInput) && typeof toolInput.skill === 'string' && toolInput.skill) {
    return toolInput.skill
  }
  return null
}

function safeHash(claudeDir: string, skill: string): string | null {
  try {
    return skillHash(claudeDir, skill)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    if (process.stdin.isTTY) {
      resolve('')
      return
    }
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}
