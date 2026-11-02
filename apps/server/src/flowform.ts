/**
 * Sign in with Google through Flowform — the same Google login, on the same
 * server, as the flowform client.
 *
 * Foundation doesn't hold a Google client of its own for this: it hands the
 * person to flowform-server's native sign-in (FLOWFORM_URL, default
 * https://server.formresearch.ai), exactly as the flowform client does:
 *
 *   1. {flowform}/auth/google/start?cb=http://localhost:<port>/auth/flowform/done/<nonce>
 *      — flowform runs Google (its client, its PKCE, its JWKS check, its
 *      signup allowlist) and 303s back to the loopback with ?session_token=…
 *   2. Foundation asks {flowform}/auth/me with that bearer: a verified Google
 *      identity (email_verified) and flowform's role.
 *   3. Foundation revokes that flowform session (POST /auth/logout) — it never
 *      keeps another service's bearer — upserts its own user, and mints its own
 *      session.
 *
 * Two ways to finish:
 *  - web: the browser that started is the browser that finishes; a cookie
 *    bound to the attempt is checked at /done (no login fixation), and the
 *    Foundation session cookie is set there.
 *  - desktop (Tauri): Google refuses embedded webviews, so the window opens the
 *    system browser and polls with a secret only it holds; the poll response
 *    sets the session cookie in the window.
 *
 * flowform's loopback rule (http, 127.0.0.1 | localhost, a port, no fragment)
 * means this works wherever Foundation's server runs on the person's machine.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { UserInfo } from "@foundation/protocol";
import { config } from "./config.ts";
import { one, run } from "./db.ts";
import { createSession, setSessionCookie, upsertUser } from "./auth.ts";
import { HttpError, parseCookies, type Req } from "./http.ts";

const ATTEMPT_TTL = 10 * 60_000; // flowform's own oauth_state lives 10 minutes
const ATTEMPT_COOKIE = "foundation_ff_attempt";

interface Attempt {
  nonce: string;
  mode: "web" | "desktop";
  /** web: hash of the cookie the starting browser holds */
  browserHash?: string;
  /** desktop: hash of the poll secret only the window holds */
  pollHash?: string;
  /** where to land afterwards (web) */
  returnTo: string;
  createdAt: number;
  /** desktop: set once /done verified the person */
  result?: { userId: string } | { error: string };
}

const attempts = new Map<string, Attempt>();
const byPoll = new Map<string, string>(); // pollHash → nonce

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = () => randomBytes(32).toString("base64url");

function sweep() {
  const now = Date.now();
  for (const [nonce, a] of attempts) {
    if (now - a.createdAt > ATTEMPT_TTL) {
      attempts.delete(nonce);
      if (a.pollHash) byPoll.delete(a.pollHash);
    }
  }
}

function sameHash(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const flowformUrl = () => config.flowformUrl.replace(/\/$/, "");

/** The loopback origin flowform will send the person back to. */
function loopbackOrigin(req: Req): string {
  // Through Vite's proxy the Host is the client's (localhost:1430), so the
  // session cookie lands on the origin the person is actually using.
  const host = req.headers.host ?? "";
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && /:\d+$/.test(host)) return `http://${host}`;
  const pub = new URL(config.publicUrl);
  if ((pub.hostname === "localhost" || pub.hostname === "127.0.0.1") && pub.port) return pub.origin;
  throw new HttpError(500, "Flowform sign-in needs Foundation's server on this machine (a loopback address with a port)");
}

function flowformStartUrl(origin: string, nonce: string) {
  const cb = `${origin}/auth/flowform/done/${nonce}`;
  return `${flowformUrl()}/auth/google/start?cb=${encodeURIComponent(cb)}`;
}

/** web: redirect this browser to flowform's Google sign-in */
export function startWeb(req: Req, res: ServerResponse) {
  sweep();
  const nonce = secret();
  const browser = secret();
  const returnTo = safeReturn(req.query.get("return"));
  attempts.set(nonce, { nonce, mode: "web", browserHash: hash(browser), returnTo, createdAt: Date.now() });
  res.setHeader("set-cookie", `${ATTEMPT_COOKIE}=${browser}; Path=/auth/flowform; HttpOnly; SameSite=Lax; Max-Age=${ATTEMPT_TTL / 1000}`);
  res.writeHead(302, { location: flowformStartUrl(loopbackOrigin(req), nonce), "cache-control": "no-store", "referrer-policy": "no-referrer" });
  res.end();
}

/** desktop: an attempt the window finishes by polling; the URL opens in the system browser */
export function beginDesktop(req: Req) {
  sweep();
  const nonce = secret();
  const poll = secret();
  const pollHash = hash(poll);
  attempts.set(nonce, { nonce, mode: "desktop", pollHash, returnTo: "/", createdAt: Date.now() });
  byPoll.set(pollHash, nonce);
  return { url: flowformStartUrl(loopbackOrigin(req), nonce), poll, expiresIn: ATTEMPT_TTL / 1000 };
}

