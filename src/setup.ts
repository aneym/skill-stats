import { createServer as netServer } from 'node:net'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  statSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  accessSync,
  constants as fsConstants,
} from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import { openDb, get } from './db.js'
import { backfill, backfillCodex } from './backfill.js'
import { installHook, settingsPath } from './settings.js'

export interface SetupOptions {
  db: string
  claudeDir: string
  codexDir: string
  port: number
  dryRun: boolean
  noMcp: boolean
  noDashboard: boolean
  noHook: boolean
  // Absolute path to this CLI's dist/cli.js — pinned into hook/mcp/plist commands.
  cliPath: string
}

const OLD_DASHBOARD_LABEL = 'com.aneym.skillstats.dashboard'
const DASHBOARD_LABEL = 'com.skill-stats.dashboard'

// Each step emits exactly one status line and never throws; `runSetup` returns 0
// unless every step that actually ran failed. --dry-run resolves the same plan
// but writes nothing (no db, no settings, no launchd, no subprocess side effects).
export async function runSetup(opts: SetupOptions): Promise<number> {
  if (opts.dryRun) return dryRun(opts)

  let done = 0
  let failed = 0
  const emit = (kind: 'done' | 'skip' | 'fail', msg: string): void => {
    const mark = kind === 'done' ? '✓' : kind === 'skip' ? '·' : '!'
    process.stdout.write(`${mark} ${msg}\n`)
    if (kind === 'done') done++
    else if (kind === 'fail') failed++
  }

  const claudeExists = isDir(opts.claudeDir)
  const codexExists = isDir(opts.codexDir)

  // 1. Env check
  const sqliteOk = nodeSqliteWorks()
  emit(
    sqliteOk ? 'done' : 'fail',
    `env: node:sqlite ${sqliteOk ? 'available' : 'UNAVAILABLE — upgrade to node >=22.5'}` +
      ` · claude dir ${claudeExists ? 'found' : 'missing'} · codex dir ${codexExists ? 'found' : 'missing'}`
  )

  // 2. Backfill (claude and/or codex, whichever dirs exist)
  if (claudeExists || codexExists) {
    try {
      const db = openDb(opts.db)
      let claudeAdded = 0
      let codexAdded = 0
      if (claudeExists) claudeAdded = backfill(db, opts.claudeDir).added
      if (codexExists) codexAdded = backfillCodex(db, opts.codexDir).added
      db.close()
      const parts: string[] = []
      if (claudeExists) parts.push(`claude +${claudeAdded}`)
      if (codexExists) parts.push(`codex +${codexAdded}`)
      emit('done', `backfill: ${parts.join(' · ')}`)
    } catch (err) {
      emit('fail', `backfill: ${describe(err)} — run \`skill-stats backfill\` manually`)
    }
  } else {
    emit('skip', 'backfill: skipped — no claude or codex dir on disk')
  }

  // 3. Hook install
  if (opts.noHook) {
    emit('skip', 'hook: skipped (--no-hook)')
  } else {
    try {
      const res = installHook(opts.claudeDir)
      emit('done', `hook: ${res.changed ? 'installed' : 'already present'} in ${settingsPath(opts.claudeDir)}`)
    } catch (err) {
      emit('fail', `hook: ${describe(err)} — run \`skill-stats install\` manually`)
    }
  }

  // 4. MCP registration (Claude Code + Codex)
  if (opts.noMcp) {
    emit('skip', 'mcp: skipped (--no-mcp)')
  } else {
    registerMcpClaude(opts, emit)
    registerMcpCodex(opts, emit)
  }

  // 5. Dashboard persistence
  if (opts.noDashboard) {
    emit('skip', 'dashboard: skipped (--no-dashboard)')
  } else {
    await setupDashboard(opts, emit)
  }

  // 6. Summary
  printSummary(opts)

  return done === 0 && failed > 0 ? 1 : 0
}

function registerMcpClaude(
  opts: SetupOptions,
  emit: (kind: 'done' | 'skip' | 'fail', msg: string) => void
): void {
  const addArgs = ['mcp', 'add', '--scope', 'user', 'skill-stats', '--', process.execPath, opts.cliPath, 'mcp']
  const claudeBin = whichBin('claude')
  if (!claudeBin) {
    emit('skip', `mcp (claude): no \`claude\` on PATH — run: claude ${addArgs.join(' ')}`)
    return
  }
  try {
    const res = spawnSync(claudeBin, addArgs, { encoding: 'utf8' })
    const already = /already exists/i.test(res.stderr ?? '')
    if (res.status === 0 || already) {
      emit('done', `mcp (claude): registered${already ? ' (already present)' : ''}`)
    } else {
      emit('fail', `mcp (claude): ${firstLine(res.stderr) || 'failed'} — run: claude ${addArgs.join(' ')}`)
    }
  } catch (err) {
    emit('fail', `mcp (claude): ${describe(err)} — run: claude ${addArgs.join(' ')}`)
  }
}

