#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { openDb } from './db.js'
import { backfill, backfillCodex } from './backfill.js'
import { computeReport, computeSkillDetail, type SkillRow } from './report.js'
import type { InventoryOptions } from './inventory.js'
import { runHook } from './hook.js'
import { recordOutcome, type Grade } from './outcome.js'
import { installHook, uninstallHook } from './settings.js'
import { doctor } from './doctor.js'
import { runMcp } from './mcp.js'
import { runDashboard } from './dashboard.js'
import { exportStream, importStream } from './transfer.js'
import { addRemote, removeRemote, readRemotes, syncRemotes } from './remotes.js'
import { runSetup } from './setup.js'
import {
  computeSweep,
  keepAdd,
  keepRemove,
  planMoves,
  performQuarantine,
  readManifest,
  restore,
  type SweepReport,
} from './sweep.js'
import { computeReconcile, type ReconcileGroup } from './reconcile.js'

interface Options {
  db: string
  claudeDir: string
  // Undefined when --claude-dir was not passed: report/skill then skip the
  // on-disk inventory instead of scanning the real ~/.claude.
  claudeDirExplicit: string | undefined
  codexDir: string
  // Same explicit-only rule for codex inventory: only scanned when passed.
  codexDirExplicit: string | undefined
  skillsRoots: string[]
  harness: string
  json: boolean
  days: number
  // Undefined when --days was not passed, so sweep can default to 45 while
  // report/skill keep their own 30-day default.
  daysRaw: string | undefined
  yes: boolean
  all: boolean
  grade?: string
  evidence?: string
  followed?: string
  ignored?: string
  session?: string
  host?: string
  path?: string
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

const HELP = `skill-stats — local-first skill-usage analytics for coding agents

Usage: skill-stats <command> [options]

Commands:
  backfill [--harness claude|codex] [--codex-dir <dir>]
                           Parse transcripts into the local db (idempotent).
                           Default harness=claude (~/.claude); codex reads
                           <codex-dir>/sessions rollouts (default ~/.codex)
  report [--json] [--days N] [--skills-root <dir>]...
                           Ranked usage report (default window 30 days)
  skill <name> [--json] [--skills-root <dir>]...
                           Drill-down for one skill (per-version rollup + recent activity)
  hook                     Ingest a PostToolUse payload from stdin (used by the installed hook)
  install | uninstall      Add/remove the PostToolUse Skill hook in settings.json
  outcome <skill> --grade worked|partial|failed [--evidence "..."]
                           Record whether a skill helped (evidence >=40 chars = trusted)
  export [--db <path>]     Dump events + outcomes as JSONL on stdout
  import <file> [--db]     Ingest a JSONL export (idempotent, machine-preserving)
  remote add <name> --host <ssh-host> [--path <repo-path>]
  remote remove <name>
  remote list [--json]
  remote sync [name]       Pull + import remotes over ssh (no name = all)
  sweep [--json] [--days N=45]
                           Cross-machine dead-weight candidates: skills in
                           inventory with zero events in the window on every
                           machine, ranked by frontmatter context cost. Read-only.
  sweep keep <name> | unkeep <name>
                           Keep-list a skill so it never appears as a candidate.
  sweep quarantine [--yes] Without --yes: print the move plan, move nothing.
                           With --yes: move each candidate's dir under
                           SKILLSTATS_HOME/quarantine (never deletes).
  sweep list [--json]      Show the quarantine manifest.
  sweep restore <name|--all>
                           Move quarantined skills back to their original path.
  reconcile [--json]       Read-only duplicate detection: same-name across
                           roots, near-duplicate names, near-identical
                           descriptions — with a keeper recommendation.
  doctor                   Diagnose setup (dirs, parse rate, hook, db, node:sqlite)
  mcp                      Run the stdio MCP server
  dashboard [--port N]     Serve a read-only HTML dashboard (default port 4173)
  setup [--dry-run] [--no-mcp] [--no-dashboard] [--no-hook] [--port N]
                           One command to stand up the whole system: env check,
                           backfill, hook install, MCP registration (Claude +
                           Codex), and a persistent launchd dashboard. Each step
                           reports ✓/·/! and never aborts the rest. --dry-run
                           prints the resolved plan and writes nothing.

Global options:
  --db <path>              Database path (default ~/.skill-analytics/skillstats.db)
  --claude-dir <dir>       Claude config dir (default ~/.claude)
  --skills-root <dir>      Extra skills root to inventory (repeatable)
  --help, -h               Show this help
  --version, -v            Show version
`

// Piping to `head` closes stdout early — exit clean instead of stack-tracing.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
  throw err
})

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      db: { type: 'string' },
      'claude-dir': { type: 'string' },
      'codex-dir': { type: 'string' },
      'skills-root': { type: 'string', multiple: true },
      harness: { type: 'string' },
      json: { type: 'boolean', default: false },
      days: { type: 'string' },
      yes: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      grade: { type: 'string' },
      evidence: { type: 'string' },
      followed: { type: 'string' },
      ignored: { type: 'string' },
      session: { type: 'string' },
      host: { type: 'string' },
      path: { type: 'string' },
      port: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'no-mcp': { type: 'boolean', default: false },
      'no-dashboard': { type: 'boolean', default: false },
      'no-hook': { type: 'boolean', default: false },
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
    // Explicit flag wins; otherwise scan the real ~/.claude when it exists.
    // undefined (no flag, no dir) = skip inventory rather than error.
    claudeDirExplicit:
      values['claude-dir'] ?? (existsSync(join(homedir(), '.claude')) ? join(homedir(), '.claude') : undefined),
    codexDir: values['codex-dir'] ?? join(homedir(), '.codex'),
    codexDirExplicit: values['codex-dir'],
    skillsRoots: values['skills-root'] ?? [],
    harness: values.harness ?? 'claude',
    json: values.json ?? false,
    days: parseDays(values.days),
    daysRaw: values.days,
    yes: values.yes ?? false,
    all: values.all ?? false,
    grade: values.grade,
    evidence: values.evidence,
    followed: values.followed,
    ignored: values.ignored,
    session: values.session,
    host: values.host,
    path: values.path,
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
    case 'export':
      return cmdExport(opts)
    case 'import':
      return cmdImport(opts, positionals[1])
    case 'remote':
      return cmdRemote(opts, positionals)
    case 'sweep':
      return cmdSweep(opts, positionals)
    case 'reconcile':
      return cmdReconcile(opts)
    case 'doctor':
      return cmdDoctor(opts)
    case 'mcp':
      await runMcp(opts.db, opts.claudeDir)
      return 0
    case 'dashboard':
      runDashboard(opts.db, opts.claudeDir, opts.codexDir, opts.port)
      return 0
    case 'setup':
      return runSetup({
        db: opts.db,
        claudeDir: opts.claudeDir,
        codexDir: opts.codexDir,
        port: opts.port,
        dryRun: values['dry-run'] ?? false,
        noMcp: values['no-mcp'] ?? false,
        noDashboard: values['no-dashboard'] ?? false,
        noHook: values['no-hook'] ?? false,
        cliPath: process.argv[1] ? resolve(process.argv[1]) : join(dirname(fileURLToPath(import.meta.url)), 'cli.js'),
      })
    default:
      process.stderr.write(`unknown command: ${command}\n\n${HELP}`)
      return 1
  }
}

