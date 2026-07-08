// test/setup.acceptance.test.mjs — FROZEN SPECIFICATION for `skill-stats setup`.
// Do not modify; build until green alongside the three existing frozen suites.
// setup is the one-command agent path: backfill + hook + (mcp/dashboard, skippable).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(root, 'dist', 'cli.js')
const line = (obj) => JSON.stringify(obj) + '\n'

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'skill-stats-setup-'))
  const claudeDir = join(base, 'claude')
  const proj = join(claudeDir, 'projects', '-Users-x')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 's1.jsonl'), line({
    type: 'assistant', sessionId: 's1', timestamp: new Date().toISOString(),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Skill', input: { skill: 'setup-probe' } }], usage: { output_tokens: 1 } },
  }))
  return { base, claudeDir, db: join(base, 'db.sqlite') }
}

const run = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts })

test('setup --dry-run: prints the plan, writes nothing', () => {
  const f = fixture()
  const res = run(['setup', '--dry-run', '--claude-dir', f.claudeDir, '--db', f.db])
  assert.equal(res.status, 0, res.stderr)
  for (const word of ['backfill', 'hook', 'mcp', 'dashboard']) {
    assert.ok(res.stdout.toLowerCase().includes(word), `dry-run plan must mention ${word}`)
  }
  assert.ok(!existsSync(f.db), 'dry-run must not create the db')
  assert.ok(!existsSync(join(f.claudeDir, 'settings.json')), 'dry-run must not write settings')
})

test('setup --no-mcp --no-dashboard: backfills + installs hook, idempotent', () => {
  const f = fixture()
  const res = run(['setup', '--no-mcp', '--no-dashboard', '--claude-dir', f.claudeDir, '--db', f.db])
  assert.equal(res.status, 0, res.stderr)
  assert.ok(existsSync(f.db), 'db must exist after setup')
  const settings = JSON.parse(readFileSync(join(f.claudeDir, 'settings.json'), 'utf8'))
  assert.ok(JSON.stringify(settings.hooks.PostToolUse).includes(' hook'), 'hook must be installed')
  const rep = run(['report', '--json', '--db', f.db, '--claude-dir', f.claudeDir])
  const skills = JSON.parse(rep.stdout).skills
  assert.ok(skills.find((s) => s.name === 'setup-probe'), 'backfill must have run')
  // second run: still exit 0, no duplicate hook entries
  const again = run(['setup', '--no-mcp', '--no-dashboard', '--claude-dir', f.claudeDir, '--db', f.db])
  assert.equal(again.status, 0, again.stderr)
  const settings2 = JSON.parse(readFileSync(join(f.claudeDir, 'settings.json'), 'utf8'))
  const hookCount = JSON.stringify(settings2).split(' hook"').length - 1
  assert.equal(hookCount, 1, 'setup must not duplicate the hook entry')
})
