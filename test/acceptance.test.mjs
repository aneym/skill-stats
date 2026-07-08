// test/acceptance.test.mjs — THE SPECIFICATION for skillstats v0.1.
// This file is frozen: the implementation must satisfy it unmodified.
// Black-box contract over the built CLI (dist/cli.js). Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(root, 'dist', 'cli.js')

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString()
const line = (obj) => JSON.stringify(obj) + '\n'
const MIN = 60_000

// Builds a synthetic ~/.claude-shaped directory with fresh timestamps.
function makeFixture() {
  const base = mkdtempSync(join(tmpdir(), 'skillstats-'))
  const claudeDir = join(base, 'claude')
  const proj = join(claudeDir, 'projects', '-Users-test-proj')
  mkdirSync(proj, { recursive: true })
  for (const name of ['alpha', 'gamma']) {
    mkdirSync(join(claudeDir, 'skills', name), { recursive: true })
    writeFileSync(
      join(claudeDir, 'skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} skill\n---\n\nBody of ${name}.\n`
    )
  }
  const sid = 'session-aaa'
  let jsonl = ''
  // user-typed slash command -> skill "beta" (not in inventory on disk)
  jsonl += line({
    type: 'user', sessionId: sid, timestamp: iso(50 * MIN),
    message: { role: 'user', content: '<command-name>/beta</command-name>\n<command-args></command-args>' },
  })
  // model-invoked Skill tool -> "alpha"
  jsonl += line({
    type: 'assistant', sessionId: sid, timestamp: iso(40 * MIN),
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'Skill', input: { skill: 'alpha' } }],
      usage: { input_tokens: 10, output_tokens: 100 },
    },
  })
  // failing tool_result after alpha activation
  jsonl += line({
    type: 'user', sessionId: sid, timestamp: iso(39 * MIN),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'boom' }] },
  })
  jsonl += line({
    type: 'assistant', sessionId: sid, timestamp: iso(38 * MIN),
    message: { role: 'assistant', content: [{ type: 'text', text: 'recovering' }], usage: { input_tokens: 5, output_tokens: 50 } },
  })
  // second alpha invocation — input keys deliberately in a different order
  jsonl += line({
    type: 'assistant', sessionId: sid, timestamp: iso(30 * MIN),
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_2', name: 'Skill', input: { args: 'x', skill: 'alpha' } }],
      usage: { input_tokens: 5, output_tokens: 20 },
    },
  })
  // a corrupt line must be skipped, never fatal
  jsonl += 'this is not json\n'
  writeFileSync(join(proj, `${sid}.jsonl`), jsonl)
  return { claudeDir, db: join(base, 'db.sqlite') }
}

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts })
}

function backfill(f) {
  const res = run(['backfill', '--claude-dir', f.claudeDir, '--db', f.db])
  assert.equal(res.status, 0, `backfill failed: ${res.stderr}`)
  return res
}

function reportJson(f) {
  const res = run(['report', '--json', '--db', f.db, '--claude-dir', f.claudeDir])
  assert.equal(res.status, 0, `report failed: ${res.stderr}`)
  return JSON.parse(res.stdout)
}

const bySkill = (rep, name) => rep.skills.find((s) => s.name === name)

test('built CLI exists', () => {
  assert.ok(existsSync(CLI), 'dist/cli.js missing — build first (npm test runs the build)')
})