function cmdBackfill(opts: Options): number {
  if (opts.harness !== 'claude' && opts.harness !== 'codex') {
    process.stderr.write('--harness must be one of: claude, codex\n')
    return 1
  }
  const db = openDb(opts.db)
  const s = opts.harness === 'codex' ? backfillCodex(db, opts.codexDir) : backfill(db, opts.claudeDir)
  db.close()
  process.stdout.write(
    `scanned ${s.scanned} file(s) · added ${s.added} · skipped ${s.skipped} · corrupt ${s.corrupt} line(s)\n`
  )
  return 0
}

function inventoryOptions(opts: Options): InventoryOptions {
  return {
    claudeDir: opts.claudeDirExplicit,
    skillsRoots: opts.skillsRoots,
    codexDir: opts.codexDirExplicit,
  }
}

function cmdReport(opts: Options): number {
  const db = openDb(opts.db)
  const report = computeReport(db, inventoryOptions(opts), opts.days)
  db.close()
  if (opts.json) {
    process.stdout.write(JSON.stringify(report) + '\n')
    return 0
  }
  process.stdout.write(`skill-stats report · window ${report.days}d · ${report.skills.length} skills\n\n`)
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
    process.stderr.write('usage: skill-stats skill <name>\n')
    return 1
  }
  const db = openDb(opts.db)
  const detail = computeSkillDetail(db, inventoryOptions(opts), name, opts.days)
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

