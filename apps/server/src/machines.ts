/**
 * Machines: Linux machines and containers that live in a section, run on a
 * container engine on this computer, and are typed into from the card.
 *
 * Two engines, one wire. Kiri (github.com/libracoder/kiri, Apache-2.0: a
 * small VM that runs Docker images) and Docker both serve the Docker Engine
 * API, so Foundation speaks that API over the engine's own socket — a named
 * pipe on Windows (\\.\pipe\kiri, \\.\pipe\docker_engine), a unix socket
 * elsewhere (~/.kiri/run/docker.sock, /run/kiri/docker.sock,
 * /var/run/docker.sock). No CLI is shelled out to, and nothing is installed.
 *
 * A machine is what Kiri calls one (`kiri machine create`): a long-lived
 * container named `machine-<name>`, labelled `dev.kiri.machine=<name>`, kept
 * running by a sleep loop when its image is a distro. Kiri's own
 * `kiri machine list | shell <name>` see machines started here. Foundation's
 * labels (`dev.foundation.board`, `dev.foundation.panel`) tie it to its card,
 * and the engine stays the truth: a card's state is what the engine says,
 * read back whenever someone is looking at it.
 *
 * Rules:
 *  - Starting runs third-party code, so only a person starts, restarts, stops,
 *    removes or loads — from a browser session (a cookie), never a bearer
 *    token, which is what agents, MCP and the service token hold. Agents may
 *    propose a machine (a card waiting for Start) and read its state and its
 *    terminal.
 *  - Removing a machine destroys its disk, so it needs `confirm`.
 *  - Nothing is mounted from this computer; nothing privileged; ports publish
 *    on 127.0.0.1 only; memory, CPU and process caps are set (Docker honours
 *    them; Kiri caps its whole VM instead, ~/.kiri/vm.json).
 *  - Image files loaded into an engine come from the archive and stay there.
 *
 * The terminal: one shell per machine card, shared by everyone looking at it
 * (an `exec` with a TTY, its stream hijacked from the engine and relayed over
 * /machines/:board/:panel/tty). Editors type; viewers watch. A late joiner
 * gets the last 64 KB of the screen.
 */