function safeReturn(raw: string | null) {
  // only same-origin paths; never an absolute URL
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

interface FlowformMe {
  user_id: string;
  display_name: string;
  email: string;
  email_verified: boolean;
  role: "admin" | "user" | "viewer" | string;
  is_admin?: boolean;
}

async function verifyWithFlowform(token: string): Promise<FlowformMe> {
  const res = await fetch(`${flowformUrl()}/auth/me`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 401 || res.status === 403) throw new HttpError(401, "Flowform didn't accept that sign-in");
  if (!res.ok) throw new HttpError(502, `Flowform answered ${res.status}`);
  return (await res.json()) as FlowformMe;
}

/** Foundation keeps no flowform bearer: the session flowform minted for this hand-off is revoked. */
async function revokeAtFlowform(token: string) {
  try {
    await fetch(`${flowformUrl()}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) });
  } catch {
    /* it expires on its own; nothing is stored here */
  }
}

/** A flowform-verified person becomes (or stays) a Foundation user. */
export function admitFlowformUser(me: FlowformMe): UserInfo {
  if (!me.email || !me.email_verified) throw new HttpError(403, "Flowform hasn't verified this Google account's email");
  if (me.role === "viewer" && !config.flowformAdmitViewers) throw new HttpError(403, "This Flowform account is view-only");
  const user = upsertUser(me.email, me.display_name);
  run("update users set flowform_user_id = ? where id = ?", me.user_id, user.id);
  // flowform's admins are Foundation's admins (as are FOUNDATION_ADMIN_EMAILS)
  if (me.role === "admin" || me.is_admin) {
    run("update users set role = 'admin' where id = ?", user.id);
    user.role = "admin";
  }
  return user;
}

/** flowform 303s here with ?session_token=… after Google */
export async function done(req: Req, res: ServerResponse) {
  sweep();
  const nonce = req.params.nonce;
  const attempt = attempts.get(nonce);
  const token = req.query.get("session_token") ?? "";
  if (!attempt) return page(res, 400, "Sign-in expired", "That sign-in took too long or was already used. Go back to Foundation and try again.");
  attempts.delete(nonce);
  if (attempt.mode === "web") {
    const presented = parseCookies(req.headers.cookie)[ATTEMPT_COOKIE] ?? "";
    // only the browser that started this sign-in may finish it
    if (!attempt.browserHash || !sameHash(hash(presented), attempt.browserHash)) {
      return page(res, 400, "Sign-in didn't finish", "This sign-in was started in a different browser. Start again from Foundation.");
    }
  }
  if (!/^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i.test(token)) {
    finishDesktop(attempt, { error: "Flowform didn't return a session" });
    return page(res, 400, "Sign-in didn't finish", "Flowform didn't return a session. Go back to Foundation and try again.");
  }
  let user: UserInfo;
  try {
    const me = await verifyWithFlowform(token);
    user = admitFlowformUser(me);
  } catch (e) {
    const msg = (e as Error).message;
    finishDesktop(attempt, { error: msg });
    return page(res, e instanceof HttpError ? e.status : 500, "Sign-in didn't finish", msg);
  } finally {
    void revokeAtFlowform(token);
  }
  if (attempt.mode === "desktop") {
    finishDesktop(attempt, { userId: user.id });
    return page(res, 200, "You're signed in", "You can return to Foundation and close this tab.");
  }
  const headers: Record<string, string | string[]> = {
    location: attempt.returnTo,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  };
  setSessionCookie(res, createSession(user.id));
  const cookies = ([] as string[]).concat(res.getHeader("set-cookie") as string | string[]);
  cookies.push(`${ATTEMPT_COOKIE}=; Path=/auth/flowform; HttpOnly; SameSite=Lax; Max-Age=0`);
  headers["set-cookie"] = cookies;
  res.writeHead(302, headers);
  res.end();
}

function finishDesktop(attempt: Attempt, result: Attempt["result"]) {
  if (attempt.mode !== "desktop") return;
  // keep it (under its poll) until the window collects it
  attempt.result = result;
  attempts.set(attempt.nonce, attempt);
}

/** desktop: the window asks whether the browser finished; on success it gets its session cookie */
export function poll(req: Req, res: ServerResponse) {
  sweep();
  const presented = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const nonce = presented ? byPoll.get(hash(presented)) : undefined;
  const attempt = nonce ? attempts.get(nonce) : undefined;
  if (!attempt) throw new HttpError(404, "no such sign-in (expired?)");
  if (!attempt.result) return { status: "pending" };
  attempts.delete(attempt.nonce);
  byPoll.delete(attempt.pollHash!);
  if ("error" in attempt.result) return { status: "error", error: attempt.result.error };
  const user = one<UserInfo>("select id, email, name, color, role from users where id = ?", attempt.result.userId);
  if (!user) throw new HttpError(500, "user vanished");
  setSessionCookie(res, createSession(user.id));
  return { status: "ok", user };
}

function page(res: ServerResponse, status: number, title: string, body: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)} · Foundation</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f3ec;color:#201e19;font:15px/1.5 "Hanken Grotesk",system-ui,sans-serif}
@media (prefers-color-scheme:dark){body{background:#0a111f;color:#e6ecf7}}main{max-width:420px;padding:32px}
h1{font-size:28px;letter-spacing:-.02em;margin:0 0 8px}p{opacity:.75;margin:0}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(body)}</p></main></body></html>`;
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
  res.end(html);
}
