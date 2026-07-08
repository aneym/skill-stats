#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { openDb } from './db.js'
import { backfill } from './backfill.js'
import { computeReport, computeSkillDetail, type SkillRow } from './report.js'
import { runHook } from './hook.js'
import { recordOutcome, type Grade } from './outcome.js'
import { installHook, uninstallHook } from './settings.js'
import { doctor } from './doctor.js'
import { runMcp } from './mcp.js'
import { runDashboard } from './dashboard.js'

interface Options {
  db: string
  claudeDir: string
  json: boolean
  days: number
  grade?: string
  evidence?: string
  followed?: string
  ignored?: string
  session?: string
  port: number
}

function defaultDb(): string {
  const base = process.env.SKILLSTATS_HOME ?? join(homedir(), '.skill-analytics')
  return join(base, 'skillstats.db')
}

function version(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const pkg: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (typeof pkg === 'object' && pkg !== null && 'version' in pkg) {
      const v = (pkg as { version?: unknown }).version
      if (typeof v === 'string') return v
    }
  } catch {
    // fall through
  }
  return '0.1.0'
}

const HELP = `skillstats — local-first skill-usage analytics for Claude Code

Usage: skillstats <command> [options]

Commands:
  backfill                 Parse ~/.claude transcripts into the local db (idempotent)
  report [--json] [--days N]   Ranked usage report (default window 30 days)
  skill <name> [--json]    Drill-down for one skill (per-version rollup + recent activity)
  hook                     Ingest a PostToolUse payload from stdin (used by the installed hook)
  install | uninstall      Add/remove the PostToolUse Skill hook in settings.json
  outcome <skill> --grade worked|partial|failed [--evidence "..."]
                           Record whether a skill helped (evidence >=40 chars = trusted)
  doctor                   Diagnose setup (dirs, parse rate, hook, db, node:sqlite)
  mcp                      Run the stdio MCP server
  dashboard [--port N]     Serve a read-only HTML dashboard (default port 4173)

Global options:
  --db <path>              Database path (default ~/.skill-analytics/skillstats.db)
  --claude-dir <dir>       Claude config dir (default ~/.claude)
  --help, -h               Show this help
  --version, -v            Show version
`

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      db: { type: 'string' },
      'claude-dir': { type: 'string' },
      json: { type: 'boolean', default: false },
      days: { type: 'string' },
      grade: { type: 'string' },
      evidence: { type: 'string' },
      followed: { type: 'string' },
      ignored: { type: 'string' },
      session: { type: 'string' },
      port: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  })

  if (values.version) {
    process.stdout.write(version() + '\n')
    return 0
  }
  const command = positionals[0]
  if (values.help || !command) {
    process.stdout.write(HELP)
    return command ? 0 : 0
  }

  const opts: Options = {
    db: values.db ?? defaultDb(),
    claudeDir: values['claude-dir'] ?? join(homedir(), '.claude'),
    json: values.json ?? false,
    days: parseDays(values.days),
    grade: values.grade,
    evidence: values.evidence,
    followed: values.followed,
    ignored: values.ignored,
    session: values.session,
    port: parsePort(values.port),
  }

  switch (command) {
    case 'backfill':
      return cmdBackfill(opts)
    case 'report':
      return cmdReport(opts)
    case 'skill':
      return cmdSkill(opts, positionals[1])
    case 'hook':
      await runHook(opts.db, opts.claudeDir)
      return 0
    case 'install':
      return cmdInstall(opts, false)
    case 'uninstall':
      return cmdInstall(opts, true)
    case 'outcome':
      return cmdOutcome(opts, positionals[1])
    case 'doctor':
      return cmdDoctor(opts)
    case 'mcp':
      await runMcp(opts.db, opts.claudeDir)
      return 0
    case 'dashboard':
      runDashboard(opts.db, opts.claudeDir, opts.port)
      return 0
    default:
      process.stderr.write(`unknown command: ${command}\n\n${HELP}`)
      return 1
  }
}

function cmdBackfill(opts: Options): number {
  const db = openDb(opts.db)
  const s = backfill(db, opts.claudeDir)
  db.close()
  process.stdout.write(
    `scanned ${s.scanned} file(s) · added ${s.added} · skipped ${s.skipped} · corrupt ${s.corrupt} line(s)\n`
  )
  return 0
}

