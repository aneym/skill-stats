import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const MATCHER = 'Skill'
const LEGACY_COMMAND = 'skillstats hook'

// Pin absolute node + CLI paths: hooks run under Claude Code's shell PATH,
// where a repo-checkout (or nvm/volta) skillstats may not resolve.
function hookCommand(): string {
  const cli = process.argv[1] ? resolve(process.argv[1]) : null
  return cli ? `"${process.execPath}" "${cli}" hook` : LEGACY_COMMAND
}

function isOurCommand(command: string): boolean {
  return command === LEGACY_COMMAND || (command.includes('skillstats') && command.trimEnd().endsWith(' hook'))
}

interface HookCommand {
  type: string
  command: string
}

interface HookMatcher {
  matcher?: string
  hooks?: HookCommand[]
}

type Settings = Record<string, unknown>

export interface InstallResult {
  changed: boolean
  message: string
}

export function settingsPath(claudeDir: string): string {
  return join(claudeDir, 'settings.json')
}

// Idempotently add the PostToolUse Skill hook, preserving every other setting.
export function installHook(claudeDir: string): InstallResult {
  const path = settingsPath(claudeDir)
  const settings = readSettings(path)
  const postToolUse = ensureMatchers(settings, 'PostToolUse')

  let entry = postToolUse.find((m) => m.matcher === MATCHER)
  if (!entry) {
    entry = { matcher: MATCHER, hooks: [] }
    postToolUse.push(entry)
  }
  entry.hooks = entry.hooks ?? []

  const command = hookCommand()
  if (entry.hooks.some((h) => isOurCommand(h.command))) {
    return { changed: false, message: `Hook already installed in ${path}` }
  }
  entry.hooks.push({ type: 'command', command })
  writeSettings(path, settings)
  return { changed: true, message: `Installed PostToolUse "${MATCHER}" hook → "${command}" in ${path}` }
}

export function uninstallHook(claudeDir: string): InstallResult {
  const path = settingsPath(claudeDir)
  if (!existsSync(path)) return { changed: false, message: `No settings file at ${path}` }
  const settings = readSettings(path)
  const hooks = asRecord(settings.hooks)
  const postToolUse = asMatcherArray(hooks?.PostToolUse)
  if (!postToolUse) return { changed: false, message: `No skillstats hook found in ${path}` }

  let changed = false
  for (const m of postToolUse) {
    if (!m.hooks) continue
    const before = m.hooks.length
    m.hooks = m.hooks.filter((h) => !isOurCommand(h.command))
    if (m.hooks.length !== before) changed = true
  }
  const pruned = postToolUse.filter((m) => (m.hooks?.length ?? 0) > 0)
  if (hooks) hooks.PostToolUse = pruned

  if (!changed) return { changed: false, message: `No skillstats hook found in ${path}` }
  writeSettings(path, settings)
  return { changed: true, message: `Removed skillstats hook from ${path}` }
}

export function isHookInstalled(claudeDir: string): boolean {
  const settings = readSettings(settingsPath(claudeDir))
  const hooks = asRecord(settings.hooks)
  const postToolUse = asMatcherArray(hooks?.PostToolUse)
  if (!postToolUse) return false
  return postToolUse.some((m) => m.hooks?.some((h) => isOurCommand(h.command)))
}

function ensureMatchers(settings: Settings, event: string): HookMatcher[] {
  const hooks = (asRecord(settings.hooks) ?? {}) as Record<string, unknown>
  settings.hooks = hooks
  const existing = asMatcherArray(hooks[event])
  const arr = existing ?? []
  hooks[event] = arr
  return arr
}

function readSettings(path: string): Settings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return asRecord(parsed) ?? {}
  } catch {
    return {}
  }
}

function writeSettings(path: string, settings: Settings): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asMatcherArray(value: unknown): HookMatcher[] | undefined {
  return Array.isArray(value) ? (value as HookMatcher[]) : undefined
}
