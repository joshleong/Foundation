/**
 * Foundation's own T3 instance: the agent harness behind the agents pane.
 *
 * T3 Code's server (the same prebuilt `t3` Vision Code runs, unmodified) can
 * drive several coding agents from one place: Claude, Codex (OpenAI), Cursor,
 * Grok, OpenCode, Antigravity (Gemini), and more instances of any of them
 * with their own sign-in or endpoint. Foundation runs one of its own, apart
 * from Vision Code's: its own home (`<data>/t3`), its own port, its own
 * threads. The agents pane reads from it which agents this computer has and
 * what each is working on.
 *
 * Starting it runs a third-party program, so only a person starts or stops
 * it, from their browser (index.ts: requirePerson). Nothing here starts a
 * thread: listing agents and threads spends nothing.
 *
 * The start is Vision's (apps/vision/src-tauri/src/code_host.rs): the program
 * is given one line of JSON on stdin (`--bootstrap-fd 0`) with a port, a home
 * and a one-time token; when `/.well-known/t3/environment` answers, the token
 * is exchanged for a bearer (`POST /oauth/token`), the bearer for a socket
 * ticket (`POST /api/auth/websocket-ticket`), and two streams stay open:
 * `subscribeServerConfig` (the providers, as they come and go) and
 * `orchestration.subscribeShell` (the threads). The bearer lives in this
 * process's memory only.
 *
 * T3's messages are its own contract (packages/contracts in t3code, 0.0.44),
 * read defensively: an unknown shape is skipped, never a crash.
 */

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import WebSocket from "ws";
import { config } from "./config.ts";
import { findT3Cli, ON_PATH, t3Command } from "./t3paths.ts";

/** an agent T3 can run: one configured instance of a provider */
export interface T3Agent {
  /** T3's routing key ("claudeAgent", "codex", or a named instance) */
  id: string;
  /** which kind of agent drives it ("claudeAgent", "codex", "cursor", "grok", "opencode", "antigravity", …) */
  driver: string;
  name: string;
  enabled: boolean;
  installed: boolean;
  version: string | null;
  /** ready: can take work now · sign-in: installed, not signed in · missing: its program isn't on this computer · off: disabled · error */
  state: "ready" | "sign-in" | "missing" | "off" | "error";
  /** the plan or account it's signed in to, when T3 knows */
  account?: string;
  /** why it isn't ready, in T3's words */
  message?: string;
  models: number;
}

/** a thread in Foundation's T3: one agent's piece of work */
export interface T3Work {
  id: string;
  title: string;
  project: string;
  /** the agent instance it runs on */
  agent: string;
  model: string;
  state: "working" | "waiting" | "idle" | "error";
  updatedAt: string;
}

export interface T3HostStatus {
  state: "off" | "starting" | "running" | "error";
  /** why it's off or failed, or what it's doing while starting */
  detail?: string;
  port?: number;
  version?: string;
  startedBy?: string;
  since: number;
  agents: T3Agent[];
  work: T3Work[];
}

const HOME = () => join(config.dataDir, "t3");
const FIRST_PORT = () => {
  const v = Number(process.env.FOUNDATION_T3_PORT ?? "15783");
  return Number.isInteger(v) && v > 0 ? v : 15783;
};
const READY_MS = () => Number(process.env.FOUNDATION_T3_READY_MS ?? "60000") || 60_000;

let status: T3HostStatus = { state: "off", since: Date.now(), agents: [], work: [] };
let child: ChildProcess | null = null;
let ws: WebSocket | null = null;
let bearer: string | null = null;
let generation = 0;
const projects = new Map<string, string>();
const threads = new Map<string, T3Work>();

export function t3Host(): T3HostStatus {
  return { ...status, agents: status.agents, work: [...threads.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)) };
}

function set(patch: Partial<T3HostStatus>) {
  const stateChanged = patch.state !== undefined && patch.state !== status.state;
  status = { ...status, ...patch, ...(stateChanged ? { since: Date.now() } : {}) };
}