function cmdReport(opts: Options): number {
  const db = openDb(opts.db)
  const report = computeReport(db, opts.claudeDir, opts.days)
  db.close()
  if (opts.json) {
    process.stdout.write(JSON.stringify(report) + '\n')
    return 0
  }
  process.stdout.write(`skillstats report · window ${report.days}d · ${report.skills.length} skills\n\n`)
  process.stdout.write(pad('SKILL', 24) + pad('INVOKES', 9) + pad('TOKENS', 10) + pad('ERRORS', 8) + pad('OUTCOMES', 16) + 'LAST USED\n')
  for (const s of report.skills) process.stdout.write(reportLine(s))
  return 0
}

function reportLine(s: SkillRow): string {
  const outcomes = `${s.outcomes.worked}/${s.outcomes.partial}/${s.outcomes.failed} (${s.outcomes.untrusted}u)`
  const name = s.dormant ? `${s.name} *` : s.name
  return (
    pad(name, 24) +
    pad(String(s.invocations), 9) +
    pad(String(s.tokensAfter), 10) +
    pad(String(s.errorsAfter), 8) +
    pad(outcomes, 16) +
    (s.lastUsed ?? '—') +
    '\n'
  )
}

function cmdSkill(opts: Options, name: string | undefined): number {
  if (!name) {
    process.stderr.write('usage: skillstats skill <name>\n')
    return 1
  }
  const db = openDb(opts.db)
  const detail = computeSkillDetail(db, opts.claudeDir, name, opts.days)
  db.close()
  if (opts.json) {
    process.stdout.write(JSON.stringify(detail) + '\n')
    return 0
  }
  process.stdout.write(`skill: ${detail.name}\n`)
  process.stdout.write(`  invocations: ${detail.invocations}${detail.dormant ? ' (dormant)' : ''}\n`)
  process.stdout.write(`  last used:   ${detail.lastUsed ?? '—'}\n`)
  process.stdout.write(`  tokens after: ${detail.tokensAfter} · errors after: ${detail.errorsAfter}\n`)
  process.stdout.write(
    `  outcomes: worked ${detail.outcomes.worked} · partial ${detail.outcomes.partial} · failed ${detail.outcomes.failed} · untrusted ${detail.outcomes.untrusted}\n`
  )
  process.stdout.write('  versions:\n')
  for (const v of detail.versions) {
    process.stdout.write(`    ${v.skillHash ?? '(unknown)'}: ${v.invocations} invoke(s), ${v.tokensAfter} tokens, ${v.errorsAfter} errors\n`)
  }
  process.stdout.write('  recent:\n')
  for (const a of detail.recent) {
    process.stdout.write(`    ${a.ts ?? '—'} · ${a.trigger ?? '?'} · ${a.origin ?? '?'} · ${a.sessionId ?? '?'}\n`)
  }
  return 0
}

function cmdInstall(opts: Options, uninstall: boolean): number {
  const res = uninstall ? uninstallHook(opts.claudeDir) : installHook(opts.claudeDir)
  process.stdout.write(res.message + '\n')
  return 0
}

function cmdOutcome(opts: Options, skill: string | undefined): number {
  if (!skill) {
    process.stderr.write('usage: skillstats outcome <skill> --grade worked|partial|failed\n')
    return 1
  }
  if (!isGrade(opts.grade)) {
    process.stderr.write('--grade must be one of: worked, partial, failed\n')
    return 1
  }
  const db = openDb(opts.db)
  const res = recordOutcome(db, {
    skill,
    grade: opts.grade,
    evidence: opts.evidence,
    followed: opts.followed,
    ignored: opts.ignored,
    sessionId: opts.session,
  })
  db.close()
  process.stdout.write(
    res.trusted
      ? `recorded ${opts.grade} for ${skill} (trusted)\n`
      : `recorded ${opts.grade} for ${skill} (untrusted — evidence under 40 chars)\n`
  )
  return 0
}

function cmdDoctor(opts: Options): number {
  const result = doctor(opts.db, opts.claudeDir)
  for (const c of result.checks) {
    const mark = c.status === 'ok' ? 'ok  ' : c.status === 'warn' ? 'warn' : 'FAIL'
    process.stdout.write(`[${mark}] ${c.name}: ${c.detail}\n`)
  }
  return result.hardFailure ? 1 : 0
}

function pad(value: string, width: number): string {
  return value.length >= width ? value + ' ' : value + ' '.repeat(width - value.length)
}

function parseDays(raw: string | undefined): number {
  const n = raw === undefined ? 30 : Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 30
}

function parsePort(raw: string | undefined): number {
  const n = raw === undefined ? 4173 : Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 4173
}

function isGrade(value: string | undefined): value is Grade {
  return value === 'worked' || value === 'partial' || value === 'failed'
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })
