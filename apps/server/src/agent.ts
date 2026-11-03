/**
 * The Foundation agent: one conversation per person per board, able to run
 * the whole grid through the board tools (tools.ts). Two runtimes, the way
 * Vision splits subscription from API:
 *
 * - "subscription" (default when `claude` is installed): Claude Code on this
 *   machine, headless (`claude -p --output-format stream-json`), with
 *   Foundation's MCP endpoint attached for the board. The person's plan pays;
 *   no API key involved. Sessions resume, so the conversation carries over —
 *   Foundation's T3-style session mechanism.
 * - "api": the Anthropic Messages API with the workspace key (credits),
 *   streaming, a manual tool loop so every step streams to the grid.
 *
 * Either way each step arrives at the client as AgentEvents over SSE, and
 * every board write shows up live to everyone through the board's Y.Doc.
 */

import Anthropic from "@anthropic-ai/sdk";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AgentEvent, AgentRuntime, UserInfo } from "@foundation/protocol";
import { config } from "./config.ts";
import { all, one, run } from "./db.ts";
import { boardDigest, editBoard } from "./boards.ts";
import { runTool, TOOLS, type ToolCtx } from "./tools.ts";
import { canWrite } from "./roles.ts";
import { createSession, revokeSession } from "./auth.ts";
import { logActivity } from "@foundation/protocol";

const SYSTEM = `You are the Foundation agent — the company brain of Form Industries, living inside Foundation, a shared grid where the team keeps its projects, files, designs, running apps and agents together.

You work with the people on the board, not for show. You can read and change the board with your tools: organize cards into sections, open apps and web pages as live panels, find an app's GitHub repo and MCP tools, wire one app's outputs into another's inputs, read live company systems (Vision, BomForm, FactoryForm, the Airform Data Room, Creation), search everything (board, files, Slack, GitHub), brief Vision on a design, queue reverse-engineering with REA, open huddles (video rooms on the board) and read what was said in them, put Slack channels on the board and read them (people post; you read), and — through Hermes — ask teammates for what the work needs, above all the latest CAD files.

Design pipelines carry a part from idea to release, panel by panel: Brief → Concept → CAD → Simulate → Review → Release (start_design_pipeline). Each stage collects artifacts; stage_request runs its hand-off (Vision briefs, Hermes CAD asks, review asks); complete_stage sends its output down the wire to the next. Only complete a stage when its work is really done.

How you work:
- Read the board first when the ask touches it. Refer to cards by name, not id.
- Make the change, then say in one or two sentences what you did and where it is. Use focus to point at the card you made.
- Ask before deleting anything or acting on someone else's work in a way they would not expect. Deletes need confirm: true.
- Nothing that spends money or runs third-party tooling starts on its own: reverse-engineering jobs wait for a person to press Run.
- When a design needs CAD or a decision you don't have, use ask_person rather than guessing.
- For work with more than one step, call set_plan first (the goal and the steps), and again as each step starts and finishes, so the person can follow along in the session tab.
- Be brief and concrete. No preamble.`;

const histories = new Map<string, Anthropic.MessageParam[]>();
const claudeSessions = new Map<string, string>();

let cliAvailable: boolean | null = null;
export function claudeCliAvailable(): boolean {
  if (cliAvailable !== null) return cliAvailable;
  try {
    execFileSync(config.claudeCli, ["--version"], { stdio: "ignore", timeout: 5000 });
    cliAvailable = true;
  } catch {
    cliAvailable = false;
  }
  return cliAvailable;
}

export function runtimes() {
  return {
    subscription: claudeCliAvailable(),
    api: Boolean(config.anthropic.apiKey),
    model: config.anthropic.model,
  };
}

export function pickRuntime(requested?: string): AgentRuntime | null {
  const r = runtimes();
  if (requested === "api") return r.api ? "api" : null;
  if (requested === "subscription") return r.subscription ? "subscription" : null;
  return r.subscription ? "subscription" : r.api ? "api" : null;
}

