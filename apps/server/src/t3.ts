/**
 * Vision Code (T3) sessions, read where T3 keeps them: its own projection
 * store (`<T3CODE_HOME>/userdata/state.sqlite`), opened read-only. No token,
 * no pairing, nothing written — Foundation lists the threads in the side pane
 * and replays one in a session tab; continuing a thread happens in Vision
 * Code itself (the tab links there).
 *
 * T3's tables are its own projection, not an API, so every read is defensive:
 * a missing store or a changed column answers "unavailable", never a crash.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = process.env.T3CODE_HOME ?? join(homedir(), "Library", "Application Support", "co.normallab.vision", "code");
const DB = join(HOME, "userdata", "state.sqlite");
/** Read when used, not at import: a test (or a launcher) may set T3_URL after this module loads. */
const t3Url = () => (process.env.T3_URL ?? "http://localhost:3783").replace(/\/$/, "");

let db: DatabaseSync | null = null;
function open(): DatabaseSync | null {
  if (db) return db;
  if (!existsSync(DB)) return null;
  try {
    db = new DatabaseSync(DB, { readOnly: true });
    return db;
  } catch {
    return null;
  }
}

let envId: { id: string | null; at: number } = { id: null, at: 0 };
/** T3's environment id, for links into Vision Code (cached a minute) */
async function environmentId(): Promise<string | null> {
  if (Date.now() - envId.at < 60_000) return envId.id;
  try {
    const r = await fetch(`${t3Url()}/.well-known/t3/environment`, { signal: AbortSignal.timeout(1200) });
    const j = (await r.json()) as { environmentId?: string };
    envId = { id: j.environmentId ?? null, at: Date.now() };
  } catch {
    envId = { id: null, at: Date.now() };
  }
  return envId.id;
}

export interface T3Thread {
  id: string;
  title: string;
  project: string;
  status: "running" | "waiting" | "idle" | "error";
  pending: number;
  updatedAt: number;
  url: string | null;
}

function statusOf(session: string | null, pending: number, error: string | null): T3Thread["status"] {
  if (pending > 0) return "waiting";
  if (error) return "error";
  if (session === "running" || session === "starting") return "running";
  return "idle";
}

export async function t3Threads(limit = 24): Promise<{ available: boolean; threads: T3Thread[] }> {
  const d = open();
  if (!d) return { available: false, threads: [] };
  const env = await environmentId();
  try {
    const rows = d
      .prepare(
        `select t.thread_id, t.title, p.title as project, t.updated_at, t.pending_approval_count + t.pending_user_input_count as pending,
                s.status, s.last_error
           from projection_threads t
           join projection_projects p on p.project_id = t.project_id
           left join projection_thread_sessions s on s.thread_id = t.thread_id
          where t.deleted_at is null and t.archived_at is null
          order by coalesce(t.latest_user_message_at, t.updated_at) desc
          limit ?`,
      )
      .all(limit) as Array<{ thread_id: string; title: string; project: string; updated_at: string; pending: number; status: string | null; last_error: string | null }>;
    return {
      available: true,
      threads: rows.map((r) => ({
        id: r.thread_id,
        title: r.title,
        project: r.project,
        status: statusOf(r.status, r.pending, r.last_error),
        pending: r.pending,
        updatedAt: Date.parse(r.updated_at) || 0,
        url: env ? `${t3Url()}/${env}/${r.thread_id}` : null,
      })),
    };
  } catch {
    return { available: false, threads: [] };
  }
}

export interface T3Item {
  kind: "user" | "assistant" | "reasoning" | "tool" | "error";
  text: string;
  at: number;
  ok?: boolean;
}

/** one thread as a conversation: messages, tool steps and the latest proposed plan */
export async function t3Thread(id: string): Promise<{ thread: T3Thread; items: T3Item[]; plan: string | null } | null> {
  const d = open();
  if (!d) return null;
  const head = (await t3Threads(500)).threads.find((t) => t.id === id);
  if (!head) return null;
  const items: T3Item[] = [];
  for (const m of d
    .prepare("select role, text, created_at from projection_thread_messages where thread_id = ? order by created_at asc limit 400")
    .all(id) as Array<{ role: string; text: string; created_at: string }>) {
    const text = m.text.trim();
    if (!text) continue;
    const kind = m.role === "user" ? "user" : m.role === "reasoning" ? "reasoning" : "assistant";
    items.push({ kind, text, at: Date.parse(m.created_at) || 0 });
  }
  // tool steps: one per call, its last state wins
  const tools = new Map<string, T3Item>();
  for (const a of d
    .prepare("select kind, summary, payload_json, created_at from projection_thread_activities where thread_id = ? order by created_at asc limit 1000")
    .all(id) as Array<{ kind: string; summary: string; payload_json: string; created_at: string }>) {
    let p: { toolCallId?: string; detail?: string; status?: string; message?: string } = {};
    try {
      p = JSON.parse(a.payload_json);
    } catch { /* keep the summary */ }
    const at = Date.parse(a.created_at) || 0;
    if (a.kind.startsWith("tool.") && p.toolCallId) {
      const prev = tools.get(p.toolCallId);
      const text = (p.detail ?? a.summary).slice(0, 160);
      const ok = p.status === "failed" ? false : p.status === "completed" ? true : undefined;
      if (prev) Object.assign(prev, { text, ok });
      else {
        const it: T3Item = { kind: "tool", text, at, ok };
        tools.set(p.toolCallId, it);
        items.push(it);
      }
    } else if (a.kind === "runtime.error") items.push({ kind: "error", text: p.message ?? a.summary, at });
  }
  items.sort((x, y) => x.at - y.at);
  const plan = (d.prepare("select plan_markdown from projection_thread_proposed_plans where thread_id = ? order by updated_at desc limit 1").get(id) as { plan_markdown?: string } | undefined)?.plan_markdown ?? null;
  return { thread: head, items, plan };
}
