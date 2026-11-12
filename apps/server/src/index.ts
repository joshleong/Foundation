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
import { attachConnection, boardEpoch, editBoard, syncAccess, ensureBoardRow, getBoard, listBoards, presence } from "./boards.ts";
import { archiveFile, listFiles, reindexFilesIfNeeded, serveFile, uploadFile } from "./files.ts";
import { integrationStatus, searchAll } from "./search.ts";
import { listApps, probeApp, saveApp } from "./apps.ts";
import { parseRepo, repoCommits, repoInfo, repoReadme } from "./github.ts";
import { companySnapshot, connectorEvents, readConnector, watchFactoryForm } from "./connectors.ts";
import { createAsk, listAsks, resolveAsk, startHermes } from "./hermes.ts";
import { getJob, listJobs, startJob } from "./jobs.ts";
import { followRun, listSessions, runtimes, sessionTurns, settleOrphanRuns, startRun, stopRun } from "./agent.ts";
import { t3Thread, t3Threads } from "./t3.ts";
import { pollHandoffs } from "./vision.ts";
import { boardPeople, boardRole, canWrite, requireWriter, setBoardRole } from "./roles.ts";
import { runTool, TOOLS } from "./tools.ts";
import { handleMcp } from "./mcp.ts";
import { seedCompanyBoard } from "./seed.ts";
import { addLine, attachHuddle, attachRecording, huddleArchive, transcriptText } from "./huddles.ts";
import { boardLink, channelHistory, channelInfo, inviteText, listChannels, postMessage, shareText, SlackError, slackStatus } from "./slack.ts";
import { appendSection, boardMaps } from "@foundation/protocol";
import { migrateAllBoards } from "./migrate.ts";
import { saveGoal, setProfile, todayFor, type GoalInput } from "./today.ts";
import * as flowform from "./flowform.ts";

const r = new Router();

r.get("/api/health", () => ({ ok: true, at: Date.now() }));

// ---------- auth ----------