function cmdExport(opts: Options): number {
  const db = openDb(opts.db)
  process.stdout.write(exportStream(db))
  db.close()
  return 0
}

function cmdImport(opts: Options, file: string | undefined): number {
  if (!file) {
    process.stderr.write('usage: skill-stats import <file>\n')
    return 1
  }
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    process.stderr.write(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
  const db = openDb(opts.db)
  const stats = importStream(db, text)
  db.close()
  process.stdout.write(`imported ${stats.added} · skipped ${stats.skipped}\n`)
  return 0
}

function cmdRemote(opts: Options, positionals: string[]): number {
  const sub = positionals[1]
  switch (sub) {
    case 'add': {
      const name = positionals[2]
      if (!name || !opts.host) {
        process.stderr.write('usage: skill-stats remote add <name> --host <ssh-host> [--path <repo-path>]\n')
        return 1
      }
      const remote = addRemote(name, opts.host, opts.path)
      process.stdout.write(`added remote ${remote.name} → ${remote.host}:${remote.path}\n`)
      return 0
    }
    case 'remove': {
      const name = positionals[2]
      if (!name) {
        process.stderr.write('usage: skill-stats remote remove <name>\n')
        return 1
      }
      process.stdout.write(removeRemote(name) ? `removed remote ${name}\n` : `no remote named ${name}\n`)
      return 0
    }
    case 'list': {
      const remotes = readRemotes()
      if (opts.json) {
        process.stdout.write(JSON.stringify(remotes) + '\n')
        return 0
      }
      if (!remotes.length) {
        process.stdout.write('no remotes configured\n')
        return 0
      }
      for (const r of remotes) {
        process.stdout.write(`${r.name}\t${r.host}\t${r.path}\t${r.lastSync ?? 'never'}\n`)
      }
      return 0
    }
    case 'sync': {
      const db = openDb(opts.db)
      const results = syncRemotes(db, positionals[2])
      db.close()
      if (!results.length) {
        process.stdout.write('no remotes to sync\n')
        return 0
      }
      for (const r of results) {
        process.stdout.write(
          r.error
            ? `${r.name}: error — ${r.error}\n`
            : `${r.name}: added ${r.added} · skipped ${r.skipped}\n`
        )
      }
      return 0
    }
    default:
      process.stderr.write('usage: skill-stats remote <add|remove|list|sync> ...\n')
      return 1
  }
}

function cmdSweep(opts: Options, positionals: string[]): number {
  const sub = positionals[1]
  switch (sub) {
    case undefined:
      return sweepShow(opts)
    case 'keep':
    case 'unkeep':
      return sweepKeepList(sub, positionals[2])
    case 'quarantine':
      return sweepQuarantine(opts)
    case 'list':
      return sweepListManifest(opts)
    case 'restore':
      return sweepRestore(opts, positionals[2])
    default:
      process.stderr.write('usage: skill-stats sweep [keep|unkeep <name>|quarantine [--yes]|list|restore <name|--all>]\n')
      return 1
  }
}

function sweepDays(opts: Options): number {
  return opts.daysRaw === undefined ? 45 : opts.days
}

function sweepShow(opts: Options): number {
  const db = openDb(opts.db)
  const report = computeSweep(db, inventoryOptions(opts), sweepDays(opts))
  db.close()
  if (opts.json) {
    process.stdout.write(JSON.stringify(report) + '\n')
    return 0
  }
  process.stdout.write(sweepHuman(report))
  return 0
}

function sweepHuman(report: SweepReport): string {
  const lines: string[] = []
  lines.push(`skill-stats sweep · window ${report.days}d · ${report.candidates.length} candidate(s) · ~${report.estTokensPerTurn} tok/turn reclaimable`)
  if (report.historyDays < 60) {
    lines.push(`  caveat: only ${report.historyDays}d of history backs these dormancy calls — thin evidence; re-run after more usage accrues.`)
  }
  lines.push('')
  lines.push(pad('SKILL', 28) + pad('SOURCE', 12) + pad('BYTES', 8) + 'LAST USED')
  for (const c of report.candidates) {
    lines.push(pad(c.name, 28) + pad(c.source, 12) + pad(String(c.descBytes), 8) + (c.lastUsed ?? '—'))
  }
  if (report.pluginBound.length) {
    lines.push('')
    lines.push(`plugin-bound (${report.pluginBound.length}) — disable the plugin instead, do not move files:`)
    for (const c of report.pluginBound) lines.push(`  ${c.name}`)
  }
  return lines.join('\n') + '\n'
}

function sweepKeepList(sub: 'keep' | 'unkeep', name: string | undefined): number {
  if (!name) {
    process.stderr.write(`usage: skill-stats sweep ${sub} <name>\n`)
    return 1
  }
  const changed = sub === 'keep' ? keepAdd(name) : keepRemove(name)
  const verb = sub === 'keep' ? 'keep-listed' : 'removed from keep-list'
  process.stdout.write(changed ? `${verb} ${name}\n` : `${name} already ${sub === 'keep' ? 'kept' : 'not kept'}\n`)
  return 0
}

function sweepQuarantine(opts: Options): number {
  const db = openDb(opts.db)
  const report = computeSweep(db, inventoryOptions(opts), sweepDays(opts))
  db.close()
  const candidates = report.candidates
  if (!opts.yes) {
    process.stdout.write(`sweep quarantine plan — ${candidates.length} skill(s), nothing moved (pass --yes to execute):\n`)
    for (const p of planMoves(candidates)) {
      process.stdout.write(`  ${p.name}\n    from ${p.src}\n    to   ${p.dest}\n`)
    }
    return 0
  }
  const moved = performQuarantine(candidates)
  process.stdout.write(`quarantined ${moved.length} skill(s): ${moved.join(', ') || '(none)'}\n`)
  return 0
}

function sweepListManifest(opts: Options): number {
  const entries = readManifest()
  if (opts.json) {
    process.stdout.write(JSON.stringify(entries) + '\n')
    return 0
  }
  if (!entries.length) {
    process.stdout.write('quarantine is empty\n')
    return 0
  }
  for (const e of entries) process.stdout.write(`${e.name}\t${e.quarantinedAt}\t${e.originalPath}\n`)
  return 0
}

function sweepRestore(opts: Options, name: string | undefined): number {
  const target = opts.all ? '--all' : name
  if (!target) {
    process.stderr.write('usage: skill-stats sweep restore <name|--all>\n')
    return 1
  }
  const res = restore(target)
  if (res.missing.length) {
    process.stdout.write(`no quarantined skill named ${res.missing.join(', ')}\n`)
    return 1
  }
  process.stdout.write(`restored ${res.restored.length} skill(s): ${res.restored.join(', ') || '(none)'}\n`)
  return 0
}

function cmdReconcile(opts: Options): number {
  const db = openDb(opts.db)
  const result = computeReconcile(db, inventoryOptions(opts))
  db.close()
  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + '\n')
    return 0
  }
  if (!result.groups.length) {
    process.stdout.write('reconcile · no duplicate or near-duplicate skills found\n')
    return 0
  }
  process.stdout.write(`reconcile · ${result.groups.length} group(s)\n`)
  for (const g of result.groups) process.stdout.write(reconcileGroupHuman(g))
  return 0
}

function reconcileGroupHuman(g: ReconcileGroup): string {
  const lines: string[] = ['', `[${g.kind}] ${g.members.map((m) => m.name).join(' · ')}`]
  for (const m of g.members) {
    lines.push(`  ${m.name} (${m.source}) — ${m.invocations} invoke(s), last ${m.lastUsed ?? '—'}, ${m.path}`)
  }
  lines.push(`  → ${g.recommendation}`)
  return lines.join('\n') + '\n'
}

function cmdOutcome(opts: Options, skill: string | undefined): number {
  if (!skill) {
    process.stderr.write('usage: skill-stats outcome <skill> --grade worked|partial|failed\n')
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
