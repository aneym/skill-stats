# skill-stats

[github.com/aneym/skill-stats](https://github.com/aneym/skill-stats) · `npm i -g skill-stats`

**Skills are the unit of agent capability — and nobody can see them.**

Every skill your agent loads is a bet: that *this* procedure, loaded at *this*
moment, will make the next few minutes of work go better. But once a skill is
installed it disappears into the run. Which ones actually fire? Which sit on
disk for months, never triggering, silently taxing every session's context?
When a skill *does* activate, does the work that follows get better or worse?
Today the honest answer is a shrug.

skill-stats closes that loop. It:

1. **Records every activation** — live via a Claude Code hook, retroactively by
   backfilling your existing Claude Code and Codex transcripts, and across all
   your machines over SSH.
2. **Grades whether the skill actually helped** — hard signals pulled straight
   from the transcript (tokens burned after activation, tool errors that
   followed) plus evidence-forced outcome grades from the agent itself.
3. **Closes the loop with human-gated proposals** — surfaces where a skill is
   underperforming and drafts an improvement, but **never edits a `SKILL.md`
   itself.** You stay in the loop.

100% local. A single SQLite file in `~/.skill-analytics`. Nothing ever leaves
your machines.

---

## Setup by agent (start here if you are one)

If you are an agent asked to set this up for your user, run:

```bash
npx skill-stats@latest setup
```

`setup` is deterministic and idempotent — safe to re-run. It backfills all
history (Claude Code + Codex), installs the live-capture hook, registers the
MCP server with Claude Code and Codex where present, and (macOS) installs a
LaunchAgent so the dashboard is always on. Every step prints `✓ / · / !` with a
manual fallback command on failure; `--dry-run` previews the plan without
touching anything.

Then verify, in order:

```bash
npx skill-stats doctor          # env, parse rate, hook, db — expect no failures
npx skill-stats report          # expect a ranked table with real counts
curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/   # expect 200 (port may differ; setup prints it)
```

If the user has other machines (reachable over SSH with keys), set each one up
the same way *on that machine*, then connect them from the primary:

```bash
npx skill-stats remote add <name> --host <ssh-host> --path <repo-or-install-path-on-remote>
npx skill-stats remote sync     # pulls their events; dashboard refresh re-syncs automatically
```

Report back to the user: the dashboard URL, total activations/skills/machines
from `report --json`, and the dormant count (their cleanup shortlist). Do not
edit any `SKILL.md` based on the data without their approval — that gate is the
product's design.

## Quickstart (human, one machine)

```bash
npx skill-stats setup           # everything above, one command
npx skill-stats report          # ranked table: what's used, what's dormant
npx skill-stats skill <name>    # drill into one skill
```

Or piecemeal: `backfill`, `install` (hook), `dashboard`, `mcp` — every step
`setup` automates exists as its own command. `report --json` for machines,
`--days 7` to narrow the window.

## Live capture (the hook)

Backfill is a snapshot; the hook keeps the picture current. `install` registers
a `PostToolUse` hook on the `Skill` tool that pipes each activation into the db
as it happens (~0.2s, async to your work). It is invisible and unbreakable by
design: on garbage input, a non-Skill tool, or any db error it exits 0
silently. **A broken analytics hook must never break your Claude session.**

## Codex support

skill-stats also reads [Codex](https://github.com/openai/codex) sessions. A
Codex skill activates when the model reads its `SKILL.md` via a tool call, so
the backfill scans each rollout's `function_call` entries and records one
activation per (session, skill) at the first read, tagged `harness=codex`.
Codex has no hook surface yet, so it's backfill-only — the dashboard's refresh
re-runs it on every open, which in practice keeps it current.

```bash
npx skill-stats backfill --harness codex   # ~/.codex/sessions; --codex-dir to override
```

## All your machines

Events carry a `machine` dimension (hostname). Connect machines over SSH you
already have keys for:

```bash
skill-stats remote add studio --host studio --path ~/repos/skill-stats
skill-stats remote sync                     # or per-name: remote sync studio
```

Sync runs the remote's `export` over SSH and imports the stream — idempotent,
merge-safe (events from different machines never dedup against each other).
The dashboard re-syncs all remotes on every refresh and gets a machine filter,
per-skill machine chips, and a Systems tile. Agents can manage this too, via
the `add_remote` / `sync_remotes` MCP tools.

## MCP server

Expose the analytics to any agent as tools (`setup` registers this for you):

```json
{ "mcpServers": { "skill-stats": { "command": "npx", "args": ["skill-stats", "mcp"] } } }
```

Tools: `get_skill_report`, `get_skill_detail`, `list_dormant_skills`,
`record_skill_outcome`, `propose_skill_improvement` (writes a markdown proposal
to `~/.skill-analytics/proposals/` — never touches a `SKILL.md`), `add_remote`,
`sync_remotes`.

## Dashboard

Always-on after `setup` (macOS LaunchAgent) at `http://localhost:4173`; opening
the page re-ingests everything, including Codex and remotes. One self-contained
HTML page, zero external assets, styled on the [KINETIC](design/README.md)
design system: ranked skills with activity sparklines, an agent-vs-human "Who"
column, machine filter, dead-weight grid, warning signals, and the outcome
evidence feed. Light and dark.

## What gets measured

Per skill, over a configurable window:

- **invocations** — model-invoked `Skill` tool calls *and* user-typed `/slash`
  commands, split as **byTrigger** (agent vs human — a skill only *you* ever
  trigger is a skill the model never discovers: a description problem).
- **machines** — where it fires, per hostname.
- **lastUsed / dormant** — dormant = on disk (including `~/.claude/commands`
  and `~/.codex/skills`; add more roots with `--skills-root`) with zero
  activations in the window. These are the skills quietly costing context.
- **tokensAfter / errorsAfter** — hard signals: output tokens and tool errors
  in the entries right after an activation. Not causation; the cheapest honest
  proxy for "did things go well after this fired."
- **outcomes** — explicit grades (`worked` / `partial` / `failed`).

### The untrusted-grade rule

An agent grading its own work is a notorious source of vibes. An outcome is
marked **trusted only when it ships with real evidence — at least 40 characters
of it** (e.g. *"followed the 'snapshot before tapping' rule from section 3; the
retry loop resolved the stale-ref failure"*). Thin-evidence grades are stored
but flagged `untrusted` and counted separately, so confident-but-empty "worked"
grades can't inflate a skill's standing. Evidence or it didn't happen.

## Design

The dashboard implements [KINETIC](design/README.md) — a two-tone monochrome
system where the accent is ink and only destructive red carries chroma. The
portable token layer ships in [`design/kinetic.css`](design/kinetic.css); it's
reusable for your own tools.

## Privacy

Everything is local. skill-stats reads your transcripts and writes a SQLite
database under `~/.skill-analytics` (override with `SKILLSTATS_HOME`). The only
network activity that exists is `remote sync`, which is your own SSH connection
to your own machines, initiated by you. No telemetry, no account, no third
party — ever.

## Roadmap

- **sweep** — cross-machine dead-weight cleanup: evidence-ranked candidates
  (by tokens-per-turn recovered), quarantine-not-delete, human-gated.
- **deeper grade loop** — correlate hard signals with outcomes; auto-flag
  skills whose activations reliably precede trouble.
- **improvement PRs** — proposals as real diffs against the skill, still
  human-approved.
- **opt-in hosted sync** — for teams who want a shared aggregated view.

## License

MIT © 2026 Alex Neyman