import { request as httpRequest, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import type { WebSocket } from "ws";
import { boardMaps, logActivity, MACHINE_DISTROS, machineName, type MachineState, type PanelDoc } from "@foundation/protocol";
import { editBoard, getBoard } from "./boards.ts";
import { one } from "./db.ts";
import { config } from "./config.ts";
import { HttpError } from "./http.ts";

// ---------- engines ----------

export interface Engine {
  id: "kiri" | "docker";
  name: string;
  /** a unix socket or Windows named pipe path, or http://host:port */
  at: string;
}

export interface EngineStatus extends Engine {
  up: boolean;
  version?: string;
  api?: string;
  os?: string;
  error?: string;
  /** Kiri is installed here but not running: a person's Start wakes it (wakeKiri) */
  asleep?: boolean;
}

/** Where each engine listens, most specific first. FOUNDATION_ENGINES="kiri=<path>,docker=<path>" replaces the list. */
export function engineCandidates(env = process.env, platform = process.platform): Engine[] {
  const set = env.FOUNDATION_ENGINES?.trim();
  if (set) {
    return set.split(",").flatMap((part) => {
      const [id, ...rest] = part.split("=");
      const at = rest.join("=").trim();
      const key = id.trim() === "kiri" ? "kiri" : "docker";
      return at ? [{ id: key, name: key === "kiri" ? "Kiri" : "Docker", at: socketOf(at) } as Engine] : [];
    });
  }
  const home = env.HOME || env.USERPROFILE || homedir();
  const kiri: string[] = [];
  const docker: string[] = [];
  if (env.KIRI_SOCKET) kiri.push(env.KIRI_SOCKET);
  if (env.DOCKER_HOST) docker.push(socketOf(env.DOCKER_HOST));
  if (platform === "win32") {
    kiri.push("\\\\.\\pipe\\kiri");
    docker.push("\\\\.\\pipe\\docker_engine");
  } else {
    if (platform === "linux") kiri.push("/run/kiri/docker.sock");
    kiri.push(posix.join(home, ".kiri", "run", "docker.sock"));
    docker.push("/var/run/docker.sock", posix.join(home, ".docker", "run", "docker.sock"));
  }
  const out: Engine[] = [];
  for (const at of new Set(kiri)) out.push({ id: "kiri", name: "Kiri", at });
  for (const at of new Set(docker)) if (!out.some((e) => e.at === at)) out.push({ id: "docker", name: "Docker", at });
  return out;
}

/** unix:///x → /x, npipe:////./pipe/x → \\.\pipe\x, tcp://h:p → http://h:p */
function socketOf(host: string): string {
  if (host.startsWith("unix://")) return host.slice(7);
  if (host.startsWith("npipe://")) return host.slice(8).replace(/\//g, "\\");
  if (host.startsWith("tcp://")) return `http://${host.slice(6)}`;
  return host;
}

export class EngineError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface EngineReply {
  status: number;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

function target(at: string) {
  if (/^https?:\/\//.test(at)) {
    const u = new URL(at);
    return { host: u.hostname, port: Number(u.port || 2375) };
  }
  return { socketPath: at };
}

/** one Engine API call. `body` is JSON, or a stream (an image tarball) when `upload` is set */
export function engineCall(
  e: Engine,
  method: string,
  path: string,
  opts: { json?: unknown; upload?: NodeJS.ReadableStream; timeoutMs?: number; onLine?: (line: string) => void } = {},
): Promise<EngineReply> {
  return new Promise((resolve, reject) => {
    const payload = opts.json === undefined ? undefined : Buffer.from(JSON.stringify(opts.json));
    const req = httpRequest({
      ...target(e.at),
      method,
      path,
      headers: {
        host: "docker",
        ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
        ...(opts.upload ? { "content-type": "application/x-tar", "transfer-encoding": "chunked" } : {}),
      },
    });
    const timeout = opts.timeoutMs ?? 15_000;
    if (timeout) req.setTimeout(timeout, () => req.destroy(new EngineError(504, `${e.name} didn't answer ${method} ${path} in ${timeout / 1000}s`)));
    req.on("error", (err: NodeJS.ErrnoException) => reject(err instanceof EngineError ? err : new EngineError(503, unreachable(e, err))));
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      let partial = "";
      res.on("data", (c: Buffer) => {
        chunks.push(c);
        if (opts.onLine) {
          partial += c.toString("utf8");
          const lines = partial.split("\n");
          partial = lines.pop() ?? "";
          for (const l of lines) if (l.trim()) opts.onLine(l);
        }
      });
      res.on("end", () => {
        if (opts.onLine && partial.trim()) opts.onLine(partial);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
      });
      res.on("error", reject);
    });
    if (opts.upload) opts.upload.pipe(req);
    else req.end(payload);
  });
}

function unreachable(e: Engine, err: NodeJS.ErrnoException) {
  if (err.code === "ENOENT" || err.code === "ECONNREFUSED") return `${e.name} isn't running here (nothing answers at ${e.at})`;
  if (err.code === "EACCES" || err.code === "EPERM") return `${e.name} is running but this server may not use it (${err.code} at ${e.at})`;
  return `${e.name} didn't answer: ${err.message}`;
}

/** an Engine API call whose answer is JSON (or nothing); errors carry the engine's own message */
export async function engineJson<T = unknown>(e: Engine, method: string, path: string, json?: unknown, timeoutMs?: number): Promise<T> {
  const r = await engineCall(e, method, path, { json, timeoutMs });
  const text = r.body.toString("utf8");
  if (r.status >= 400) {
    let msg = text.trim();
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? msg;
    } catch {
      /* plain text */
    }
    throw new EngineError(r.status, msg || `${e.name} answered ${r.status}`);
  }
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

let statusCache: { at: number; list: EngineStatus[] } | null = null;

/** which engines answer here, Kiri first. Cached 3 s: cards ask while on screen */
export async function engineStatus(fresh = false): Promise<EngineStatus[]> {
  if (!fresh && statusCache && Date.now() - statusCache.at < 3000) return statusCache.list;
  const list = await Promise.all(
    engineCandidates().map(async (e): Promise<EngineStatus> => {
      if (!/^https?:/.test(e.at) && !e.at.startsWith("\\\\") && !existsSync(e.at)) return { ...e, up: false, error: `${e.name} isn't running here (no socket at ${e.at})` };
      try {
        const v = await engineJson<{ Version?: string; ApiVersion?: string; Os?: string; Platform?: { Name?: string } }>(e, "GET", "/version", undefined, 2500);
        // a docker.sock that is really Kiri (Kiri links /var/run/docker.sock to itself) says so
        const isKiri = e.id === "kiri" || /kiri/i.test(v.Platform?.Name ?? "");
        return { ...e, ...(isKiri ? { id: "kiri" as const, name: "Kiri" } : {}), up: true, version: v.Version, api: v.ApiVersion, os: v.Os };
      } catch (err) {
        return { ...e, up: false, error: (err as Error).message };
      }
    }),
  );
  // Kiri installed but not running: say so once, on its first entry, so the card offers Start rather than "no engine"
  if (!list.some((s) => s.id === "kiri" && s.up) && kiriApp()) {
    const k = list.find((s) => s.id === "kiri");
    if (k) Object.assign(k, { asleep: true, error: "Kiri is installed and asleep: Start wakes it." });
  }
  // the same engine reached twice (Kiri behind docker.sock) shows once
  const seen = new Set<string>();
  const uniq = list.filter((s) => {
    if (!s.up) return true;
    const k = `${s.id}:${s.version}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  statusCache = { at: Date.now(), list: uniq };
  return uniq;
}

/**
 * Kiri's app on this computer, if it is installed (npm run kiri:install, or
 * Kiri's own installer): %LOCALAPPDATA%\Kiri\kiri-win.exe, or Kiri.app. On
 * Linux Kiri's package runs the engine as a service, so there is nothing to wake.
 */
export function kiriApp(env = process.env, platform = process.platform): { exe: string; args: string[] } | null {
  if (env.FOUNDATION_ENGINES?.trim()) return null; // the engines are named: wake none
  if (platform === "win32") {
    const dir = join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Kiri");
    const exe = join(dir, "kiri-win.exe");
    if (!existsSync(exe)) return null;
    // the WSL distro Kiri's setup chose, else the one npm run kiri:install makes
    let distro = "kiri";
    try {
      distro = (JSON.parse(readFileSync(join(dir, "setup.json"), "utf8")) as { distro?: string }).distro || distro;
    } catch {
      /* no setup.json: installed by npm run kiri:install */
    }
    return { exe, args: ["--background", "--distro", distro] };
  }
  if (platform === "darwin" && existsSync("/Applications/Kiri.app")) return { exe: "open", args: ["-g", "-a", "Kiri"] };
  return null;
}

let waking: Promise<boolean> | null = null;

/** Start Kiri's app (no window) and wait for its engine; one wake at a time. Only a person's Start calls this. */
export function wakeKiri(timeoutMs = 60_000): Promise<boolean> {
  if (waking) return waking;
  const app = kiriApp();
  if (!app) return Promise.resolve(false);
  waking = (async () => {
    try {
      spawn(app.exe, app.args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        if ((await engineStatus(true)).some((s) => s.id === "kiri" && s.up)) return true;
        await new Promise((r) => setTimeout(r, 750));
      }
      return false;
    } catch {
      return false;
    } finally {
      waking = null;
    }
  })();
  return waking;
}

/** before a person's Start: Kiri asleep and wanted (by name, or as the first choice) → wake it */
async function wakeIfAsleep(want?: string) {
  if (want && want !== "kiri") return;
  const list = await engineStatus();
  if (!list.some((s) => s.id === "kiri" && s.asleep)) return;
  if (!(await wakeKiri()) && want === "kiri") throw new HttpError(503, "Kiri is installed but didn't start within a minute. Open Kiri from the Start menu to see why.");
}

async function pickEngine(want?: string): Promise<EngineStatus> {
  const list = await engineStatus();
  const up = list.filter((s) => s.up);
  const e = want ? up.find((s) => s.id === want) : up[0];
  if (e) return e;
  if (want) throw new HttpError(503, list.find((s) => s.id === want)?.error ?? `no ${want} engine here`);
  throw new HttpError(503, "No container engine is running here. Install Kiri (npm run kiri:install in Foundation's folder, or runkiri.com) or Docker Desktop, start it, and press Start again.");
}

// ---------- the card ----------

export const LABEL_BOARD = "dev.foundation.board";
export const LABEL_PANEL = "dev.foundation.panel";
export const LABEL_KIRI = "dev.kiri.machine";

const LIMITS = {
  memoryMb: Number(process.env.FOUNDATION_MACHINE_MEMORY_MB ?? 2048),
  cpus: Number(process.env.FOUNDATION_MACHINE_CPUS ?? 2),
  pids: 1024,
};

/** the long-lived loop Kiri's machines run when their image is a distro */
const KEEP_ALIVE = ["/bin/sh", "-c", "trap 'exit 0' TERM INT; while :; do sleep 3600 & wait $!; done"];

function machinePanel(boardId: string, panelId: string): PanelDoc {
  const o = boardMaps(getBoard(boardId).doc).objects.get(panelId);
  if (!o || o.kind !== "panel" || o.panel !== "machine") throw new HttpError(404, "no such machine card on this board");
  return o;
}

function writeMachine(boardId: string, panelId: string, patch: Partial<MachineState>, activity?: { who: string; role: "human" | "agent"; text: string }) {
  editBoard(boardId, "machines", (doc) => {
    const m = boardMaps(doc);
    const o = m.objects.get(panelId);
    if (!o || o.kind !== "panel") return;
    const prev = o.machine ?? { name: machineName(o.name), state: "absent" as const };
    const next: MachineState = { ...prev, ...patch };
    if (patch.state && patch.state !== prev.state) next.since = Date.now();
    // drop keys set to undefined so the doc stays clean
    for (const k of Object.keys(next) as Array<keyof MachineState>) if (next[k] === undefined) delete next[k];
    const status = next.state === "running" ? "running" : next.state === "error" ? "error" : "idle";
    m.objects.set(panelId, { ...o, machine: next, status });
    if (activity) logActivity(doc, { ...activity, objectId: panelId });
  });
}

interface ContainerSummary {
  Id: string;
  Names?: string[];
  Image: string;
  State: string;
  Status: string;
  Labels?: Record<string, string>;
  Ports?: Array<{ PrivatePort: number; PublicPort?: number; IP?: string; Type?: string }>;
}

const filter = (f: Record<string, string[]>) => encodeURIComponent(JSON.stringify(f));

/** the container a card runs, on whichever engine has it */
async function findContainer(boardId: string, panelId: string, prefer?: string): Promise<{ engine: EngineStatus; c: ContainerSummary } | null> {
  const engines = (await engineStatus()).filter((s) => s.up);
  engines.sort((a, b) => (a.id === prefer ? -1 : b.id === prefer ? 1 : 0));
  for (const engine of engines) {
    const rows = await engineJson<ContainerSummary[]>(engine, "GET", `/containers/json?all=1&filters=${filter({ label: [`${LABEL_PANEL}=${panelId}`] })}`).catch(() => []);
    const c = rows.find((r) => r.Labels?.[LABEL_BOARD] === boardId);
    if (c) return { engine, c };
  }
  return null;
}

function portsOf(c: ContainerSummary) {
  const seen = new Set<string>();
  return (c.Ports ?? [])
    .filter((p) => p.PublicPort && (p.Type ?? "tcp") === "tcp")
    .filter((p) => {
      const k = `${p.PrivatePort}:${p.PublicPort}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((p) => ({ port: p.PrivatePort, host: p.PublicPort! }));
}

function stateOf(c: ContainerSummary): MachineState["state"] {
  if (c.State === "running") return "running";
  if (c.State === "created" || c.State === "restarting") return "starting";
  return "stopped";
}

const inFlight = new Map<string, Promise<unknown>>();
const key = (b: string, p: string) => `${b}/${p}`;

/**
 * Read a card's machine back from the engine and write what's true to the
 * board: running, stopped, or gone. Called whenever a card on screen asks.
 */
export async function reconcileMachine(boardId: string, panelId: string): Promise<{ machine: MachineState | null; engines: EngineStatus[] }> {
  const panel = machinePanel(boardId, panelId);
  const engines = await engineStatus();
  const m = panel.machine;
  if (!m) return { machine: null, engines };
  if (inFlight.has(key(boardId, panelId))) return { machine: m, engines };
  const found = await findContainer(boardId, panelId, m.engine);
  if (found) {
    const state = stateOf(found.c);
    const ports = portsOf(found.c);
    const changed = state !== m.state || found.c.Id !== m.containerId || JSON.stringify(ports) !== JSON.stringify(m.ports ?? []) || found.engine.id !== m.engine;
    if (changed) writeMachine(boardId, panelId, { state, containerId: found.c.Id, ports, engine: found.engine.id, image: m.image ?? found.c.Image, detail: state === "stopped" ? found.c.Status : undefined });
  } else if (m.containerId && engines.some((e) => e.up && (!m.engine || e.id === m.engine))) {
    // its engine answers and it isn't there: someone removed it outside Foundation
    writeMachine(boardId, panelId, { state: "absent", containerId: undefined, ports: undefined, detail: "Not on the engine any more (removed outside Foundation). Start makes a fresh one." });
  } else if (m.containerId && (m.state === "running" || m.state === "starting")) {
    // its engine doesn't answer (Kiri's app quit, Docker quit): out of reach, its disk still on that engine.
    // (Kiri's engine in WSL can outlive its app, so the machine may still be running there.)
    const name = engines.find((e) => e.id === m.engine)?.name ?? "Its engine";
    writeMachine(boardId, panelId, { state: "stopped", ports: undefined, detail: `${name} isn't answering here, so this machine is out of reach. Its disk is kept: Start brings ${name} back and runs it again.` });
  }
  return { machine: machinePanel(boardId, panelId).machine ?? null, engines };
}

function splitImage(image: string) {
  const at = image.lastIndexOf(":");
  const slash = image.lastIndexOf("/");
  return at > slash ? { repo: image.slice(0, at), tag: image.slice(at + 1) } : { repo: image, tag: "latest" };
}

/** a ref an engine will take: registry/name:tag, letters, digits and . _ - / : @ */
export function validImage(image: string) {
  return /^[a-z0-9][a-z0-9._\-/:@]{0,199}$/i.test(image) && !image.includes("..");
}

async function pull(e: Engine, image: string, onProgress: (text: string) => void) {
  const { repo, tag } = splitImage(image);
  const layers = new Map<string, { cur: number; tot: number }>();
  let failed = "";
  let last = 0;
  const r = await engineCall(e, "POST", `/images/create?fromImage=${encodeURIComponent(repo)}&tag=${encodeURIComponent(tag)}`, {
    timeoutMs: 15 * 60_000,
    onLine: (line) => {
      let v: { id?: string; status?: string; error?: string; progressDetail?: { current?: number; total?: number } };
      try {
        v = JSON.parse(line);
      } catch {
        return;
      }
      if (v.error) failed = v.error;
      if (v.id && v.progressDetail?.total) layers.set(v.id, { cur: v.progressDetail.current ?? 0, tot: v.progressDetail.total });
      if (Date.now() - last > 700) {
        last = Date.now();
        let cur = 0;
        let tot = 0;
        for (const l of layers.values()) (cur += l.cur), (tot += l.tot);
        onProgress(tot ? `Pulling ${image}: ${mb(cur)} of ${mb(tot)}` : `Pulling ${image}…`);
      }
    },
  });
  if (r.status >= 400 || failed) throw new EngineError(r.status >= 400 ? r.status : 500, failed || r.body.toString("utf8").trim() || `couldn't pull ${image}`);
}

const mb = (n: number) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;

export interface StartInput {
  image?: string;
  engine?: string;
  ports?: number[];
}

/**
 * A person pressed Start: pull the image if the engine doesn't have it,
 * create the machine (once — a second press while it starts joins the
 * first), and start it. A stopped machine just starts again, disk intact.
 */
export function startMachine(boardId: string, panelId: string, person: string, input: StartInput = {}): Promise<MachineState> {
  const k = key(boardId, panelId);
  const running = inFlight.get(k);
  if (running) return running as Promise<MachineState>;
  const p = doStart(boardId, panelId, person, input).finally(() => inFlight.delete(k));
  inFlight.set(k, p);
  return p;
}

async function doStart(boardId: string, panelId: string, person: string, input: StartInput): Promise<MachineState> {
  const panel = machinePanel(boardId, panelId);
  const prev = panel.machine ?? { name: machineName(panel.name), state: "absent" as const };
  const image = (input.image ?? prev.image ?? "").trim();
  if (!image) throw new HttpError(400, "pick an image first");
  if (!validImage(image)) throw new HttpError(400, `“${image}” isn't an image name an engine will take`);
  const wantPorts = (input.ports ?? prev.wantPorts ?? []).filter((n) => Number.isInteger(n) && n > 0 && n < 65536).slice(0, 8);

  // a machine whose disk is on a sleeping Kiri is found once Kiri is up, not made again on Docker
  // the engine its disk is on; a card with no machine (never started, or removed) takes the first one
  const wantEngine = input.engine ?? (prev.containerId ? prev.engine : undefined);
  if ((!wantEngine || wantEngine === "kiri") && (await engineStatus()).some((s) => s.id === "kiri" && s.asleep)) {
    writeMachine(boardId, panelId, { state: "starting", detail: "Waking Kiri…" });
    await wakeIfAsleep(wantEngine).catch((err: Error) => {
      writeMachine(boardId, panelId, { state: prev.containerId ? "stopped" : "absent", detail: err.message });
      throw err;
    });
  }

  const existing = await findContainer(boardId, panelId, wantEngine ?? prev.engine);
  if (existing && existing.c.Image !== image && input.image && input.image !== prev.image) {
    throw new HttpError(409, `This card already has a machine running ${existing.c.Image}. Remove it first to start ${image}.`);
  }
  const engine = existing?.engine ?? (await pickEngine(wantEngine));
  const fail = (err: unknown): never => {
    const msg = (err as Error).message;
    writeMachine(boardId, panelId, { state: "error", detail: msg }, { who: person, role: "human", text: `couldn't start ${prev.name}: ${msg.slice(0, 160)}` });
    throw err instanceof HttpError ? err : new HttpError(err instanceof EngineError && err.status < 500 ? err.status : 502, msg);
  };

  if (existing) {
    if (existing.c.State !== "running") {
      writeMachine(boardId, panelId, { state: "starting", engine: engine.id, containerId: existing.c.Id, detail: undefined, startedBy: person, proposedBy: undefined });
      await engineJson(engine, "POST", `/containers/${existing.c.Id}/start`).catch(fail);
    }
    await reconcileAfter(boardId, panelId, engine);
    writeMachine(boardId, panelId, {}, { who: person, role: "human", text: `started the machine ${prev.name} on ${engine.name}` });
    return machinePanel(boardId, panelId).machine!;
  }

  writeMachine(boardId, panelId, { image, engine: engine.id, wantPorts, state: "pulling", detail: `Looking for ${image} on ${engine.name}…`, startedBy: person, proposedBy: undefined, containerId: undefined, ports: undefined });
  const have = await engineCall(engine, "GET", `/images/${encodeURIComponent(image)}/json`).catch(() => null);
  if (!have || have.status === 404) await pull(engine, image, (detail) => writeMachine(boardId, panelId, { detail })).catch(fail);
  else if (have.status >= 400) fail(new EngineError(have.status, have.body.toString("utf8")));

  writeMachine(boardId, panelId, { state: "starting", detail: `Starting on ${engine.name}…` });
  const distro = MACHINE_DISTROS.some((d) => d.image === image) || /^(ubuntu|debian|alpine|fedora|archlinux|rockylinux|opensuse\/[a-z]+|amazonlinux|almalinux|centos)(:|$)/.test(image);
  const body = {
    Image: image,
    ...(distro ? { Cmd: KEEP_ALIVE } : {}),
    Hostname: prev.name,
    Labels: { [LABEL_BOARD]: boardId, [LABEL_PANEL]: panelId, [LABEL_KIRI]: prev.name, "dev.foundation.by": person },
    ExposedPorts: Object.fromEntries(wantPorts.map((p) => [`${p}/tcp`, {}])),
    HostConfig: {
      RestartPolicy: { Name: "unless-stopped" },
      Memory: LIMITS.memoryMb * 1048576,
      NanoCpus: Math.round(LIMITS.cpus * 1e9),
      PidsLimit: LIMITS.pids,
      PortBindings: Object.fromEntries(wantPorts.map((p) => [`${p}/tcp`, [{ HostIp: "127.0.0.1", HostPort: "" }]])),
    },
  };
  const name = await freeName(engine, prev.name);
  const created = await engineJson<{ Id: string }>(engine, "POST", `/containers/create?name=${encodeURIComponent(`machine-${name}`)}`, body).catch(fail);
  if (name !== prev.name) writeMachine(boardId, panelId, { name });
  writeMachine(boardId, panelId, { containerId: created.Id });
  await engineJson(engine, "POST", `/containers/${created.Id}/start`).catch(fail);
  await reconcileAfter(boardId, panelId, engine);
  writeMachine(boardId, panelId, { detail: undefined }, { who: person, role: "human", text: `started the machine ${name} (${image}) on ${engine.name}` });
  return machinePanel(boardId, panelId).machine!;
}

/** machine-<name> must be free on the engine (another board may have the same name): add -2, -3… */
async function freeName(e: Engine, name: string) {
  for (let i = 1; i < 50; i++) {
    const n = i === 1 ? name : `${name.slice(0, 36)}-${i}`;
    const r = await engineCall(e, "GET", `/containers/${encodeURIComponent(`machine-${n}`)}/json`).catch(() => null);
    if (!r || r.status === 404) return n;
  }
  throw new HttpError(409, `every machine-${name}… name is taken on this engine`);
}

async function reconcileAfter(boardId: string, panelId: string, engine: Engine) {
  const found = await findContainer(boardId, panelId, engine.id);
  if (found) writeMachine(boardId, panelId, { state: stateOf(found.c), containerId: found.c.Id, ports: portsOf(found.c), engine: found.engine.id });
}

async function container(boardId: string, panelId: string) {
  const panel = machinePanel(boardId, panelId);
  // its disk is on a sleeping Kiri: wake it to act on it (stop, restart and remove are a person's too)
  if (panel.machine?.engine === "kiri" && panel.machine.containerId) await wakeIfAsleep("kiri");
  const found = await findContainer(boardId, panelId, panel.machine?.engine);
  if (!found) throw new HttpError(404, "this card has no machine on any engine here");
  return { panel, ...found };
}

export async function stopMachine(boardId: string, panelId: string, person: string) {
  const { engine, c, panel } = await container(boardId, panelId);
  endTerminal(boardId, panelId, "The machine was stopped.");
  await engineJson(engine, "POST", `/containers/${c.Id}/stop?t=5`, undefined, 30_000).catch((e) => {
    if (!(e instanceof EngineError && e.status === 304)) throw e; // 304: already stopped
  });
  await reconcileAfter(boardId, panelId, engine);
  writeMachine(boardId, panelId, { detail: `Stopped by ${person}. Its disk is kept: Start runs it again.` }, { who: person, role: "human", text: `stopped the machine ${panel.machine?.name ?? panel.name}` });
  return machinePanel(boardId, panelId).machine!;
}

export async function restartMachine(boardId: string, panelId: string, person: string) {
  const { engine, c, panel } = await container(boardId, panelId);
  endTerminal(boardId, panelId, "The machine is restarting.");
  await engineJson(engine, "POST", `/containers/${c.Id}/restart?t=5`, undefined, 40_000);
  await reconcileAfter(boardId, panelId, engine);
  writeMachine(boardId, panelId, { detail: undefined }, { who: person, role: "human", text: `restarted the machine ${panel.machine?.name ?? panel.name}` });
  return machinePanel(boardId, panelId).machine!;
}

/** destroys the machine and its disk; the card stays, ready to start a fresh one */
export async function removeMachine(boardId: string, panelId: string, person: string, confirm: boolean) {
  if (!confirm) throw new HttpError(400, "Removing a machine deletes its disk. Send confirm: true to do it.");
  const { engine, c, panel } = await container(boardId, panelId);
  endTerminal(boardId, panelId, "The machine was removed.");
  await engineJson(engine, "DELETE", `/containers/${c.Id}?force=1&v=1`, undefined, 30_000);
  writeMachine(boardId, panelId, { state: "absent", containerId: undefined, ports: undefined, detail: `Removed by ${person}, with its disk. Start makes a fresh one.` }, { who: person, role: "human", text: `removed the machine ${panel.machine?.name ?? panel.name}` });
  return machinePanel(boardId, panelId).machine!;
}

/** the images an engine already has, newest first (what Start can run without pulling) */
export async function engineImages(engineId?: string) {
  const engine = await pickEngine(engineId);
  const rows = await engineJson<Array<{ RepoTags?: string[] | null; Size: number; Created: number }>>(engine, "GET", "/images/json");
  return {
    engine: engine.id,
    images: rows
      .flatMap((r) => (r.RepoTags ?? []).filter((t) => t && t !== "<none>:<none>").map((tag) => ({ tag, size: r.Size, created: r.Created })))
      .sort((a, b) => b.created - a.created)
      .slice(0, 60),
  };
}

/**
 * Load an image file from the archive into an engine (`docker load`): an
 * image someone saved (`docker save`) and dropped on the board. The file stays
 * archived; the engine gets a copy.
 */
export async function loadImage(boardId: string, fileId: string, person: string, engineId?: string) {
  const f = one<{ id: string; name: string; sha256: string; board_id: string | null; size: number }>("select id, name, sha256, board_id, size from files where id = ?", fileId);
  if (!f) throw new HttpError(404, "no such file");
  if (f.board_id && f.board_id !== boardId) throw new HttpError(403, "that file belongs to another board");
  if (!/\.(tar|tar\.gz|tgz)$/i.test(f.name)) throw new HttpError(400, `${f.name} isn't an image file (docker save writes a .tar)`);
  const engine = await pickEngine(engineId);
  const path = join(config.dataDir, "files", f.sha256);
  if (!existsSync(path)) throw new HttpError(410, "the file's bytes aren't on this server");
  const loaded: string[] = [];
  let failed = "";
  const r = await engineCall(engine, "POST", "/images/load?quiet=1", {
    upload: createReadStream(path),
    timeoutMs: 15 * 60_000,
    onLine: (line) => {
      try {
        const v = JSON.parse(line) as { stream?: string; error?: string };
        if (v.error) failed = v.error;
        const m = /Loaded image(?: ID)?: (\S+)/.exec(v.stream ?? "");
        if (m) loaded.push(m[1]);
      } catch {
        /* not a progress line */
      }
    },
  });
  if (r.status >= 400 || failed) throw new HttpError(r.status >= 400 && r.status < 500 ? r.status : 502, failed || r.body.toString("utf8").trim() || "the engine refused the file");
  editBoard(boardId, "machines", (doc) => logActivity(doc, { who: person, role: "human", text: `loaded ${loaded.join(", ") || f.name} into ${engine.name}` }));
  return { engine: engine.id, images: loaded };
}

// ---------- agents: propose, read ----------

/** an agent (or a person, through a tool) proposes a machine: a card waiting for a person to press Start */
export function proposeMachine(panel: PanelDoc, image: string | undefined, by: string, ports?: number[]): PanelDoc {
  return {
    ...panel,
    machine: {
      name: machineName(panel.name),
      ...(image ? { image } : {}),
      state: "absent",
      ...(ports?.length ? { wantPorts: ports } : {}),
      proposedBy: by,
      detail: `Proposed by ${by}. Nothing runs until a person presses Start.`,
      since: Date.now(),
    },
    status: "idle",
  };
}

/** what an agent may read: every machine card on the board, and the end of each shared terminal */
export async function describeMachines(boardId: string) {
  const objects = [...boardMaps(getBoard(boardId).doc).objects.values()].filter((o): o is PanelDoc => o.kind === "panel" && o.panel === "machine" && Boolean(o.machine));
  for (const o of objects) await reconcileMachine(boardId, o.id).catch(() => null);
  const engines = await engineStatus();
  const fresh = [...boardMaps(getBoard(boardId).doc).objects.values()].filter((o): o is PanelDoc => o.kind === "panel" && o.panel === "machine" && Boolean(o.machine));
  return {
    engines: engines.map((e) => ({ engine: e.id, up: e.up, version: e.version, ...(e.asleep ? { asleep: true } : {}), ...(e.up ? {} : { why: e.error }) })),
    machines: fresh.map((o) => ({
      id: o.id,
      name: o.machine!.name,
      image: o.machine!.image ?? null,
      engine: o.machine!.engine ?? null,
      state: o.machine!.state,
      detail: o.machine!.detail ?? null,
      ports: (o.machine!.ports ?? []).map((p) => ({ port: p.port, url: `http://127.0.0.1:${p.host}` })),
      terminal: screenText(boardId, o.id),
    })),
  };
}

// ---------- the shared terminal ----------

interface Tty {
  board: string;
  panel: string;
  execId: string;
  engine: Engine;
  sock: Socket;
  clients: Map<WebSocket, { canType: boolean; name: string }>;
  screen: Buffer[];
  screenBytes: number;
  idle?: ReturnType<typeof setTimeout>;
  size?: { cols: number; rows: number };
}

const SCREEN_MAX = 64 * 1024;
const IDLE_MS = 5 * 60_000;
const ttys = new Map<string, Tty>();
const opening = new Map<string, Promise<Tty>>();

function screenText(boardId: string, panelId: string) {
  const t = ttys.get(key(boardId, panelId));
  if (!t) return null;
  // strip escape sequences: an agent reads words, not colours
  return Buffer.concat(t.screen)
    .toString("utf8")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, "")
    .replace(/\r/g, "")
    .slice(-4000);
}

function hijack(e: Engine, path: string, body: unknown): Promise<{ sock: Socket; head: Buffer }> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = httpRequest({
      ...target(e.at),
      method: "POST",
      path,
      headers: { host: "docker", "content-type": "application/json", "content-length": payload.length, connection: "Upgrade", upgrade: "tcp" },
    });
    req.on("upgrade", (_res, sock, head) => resolve({ sock, head }));
    req.on("response", (res) => {
      let text = "";
      res.on("data", (c: Buffer) => (text += c.toString("utf8")));
      res.on("end", () => reject(new EngineError(res.statusCode ?? 500, text.trim() || `${e.name} wouldn't attach a terminal`)));
    });
    req.on("error", (err: NodeJS.ErrnoException) => reject(new EngineError(503, unreachable(e, err))));
    req.end(payload);
  });
}

