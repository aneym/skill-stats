// test/codex.acceptance.test.mjs — FROZEN SPECIFICATION for the Codex harness adapter.
// Do not modify; build until green. Black-box over dist/cli.js.
//
// Codex mechanics (verified against real ~/.codex/sessions rollouts, 2026-07-08):
// sessions live at <codex-dir>/sessions/YYYY/MM/DD/rollout-*.jsonl; the first line is
// {type:"session_meta", payload:{session_id, cwd, ...}}; a skill activates when the model
// reads its SKILL.md via a function_call (exec_command / shell) whose arguments reference
// a path ending in SKILL.md. Skill name = basename of the SKILL.md's parent directory.
// Progressive disclosure means one skill file is often read many times per session:
// the adapter records ONE activation per (session, skill), at the first read's timestamp.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(root, 'dist', 'cli.js')
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString()
const line = (obj) => JSON.stringify(obj) + '\n'
const MIN = 60_000

function rollout(dir, name, sessionId, entries) {
  const day = join(dir, 'sessions', '2026', '07', '08')
  mkdirSync(day, { recursive: true })
  let out = line({
    timestamp: iso(60 * MIN),
    type: 'session_meta',
    payload: { session_id: sessionId, id: sessionId, cwd: '/tmp/proj', originator: 'codex-tui' },
  })
  for (const e of entries) out += typeof e === 'string' ? e : line(e)
  writeFileSync(join(day, name), out)
}

const call = (msAgo, name, args) => ({
  timestamp: iso(msAgo),
  type: 'response_item',
  payload: { type: 'function_call', name, arguments: JSON.stringify(args), call_id: `c${msAgo}` },
})

function makeFixture() {
  const base = mkdtempSync(join(tmpdir(), 'skillstats-codex-'))
  const codexDir = join(base, 'codex')
  // session 1: alpha read three times (progressive disclosure) + one non-skill exec
  rollout(codexDir, 'rollout-a.jsonl', 'codex-s1', [
    call(50 * MIN, 'exec_command', { cmd: 'cat /Users/u/.claude/skills/alpha/SKILL.md' }),
    call(45 * MIN, 'exec_command', { cmd: "sed -n '40,120p' /Users/u/.claude/skills/alpha/SKILL.md" }),
    call(44 * MIN, 'shell', { command: ['bash', '-lc', 'cat /Users/u/.claude/skills/alpha/SKILL.md'] }),
    call(40 * MIN, 'exec_command', { cmd: 'ls -la /tmp' }),
    'not json — must be skipped, never fatal\n',
  ])
  // session 2: beta once
  rollout(codexDir, 'rollout-b.jsonl', 'codex-s2', [
    call(30 * MIN, 'exec_command', { cmd: 'cat /Users/u/repos/proj/.codex/skills/beta/SKILL.md' }),
  ])
  return { codexDir, db: join(base, 'db.sqlite') }
}

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts })
}

function backfillCodex(f) {
  const res = run(['backfill', '--harness', 'codex', '--codex-dir', f.codexDir, '--db', f.db])
  assert.equal(res.status, 0, `codex backfill failed: ${res.stderr}`)
  return res
}

function reportJson(f) {
  // no --claude-dir: report over the db must not require a claude dir to exist
  const res = run(['report', '--json', '--db', f.db])
  assert.equal(res.status, 0, `report failed: ${res.stderr}`)
  return JSON.parse(res.stdout)
}

const bySkill = (rep, name) => rep.skills.find((s) => s.name === name)

test('codex backfill: one activation per (session, skill), both tool shapes, corrupt line skipped', () => {
  const f = makeFixture()
  backfillCodex(f)
  const rep = reportJson(f)
  const alpha = bySkill(rep, 'alpha')
  assert.ok(alpha, 'alpha missing')
  assert.equal(alpha.invocations, 1, 'three reads in one session = ONE activation')
  const beta = bySkill(rep, 'beta')
  assert.ok(beta, 'beta missing (shell/custom path form)')
  assert.equal(beta.invocations, 1)
  assert.ok(!bySkill(rep, 'ls'), 'non-SKILL.md exec must not create events')
})

test('codex backfill is idempotent', () => {
  const f = makeFixture()
  backfillCodex(f)
  backfillCodex(f)
  const rep = reportJson(f)
  assert.equal(bySkill(rep, 'alpha').invocations, 1)
  assert.equal(bySkill(rep, 'beta').invocations, 1)
})

test('harness recorded: codex events tagged, drill-down exposes harness', () => {
  const f = makeFixture()
  backfillCodex(f)
  const res = run(['skill', 'alpha', '--json', '--db', f.db])
  assert.equal(res.status, 0, res.stderr)
  const detail = JSON.parse(res.stdout)
  assert.equal(detail.name, 'alpha')
  const serialized = JSON.stringify(detail)
  assert.ok(serialized.includes('codex'), 'skill detail must expose the codex harness attribution')
})

test('claude untouched: --harness codex does not scan claude transcripts', () => {
  const f = makeFixture()
  const res = run(['backfill', '--harness', 'codex', '--codex-dir', f.codexDir, '--db', f.db])
  assert.equal(res.status, 0)
  assert.ok(!/claude/i.test(res.stderr || ''), 'codex backfill must not touch claude dirs')
})
