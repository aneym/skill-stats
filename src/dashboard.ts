import { createServer } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import { openDb, all } from './db.js'
import { computeReport, type Report, type SkillRow } from './report.js'

const DAY_MS = 86_400_000

export function runDashboard(dbPath: string, claudeDir: string, port: number): void {
  const db = openDb(dbPath)
  const server = createServer((_req, res) => {
    const report = computeReport(db, claudeDir, 30)
    const html = renderPage(db, report)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  server.listen(port, () => {
    process.stdout.write(`skillstats dashboard on http://localhost:${port}\n`)
  })
}

function dailyCounts(db: DatabaseSync, skill: string, days = 30): number[] {
  const buckets = new Array<number>(days).fill(0)
  const start = Date.now() - days * DAY_MS
  const rows = all<{ ts: string | null }>(db, 'SELECT ts FROM events WHERE skill = ?', skill)
  for (const r of rows) {
    if (!r.ts) continue
    const ms = Date.parse(r.ts)
    if (Number.isNaN(ms) || ms < start) continue
    const idx = Math.min(days - 1, Math.floor((ms - start) / DAY_MS))
    buckets[idx]++
  }
  return buckets
}

function sparkline(counts: number[]): string {
  const bars = '▁▂▃▄▅▆▇█'
  const max = Math.max(1, ...counts)
  return counts
    .map((c) => (c === 0 ? bars[0] : bars[Math.min(bars.length - 1, Math.ceil((c / max) * (bars.length - 1)))]))
    .join('')
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function rows(db: DatabaseSync, skills: SkillRow[]): string {
  return skills
    .map((s) => {
      const spark = esc(sparkline(dailyCounts(db, s.name)))
      const o = s.outcomes
      return `<tr>
        <td class="name">${esc(s.name)}${s.dormant ? ' <span class="tag">dormant</span>' : ''}</td>
        <td class="num">${s.invocations}</td>
        <td class="spark">${spark}</td>
        <td class="num">${s.tokensAfter.toLocaleString()}</td>
        <td class="num">${s.errorsAfter}</td>
        <td class="out"><span class="w">${o.worked}</span>/<span class="p">${o.partial}</span>/<span class="f">${o.failed}</span> <span class="u">(${o.untrusted} untrusted)</span></td>
        <td class="ts">${s.lastUsed ? esc(s.lastUsed) : '—'}</td>
      </tr>`
    })
    .join('\n')
}

function renderPage(db: DatabaseSync, report: Report): string {
  const dormant = report.skills.filter((s) => s.dormant)
  const active = report.skills.filter((s) => !s.dormant)
  const dormantList = dormant.length
    ? dormant.map((s) => `<li>${esc(s.name)}</li>`).join('')
    : '<li class="muted">none — every skill on disk has been used</li>'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>skillstats</title>
<style>
  :root { color-scheme: light dark; --bg:#0d0f12; --fg:#e6e6e6; --muted:#8a8f98; --line:#23262d; --accent:#7aa2f7; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg); color:var(--fg); }
  header { padding:24px 20px 8px; }
  h1 { margin:0; font-size:20px; letter-spacing:.5px; }
  .sub { color:var(--muted); margin-top:4px; }
  main { padding:12px 20px 40px; }
  section { margin-top:24px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:1px; color:var(--muted); border-bottom:1px solid var(--line); padding-bottom:6px; }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); white-space:nowrap; }
  th { color:var(--muted); font-weight:600; font-size:12px; }
  td.num,th.num { text-align:right; }
  .name .tag { color:var(--muted); font-size:11px; border:1px solid var(--line); border-radius:4px; padding:0 4px; }
  .spark { color:var(--accent); letter-spacing:1px; }
  .out .w { color:#9ece6a; } .out .p { color:#e0af68; } .out .f { color:#f7768e; } .out .u { color:var(--muted); }
  .ts { color:var(--muted); font-size:12px; }
  ul { padding-left:18px; } .muted { color:var(--muted); }
  .wrap { overflow-x:auto; }
</style>
</head>
<body>
<header>
  <h1>skillstats</h1>
  <div class="sub">${report.skills.length} skills · ${active.length} active · ${dormant.length} dormant · window ${report.days}d · generated ${esc(report.generatedAt)}</div>
</header>
<main>
  <section>
    <h2>Ranked skills</h2>
    <div class="wrap">
    <table>
      <thead><tr>
        <th>skill</th><th class="num">invocations</th><th>30d activity</th>
        <th class="num">tokens after</th><th class="num">errors after</th><th>outcomes w/p/f</th><th>last used</th>
      </tr></thead>
      <tbody>
${rows(db, report.skills)}
      </tbody>
    </table>
    </div>
  </section>
  <section>
    <h2>Dormant skills</h2>
    <ul>${dormantList}</ul>
  </section>
</main>
</body>
</html>`
}