export async function runAgent(opts: {
  boardId: string;
  user: UserInfo;
  prompt: string;
  runtime?: string;
  /** the session tab this turn belongs to: its own conversation (default: the person's one per board) */
  session?: string;
  runId?: string;
  emit: (e: AgentEvent) => void;
  signal: AbortSignal;
}) {
  const runtime = pickRuntime(opts.runtime);
  if (!runtime) {
    opts.emit({
      type: "error",
      message: "No agent runtime: install Claude Code (`claude`) to use your subscription, or set ANTHROPIC_API_KEY to use API credits.",
    });
    return;
  }
  const runId = opts.runId ?? newRunId();
  run(
    "insert into agent_runs (id, board_id, runtime, prompt, status, created_by, created_at, session_id) values (?, ?, ?, ?, 'running', ?, ?, ?)",
    runId, opts.boardId, runtime, opts.prompt, opts.user.id, Date.now(), opts.session ?? null,
  );
  // a viewer's question isn't a change to the board, so it doesn't go in its activity
  if (canWrite(opts.user.id, opts.boardId)) editBoard(opts.boardId, "agent", (doc) => logActivity(doc, { who: opts.user.name, role: "human", text: `asked the agent: ${opts.prompt.slice(0, 140)}` }));
  const transcript: AgentEvent[] = [];
  // the transcript is saved as the turn runs, so a reload mid-turn replays it
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    saveTimer = null;
    run("update agent_runs set transcript_json = ? where id = ? and status = 'running'", JSON.stringify(transcript), runId);
  };
  const emit = (e: AgentEvent) => {
    // streamed text is stored as one event per run of text, not one per token
    const last = transcript[transcript.length - 1];
    if (e.type === "text" && last?.type === "text") transcript[transcript.length - 1] = { type: "text", text: last.text + e.text };
    else transcript.push(e);
    opts.emit(e);
    saveTimer ??= setTimeout(save, 1200);
  };
  const finish = (status: "done" | "error" | "stopped") => {
    if (saveTimer) clearTimeout(saveTimer);
    run("update agent_runs set status = ?, transcript_json = ?, finished_at = ? where id = ?", status, JSON.stringify(transcript), Date.now(), runId);
  };
  try {
    if (runtime === "api") await runApi(opts, emit);
    else await runSubscription(opts, emit, runId);
    finish(opts.signal.aborted ? "stopped" : "done");
  } catch (e) {
    if (opts.signal.aborted) return finish("stopped");
    emit({ type: "error", message: (e as Error).message });
    finish("error");
  }
}

const newRunId = () => `run_${randomBytes(6).toString("hex")}`;

// ---------- runs outlive the page that started them ----------
// A turn keeps going when its tab reloads or closes; the page reattaches by
// run id (replay, then live), and only Stop ends it early.

interface LiveRun {
  id: string;
  userId: string;
  events: AgentEvent[];
  listeners: Set<(e: AgentEvent) => void>;
  done: boolean;
  ctrl: AbortController;
}
const live = new Map<string, LiveRun>();

export function startRun(opts: Omit<Parameters<typeof runAgent>[0], "emit" | "signal" | "runId">): LiveRun {
  const r: LiveRun = { id: newRunId(), userId: opts.user.id, events: [], listeners: new Set(), done: false, ctrl: new AbortController() };
  live.set(r.id, r);
  const emit = (e: AgentEvent) => {
    const last = r.events[r.events.length - 1];
    if (e.type === "text" && last?.type === "text") r.events[r.events.length - 1] = { type: "text", text: last.text + e.text };
    else r.events.push(e);
    for (const fn of r.listeners) fn(e);
  };
  emit({ type: "run", id: r.id });
  void runAgent({ ...opts, runId: r.id, emit, signal: r.ctrl.signal }).finally(() => {
    r.done = true;
    for (const fn of r.listeners) fn({ type: "status", status: "ended" });
    r.listeners.clear();
    setTimeout(() => live.delete(r.id), 60_000);
  });
  return r;
}

/** a run this person may watch: replay what happened, then follow; returns a detach */
export function followRun(id: string, userId: string, send: (e: AgentEvent) => void, end: () => void): (() => void) | null {
  const r = live.get(id);
  if (!r || r.userId !== userId) return null;
  for (const e of r.events) send(e);
  if (r.done) {
    end();
    return () => {};
  }
  const fn = (e: AgentEvent) => (e.type === "status" && e.status === "ended" ? end() : send(e));
  r.listeners.add(fn);
  return () => r.listeners.delete(fn);
}

export function stopRun(id: string, userId: string) {
  const r = live.get(id);
  if (!r || r.userId !== userId) return false;
  r.ctrl.abort();
  return true;
}

/** runs left "running" by a server that stopped can't finish: say so */
export function settleOrphanRuns() {
  run("update agent_runs set status = 'error', finished_at = ? where status = 'running'", Date.now());
}

