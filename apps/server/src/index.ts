/**
 * Foundation server — one process, runs locally for testing:
 *
 *   npm run dev:server      → http://localhost:4410
 *
 * HTTP API under /api, auth under /auth, files under /files, MCP at /mcp,
 * live board sync over WebSocket at /sync/:boardId.
 */

import { createServer, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.ts";
import "./db.ts";
import { HttpError, json, readJson, Router, sse, type Req } from "./http.ts";
import { clearSession, createSession, googleAuthUrl, googleCallback, isAllowed, requireUser, setSessionCookie, upsertUser, userFromRequest, createSession as mintToken } from "./auth.ts";
import { attachConnection, ensureBoardRow, getBoard, listBoards, presence } from "./boards.ts";
import { archiveFile, listFiles, reindexFilesIfNeeded, serveFile, uploadFile } from "./files.ts";
import { integrationStatus, searchAll } from "./search.ts";
import { listApps, probeApp, saveApp } from "./apps.ts";
import { parseRepo, repoCommits, repoInfo, repoReadme } from "./github.ts";
import { companySnapshot, readConnector } from "./connectors.ts";
import { createAsk, listAsks, resolveAsk, startHermes } from "./hermes.ts";
import { getJob, listJobs, startJob } from "./jobs.ts";
import { runAgent, runtimes } from "./agent.ts";
import { runTool, TOOLS } from "./tools.ts";
import { handleMcp } from "./mcp.ts";
import { seedCompanyBoard } from "./seed.ts";

const r = new Router();

r.get("/api/health", () => ({ ok: true, at: Date.now() }));

// ---------- auth ----------

r.get("/auth/config", () => ({ google: Boolean(config.google.clientId), devLogin: config.devLogin }));
r.get("/api/me", (req) => ({ user: userFromRequest(req) }));
r.post("/auth/dev", async (req, res) => {
  if (!config.devLogin) throw new HttpError(403, "dev login is off");
  const { email, name } = await readJson<{ email?: string; name?: string }>(req);
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, "enter an email");
  if (!isAllowed(email)) throw new HttpError(403, `${email} is not on Foundation's allowlist`);
  const user = upsertUser(email, name ?? "");
  setSessionCookie(res, createSession(user.id));
  return { user };
});
r.get("/auth/google/start", (_req, res) => {
  res.writeHead(302, { location: googleAuthUrl() });
  res.end();
});
r.get("/auth/google/callback", async (req, res) => {
  const user = await googleCallback(req.query.get("code") ?? "", req.query.get("state") ?? "");
  setSessionCookie(res, createSession(user.id));
  res.writeHead(302, { location: config.clientUrl });
  res.end();
});
r.post("/auth/logout", (req, res) => {
  clearSession(req, res);
  return { ok: true };
});
/** a bearer for an external agent (Claude Code, Codex, Vision) acting as you */
r.post("/api/agent/token", (req) => {
  const u = requireUser(req);
  return { token: mintToken(u.id, 30 * 864e5), mcp: `${config.publicUrl}/mcp?board=company` };
});

// ---------- boards ----------

r.get("/api/boards", (req) => {
  requireUser(req);
  return { boards: listBoards() };
});
r.post("/api/boards", async (req) => {
  requireUser(req);
  const { name } = await readJson<{ name?: string }>(req);
  const id = (name ?? "board").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || `board-${Date.now().toString(36)}`;
  ensureBoardRow(id, name ?? id);
  getBoard(id);
  return { id };
});
r.get("/api/boards/:id/presence", (req) => {
  requireUser(req);
  return { people: presence(req.params.id) };
});
r.get("/api/boards/:id/tools", () => ({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, write: Boolean(t.write) })) }));
r.post("/api/boards/:id/tools/:name", async (req) => {
  const u = requireUser(req);
  const input = await readJson(req);
  return { result: await runTool({ boardId: req.params.id, actor: u.name, userId: u.id }, req.params.name, input) };
});

// ---------- files ----------

r.post("/api/files", async (req) => {
  const u = requireUser(req);
  const file = await uploadFile(req, u.id);
  return { file: { ...file, url: `/files/${file.id}` } };
});
r.get("/api/files", (req) => {
  requireUser(req);
  return { files: listFiles(req.query.get("board")).map((f) => ({ ...f, url: `/files/${f.id}` })) };
});
r.delete("/api/files/:id", (req) => {
  requireUser(req);
  archiveFile(req.params.id);
  return { archived: true };
});
r.get("/files/:id", (req, res) => {
  requireUser(req);
  serveFile(req, res, req.params.id);
});

// ---------- search ----------

r.get("/api/search", async (req) => {
  requireUser(req);
  const q = (req.query.get("q") ?? "").trim();
  if (!q) return { hits: [], sources: {} };
  return searchAll(q, { boardId: req.query.get("board") ?? undefined, remote: req.query.get("remote") !== "0" });
});
r.get("/api/integrations", (req) => {
  requireUser(req);
  return { ...integrationStatus(), agent: runtimes() };
});

// ---------- apps, repos, company ----------