function codexTomlBlock(cliPath: string): string {
  return `\n[mcp_servers.skill-stats]\ncommand = ${jsonStr(process.execPath)}\nargs = [${jsonStr(cliPath)}, "mcp"]\n`
}

function registerMcpCodex(
  opts: SetupOptions,
  emit: (kind: 'done' | 'skip' | 'fail', msg: string) => void
): void {
  const configPath = join(opts.codexDir, 'config.toml')
  if (!existsSync(configPath)) {
    emit('skip', `mcp (codex): no ${configPath} — skipping codex registration`)
    return
  }
  const block = codexTomlBlock(opts.cliPath)
  try {
    // Resolve symlinks so we append to the real file, not clobber the link.
    const real = realpathSync(configPath)
    const current = readFileSync(real, 'utf8')
    if (current.includes('mcp_servers.skill-stats')) {
      emit('done', 'mcp (codex): already present')
      return
    }
    const sep = current.endsWith('\n') ? '' : '\n'
    writeFileSync(real, current + sep + block)
    emit('done', `mcp (codex): appended block to ${real}`)
  } catch (err) {
    emit('fail', `mcp (codex): ${describe(err)} — add this block manually:\n${block}`)
  }
}

async function setupDashboard(
  opts: SetupOptions,
  emit: (kind: 'done' | 'skip' | 'fail', msg: string) => void
): Promise<void> {
  if (platform() !== 'darwin') {
    emit('skip', `dashboard: non-darwin — run \`skill-stats dashboard --port ${opts.port}\` yourself`)
    return
  }
  if (launchctlLoaded(OLD_DASHBOARD_LABEL)) {
    emit('skip', `dashboard: ${OLD_DASHBOARD_LABEL} already loaded — not double-serving`)
    return
  }

  const port = await pickPort(opts.port)
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${DASHBOARD_LABEL}.plist`)
  try {
    writeFileSync(plistPath, plistBody(DASHBOARD_LABEL, opts.cliPath, port))
  } catch (err) {
    emit('fail', `dashboard: cannot write ${plistPath} — ${describe(err)}`)
    return
  }

  const domain = `gui/${uid()}`
  spawnSync('launchctl', ['bootout', `${domain}/${DASHBOARD_LABEL}`], { encoding: 'utf8' })
  const boot = spawnSync('launchctl', ['bootstrap', domain, plistPath], { encoding: 'utf8' })
  if (boot.status !== 0) {
    emit('fail', `dashboard: launchctl bootstrap failed — ${firstLine(boot.stderr) || 'unknown'} (plist at ${plistPath})`)
    return
  }

  const ok = await pollHttpOk(port, 3000)
  if (ok) {
    emit('done', `dashboard: serving on http://localhost:${port} (launchd ${DASHBOARD_LABEL})`)
  } else {
    emit('fail', `dashboard: launchd loaded but http://localhost:${port}/ not answering yet — check \`launchctl print ${domain}/${DASHBOARD_LABEL}\``)
  }
}

function printSummary(opts: SetupOptions): void {
  let events = 0
  let skills = 0
  try {
    const db = openDb(opts.db)
    events = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM events')?.n ?? 0
    skills = get<{ n: number }>(db, 'SELECT COUNT(DISTINCT skill) AS n FROM events')?.n ?? 0
    db.close()
  } catch {
    // summary is best-effort; a missing db just shows zeros
  }
  process.stdout.write('\nsetup complete.\n')
  process.stdout.write(`  db: ${opts.db} · ${events} event(s) across ${skills} skill(s)\n`)
  process.stdout.write('  next: npx skill-stats report   ·   for another machine: npx skill-stats remote add <name> --host <ssh-host>\n')
}

