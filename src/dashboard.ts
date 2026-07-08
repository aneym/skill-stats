import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { hostname } from 'node:os'
import type { DatabaseSync } from 'node:sqlite'
import { openDb, all } from './db.js'
import { backfill, backfillCodex } from './backfill.js'
import { computeReport, computeSkillDetail, type Report, type SkillDetail } from './report.js'
import { renderPage } from './dashboard-page.js'
import { syncRemotes } from './remotes.js'

export interface OutcomeRecord {
  skill: string
  grade: string | null
  trusted: boolean
  evidence: string | null
  ts: string | null
}

export interface DashboardMeta {
  host: string
  dbPath: string
  version: string
  refreshedAt: string
}

// Payload shared by GET / (embedded), GET /api/report and POST /api/refresh.
export interface DashboardData {
  report: Report
  recentOutcomes: OutcomeRecord[]
  meta: DashboardMeta
}

export interface SkillDrilldown {
  detail: SkillDetail
  outcomes: OutcomeRecord[]
}

interface OutcomeDbRow {
  skill: string
  grade: string | null
  trusted: number
  evidence: string | null
  ts: string | null
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
    // fall through to default
  }
  return '0.1.0'
}

function toRecord(r: OutcomeDbRow): OutcomeRecord {
  return { skill: r.skill, grade: r.grade, trusted: r.trusted !== 0, evidence: r.evidence, ts: r.ts }
}

function recentOutcomes(db: DatabaseSync): OutcomeRecord[] {
  return all<OutcomeDbRow>(
    db,
    'SELECT skill, grade, trusted, evidence, ts FROM outcomes ORDER BY ts DESC LIMIT 20'
  ).map(toRecord)
}

function outcomesForSkill(db: DatabaseSync, name: string): OutcomeRecord[] {
  return all<OutcomeDbRow>(
    db,
    'SELECT skill, grade, trusted, evidence, ts FROM outcomes WHERE skill = ? ORDER BY ts DESC',
    name
  ).map(toRecord)
}

function buildData(
  db: DatabaseSync,
  dbPath: string,
  claudeDir: string,
  codexDir: string,
  days: number
): DashboardData {
  const report = computeReport(db, { claudeDir, codexDir }, days)
  return {
    report,
    recentOutcomes: recentOutcomes(db),
    meta: { host: hostname(), dbPath, version: version(), refreshedAt: new Date().toISOString() },
  }
}

function parseDays(url: URL): number {
  const raw = url.searchParams.get('days')
  const n = raw === null ? 30 : Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 30
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

// Refresh is best-effort: a broken claude transcript or missing codex dir must
// still yield a fresh report rather than a 500. Each adapter is isolated.
function refresh(db: DatabaseSync, claudeDir: string, codexDir: string): void {
  try {
    backfill(db, claudeDir)
  } catch {
    // degrade gracefully — keep whatever is already in the db
  }
  try {
    backfillCodex(db, codexDir)
  } catch {
    // codex is optional; ignore adapter failures
  }
  try {
    syncRemotes(db)
  } catch {
    // remote sync is best-effort; a broken remote never fails the refresh
  }
}

function handle(
  db: DatabaseSync,
  dbPath: string,
  claudeDir: string,
  codexDir: string,
  req: IncomingMessage,
  res: ServerResponse
): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname

  if (req.method === 'GET' && path === '/') {
    const html = renderPage(buildData(db, dbPath, claudeDir, codexDir, 30))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
    return
  }

  if (req.method === 'GET' && path === '/api/report') {
    sendJson(res, 200, buildData(db, dbPath, claudeDir, codexDir, parseDays(url)))
    return
  }

  if (req.method === 'GET' && path.startsWith('/api/skill/')) {
    const name = decodeURIComponent(path.slice('/api/skill/'.length))
    if (!name) {
      sendJson(res, 400, { error: 'skill name required' })
      return
    }
    const detail = computeSkillDetail(db, { claudeDir, codexDir }, name, parseDays(url))
    const drilldown: SkillDrilldown = { detail, outcomes: outcomesForSkill(db, name) }
    sendJson(res, 200, drilldown)
    return
  }

  if (req.method === 'POST' && path === '/api/refresh') {
    refresh(db, claudeDir, codexDir)
    sendJson(res, 200, buildData(db, dbPath, claudeDir, codexDir, parseDays(url)))
    return
  }

  sendJson(res, 404, { error: 'not found' })
}

export function runDashboard(
  dbPath: string,
  claudeDir: string,
  codexDir: string,
  port: number
): void {
  const db = openDb(dbPath)
  const server = createServer((req, res) => {
    try {
      handle(db, dbPath, claudeDir, codexDir, req, res)
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
  })
  server.listen(port, () => {
    process.stdout.write(`skill-stats dashboard on http://localhost:${port}\n`)
  })
}
