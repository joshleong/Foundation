/**
 * SQLite through node:sqlite (no native build step). One file under
 * FOUNDATION_DATA_DIR holds users, sessions, board update logs, files, the
 * full-text index, apps, asks and agent runs.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(join(config.dataDir, "files"), { recursive: true });

export const db = new DatabaseSync(join(config.dataDir, "foundation.db"));

/** set when the search index was rebuilt; files.ts re-extracts file text */
export let needsFileReindex = false;

db.exec(`
pragma journal_mode = wal;
pragma synchronous = normal;
pragma foreign_keys = on;

create table if not exists users (
  id text primary key,
  email text unique not null,
  name text not null,
  color text not null,
  role text not null default 'member',
  created_at integer not null
);

create table if not exists sessions (
  token text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at integer not null,
  expires_at integer not null
);

create table if not exists boards (
  id text primary key,
  name text not null,
  created_at integer not null,
  updated_at integer not null
);

-- Yjs updates, appended; compacted into one row per board when it grows
create table if not exists board_updates (
  seq integer primary key autoincrement,
  board_id text not null,
  update_blob blob not null,
  at integer not null
);
create index if not exists board_updates_board on board_updates(board_id, seq);

-- uploaded media is archived, never deleted (carried over from flowform-server)
create table if not exists files (
  id text primary key,
  board_id text,
  name text not null,
  mime text not null,
  size integer not null,
  sha256 text not null,
  uploaded_by text,
  created_at integer not null,
  archived_at integer
);


create table if not exists apps (
  id text primary key,
  name text not null,
  url text,
  repo text,
  mcp text,
  description text,
  ports_json text not null default '[]',
  created_by text,
  created_at integer not null
);

create table if not exists asks (
  id text primary key,
  board_id text not null,
  panel_id text,
  assignee text not null,
  kind text not null,
  prompt text not null,
  status text not null default 'open',
  created_by text not null,
  created_at integer not null,
  due_at integer,
  last_nudged_at integer,
  resolved_file_id text
);

create table if not exists agent_runs (
  id text primary key,
  board_id text not null,
  runtime text not null,
  prompt text not null,
  status text not null,
  transcript_json text not null default '[]',
  input_tokens integer default 0,
  output_tokens integer default 0,
  created_by text,
  created_at integer not null,
  finished_at integer
);

create table if not exists jobs (
  id text primary key,
  kind text not null,
  target text not null,
  goal text not null default '',
  board_id text,
  status text not null,
  output text not null default '',
  created_by text,
  created_at integer not null,
  finished_at integer
);
`);

// Full-text index. unicode61 without stemming: people type prefixes of part
// numbers and app names ("factory" → FactoryForm, "0330" → 03304-10027), and a
// stemmer turns query prefixes into stems that no longer match.
const FTS_SQL = `create virtual table search_fts using fts5(
  source unindexed, ref unindexed, board_id unindexed, title, body,
  tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4'
)`;
{
  const existing = db.prepare("select sql from sqlite_master where name = 'search_fts'").get() as { sql: string } | undefined;
  if (existing && existing.sql.includes("porter")) {
    db.exec("drop table search_fts");
    console.log("search index: rebuilt without stemming (boards re-index on load; files re-index below)");
  }
  if (!existing || existing.sql.includes("porter")) {
    db.exec(FTS_SQL);
    needsFileReindex = Boolean(existing);
  }
}

export type Row = Record<string, unknown>;

export function one<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

export function run(sql: string, ...params: unknown[]) {
  return db.prepare(sql).run(...(params as never[]));
}

/** Replace a document in the full-text index. */
export function indexDoc(source: string, ref: string, boardId: string | null, title: string, body: string) {
  run("delete from search_fts where source = ? and ref = ?", source, ref);
  run(
    "insert into search_fts (source, ref, board_id, title, body) values (?, ?, ?, ?, ?)",
    source,
    ref,
    boardId,
    title,
    body.slice(0, 200_000),
  );
}

export function unindexDoc(source: string, ref: string) {
  run("delete from search_fts where source = ? and ref = ?", source, ref);
}