function dryRun(opts: SetupOptions): number {
  const claudeExists = isDir(opts.claudeDir)
  const codexExists = isDir(opts.codexDir)
  const w = (s: string): void => {
    process.stdout.write(s + '\n')
  }

  w('setup --dry-run · plan only, nothing will be written\n')
  w(`  db:         ${opts.db}`)
  w(`  claude dir: ${opts.claudeDir} (${claudeExists ? 'exists' : 'missing'})`)
  w(`  codex dir:  ${opts.codexDir} (${codexExists ? 'exists' : 'missing'})`)
  w(`  cli:        ${opts.cliPath}`)
  w('')

  w(`1. env check: node:sqlite ${nodeSqliteWorks() ? 'available' : 'UNAVAILABLE'}`)

  if (claudeExists || codexExists) {
    const parts: string[] = []
    if (claudeExists) parts.push('claude')
    if (codexExists) parts.push('codex')
    w(`2. backfill: would parse ${parts.join(' + ')} transcripts into ${opts.db}`)
  } else {
    w('2. backfill: would skip — no claude or codex dir on disk')
  }

  w(
    opts.noHook
      ? '3. hook: would skip (--no-hook)'
      : `3. hook: would install PostToolUse Skill hook in ${settingsPath(opts.claudeDir)}`
  )

  if (opts.noMcp) {
    w('4. mcp: would skip (--no-mcp)')
  } else {
    const claudeBin = whichBin('claude')
    w(
      claudeBin
        ? `4. mcp (claude): would run \`${claudeBin} mcp add --scope user skill-stats -- ${process.execPath} ${opts.cliPath} mcp\``
        : '4. mcp (claude): no `claude` on PATH — would print the add command for you'
    )
    const configPath = join(opts.codexDir, 'config.toml')
    if (!existsSync(configPath)) {
      w(`   mcp (codex): would skip — no ${configPath}`)
    } else {
      let present = false
      try {
        present = readFileSync(realpathSync(configPath), 'utf8').includes('mcp_servers.skill-stats')
      } catch {
        present = false
      }
      w(
        present
          ? `   mcp (codex): already present in ${configPath} — would skip`
          : `   mcp (codex): would append [mcp_servers.skill-stats] block to ${configPath}`
      )
    }
  }

  if (opts.noDashboard) {
    w('5. dashboard: would skip (--no-dashboard)')
  } else if (platform() !== 'darwin') {
    w(`5. dashboard: non-darwin — would print \`skill-stats dashboard --port ${opts.port}\``)
  } else if (launchctlLoaded(OLD_DASHBOARD_LABEL)) {
    w(`5. dashboard: ${OLD_DASHBOARD_LABEL} already loaded — would skip (no double-serve)`)
  } else {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${DASHBOARD_LABEL}.plist`)
    w(`5. dashboard: would write ${plistPath} and bootstrap launchd on port ${opts.port}`)
  }

  w('6. summary: would print dashboard URL, event/skill counts, and next-step commands')
  return 0
}

// ---- helpers ----

function nodeSqliteWorks(): boolean {
  try {
    openDb(':memory:').close()
    return true
  } catch {
    return false
  }
}

function whichBin(bin: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue
    const candidate = join(dir, bin)
    try {
      accessSync(candidate, fsConstants.X_OK)
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // not here; keep scanning
    }
  }
  return null
}

function launchctlLoaded(label: string): boolean {
  const res = spawnSync('launchctl', ['print', `gui/${uid()}/${label}`], { encoding: 'utf8' })
  return res.status === 0
}

function uid(): string {
  return process.getuid ? String(process.getuid()) : ''
}

async function pickPort(preferred: number): Promise<number> {
  for (let port = preferred; port <= preferred + 7; port++) {
    if (await portFree(port)) return port
  }
  return preferred
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = netServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

function pollHttpOk(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const attempt = (): void => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => {
        const ok = res.statusCode === 200
        res.resume()
        if (ok || Date.now() >= deadline) resolve(ok)
        else setTimeout(attempt, 250)
      })
      req.on('error', () => {
        if (Date.now() >= deadline) resolve(false)
        else setTimeout(attempt, 250)
      })
      req.on('timeout', () => req.destroy())
    }
    attempt()
  })
}

function plistBody(label: string, cliPath: string, port: number): string {
  const args = [process.execPath, cliPath, 'dashboard', '--port', String(port)]
  const argXml = args.map((a) => `      <string>${xmlEscape(a)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function jsonStr(s: string): string {
  return JSON.stringify(s)
}

function firstLine(s: string | null | undefined): string {
  return (s ?? '').split('\n').find((l) => l.trim().length > 0)?.trim() ?? ''
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