test('backfill + report: counts, sources, dormancy, hard signals', () => {
  const f = makeFixture()
  backfill(f)
  const rep = reportJson(f)
  assert.equal(typeof rep.generatedAt, 'string')
  assert.ok(Array.isArray(rep.skills))

  const alpha = bySkill(rep, 'alpha')
  assert.ok(alpha, 'alpha missing from report')
  assert.equal(alpha.invocations, 2, 'alpha invoked twice (incl. reordered-keys tool_use)')
  assert.equal(alpha.dormant, false)
  assert.ok(alpha.errorsAfter >= 1, 'failing tool_result after activation must be counted')
  assert.ok(alpha.tokensAfter > 0, 'assistant token usage after activation must be attributed')
  assert.equal(typeof alpha.lastUsed, 'string')

  const beta = bySkill(rep, 'beta')
  assert.ok(beta, 'slash-command invocation (<command-name>/beta</command-name>) must be counted')
  assert.equal(beta.invocations, 1)

  const gamma = bySkill(rep, 'gamma')
  assert.ok(gamma, 'gamma exists on disk, never invoked — must still appear')
  assert.equal(gamma.invocations, 0)
  assert.equal(gamma.dormant, true)
})

test('backfill is idempotent — re-running never double-counts', () => {
  const f = makeFixture()
  backfill(f)
  backfill(f)
  const rep = reportJson(f)
  assert.equal(bySkill(rep, 'alpha').invocations, 2)
  assert.equal(bySkill(rep, 'beta').invocations, 1)
})

test('hook: ingests PostToolUse JSON on stdin; never breaks the session', () => {
  const f = makeFixture()
  backfill(f)
  const payload = JSON.stringify({
    session_id: 'hook-1',
    transcript_path: '/tmp/nope.jsonl',
    cwd: '/tmp',
    hook_event_name: 'PostToolUse',
    tool_name: 'Skill',
    tool_input: { skill: 'delta' },
    tool_response: {},
  })
  const res = run(['hook', '--db', f.db], { input: payload })
  assert.equal(res.status, 0, `hook must exit 0: ${res.stderr}`)
  const rep = reportJson(f)
  assert.ok(bySkill(rep, 'delta'), 'hook-ingested skill must appear in report')
  assert.ok(bySkill(rep, 'delta').invocations >= 1)

  // non-Skill tool: ignored, still exit 0
  const other = run(['hook', '--db', f.db], {
    input: JSON.stringify({ session_id: 'hook-2', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }),
  })
  assert.equal(other.status, 0)

  // garbage stdin: still exit 0 (a broken hook must never block the user's session)
  const garbage = run(['hook', '--db', f.db], { input: 'not json at all' })
  assert.equal(garbage.status, 0, 'hook must swallow garbage input with exit 0')
})

test('outcome recording: evidence-forced trust split', () => {
  const f = makeFixture()
  backfill(f)
  const longEvidence =
    'Followed the "always snapshot before tapping" rule from the skill; the retry loop in section 3 was applied verbatim and resolved the stale-ref failure.'
  let res = run(['outcome', 'alpha', '--grade', 'worked', '--evidence', longEvidence, '--session', 'session-aaa', '--db', f.db])
  assert.equal(res.status, 0, res.stderr)
  res = run(['outcome', 'alpha', '--grade', 'failed', '--evidence', 'bad', '--session', 'session-aaa', '--db', f.db])
  assert.equal(res.status, 0, 'short-evidence outcome is stored, just untrusted')

  const alpha = bySkill(reportJson(f), 'alpha')
  assert.ok(alpha.outcomes, 'report must include outcomes rollup')
  assert.equal(alpha.outcomes.worked, 1)
  assert.equal(alpha.outcomes.untrusted, 1, 'vibes-only grade must be flagged untrusted')
})

test('skill drill-down', () => {
  const f = makeFixture()
  backfill(f)
  const res = run(['skill', 'alpha', '--json', '--db', f.db, '--claude-dir', f.claudeDir])
  assert.equal(res.status, 0, res.stderr)
  const detail = JSON.parse(res.stdout)
  assert.equal(detail.name, 'alpha')
  assert.equal(detail.invocations, 2)
})

test('doctor runs clean on the fixture', () => {
  const f = makeFixture()
  const res = run(['doctor', '--claude-dir', f.claudeDir, '--db', f.db])
  assert.equal(res.status, 0, res.stderr)
})
