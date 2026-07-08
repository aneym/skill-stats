// test/v02.acceptance.test.mjs — FROZEN SPECIFICATION for skill-stats v0.2.
// Do not modify; build until green alongside the two existing frozen suites.
// Covers: rename, trigger split, machine dimension, hook/backfill dedup,
// export/import, remotes config, inventory completeness.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(root, 'dist', 'cli.js')
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString()
const line = (obj) => JSON.stringify(obj) + '\n'
const MIN = 60_000

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts })
}

function makeClaudeFixture() {
  const base = mkdtempSync(join(tmpdir(), 'skill-stats-v02-'))
  const claudeDir = join(base, 'claude')
  const proj = join(claudeDir, 'projects', '-Users-test-proj')
  mkdirSync(proj, { recursive: true })
  // on-disk skill + a slash COMMAND (commands are skills too — inventory must see both)
  mkdirSync(join(claudeDir, 'skills', 'alpha'), { recursive: true })
  writeFileSync(join(claudeDir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\nA.\n')
  mkdirSync(join(claudeDir, 'commands'), { recursive: true })
  writeFileSync(join(claudeDir, 'commands', 'deploy-magic.md'), '# deploy-magic command\n')
  const sid = 'v02-session'
  let jsonl = ''
  jsonl += line({
    type: 'user', sessionId: sid, timestamp: iso(50 * MIN),
    message: { role: 'user', content: '<command-name>/beta</command-name>' },
  })
  jsonl += line({
    type: 'assistant', sessionId: sid, timestamp: iso(40 * MIN),
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'alpha' } }],
      usage: { input_tokens: 1, output_tokens: 10 },
    },
  })
  jsonl += line({
    type: 'assistant', sessionId: sid, timestamp: iso(30 * MIN),
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't2', name: 'Skill', input: { skill: 'alpha' } }],
      usage: { input_tokens: 1, output_tokens: 10 },
    },
  })
  writeFileSync(join(proj, `${sid}.jsonl`), jsonl)
  return { base, claudeDir, db: join(base, 'db.sqlite') }
}

const report = (f, extra = []) => {
  const res = run(['report', '--json', '--db', f.db, '--claude-dir', f.claudeDir, ...extra])
  assert.equal(res.status, 0, res.stderr)
  return JSON.parse(res.stdout)
}
const bySkill = (rep, name) => rep.skills.find((s) => s.name === name)

test('identity: renamed to skill-stats', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'skill-stats')
  assert.ok(pkg.bin['skill-stats'], 'bin must be skill-stats')
  const help = run(['--help'])
  assert.ok(help.stdout.includes('skill-stats'), 'HELP must use the new name')
  assert.ok(!/skillstats(?!\.db|-)/.test(help.stdout), 'HELP must not use the old name')
})

test('trigger split: byTrigger on report rows', () => {
  const f = makeClaudeFixture()
  assert.equal(run(['backfill', '--claude-dir', f.claudeDir, '--db', f.db]).status, 0)
  const rep = report(f)
  assert.deepEqual(bySkill(rep, 'alpha').byTrigger, { model: 2 })
  assert.deepEqual(bySkill(rep, 'beta').byTrigger, { 'user-slash': 1 })
})

test('machine dimension: events stamped with hostname, surfaced per skill', () => {
  const f = makeClaudeFixture()
  run(['backfill', '--claude-dir', f.claudeDir, '--db', f.db])
  const rep = report(f)
  const machines = bySkill(rep, 'alpha').machines
  assert.ok(machines && machines[hostname()] === 2, `expected {${hostname()}: 2}, got ${JSON.stringify(machines)}`)
})

test('hook + backfill of the same activation do not double-count', () => {
  const f = makeClaudeFixture()
  const sid = 'dedup-session'
  // hook fires live (stamps ~now)
  const hook = run(['hook', '--db', f.db], {
    input: JSON.stringify({ session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'echo-skill' } }),
  })
  assert.equal(hook.status, 0)
  // the transcript for the same activation lands seconds earlier
  const proj = join(f.claudeDir, 'projects', '-Users-dedup')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, `${sid}.jsonl`), line({
    type: 'assistant', sessionId: sid, timestamp: iso(5_000),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'd1', name: 'Skill', input: { skill: 'echo-skill' } }], usage: { output_tokens: 1 } },
  }))
  run(['backfill', '--claude-dir', f.claudeDir, '--db', f.db])
  assert.equal(bySkill(report(f), 'echo-skill').invocations, 1, 'same (session, skill) within seconds must count once')
})

test('export/import: JSONL round-trip, machine preserved, idempotent', () => {
  const f = makeClaudeFixture()
  run(['backfill', '--claude-dir', f.claudeDir, '--db', f.db])
  const exp = run(['export', '--db', f.db])
  assert.equal(exp.status, 0, exp.stderr)
  // simulate a remote machine's export by rewriting the machine field
  const remoteLines = exp.stdout.trim().split('\n').map((l) => {
    const o = JSON.parse(l)
    if (o.machine) o.machine = 'remote-mac-studio'
    if (o.session_id) o.session_id = 'remote-' + o.session_id
    return JSON.stringify(o)
  }).join('\n')
  const file = join(f.base, 'remote-export.jsonl')
  writeFileSync(file, remoteLines + '\n')
  assert.equal(run(['import', file, '--db', f.db]).status, 0)
  assert.equal(run(['import', file, '--db', f.db]).status, 0, 'second import must be a no-op')
  const alpha = bySkill(report(f), 'alpha')
  assert.equal(alpha.invocations, 4, 'local 2 + imported 2 (idempotent)')
  assert.equal(alpha.machines['remote-mac-studio'], 2)
  assert.equal(alpha.machines[hostname()], 2)
})

test('remote registry: add + list (config only, no live ssh)', () => {
  const home = mkdtempSync(join(tmpdir(), 'skill-stats-home-'))
  const env = { ...process.env, SKILLSTATS_HOME: home }
  const add = run(['remote', 'add', 'studio', '--host', 'studio', '--path', '/Users/aneyman/repos/skill-stats'], { env })
  assert.equal(add.status, 0, add.stderr)
  const list = run(['remote', 'list', '--json'], { env })
  assert.equal(list.status, 0)
  const remotes = JSON.parse(list.stdout)
  assert.equal(remotes.length, 1)
  assert.equal(remotes[0].name, 'studio')
  assert.equal(remotes[0].host, 'studio')
})

test('inventory completeness: commands count as skills; extra roots scanned', () => {
  const f = makeClaudeFixture()
  run(['backfill', '--claude-dir', f.claudeDir, '--db', f.db])
  const extraRoot = join(f.base, 'extra-skills')
  mkdirSync(join(extraRoot, 'omega'), { recursive: true })
  writeFileSync(join(extraRoot, 'omega', 'SKILL.md'), '---\nname: omega\n---\nO.\n')
  const rep = report(f, ['--skills-root', extraRoot])
  const cmd = bySkill(rep, 'deploy-magic')
  assert.ok(cmd, 'slash commands on disk must appear in inventory')
  assert.equal(cmd.dormant, true)
  const omega = bySkill(rep, 'omega')
  assert.ok(omega, '--skills-root dirs must be scanned')
  assert.equal(omega.dormant, true)
})