// ---------- reading T3's shapes ----------

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/** T3's ServerProvider → what the pane shows */
export function agentOf(v: unknown): T3Agent | null {
  const p = obj(v);
  const id = str(p?.instanceId);
  if (!p || !id) return null;
  const auth = obj(p.auth);
  const enabled = p.enabled !== false;
  const installed = p.installed === true;
  const unavailable = p.availability === "unavailable";
  const state: T3Agent["state"] = !enabled || p.status === "disabled"
    ? "off"
    : unavailable || !installed
      ? "missing"
      : auth?.status === "unauthenticated"
        ? "sign-in"
        : p.status === "ready" || p.status === "warning"
          ? "ready"
          : "error";
  return {
    id,
    driver: str(p.driver) ?? id,
    name: str(p.displayName) ?? id,
    enabled,
    installed,
    version: str(p.version) ?? null,
    state,
    account: str(auth?.label) ?? str(auth?.type) ?? str(auth?.email),
    message: str(p.unavailableReason) ?? str(p.message),
    models: Array.isArray(p.models) ? p.models.length : 0,
  };
}

/** T3's OrchestrationThreadShell → a piece of work (null: archived, or not a thread) */
export function workOf(v: unknown, projectName: (id: string) => string | undefined = (id) => projects.get(id)): T3Work | null {
  const t = obj(v);
  const id = str(t?.id);
  if (!t || !id || t.archivedAt) return null;
  const session = obj(t.session);
  const turn = obj(t.latestTurn);
  const sel = obj(t.modelSelection);
  const state: T3Work["state"] = t.hasPendingApprovals === true || t.hasPendingUserInput === true
    ? "waiting"
    : session?.status === "error" || turn?.state === "error"
      ? "error"
      : session?.status === "running" || session?.status === "starting" || turn?.state === "running" || t.backgroundLiveness === "working"
        ? "working"
        : "idle";
  return {
    id,
    title: str(t.title) ?? "Untitled",
    project: projectName(str(t.projectId) ?? "") ?? "",
    agent: str(session?.providerInstanceId) ?? str(sel?.instanceId) ?? str(sel?.provider) ?? "",
    model: str(sel?.model) ?? "",
    state,
    updatedAt: str(t.updatedAt) ?? "",
  };
}

function takeProviders(list: unknown) {
  if (!Array.isArray(list)) return;
  set({ agents: list.map(agentOf).filter((a): a is T3Agent => !!a) });
}

/** one item of `subscribeServerConfig` */
export function onConfigItem(item: unknown) {
  const e = obj(item);
  if (!e) return;
  if (e.type === "snapshot") takeProviders(obj(e.config)?.providers);
  else if (e.type === "providerStatuses") takeProviders(obj(e.payload)?.providers);
}

/** one item of `orchestration.subscribeShell` */
export function onShellItem(item: unknown) {
  const e = obj(item);
  if (!e) return;
  const project = (p: unknown) => {
    const o = obj(p);
    const id = str(o?.id);
    if (id) projects.set(id, str(o?.title) ?? "");
  };
  const thread = (t: unknown) => {
    const id = str(obj(t)?.id);
    if (!id) return;
    const w = workOf(t);
    if (w) threads.set(id, w);
    else threads.delete(id);
  };
  if (e.kind === "snapshot") {
    const s = obj(e.snapshot);
    projects.clear();
    threads.clear();
    if (Array.isArray(s?.projects)) s.projects.forEach(project);
    if (Array.isArray(s?.threads)) s.threads.forEach(thread);
  } else if (e.kind === "project-upserted") project(e.project);
  else if (e.kind === "project-removed") projects.delete(str(e.projectId) ?? "");
  else if (e.kind === "thread-upserted") thread(e.thread);
  else if (e.kind === "thread-removed") threads.delete(str(e.threadId) ?? "");
}

