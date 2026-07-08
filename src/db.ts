import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { hostname } from 'node:os'

export const SCHEMA_VERSION = '1'

// node:sqlite is an untyped external boundary: rows come back as `unknown`.
// These two helpers are the single place we assert a row shape, so the rest of
// the codebase stays fully typed. Validate/narrow happens here, nowhere else.
export function all<T>(db: DatabaseSync, sql: string, ...params: SqlParam[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}

export function get<T>(db: DatabaseSync, sql: string, ...params: SqlParam[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}

export type SqlParam = string | number | bigint | null | Uint8Array

export function openDb(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  migrate(db)
  return db
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      harness    TEXT NOT NULL DEFAULT 'claude-code',
      skill      TEXT NOT NULL,
      source     TEXT,
      trigger    TEXT,
      session_id TEXT,
      project    TEXT,
      ts         TEXT,
      skill_hash TEXT,
      origin     TEXT NOT NULL,
      machine    TEXT,
      dedup_key  TEXT UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_events_skill ON events(skill);
    CREATE TABLE IF NOT EXISTS signals (
      event_id     INTEGER PRIMARY KEY,
      tokens_after INTEGER NOT NULL DEFAULT 0,
      errors_after INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS outcomes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      skill      TEXT NOT NULL,
      session_id TEXT,
      ts         TEXT,
      grade      TEXT,
      evidence   TEXT,
      followed   TEXT,
      ignored    TEXT,
      trusted    INTEGER NOT NULL DEFAULT 0
    );
  `)
  // v0.1 dbs predate the machine column. Add it on open and backfill existing
  // rows to this host — they were all recorded here before multi-machine sync.
  const cols = all<{ name: string }>(db, 'PRAGMA table_info(events)')
  if (!cols.some((c) => c.name === 'machine')) {
    db.exec('ALTER TABLE events ADD COLUMN machine TEXT')
  }
  db.prepare('UPDATE events SET machine = ? WHERE machine IS NULL').run(hostname())
  // Created only after the column is guaranteed present (v0.1 dbs lacked it).
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_dedup ON events(session_id, skill, machine)')

  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(
    'schema_version',
    SCHEMA_VERSION
  )
}
