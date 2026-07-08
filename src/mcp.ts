import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { openDb } from './db.js'
import { computeReport, computeSkillDetail } from './report.js'
import { recordOutcome, isTrusted, TRUST_MIN_EVIDENCE, type Grade } from './outcome.js'
import { writeProposal } from './proposals.js'
import { addRemote, syncRemotes } from './remotes.js'

const VERSION = '0.2.0'

export async function runMcp(dbPath: string, claudeDir: string): Promise<void> {
  const db = openDb(dbPath)
  const server = new McpServer({ name: 'skill-stats', version: VERSION })

  server.tool(
    'get_skill_report',
    'Ranked usage report across all skills (invocations, hard signals, dormancy, outcomes, byTrigger, machines).',
    { days: z.number().int().positive().optional() },
    async ({ days }) => text(JSON.stringify(computeReport(db, { claudeDir }, days ?? 30), null, 2))
  )

  server.tool(
    'get_skill_detail',
    'Drill-down for one skill: per-version rollup, byTrigger/machines split, and recent activations.',
    { skill: z.string() },
    async ({ skill }) => text(JSON.stringify(computeSkillDetail(db, { claudeDir }, skill, 30), null, 2))
  )

  server.tool(
    'list_dormant_skills',
    'Skills present on disk but unused within the window.',
    { days: z.number().int().positive().optional() },
    async ({ days }) => {
      const report = computeReport(db, { claudeDir }, days ?? 30)
      return text(JSON.stringify(report.skills.filter((s) => s.dormant), null, 2))
    }
  )

  server.tool(
    'add_remote',
    'Register a remote skill-stats system for ssh sync (agent-configurable multi-system fleet).',
    { name: z.string(), host: z.string(), path: z.string().optional() },
    async ({ name, host, path }) => {
      const remote = addRemote(name, host, path)
      return text(`Added remote ${remote.name} → ${remote.host}:${remote.path}`)
    }
  )

  server.tool(
    'sync_remotes',
    'Pull and import every configured remote over ssh. Per-remote failures are non-fatal.',
    {},
    async () => text(JSON.stringify(syncRemotes(db), null, 2))
  )

  server.tool(
    'record_skill_outcome',
    `Record whether a skill helped. Evidence >= ${TRUST_MIN_EVIDENCE} chars marks the grade trusted; shorter grades are stored untrusted.`,
    {
      skill: z.string(),
      grade: z.enum(['worked', 'partial', 'failed']),
      evidence: z.string(),
      followed: z.string().optional(),
      ignored: z.string().optional(),
      session_id: z.string().optional(),
    },
    async (args) => {
      recordOutcome(db, {
        skill: args.skill,
        grade: args.grade as Grade,
        evidence: args.evidence,
        followed: args.followed,
        ignored: args.ignored,
        sessionId: args.session_id,
      })
      const trusted = isTrusted(args.evidence)
      const note = trusted
        ? 'Recorded (trusted).'
        : `Recorded, but flagged UNTRUSTED: evidence under ${TRUST_MIN_EVIDENCE} chars is a vibes-only grade.`
      return text(note)
    }
  )

  server.tool(
    'propose_skill_improvement',
    'Write a human-reviewable markdown improvement proposal. Never edits any SKILL.md.',
    {
      skill: z.string(),
      problem: z.string(),
      proposed_change: z.string(),
      evidence: z.array(z.string()),
    },
    async (args) => {
      const path = writeProposal({
        skill: args.skill,
        problem: args.problem,
        proposedChange: args.proposed_change,
        evidence: args.evidence,
      })
      return text(`Proposal written to ${path} (no SKILL.md was modified).`)
    }
  )

  await server.connect(new StdioServerTransport())
}

function text(body: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: body }] }
}
