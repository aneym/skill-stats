import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

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
  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(
    'schema_version',
    SCHEMA_VERSION
  )
}