// ---------- starting and stopping ----------

function portFree(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = createServer();
    s.once("error", () => ok(false));
    s.listen(port, "127.0.0.1", () => s.close(() => ok(true)));
  });
}

async function pickPort(): Promise<number> {
  const first = FIRST_PORT();
  for (let p = first; p < first + 20; p++) if (await portFree(p)) return p;
  throw new Error(`No free port for T3 between ${first} and ${first + 19}. Set FOUNDATION_T3_PORT where Foundation's server starts.`);
}

/** a new home starts supervised: a thread's tool calls that change something wait for a person (Vision's default too) */
function seedHome(home: string) {
  const dir = join(home, "userdata");
  mkdirSync(dir, { recursive: true });
  const settings = join(dir, "settings.json");
  if (!existsSync(settings)) writeFileSync(settings, JSON.stringify({ defaultRuntimeMode: "approval-required" }, null, 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitReady(base: string, gen: number): Promise<string | undefined> {
  const until = Date.now() + READY_MS();
  while (Date.now() < until) {
    if (gen !== generation) throw new Error("stopped");
    if (!child) throw new Error(status.detail ?? "T3 stopped before it was ready");
    try {
      const r = await fetch(`${base}/.well-known/t3/environment`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return str(((await r.json()) as { serverVersion?: string; version?: string }).serverVersion);
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`T3 didn't answer at ${base} within ${Math.round(READY_MS() / 1000)} s`);
}

async function exchange(base: string, token: string): Promise<string> {
  const form = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: token,
    subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    client_label: "Foundation",
    client_device_type: "desktop",
  });
  const r = await fetch(`${base}/oauth/token`, { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
  const body = (await r.json().catch(() => ({}))) as { access_token?: string };
  if (!body.access_token) throw new Error(`T3 refused Foundation's sign-in (HTTP ${r.status})`);
  return body.access_token;
}

async function connect(base: string, gen: number) {
  if (gen !== generation || !bearer) return;
  const r = await fetch(`${base}/api/auth/websocket-ticket`, { method: "POST", headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(5000) });
  const ticket = ((await r.json().catch(() => ({}))) as { ticket?: string }).ticket;
  if (!ticket) throw new Error(`T3 refused a socket ticket (HTTP ${r.status})`);
  const sock = new WebSocket(`${base.replace(/^http/, "ws")}/ws?wsTicket=${encodeURIComponent(ticket)}&orchestrationProtocol=1&clientSurface=desktop`);
  ws = sock;
  const streams = new Map<string, (item: unknown) => void>([
    ["1", onConfigItem],
    ["2", onShellItem],
  ]);
  const send = (m: unknown) => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify(m));
  sock.on("open", () => {
    send({ _tag: "Request", id: "1", tag: "subscribeServerConfig", payload: {}, headers: [] });
    send({ _tag: "Request", id: "2", tag: "orchestration.subscribeShell", payload: {}, headers: [] });
  });
  sock.on("message", (data) => {
    let msg: { _tag?: string; requestId?: string; values?: unknown[] };
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg._tag === "Ping") return void send({ _tag: "Pong" });
    if (msg._tag !== "Chunk" || !msg.requestId) return;
    const take = streams.get(msg.requestId);
    for (const v of msg.values ?? []) {
      try {
        take?.(v);
      } catch { /* a shape this build doesn't know */ }
    }
    send({ _tag: "Ack", requestId: msg.requestId });
  });
  sock.on("error", () => {});
  sock.on("close", () => {
    if (ws === sock) ws = null;
    // T3 still up: the streams come back (a fresh ticket each time)
    if (gen === generation && status.state === "running") setTimeout(() => void connect(base, gen).catch(() => {}), 1500);
  });
}

function killTree(c: ChildProcess) {
  if (c.pid && process.platform === "win32") execFile("taskkill", ["/pid", String(c.pid), "/T", "/F"], { windowsHide: true }, () => {});
  else c.kill();
}

/** a person pressed Start. Resolves once T3 is running (or says why it isn't); a second press while it starts joins the first */
let starting: Promise<T3HostStatus> | null = null;
export function startT3(by: string): Promise<T3HostStatus> {
  if (status.state === "running") return Promise.resolve(t3Host());
  starting ??= run(by).finally(() => (starting = null));
  return starting;
}

async function run(by: string): Promise<T3HostStatus> {
  const gen = ++generation;
  projects.clear();
  threads.clear();
  set({ state: "starting", detail: "Finding the T3 program", startedBy: by, agents: [], port: undefined, version: undefined });
  try {
    const cli = findT3Cli();
    if (!cli.found) throw new Error(`The T3 program isn't on this computer. Looked in: ${cli.tried.join("; ")}. Install Vision Code, or set T3_CLI to a t3 program (t3.exe on Windows) where Foundation's server starts.`);
    if (cli.found !== ON_PATH && !existsSync(cli.found)) throw new Error(`The T3 program isn't on this computer at ${cli.found}. Install Vision Code, or set T3_CLI to a t3 program (t3.exe on Windows) where Foundation's server starts.`);
    const { cmd, pre } = t3Command(cli.found);
    const home = HOME();
    seedHome(home);
    const port = await pickPort();
    const token = randomBytes(24).toString("hex");
    const env: NodeJS.ProcessEnv = { ...process.env, T3CODE_HOME: home };
    for (const k of ["T3CODE_PORT", "T3CODE_MODE", "T3CODE_HOST", "T3CODE_DEV_AUTH_TOKEN"]) delete env[k];
    set({ detail: `Starting T3 on port ${port}`, port });
    const c = spawn(cmd, [...pre, "--bootstrap-fd", "0"], { cwd: home, env, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    child = c;
    let err = "";
    c.stderr?.on("data", (b: Buffer) => (err = (err + b).slice(-600)));
    c.on("error", (e) => {
      if (child === c) child = null;
      if (gen === generation) set({ state: "error", detail: `The T3 program at ${cli.found} wouldn't start: ${e.message}` });
    });
    c.on("exit", (code) => {
      if (child === c) child = null;
      if (gen !== generation) return;
      ws?.close();
      bearer = null;
      // stopped by a person is "off" (stopT3 moved the generation on); anything else is said
      set({ state: "error", detail: `T3 stopped on its own (exit ${code ?? "?"})${err.trim() ? `: ${err.trim().split("\n").pop()}` : ""}`, agents: [] });
      threads.clear();
    });
    c.stdin?.end(`${JSON.stringify({ mode: "desktop", noBrowser: true, port, t3Home: home, host: "127.0.0.1", desktopBootstrapToken: token, tailscaleServeEnabled: false, tailscaleServePort: 443 })}\n`);
    const base = `http://127.0.0.1:${port}`;
    const version = await waitReady(base, gen);
    bearer = await exchange(base, token);
    set({ state: "running", detail: undefined, version });
    await connect(base, gen);
    return t3Host();
  } catch (e) {
    if (gen === generation) {
      if (child) killTree(child);
      child = null;
      bearer = null;
      if (status.state !== "error") set({ state: "error", detail: (e as Error).message });
    }
    return t3Host();
  }
}

/** a person pressed Stop: T3 and the agents it runs end; its threads are kept in its home */
export function stopT3(): T3HostStatus {
  generation++;
  ws?.close();
  ws = null;
  bearer = null;
  if (child) killTree(child);
  child = null;
  projects.clear();
  threads.clear();
  set({ state: "off", detail: undefined, agents: [], port: undefined, version: undefined, startedBy: undefined });
  return t3Host();
}

// Foundation going away takes its T3 with it
process.once("exit", () => {
  if (child?.pid) {
    try {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, detached: true, stdio: "ignore" }).unref();
      else child.kill();
    } catch { /* already gone */ }
  }
});
