import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type DB = Database.Database

/** Open (and migrate) the statistics database. */
export function openStats(file: string): DB {
  mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      post_id TEXT PRIMARY KEY, account_id TEXT, platform TEXT, project_id TEXT, variant_id TEXT,
      recipe TEXT, channel TEXT, category TEXT, title TEXT, url TEXT, thumb TEXT, published_at TEXT
    );
    -- Lifetime counters of one post at one moment (deltas between snapshots = growth).
    CREATE TABLE IF NOT EXISTS post_snap (
      post_id TEXT, at TEXT, views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER,
      PRIMARY KEY (post_id, at)
    );
    CREATE TABLE IF NOT EXISTS account_daily (
      account_id TEXT, date TEXT, followers_gained INTEGER, followers_total INTEGER,
      PRIMARY KEY (account_id, date)
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `)
  return db
}
