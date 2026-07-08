// test/sweep.acceptance.test.mjs — FROZEN SPECIFICATION for `skill-stats sweep`.
// Do not modify; build until green alongside the four existing frozen suites.
// sweep = cross-machine dead-weight cleanup: evidence-ranked candidates,
// quarantine-not-delete, keep-list, restore. Human-gated by design.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(root, 'dist', 'cli.js')
const line = (obj) => JSON.stringify(obj) + '\n'
const DAY = 86_400_000
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString()

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'skill-stats-sweep-'))
  const claudeDir = join(base, 'claude')
  const home = join(base, 'home') // SKILLSTATS_HOME: db, keep.json, quarantine manifest
  mkdirSync(home, { recursive: true })
  const mkSkill = (name, desc) => {
    mkdirSync(join(claudeDir, 'skills', name), { recursive: true })
    writeFileSync(
      join(claudeDir, 'skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${desc}\n---\n\nBody.\n`
    )
  }
  mkSkill('busy-skill', 'used constantly')
  mkSkill('dead-skill', 'a long description that costs real context every single turn of every session')
  mkSkill('sacred-skill', 'rare but critical — keep-listed')
  const proj = join(claudeDir, 'projects', '-Users-x')
  mkdirSync(proj, { recursive: true })
  // history depth: an old event 40 days back plus a recent busy-skill activation
  writeFileSync(join(proj, 'old.jsonl'), line({
    type: 'assistant', sessionId: 'old', timestamp: iso(40 * DAY),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'o', name: 'Skill', input: { skill: 'busy-skill' } }], usage: { output_tokens: 1 } },
  }))
  writeFileSync(join(proj, 'now.jsonl'), line({
    type: 'assistant', sessionId: 'now', timestamp: iso(1 * DAY),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'n', name: 'Skill', input: { skill: 'busy-skill' } }], usage: { output_tokens: 1 } },
  }))
  return { base, claudeDir, home, db: join(home, 'skillstats.db') }
}

const run = (f, args) =>
  spawnSync(process.execPath, [CLI, ...args, '--db', f.db, '--claude-dir', f.claudeDir], {
    encoding: 'utf8',
    env: { ...process.env, SKILLSTATS_HOME: f.home },
  })

test('sweep: ranked candidates with evidence; keep-list and active skills excluded', () => {
  const f = fixture()
  assert.equal(run(f, ['backfill']).status, 0)
  assert.equal(run(f, ['sweep', 'keep', 'sacred-skill']).status, 0)
  const res = run(f, ['sweep', '--json'])
  assert.equal(res.status, 0, res.stderr)
  const out = JSON.parse(res.stdout)
  const names = out.candidates.map((c) => c.name)
  assert.ok(names.includes('dead-skill'), 'dormant unkept skill must be a candidate')
  assert.ok(!names.includes('busy-skill'), 'recently used skill must not be a candidate')
  assert.ok(!names.includes('sacred-skill'), 'keep-listed skill must never be a candidate')
  const dead = out.candidates.find((c) => c.name === 'dead-skill')
  assert.ok(dead.descBytes > 40, 'candidate carries its context cost (description bytes)')
  assert.ok(dead.historyDays >= 39, 'evidence: days of history backing the dormancy claim')
  assert.ok(typeof out.estTokensPerTurn === 'number' && out.estTokensPerTurn > 0, 'total estimated savings present')
})

test('sweep quarantine + restore: reversible, manifest-backed, never deletes', () => {
  const f = fixture()
  run(f, ['backfill'])
  const q = run(f, ['sweep', 'quarantine', '--yes'])
  assert.equal(q.status, 0, q.stderr)
  assert.ok(!existsSync(join(f.claudeDir, 'skills', 'dead-skill', 'SKILL.md')), 'quarantined skill leaves the live dir')
  assert.ok(existsSync(join(f.claudeDir, 'skills', 'busy-skill', 'SKILL.md')), 'active skill untouched')
  // archived somewhere under SKILLSTATS_HOME or claude-dir, with a manifest recording the original path
  const manifest = run(f, ['sweep', 'list', '--json'])
  assert.equal(manifest.status, 0)
  const entries = JSON.parse(manifest.stdout)
  const entry = entries.find((e) => e.name === 'dead-skill')
  assert.ok(entry && entry.originalPath.includes('dead-skill'), 'manifest records the original path')
  const r = run(f, ['sweep', 'restore', 'dead-skill'])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(f.claudeDir, 'skills', 'dead-skill', 'SKILL.md')), 'restore puts it back exactly')
})

test('sweep quarantine without --yes: prints plan, moves nothing', () => {
  const f = fixture()
  run(f, ['backfill'])
  const res = run(f, ['sweep', 'quarantine'])
  assert.equal(res.status, 0, res.stderr)
  assert.ok(existsSync(join(f.claudeDir, 'skills', 'dead-skill', 'SKILL.md')), 'no --yes = dry plan only')
  assert.ok(res.stdout.includes('dead-skill'), 'plan must name the candidates')
})

test('reconcile: flags same-name collisions and near-duplicate content, recommends by usage', () => {
  const f = fixture()
  // same NAME in a second root (the multi-root copy problem)
  const extraRoot = join(f.base, 'extra-root')
  mkdirSync(join(extraRoot, 'busy-skill'), { recursive: true })
  writeFileSync(join(extraRoot, 'busy-skill', 'SKILL.md'), '---\nname: busy-skill\ndescription: stale copy of busy-skill\n---\nOld body.\n')
  // two skills with essentially identical descriptions (content dupes)
  for (const name of ['format-code', 'fmt-code']) {
    mkdirSync(join(f.claudeDir, 'skills', name), { recursive: true })
    writeFileSync(
      join(f.claudeDir, 'skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Format source code files according to the project style rules and fix lint issues\n---\n\nRun the formatter, then the linter, then re-check.\n`
    )
  }
  run(f, ['backfill'])
  const res = spawnSync(process.execPath, [CLI, 'reconcile', '--json', '--db', f.db, '--claude-dir', f.claudeDir, '--skills-root', extraRoot], {
    encoding: 'utf8',
    env: { ...process.env, SKILLSTATS_HOME: f.home },
  })
  assert.equal(res.status, 0, res.stderr)
  const out = JSON.parse(res.stdout)
  assert.ok(Array.isArray(out.groups))
  const nameGroup = out.groups.find((g) => g.kind === 'same-name' && g.members.some((m) => m.name === 'busy-skill'))
  assert.ok(nameGroup, 'same skill name in two roots must be flagged')
  assert.equal(nameGroup.members.length, 2)
  assert.ok(nameGroup.recommendation && nameGroup.recommendation.length > 10, 'group carries a concrete recommendation')
  assert.ok(nameGroup.members.some((m) => typeof m.invocations === 'number'), 'members carry usage counts (evidence for the keeper)')
  const contentGroup = out.groups.find((g) => g.kind === 'similar-content' && g.members.some((m) => m.name === 'format-code'))
  assert.ok(contentGroup, 'near-identical descriptions must be flagged as content dupes')
  assert.ok(contentGroup.members.some((m) => m.name === 'fmt-code'))
  // reconcile NEVER mutates anything
  assert.ok(existsSync(join(extraRoot, 'busy-skill', 'SKILL.md')), 'reconcile is read-only')
})