r.get("/auth/config", () => ({ google: Boolean(config.google.clientId), devLogin: config.devLogin, flowform: { url: flowform.flowformUrl() } }));
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
// Google through flowform-server — the flowform client's sign-in (flowform.ts)
r.get("/auth/flowform/start", (req, res) => flowform.startWeb(req, res));
r.post("/auth/flowform/begin", (req) => flowform.beginDesktop(req));
r.get("/auth/flowform/done/:nonce", (req, res) => flowform.done(req, res));
r.post("/auth/flowform/poll", (req, res) => flowform.poll(req, res));
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
  const u = requireUser(req);
  return { boards: listBoards().map((b) => ({ ...b, role: boardRole(u.id, b.id) })) };
});
r.get("/api/boards/:id/epoch", (req) => {
  requireUser(req);
  return { epoch: boardEpoch(req.params.id) };
});
r.get("/api/boards/:id/people", (req) => {
  requireUser(req);
  return { people: boardPeople(req.params.id) };
});
r.post("/api/boards/:id/people", async (req) => {
  const u = requireUser(req);
  const { userId, role } = await readJson<{ userId?: string; role?: "member" | "viewer" | null }>(req);
  if (!userId || (role !== null && role !== "member" && role !== "viewer")) throw new HttpError(400, "userId and role (member, viewer or null) required");
  setBoardRole(u, req.params.id, userId, role);
  return { people: boardPeople(req.params.id) };
});
r.post("/api/boards", async (req) => {
  requireWriter(requireUser(req));
  const { name } = await readJson<{ name?: string }>(req);
  const id = (name ?? "board").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || `board-${Date.now().toString(36)}`;
  ensureBoardRow(id, name ?? id);
  // the server lays the first section, so two people opening a new board at once don't both seed it
  const doc = getBoard(id).doc;
  if (boardMaps(doc).sections.size === 0) editBoard(id, "system", (d) => appendSection(d, "Section 1"));
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
r.get("/api/files/:id/cad", async (req) => {
  requireUser(req);
  const { cadSummaryForFile } = await import("./cad.ts");
  const s = await cadSummaryForFile(req.params.id);
  if (!s) throw new HttpError(404, "no such file");
  return s;
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
/** pushed connector changes (FactoryForm's live stream), so cards refetch at once */
r.get("/api/connectors/events", (req, res) => {
  requireUser(req);
  const send = sse(res);
  const on = (id: string) => send({ id });
  connectorEvents.on("change", on);
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  res.on("close", () => {
    clearInterval(ping);
    connectorEvents.off("change", on);
  });
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

// ---------- huddles (video portals; media is peer to peer, see huddles.ts) ----------

function huddleOn(boardId: string, id: string) {
  const o = boardMaps(getBoard(boardId).doc).objects.get(id);
  if (!o || o.kind !== "panel" || o.panel !== "huddle") throw new HttpError(404, "no such huddle");
  return o;
}
r.get("/api/huddles/:id", (req) => {
  requireUser(req);
  const board = req.query.get("board") ?? "company";
  const panel = huddleOn(board, req.params.id);
  return { huddle: { id: panel.id, name: panel.name, channel: panel.channel ?? null, state: panel.huddle ?? { people: [] } }, sessions: huddleArchive(board, panel.id) };
});
r.post("/api/huddles/:id/lines", async (req) => {
  const u = requireUser(req);
  const b = await readJson<{ board?: string; text?: string }>(req);
  try {
    return { line: addLine(b.board ?? "company", req.params.id, u, b.text ?? "", "typed") };
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
r.post("/api/huddles/:id/recordings", async (req) => {
  const u = requireUser(req);
  const b = await readJson<{ board?: string; fileId?: string; sessionId?: string; startedAt?: number; endedAt?: number }>(req);
  if (!b.fileId) throw new HttpError(400, "fileId required");
  try {
    return attachRecording(b.board ?? "company", req.params.id, { fileId: b.fileId, person: u.name, sessionId: b.sessionId, startedAt: b.startedAt ?? Date.now(), endedAt: b.endedAt ?? Date.now() });
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});

// ---------- Slack channels (bot token; posts go out under the person's name) ----------

async function slackDo<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SlackError) throw new HttpError(e.code === "not_configured" ? 503 : 502, e.message);
    throw e;
  }
}
r.get("/api/slack/status", async (req) => {
  requireUser(req);
  return slackStatus();
});
r.get("/api/slack/channels", (req) => {
  requireUser(req);
  return slackDo(async () => ({ channels: await listChannels() }));
});
r.get("/api/slack/channels/:id", (req) => {
  requireUser(req);
  return slackDo(async () => ({ channel: await channelInfo(req.params.id), messages: await channelHistory(req.params.id, 40, req.query.get("fresh") === "1") }));
});
r.post("/api/slack/channels/:id/messages", async (req) => {
  const u = requireUser(req);
  const b = await readJson<{ text?: string }>(req);
  return slackDo(() => postMessage(req.params.id, b.text ?? "", u));
});
/** send the channel a link to a place on the board */
r.post("/api/slack/channels/:id/share", async (req) => {
  const u = requireUser(req);
  const b = await readJson<{ board?: string; objectId?: string; title?: string; note?: string }>(req);
  const board = b.board ?? "company";
  const text = shareText({ by: u.name, board, objectId: b.objectId, title: b.title || "A place", note: b.note });
  return slackDo(async () => ({ ...(await postMessage(req.params.id, text, u, { board, objectId: b.objectId ?? null })), url: boardLink(board, b.objectId) }));
});
/** invite the channel into a huddle on the board */
r.post("/api/slack/channels/:id/invite", async (req) => {
  const u = requireUser(req);
  const b = await readJson<{ board?: string; huddleId?: string }>(req);
  const board = b.board ?? "company";
  const h = huddleOn(board, b.huddleId ?? "");
  const text = inviteText({ by: u.name, board, huddleId: h.id, huddleName: h.name, live: h.huddle?.people ?? [] });
  return slackDo(async () => ({ ...(await postMessage(req.params.id, text, u, { board, huddle: h.id })), url: boardLink(board, h.id) }));
});
/** hand a huddle session's notes (transcript + recordings) to a channel */
r.post("/api/slack/channels/:id/huddle-notes", async (req) => {
  const u = requireUser(req);
  const b = await readJson<{ board?: string; huddleId?: string; sessionId?: string; summary?: string }>(req);
  const board = b.board ?? "company";
  const h = huddleOn(board, b.huddleId ?? "");
  const s = huddleArchive(board, h.id).find((x) => x.id === b.sessionId) ?? huddleArchive(board, h.id)[0];
  if (!s) throw new HttpError(404, "that huddle hasn't met yet");
  const lines = transcriptText(s).split("\n");
  const excerpt = lines.slice(0, 40).join("\n") + (lines.length > 40 ? `\n… ${lines.length - 40} more lines on Foundation` : "");
  const text = `${b.summary ? `${b.summary.trim()}\n\n` : ""}\`\`\`${excerpt}\`\`\`\n<${boardLink(board, h.id)}|The full huddle archive on Foundation>`;
  return slackDo(() => postMessage(req.params.id, text, u, { board, huddle: h.id, session: s.id }));
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
r.get("/api/agent/sessions", (req) => {
  const user = requireUser(req);
  return { sessions: listSessions(req.query.get("board") || "company", user.id) };
});
r.get("/api/agent/sessions/:id", (req) => {
  const user = requireUser(req);
  return { turns: sessionTurns(req.params.id, user.id) };
});

// ---------- Today: the person's own page ----------

r.get("/api/today", (req) => todayFor(requireUser(req)));
r.post("/api/today/goals", async (req) => {
  const u = requireUser(req);
  const g = await readJson<GoalInput>(req);
  try {
    return { goal: saveGoal(u.id, g) };
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
r.post("/api/today/profile", async (req) => {
  const u = requireUser(req);
  return { profile: setProfile(u.id, await readJson(req)) };
});

// ---------- Vision Code (T3) sessions, read-only ----------

r.get("/api/t3/threads", async (req) => {
  requireUser(req);
  return t3Threads();
});
r.get("/api/t3/threads/:id", async (req) => {
  requireUser(req);
  const t = await t3Thread(req.params.id);
  if (!t) throw new HttpError(404, "no such Vision Code thread");
  return t;
});

r.post("/api/agent", async (req, res) => {
  const user = requireUser(req);
  const body = await readJson<{ board?: string; prompt?: string; runtime?: string; session?: string; persona?: string }>(req);
  if (!body.prompt?.trim()) throw new HttpError(400, "say something");
  const send = sse(res);
  const session = body.session && /^ses_[a-z0-9]{6,24}$/.test(body.session) ? body.session : undefined;
  // the run lives on the server: closing this stream detaches, it doesn't stop it
  const r = startRun({ boardId: body.board || "company", user, prompt: body.prompt, runtime: body.runtime, session, persona: body.persona === "shiba" ? "shiba" : undefined });
  await new Promise<void>((done) => {
    const detach = followRun(r.id, user.id, send, done);
    res.on("close", () => (detach?.(), done()));
  });
  res.end();
});
r.get("/api/agent/runs/:id/events", async (req, res) => {
  const user = requireUser(req);
  const send = sse(res);
  await new Promise<void>((done) => {
    const detach = followRun(req.params.id, user.id, send, done);
    if (!detach) return done(); // finished long ago (or not yours): the transcript has it
    res.on("close", () => (detach(), done()));
  });
  res.end();
});
r.post("/api/agent/runs/:id/stop", (req) => {
  const user = requireUser(req);
  return { stopped: stopRun(req.params.id, user.id) };
});

// ---------- view only ----------

/**
 * Viewers don't write. Any non-GET under /api is a write except these: the
 * agent (its tools check per call, so a viewer can still ask it things),
 * stopping your own run, an MCP token (its tools check too), board tools
 * (runTool checks), setting roles (admins only), and a person's own Today
 * (their goals and profile are theirs, not a board's). The board is the
 * route's :id, or ?board=, else the person's account role decides.
 */
const READ_POSTS = [/^\/api\/agent$/, /^\/api\/agent\/runs\/[^/]+\/stop$/, /^\/api\/agent\/token$/, /^\/api\/boards\/[^/]+\/tools\//, /^\/api\/boards\/[^/]+\/people$/, /^\/api\/apps\/probe$/, /^\/api\/today\//];
function gateWrites(req: Req, path: string) {
  if (req.method === "GET" || req.method === "OPTIONS" || !path.startsWith("/api/")) return;
  if (READ_POSTS.some((p) => p.test(path))) return;
  const user = userFromRequest(req);
  if (!user) return; // the route's own requireUser answers 401
  const board = /^\/api\/boards\/([^/]+)/.exec(path)?.[1] ?? req.query.get("board");
  requireWriter(user, board);
}

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
    gateWrites(req, url.pathname);
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
  const user = userFromRequest(req);
  const hm = /^\/huddle\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
  if (hm && user) {
    wss.handleUpgrade(req, socket, head, (ws) => attachHuddle(hm[1], hm[2], ws, user, req.query.get("send") === "1"));
    return;
  }
  const m = /^\/sync\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
  if (!m || !user) {
    socket.write(`HTTP/1.1 ${m ? 401 : 404} ${m ? "Unauthorized" : "Not Found"}\r\n\r\n`);
    socket.destroy();
    return;
  }
  // the board a client holds must be this board: a copy from before a reset is refused, and a client
  // that doesn't say (a build from before epochs) can read but not write until it reloads
  const access = syncAccess(req.query.get("epoch"), boardEpoch(m[1]), canWrite(user.id, m[1]));
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (access === "refuse") return ws.close(4002, "this board was reset");
    attachConnection(m[1], ws, access === "read", user.id);
  });
});

reindexFilesIfNeeded();
watchFactoryForm();
// the Vision loop: bring back what hand-off threads export, and ask the reviewers once they have
setInterval(() => {
  void pollHandoffs((h, reviewer) => {
    const section = h.section_id ? boardMaps(getBoard(h.board_id).doc).sections.get(h.section_id)?.name : undefined;
    createAsk({ boardId: h.board_id, actor: "Vision Code", userId: h.created_by }, { assignee: reviewer, prompt: `Review what Vision made for “${h.title}”`, kind: "review", section });
  });
}, 4000).unref();
seedCompanyBoard();
migrateAllBoards();
settleOrphanRuns();
startHermes();

server.listen(config.port, config.host, () => {
  const rt = runtimes();
  console.log(`\n  Foundation server  ${config.publicUrl}`);
  console.log(`  data               ${config.dataDir}`);
  console.log(`  sign-in            ${config.google.clientId ? "Google" : ""}${config.google.clientId && config.devLogin ? " + " : ""}${config.devLogin ? "dev login" : ""}`);
  console.log(`  agent              ${rt.subscription ? "Claude Code (subscription)" : "—"}${rt.api ? ` · API (${rt.model})` : ""}`);
  console.log(`  MCP                ${config.publicUrl}/mcp?board=company\n`);
});