async function openTty(boardId: string, panelId: string): Promise<Tty> {
  const { engine, c } = await container(boardId, panelId);
  if (c.State !== "running") throw new HttpError(409, "the machine isn't running");
  const exec = await engineJson<{ Id: string }>(engine, "POST", `/containers/${c.Id}/exec`, {
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Env: ["TERM=xterm-256color", "COLORTERM=truecolor"],
    Cmd: ["/bin/sh", "-c", "cd ~ 2>/dev/null || cd /; exec $(command -v bash || command -v sh) -l"],
  });
  const { sock, head } = await hijack(engine, `/exec/${exec.Id}/start`, { Detach: false, Tty: true });
  const t: Tty = { board: boardId, panel: panelId, execId: exec.Id, engine, sock, clients: new Map(), screen: [], screenBytes: 0 };
  const out = (b: Buffer) => {
    if (!b.length) return;
    t.screen.push(b);
    t.screenBytes += b.length;
    while (t.screenBytes > SCREEN_MAX && t.screen.length > 1) t.screenBytes -= t.screen.shift()!.length;
    for (const ws of t.clients.keys()) if (ws.readyState === ws.OPEN) ws.send(b, { binary: true });
  };
  out(head);
  sock.on("data", out);
  sock.on("close", () => {
    if (ttys.get(key(boardId, panelId)) !== t) return;
    ttys.delete(key(boardId, panelId));
    for (const ws of t.clients.keys()) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "exit", text: "The shell ended. Open the terminal again for a new one." }));
      ws.close(1000, "shell ended");
    }
  });
  sock.on("error", () => sock.destroy());
  ttys.set(key(boardId, panelId), t);
  return t;
}

