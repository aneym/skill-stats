import type { DatabaseSync } from 'node:sqlite'

export type Grade = 'worked' | 'partial' | 'failed'

export const TRUST_MIN_EVIDENCE = 40

export interface OutcomeInput {
  skill: string
  grade: Grade
  evidence?: string
  followed?: string
  ignored?: string
  sessionId?: string
}

export interface OutcomeResult {
  trusted: boolean
}

// trusted iff evidence is present AND >= 40 chars. Vibes-only grades are stored
// anyway (nothing is discarded) but flagged untrusted so reports can discount them.
export function isTrusted(evidence?: string): boolean {
  return typeof evidence === 'string' && evidence.trim().length >= TRUST_MIN_EVIDENCE
}

export function recordOutcome(db: DatabaseSync, input: OutcomeInput): OutcomeResult {
  const trusted = isTrusted(input.evidence)
  db.prepare(
    `INSERT INTO outcomes (skill, session_id, ts, grade, evidence, followed, ignored, trusted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.skill,
    input.sessionId ?? null,
    new Date().toISOString(),
    input.grade,
    input.evidence ?? null,
    input.followed ?? null,
    input.ignored ?? null,
    trusted ? 1 : 0
  )
  return { trusted }
}