// ---------- API runtime (credits) ----------

function apiTools(): Anthropic.Tool[] {
  return TOOLS.map((t) => {
    const schema = zodToJsonSchema(t.schema, { $refStrategy: "none" }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: schema as Anthropic.Tool.InputSchema };
  });
}

/** one conversation per person per board, or per session tab */
const convKey = (opts: { boardId: string; user: UserInfo; session?: string }) => `${opts.boardId}:${opts.user.id}${opts.session ? `:${opts.session}` : ""}`;

async function runApi(opts: Parameters<typeof runAgent>[0], emit: (e: AgentEvent) => void) {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey });
  const key = convKey(opts);
  const history = histories.get(key) ?? [];
  history.push({
    role: "user",
    content: `${opts.prompt}\n\n<board name="${opts.boardId}" person="${opts.user.name}"${canWrite(opts.user.id, opts.boardId) ? "" : ' access="view only — read and answer; do not try to change the board"'}>\n${boardDigest(opts.boardId)}\n</board>`,
  });
  const ctx: ToolCtx = { boardId: opts.boardId, actor: "Foundation Agent", userId: opts.user.id };
  const tools = apiTools();
  let usage = { input: 0, output: 0 };

  for (let step = 0; step < 24; step++) {
    if (opts.signal.aborted) throw new Error("stopped");
    emit({ type: "status", status: step === 0 ? "thinking" : "working" });
    const stream = client.messages.stream(
      {
        model: config.anthropic.model,
        max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        tools,
        messages: history,
      } as Anthropic.MessageStreamParams,
      { signal: opts.signal },
    );
    stream.on("text", (t) => emit({ type: "text", text: t }));
    const msg = await stream.finalMessage();
    usage = { input: usage.input + msg.usage.input_tokens, output: usage.output + msg.usage.output_tokens };
    history.push({ role: "assistant", content: msg.content });

    if (msg.stop_reason === "refusal") throw new Error("the model declined this request");
    if (msg.stop_reason === "pause_turn") continue;
    const calls = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || calls.length === 0) break;

    const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
      calls.map(async (c) => {
        emit({ type: "tool", name: c.name, input: c.input });
        try {
          const out = await runTool(ctx, c.name, c.input);
          const text = typeof out === "string" ? out : JSON.stringify(out);
          emit({ type: "tool_result", name: c.name, ok: true, summary: text.slice(0, 200) });
          return { type: "tool_result" as const, tool_use_id: c.id, content: text.slice(0, 60_000) };
        } catch (e) {
          const message = (e as Error).message;
          emit({ type: "tool_result", name: c.name, ok: false, summary: message });
          return { type: "tool_result" as const, tool_use_id: c.id, content: message, is_error: true };
        }
      }),
    );
    history.push({ role: "user", content: results });
  }
  // keep the conversation bounded; older turns fall off whole
  while (history.length > 40) history.splice(0, 2);
  histories.set(key, history);
  emit({ type: "done", runtime: "api", usage });
}

// ---------- subscription runtime (Claude Code, T3-style session) ----------

