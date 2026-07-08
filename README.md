# skillstats

**Skills are the unit of agent capability — and nobody can see them.**

Every skill your agent loads is a bet: that *this* procedure, loaded at *this*
moment, will make the next few minutes of work go better. But once a skill is
installed it disappears into the run. Which ones actually fire? Which sit on
disk for months, never triggering? When a skill *does* activate, does the work
that follows get better or worse? Today the honest answer is a shrug.

skillstats closes that loop. It:

1. **Records every activation** — live via a Claude Code hook, and retroactively
   by backfilling your existing transcripts.
2. **Grades whether the skill actually helped** — hard signals pulled straight
   from the transcript (tokens burned after activation, tool errors that
   followed) plus evidence-forced outcome grades from the agent itself.
3. **Closes the loop with human-gated proposals** — surfaces where a skill is
   underperforming and drafts an improvement, but **never edits a `SKILL.md`
   itself.** You stay in the loop.

100% local. A single SQLite file in `~/.skill-analytics`. Nothing ever leaves
your machine.

---

## Quickstart

```bash
npx skillstats backfill      # parse ~/.claude transcripts into the local db
npx skillstats report        # ranked table: what's used, what's dormant
```

`report --json` emits the same data as machine-readable JSON;
`report --days 7` narrows the window.

Drill into one skill:

```bash
npx skillstats skill agent-browser
```

## Live capture (hook install)

Backfill is a snapshot; the hook keeps the picture current. It registers a
`PostToolUse` hook matching the `Skill` tool that pipes each activation into the
db as it happens:

```bash
npx skillstats install       # adds the hook to ~/.claude/settings.json
npx skillstats uninstall     # removes it, preserving all your other settings
```

The hook is designed to be invisible and unbreakable: on garbage input, a
non-Skill tool, or any db error it exits 0 silently. **A broken analytics hook
must never break your Claude session.**

## MCP server

Expose the analytics to any agent as tools. Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "skillstats": {
      "command": "npx",
      "args": ["skillstats", "mcp"]
    }
  }
}
```

Tools: `get_skill_report`, `get_skill_detail`, `list_dormant_skills`,
`record_skill_outcome`, and `propose_skill_improvement` (which writes a markdown
proposal to `~/.skill-analytics/proposals/` and returns its path — it never
touches a `SKILL.md`).

## Dashboard

```bash
npx skillstats dashboard     # http://localhost:4173
```

A single self-contained HTML page (zero external assets): the ranked skills
table, dormant list, outcomes rollup, and a 30-day activity sparkline per skill.
Read-only over the db.

## What gets measured

Per skill, over a configurable window:

- **invocations** — how many times it activated (model-invoked `Skill` tool
  calls *and* user-typed `/slash` commands).
- **lastUsed** — most recent activation.
- **dormant** — present on disk but zero activations in the window. These are
  the skills quietly costing you context budget for nothing.
- **tokensAfter / errorsAfter** — hard signals. Output tokens spent and tool
  errors raised in the entries immediately following an activation. Not proof of
  causation, but the cheapest available proxy for "did things go well after
  this fired."
- **outcomes** — explicit grades (`worked` / `partial` / `failed`) recorded by
  the agent or by you.

### The untrusted-grade rule

An agent grading its own work is a notorious source of vibes. So an outcome is
marked **trusted only when it ships with real evidence — at least 40 characters
of it** (e.g. *"followed the 'snapshot before tapping' rule from section 3; the
retry loop resolved the stale-ref failure"*). A grade with thin or absent
evidence is still stored, but flagged `untrusted` and counted separately, so a
wall of confident-but-empty "worked" grades can't quietly inflate a skill's
standing. Evidence or it didn't happen.

## Privacy

Everything is local. skillstats reads your transcripts and writes a SQLite
database under `~/.skill-analytics`. There is no network code, no telemetry, no
account. Nothing leaves the machine — ever.

## Roadmap

- **v0.2** — deeper grade loop: correlate hard signals with outcomes, auto-flag
  skills whose activations reliably precede trouble.
- **v0.3** — opt-in hosted sync for teams who want a shared, aggregated view.
- **v0.4** — improvement PRs (open a proposal as a real diff against the skill,
  still human-approved) and multi-harness support beyond Claude Code.

## License

MIT © 2026 Alex Neyman