function endTerminal(boardId: string, panelId: string, why: string) {
  const t = ttys.get(key(boardId, panelId));
  if (!t) return;
  ttys.delete(key(boardId, panelId));
  for (const ws of t.clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "exit", text: why }));
    ws.close(1000, why);
  }
  t.sock.destroy();
}

async function resize(t: Tty, cols: number, rows: number) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 10 || rows < 3 || cols > 500 || rows > 200) return;
  if (t.size?.cols === cols && t.size?.rows === rows) return;
  t.size = { cols, rows };
  await engineJson(t.engine, "POST", `/exec/${t.execId}/resize?h=${rows}&w=${cols}`).catch(() => null);
}

/**
 * A browser opened a machine card's terminal. Editors type into the shared
 * shell; viewers only watch (their input is dropped here, on the server).
 * Text frames are control: {t:"resize", cols, rows}. Binary frames are keys.
 */
export async function attachTerminal(boardId: string, panelId: string, ws: WebSocket, who: { name: string }, canType: boolean) {
  const k = key(boardId, panelId);
  let t = ttys.get(k);
  try {
    if (!t) {
      let p = opening.get(k);
      if (!p) {
        p = openTty(boardId, panelId).finally(() => opening.delete(k));
        opening.set(k, p);
      }
      t = await p;
    }
  } catch (e) {
    ws.send(JSON.stringify({ t: "error", text: (e as Error).message }));
    ws.close(4004, "no terminal");
    return;
  }
  const tty = t;
  if (tty.idle) clearTimeout(tty.idle);
  tty.idle = undefined;
  tty.clients.set(ws, { canType, name: who.name });
  ws.send(JSON.stringify({ t: "hello", canType, engine: tty.engine.id, people: peopleAt(tty) }));
  announcePeople(tty, ws);
  if (tty.screen.length) ws.send(Buffer.concat(tty.screen), { binary: true });
  else tty.sock.write("\n"); // a fresh shell: ask for its prompt
  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      try {
        const m = JSON.parse(data.toString()) as { t?: string; cols?: number; rows?: number };
        if (m.t === "resize" && canType) void resize(tty, Number(m.cols), Number(m.rows));
      } catch {
        /* ignore */
      }
      return;
    }
    if (!canType) return; // viewers watch
    tty.sock.write(data as Buffer);
  });
  ws.on("close", () => {
    tty.clients.delete(ws);
    announcePeople(tty);
    if (tty.clients.size === 0 && ttys.get(k) === tty) {
      // keep the shell (and what's running in it) a while for whoever comes back
      tty.idle = setTimeout(() => {
        if (tty.clients.size === 0) endTerminal(boardId, panelId, "idle");
      }, IDLE_MS);
    }
  });
}

/** who has this terminal open: each person once, however many tabs */
function peopleAt(t: Tty) {
  return [...new Set([...t.clients.values()].map((c) => c.name))];
}

function announcePeople(t: Tty, except?: WebSocket) {
  const msg = JSON.stringify({ t: "people", people: peopleAt(t) });
  for (const ws of t.clients.keys()) if (ws !== except && ws.readyState === ws.OPEN) ws.send(msg);
}

/** for tests and shutdown */
export function closeTerminals() {
  for (const t of ttys.values()) {
    if (t.idle) clearTimeout(t.idle);
    t.sock.destroy();
  }
  ttys.clear();
  statusCache = null;
}