async function runSubscription(opts: Parameters<typeof runAgent>[0], emit: (e: AgentEvent) => void, runId: string) {
  const key = convKey(opts);
  // a short-lived session for this person, so the agent's writes are theirs
  const token = createSession(opts.user.id, 2 * 3600_000);
  const mcpFile = join(config.dataDir, `mcp-${randomBytes(6).toString("hex")}.json`);
  writeFileSync(
    mcpFile,
    JSON.stringify({
      mcpServers: {
        foundation: {
          type: "http",
          url: `http://${config.host}:${config.port}/mcp?board=${encodeURIComponent(opts.boardId)}`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }),
    { mode: 0o600 },
  );
  const prompt = `${opts.prompt}\n\n<board name="${opts.boardId}" person="${opts.user.name}"${canWrite(opts.user.id, opts.boardId) ? "" : ' access="view only — read and answer; do not try to change the board"'}>\n${boardDigest(opts.boardId)}\n</board>`;
  const argv = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--mcp-config",
    mcpFile,
    "--append-system-prompt",
    SYSTEM + "\nYour board tools are the mcp__foundation__* tools.",
    "--allowedTools",
    "mcp__foundation__*",
  ];
  // the Claude Code session to continue: this server's memory, else the last run of this tab
  const resume =
    claudeSessions.get(key) ??
    (opts.session
      ? one<{ claude_session: string }>("select claude_session from agent_runs where session_id = ? and created_by = ? and claude_session is not null order by created_at desc limit 1", opts.session, opts.user.id)?.claude_session
      : undefined);
  if (resume) argv.push("--resume", resume);

  emit({ type: "status", status: "thinking" });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(config.claudeCli, argv, { cwd: config.dataDir, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    opts.signal.addEventListener("abort", () => child.kill("SIGTERM"));
    let buf = "";
    let err = "";
    child.stdout.on("data", (b: Buffer) => {
      buf += b.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handleLine(line);
      }
    });
    child.stderr.on("data", (b: Buffer) => (err += b.toString("utf8")));
    const handleLine = (line: string) => {
      let ev: {
        type: string;
        subtype?: string;
        session_id?: string;
        message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown; content?: unknown; is_error?: boolean }> };
        usage?: { input_tokens?: number; output_tokens?: number };
        result?: string;
        is_error?: boolean;
      };
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.session_id && claudeSessions.get(key) !== ev.session_id) {
        claudeSessions.set(key, ev.session_id);
        run("update agent_runs set claude_session = ? where id = ?", ev.session_id, runId);
      }
      if (ev.type === "assistant") {
        for (const b of ev.message?.content ?? []) {
          if (b.type === "text" && b.text) emit({ type: "text", text: b.text });
          // Claude Code's own plumbing (tool search) isn't a step people need to see
          if (b.type === "tool_use" && b.name !== "ToolSearch") emit({ type: "tool", name: (b.name ?? "").replace(/^mcp__foundation__/, ""), input: b.input });
        }
        emit({ type: "status", status: "working" });
      } else if (ev.type === "user") {
        for (const b of ev.message?.content ?? []) {
          if (b.type === "tool_result") {
            if (typeof b.content !== "string" && JSON.stringify(b.content).includes('"tool_reference"')) continue;
            const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
            emit({ type: "tool_result", name: "", ok: !b.is_error, summary: text.slice(0, 200) });
          }
        }
      } else if (ev.type === "result") {
        if (ev.is_error) emit({ type: "error", message: ev.result ?? "Claude Code reported an error" });
        emit({ type: "done", runtime: "subscription", usage: { input: ev.usage?.input_tokens ?? 0, output: ev.usage?.output_tokens ?? 0 } });
      }
    };
    child.on("error", reject);
    child.on("close", (code) => {
      rmSync(mcpFile, { force: true });
      revokeSession(token);
      if (code === 0 || opts.signal.aborted) resolve();
      else reject(new Error(`Claude Code exited ${code}: ${err.slice(-600)}`));
    });
  });
}

// ---------- sessions (the tabs) ----------

export interface SessionSummary {
  id: string;
  title: string;
  board: string;
  runs: number;
  status: "running" | "done" | "error";
  updatedAt: number;
}

/** this person's agent sessions on a board, newest first */
export function listSessions(boardId: string, userId: string, limit = 30): SessionSummary[] {
  const rows = all<{ session_id: string; first: string; runs: number; updated: number; board_id: string }>(
    `select session_id, board_id, count(*) as runs, max(created_at) as updated,
            (select prompt from agent_runs b where b.session_id = a.session_id order by created_at asc limit 1) as first
       from agent_runs a
      where board_id = ? and created_by = ? and session_id is not null
      group by session_id order by updated desc limit ?`,
    boardId, userId, limit,
  );
  return rows.map((r) => {
    const last = one<{ status: string }>("select status from agent_runs where session_id = ? order by created_at desc limit 1", r.session_id);
    return { id: r.session_id, title: titleOf(r.first), board: r.board_id, runs: r.runs, status: (last?.status ?? "done") as SessionSummary["status"], updatedAt: r.updated };
  });
}

/** a session's turns, as the tab replays them */
export function sessionTurns(sessionId: string, userId: string) {
  return all<{ id: string; prompt: string; status: string; runtime: string; transcript_json: string; created_at: number }>(
    "select id, prompt, status, runtime, transcript_json, created_at from agent_runs where session_id = ? and created_by = ? order by created_at asc",
    sessionId, userId,
  ).map((r) => ({ id: r.id, prompt: r.prompt, status: r.status, runtime: r.runtime, at: r.created_at, events: JSON.parse(r.transcript_json) as AgentEvent[] }));
}

export function titleOf(prompt: string) {
  const line = prompt.split("\n")[0].trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}