r.get("/api/apps", (req) => {
  requireUser(req);
  return { apps: listApps() };
});
r.post("/api/apps", async (req) => {
  const u = requireUser(req);
  const body = await readJson<{ name: string; url?: string; repo?: string; mcp?: string; description?: string }>(req);
  if (!body.name) throw new HttpError(400, "name required");
  return { app: saveApp(body, u.id) };
});
r.post("/api/apps/probe", async (req) => {
  requireUser(req);
  const { url } = await readJson<{ url?: string }>(req);
  if (!url || !/^https?:\/\//.test(url)) throw new HttpError(400, "an http(s) URL");
  return probeApp(url);
});
r.get("/api/repo", async (req) => {
  requireUser(req);
  const repo = parseRepo(req.query.get("repo") ?? "");
  if (!repo) throw new HttpError(400, "owner/name or a GitHub URL");
  const [info, readme, commits] = await Promise.all([repoInfo(repo), repoReadme(repo).catch(() => ""), repoCommits(repo).catch(() => [])]);
  return { info, readme: readme.slice(0, 40_000), commits };
});
r.get("/api/company", async (req) => {
  requireUser(req);
  return companySnapshot(req.query.get("fresh") === "1");
});
r.get("/api/connectors/:id", async (req) => {
  requireUser(req);
  return readConnector(req.params.id, req.query.get("fresh") === "1");
});

// ---------- Hermes asks ----------

r.get("/api/asks", (req) => {
  requireUser(req);
  return { asks: listAsks(req.query.get("board") ?? undefined) };
});
r.post("/api/asks", async (req) => {
  const u = requireUser(req);
  const b = await readJson<{ board: string; assignee: string; prompt: string; kind?: string; section?: string }>(req);
  return createAsk({ boardId: b.board, actor: u.name, userId: u.id }, { assignee: b.assignee, prompt: b.prompt, kind: b.kind ?? "cad_upload", section: b.section });
});
r.post("/api/asks/:id/resolve", async (req) => {
  const u = requireUser(req);
  const { fileId } = await readJson<{ fileId?: string }>(req);
  return resolveAsk(req.params.id, u.name, fileId);
});

// ---------- jobs ----------

r.get("/api/jobs", (req) => {
  requireUser(req);
  return { jobs: listJobs() };
});
r.get("/api/jobs/:id", (req) => {
  requireUser(req);
  const job = getJob(req.params.id);
  if (!job) throw new HttpError(404, "no such job");
  return { job };
});
r.post("/api/jobs/:id/run", (req) => {
  const u = requireUser(req);
  const job = getJob(req.params.id);
  if (!job) throw new HttpError(404, "no such job");
  return { job: startJob(job.id, job.board_id ?? "company", u.name) };
});

// ---------- agent ----------

r.get("/api/agent/runtimes", (req) => {
  requireUser(req);
  return runtimes();
});
r.post("/api/agent", async (req, res) => {
  const user = requireUser(req);
  const body = await readJson<{ board?: string; prompt?: string; runtime?: string }>(req);
  if (!body.prompt?.trim()) throw new HttpError(400, "say something");
  const send = sse(res);
  const ctrl = new AbortController();
  res.on("close", () => ctrl.abort());
  await runAgent({ boardId: body.board || "company", user, prompt: body.prompt, runtime: body.runtime, emit: send, signal: ctrl.signal });
  res.end();
});

// ---------- server ----------

const server = createServer(async (rawReq, res: ServerResponse) => {
  const req = rawReq as Req;
  const url = new URL(req.url ?? "/", "http://local");
  req.query = url.searchParams;
  // dev: the client runs on its own port; allow it with credentials
  const origin = req.headers.origin;
  if (origin && (origin === config.clientUrl || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) || origin === "tauri://localhost")) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader("access-control-allow-headers", "content-type, authorization, mcp-session-id, mcp-protocol-version");
    res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  try {
    if (url.pathname === "/mcp") {
      const user = userFromRequest(req);
      if (!user) throw new HttpError(401, "MCP needs a bearer token (POST /api/agent/token)");
      return await handleMcp(req, res, user);
    }
    const m = r.match(req.method ?? "GET", url.pathname);
    if (!m) throw new HttpError(404, "not found");
    req.params = m.params;
    const out = await m.handler(req, res);
    if (!res.headersSent && out !== undefined) json(res, out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, { error: (e as Error).message }, status);
    else res.end();
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
server.on("upgrade", (rawReq, socket, head) => {
  const req = rawReq as Req;
  const url = new URL(req.url ?? "/", "http://local");
  req.query = url.searchParams;
  const m = /^\/sync\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
  const user = userFromRequest(req);
  if (!m || !user) {
    socket.write(`HTTP/1.1 ${m ? 401 : 404} ${m ? "Unauthorized" : "Not Found"}\r\n\r\n`);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => attachConnection(m[1], ws));
});

reindexFilesIfNeeded();
seedCompanyBoard();
startHermes();

server.listen(config.port, config.host, () => {
  const rt = runtimes();
  console.log(`\n  Foundation server  ${config.publicUrl}`);
  console.log(`  data               ${config.dataDir}`);
  console.log(`  sign-in            ${config.google.clientId ? "Google" : ""}${config.google.clientId && config.devLogin ? " + " : ""}${config.devLogin ? "dev login" : ""}`);
  console.log(`  agent              ${rt.subscription ? "Claude Code (subscription)" : "—"}${rt.api ? ` · API (${rt.model})` : ""}`);
  console.log(`  MCP                ${config.publicUrl}/mcp?board=company\n`);
});
