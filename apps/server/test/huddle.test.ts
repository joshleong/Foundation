/**
 * Huddles and Slack channels, end to end on the server: two people join a
 * huddle over real sockets, signalling is relayed only to the addressee, the
 * session opens and closes with the people in it, the transcript and
 * recordings are archived (the file is never deleted), and the transcript is
 * searchable. Slack runs against a stand-in API (SLACK_API_BASE): reads,
 * posts under the person's name, joining a public channel on not_in_channel,
 * links to a place on the board, and huddle invites.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

process.env.FOUNDATION_DATA_DIR = mkdtempSync(join(tmpdir(), "foundation-huddle-"));
process.env.FOUNDATION_CLIENT_URL = "http://localhost:1430";

// the person the tools act for: a member (an unknown id would be a viewer, and viewers can't write)
const { run: runSql } = await import("../src/db.ts");
runSql("insert or ignore into users (id, email, name, color, role, created_at) values (?, ?, ?, ?, 'member', ?)", "u0", "u0@formindustries.com", "Tester", "#325bb4", Date.now());
const { getBoard, closeBoards } = await import("../src/boards.ts");
const { attachHuddle, addLine, attachRecording, huddleArchive, huddleRoster, transcriptText } = await import("../src/huddles.ts");
const { runTool } = await import("../src/tools.ts");
const { searchLocal } = await import("../src/search.ts");
const { run } = await import("../src/db.ts");
const slack = await import("../src/slack.ts");
const { boardMaps, appendSection } = await import("@foundation/protocol");
import type { HuddleWire, UserInfo } from "@foundation/protocol";

const BOARD = "huddle-board";
const ctx = { boardId: BOARD, actor: "test", userId: "u0" };
const noa: UserInfo = { id: "u1", email: "noa@formindustries.com", name: "Noa", color: "#325bb4", role: "member" };
const kai: UserInfo = { id: "u2", email: "kai@formindustries.com", name: "Kai", color: "#2e7d54", role: "member" };

let wss: WebSocketServer;
let port = 0;
const pending = new Map<string, { user: UserInfo; send: boolean; huddle: string }>();

before(async () => {
  getBoard(BOARD).doc.transact(() => appendSection(getBoard(BOARD).doc, "Studio"));
  wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  port = (wss.address() as { port: number }).port;
  wss.on("connection", (ws, req) => {
    const p = pending.get(new URL(req.url ?? "/", "http://x").searchParams.get("k") ?? "")!;
    attachHuddle(BOARD, p.huddle, ws, p.user, p.send);
  });
});
after(() => {
  wss.close();
  closeBoards();
});

/** a socket that queues what it hears, so tests can wait for a message type */
function enter(huddle: string, user: UserInfo, send: boolean) {
  const k = Math.random().toString(36).slice(2);
  pending.set(k, { user, send, huddle });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?k=${k}`);
  const heard: HuddleWire[] = [];
  const waiters: Array<() => void> = [];
  ws.on("message", (raw) => {
    heard.push(JSON.parse(String(raw)));
    for (const w of waiters.splice(0)) w();
  });
  const next = async <T extends HuddleWire["t"]>(t: T, timeout = 2000): Promise<Extract<HuddleWire, { t: T }>> => {
    const end = Date.now() + timeout;
    for (;;) {
      const i = heard.findIndex((m) => m.t === t);
      if (i >= 0) return heard.splice(i, 1)[0] as Extract<HuddleWire, { t: T }>;
      if (Date.now() > end) throw new Error(`no ${t} for ${user.name}`);
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  };
  return { ws, heard, next, say: (m: unknown) => ws.send(JSON.stringify(m)) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a huddle: people join, signalling is relayed only to its addressee, the session opens and closes", async () => {
  const { id } = (await runTool(ctx, "open_huddle", { name: "Shroud review" })) as { id: string };
  const panel = () => boardMaps(getBoard(BOARD).doc).objects.get(id) as { huddle?: { people: string[]; liveSince?: number; lastEndedAt?: number } };

  const a = enter(id, noa, true);
  const wa = await a.next("welcome");
  assert.equal(wa.peers.length, 0);
  assert.ok(Array.isArray(wa.ice) && wa.ice.length > 0, "ICE servers are handed out");
  await sleep(30);
  assert.deepEqual(panel().huddle?.people, ["Noa"]);
  assert.ok(panel().huddle?.liveSince);

  // a watcher: sees the portal, doesn't count as in it
  const w = enter(id, kai, false);
  const ww = await w.next("welcome");
  assert.deepEqual(ww.peers.map((p) => p.name), ["Noa"]);
  await a.next("peer-joined");

  const b = enter(id, kai, true);
  const wb = await b.next("welcome");
  assert.equal(wb.peers.length, 2);
  const joined = await a.next("peer-joined");
  assert.equal(joined.name, "Kai");
  await sleep(30);
  assert.deepEqual(panel().huddle?.people.sort(), ["Kai", "Noa"]);

  // an offer from Kai to Noa reaches Noa, not the watcher
  b.say({ t: "signal", to: wa.you, data: { sdp: "offer" } });
  const sig = await a.next("signal");
  assert.equal(sig.from, wb.you);
  assert.deepEqual(sig.data, { sdp: "offer" });
  await sleep(50);
  assert.ok(!w.heard.some((m) => m.t === "signal"), "signals are point to point");

  // spoken lines join the live session and reach everyone; captions are never stored
  a.say({ t: "line", text: "The shroud clears the fan by 4 mm", source: "speech" });
  a.say({ t: "caption", text: "the shroud cle" });
  const line = await b.next("line");
  assert.equal(line.line.speaker, "Noa");
  assert.equal(line.line.source, "speech");
  await w.next("caption");
  b.say({ t: "line", text: "Let's take rev C to simulation", source: "speech" });
  await a.next("line");

  // recording: only someone in the huddle can start it; everyone hears
  w.say({ t: "recording", on: true });
  await sleep(50);
  assert.ok(!a.heard.some((m) => m.t === "recording"), "a watcher can't start a recording");
  a.say({ t: "recording", on: true });
  assert.equal((await b.next("recording")).on, true);

  assert.equal(huddleRoster(BOARD, id).length, 3);
  a.ws.close();
  b.ws.close();
  await sleep(80);
  assert.deepEqual(panel().huddle?.people, []);
  assert.ok(panel().huddle?.lastEndedAt, "the session ended when the last person left");
  w.ws.close();
  await sleep(30);

  const [s] = huddleArchive(BOARD, id);
  assert.ok(s.ended_at);
  assert.deepEqual(s.people.sort(), ["Kai", "Noa"]);
  assert.deepEqual(
    s.lines.map((l) => [l.speaker, l.source]),
    [
      ["Noa", "speech"],
      ["Kai", "speech"],
      ["Foundation", "system"],
    ],
  );
  assert.ok(!s.lines.some((l) => l.text.includes("the shroud cle")), "interim captions aren't archived");

  // notes typed after the huddle join the last session; the transcript is searchable
  addLine(BOARD, id, noa, "Action: Kai sends the STEP to Vision", "typed");
  const hits = searchLocal("simulation", BOARD);
  const hit = hits.find((h) => h.source === "huddle");
  assert.ok(hit, "⌘K finds what was said");
  assert.equal(hit!.objectId, id);
  assert.match(transcriptText(huddleArchive(BOARD, id)[0]), /Kai: Action|Noa: Action: Kai sends/);
  assert.match(String(await runTool(ctx, "huddle_transcript", { huddle: id })), /Noa: The shroud clears the fan by 4 mm/);

  // a recording is a file: attached to the session, archived (never deleted)
  run("insert into files (id, board_id, name, mime, size, sha256, uploaded_by, created_at) values ('f_rec1', ?, 'noa.webm', 'video/webm', 10, 'x', 'u1', ?)", BOARD, Date.now());
  assert.equal(attachRecording(BOARD, id, { fileId: "f_rec1", person: "Noa", startedAt: s.started_at + 10, endedAt: s.started_at + 20 }).sessionId, s.id);
  assert.equal(huddleArchive(BOARD, id)[0].media[0].url, "/files/f_rec1");
  assert.throws(() => attachRecording(BOARD, id, { fileId: "f_nope", person: "Noa", startedAt: 0, endedAt: 0 }), /upload the recording first/);
});

test("a second gathering is a new session", async () => {
  const { id } = (await runTool(ctx, "open_huddle", { name: "Standup" })) as { id: string };
  for (let i = 0; i < 2; i++) {
    const a = enter(id, noa, true);
    await a.next("welcome");
    a.say({ t: "line", text: `round ${i}`, source: "typed" });
    await a.next("line");
    a.ws.close();
    await sleep(60);
  }
  const sessions = huddleArchive(BOARD, id);
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((s) => s.lines[0].text), ["round 1", "round 0"]);
});

test("typing into a huddle that never met is refused; sockets to a missing huddle are closed", async () => {
  const { id } = (await runTool(ctx, "open_huddle", {})) as { id: string };
  assert.throws(() => addLine(BOARD, id, noa, "hello", "typed"), /hasn't met yet/);
  const x = enter("pnl_missing", noa, true);
  const code = await new Promise<number>((r) => x.ws.on("close", (c) => r(c)));
  assert.equal(code, 4404);
});

// ---------- Slack, against a stand-in API ----------

let fake: Server;
const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
let joined = false;

before(async () => {
  fake = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const method = url.pathname.slice(1);
    let body: Record<string, unknown> = Object.fromEntries(url.searchParams);
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    }
    calls.push({ method, body });
    assert.equal(req.headers.authorization, "Bearer xoxb-test");
    const send = (o: unknown) => res.end(JSON.stringify(o));
    if (method === "auth.test") return send({ ok: true, team: "Form Industries", user: "foundation" });
    if (method === "conversations.list")
      return send({ ok: true, channels: [{ id: "C0DESIGN1", name: "design", is_private: false, is_member: false, num_members: 9, topic: { value: "Shrouds and fans" } }] });
    if (method === "conversations.info") return send({ ok: true, channel: { id: "C0DESIGN1", name: "design", is_private: false, is_member: joined } });
    if (method === "conversations.join") {
      joined = true;
      return send({ ok: true });
    }
    if (method === "users.info") return send({ ok: true, user: { name: "kai", profile: { display_name: "Kai" } } });
    if (method === "conversations.history")
      return send({
        ok: true,
        messages: [
          { ts: "1793000002.000200", user: "U0KAI", text: "<@U0KAI> pushed <https://example.com/rev-c|rev C> &amp; notes" },
          { ts: "1793000001.000100", user: "U0KAI", text: "morning" },
          { ts: "1793000000.000050", subtype: "channel_join", user: "U0KAI", text: "joined" },
        ],
      });
    if (method === "chat.postMessage") {
      if (!joined) return send({ ok: false, error: "not_in_channel" });
      return send({ ok: true, ts: "1793000003.000300" });
    }
    send({ ok: false, error: "unknown_method" });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  process.env.SLACK_API_BASE = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
});
after(() => fake.close());

test("Slack: off without a token, and says how to connect", async () => {
  delete process.env.SLACK_BOT_TOKEN;
  const s = await slack.slackStatus();
  assert.equal(s.connected, false);
  assert.match(s.reason ?? "", /SLACK_BOT_TOKEN/);
  await assert.rejects(slack.channelHistory("C0DESIGN1"), /isn't connected/);
});

test("Slack: read a channel, post as a person, share a board place, invite to a huddle", async () => {
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  assert.deepEqual(await slack.slackStatus(), { connected: true, team: "Form Industries", bot: "foundation" });

  const msgs = await slack.channelHistory("C0DESIGN1");
  assert.deepEqual(msgs.map((m) => m.text), ["morning", "@Kai pushed rev C (https://example.com/rev-c) & notes"], "oldest first; joins dropped; mrkdwn made plain");
  assert.equal(msgs[0].name, "Kai");
  const before = calls.length;
  await slack.channelHistory("C0DESIGN1");
  assert.equal(calls.length, before, "a second read inside the cache window costs nothing");

  // the app isn't in the channel yet: it joins (public) and posts once
  await slack.postMessage("C0DESIGN1", "rev C is on the board", { name: "Noa" });
  const posts = calls.filter((c) => c.method === "chat.postMessage");
  assert.equal(posts.length, 2, "first attempt, then the retry after joining");
  assert.ok(calls.some((c) => c.method === "conversations.join"));
  assert.equal(posts[1].body.username, "Noa via Foundation", "the channel sees who wrote");

  // a link straight to a place on the board, framed when it opens
  const share = slack.shareText({ by: "Noa", board: BOARD, objectId: "pnl_x", title: "Shroud <rev C>" });
  assert.match(share, /<http:\/\/localhost:1430\/\?board=huddle-board&focus=pnl_x\|Shroud  rev C on Foundation>/);
  const invite = slack.inviteText({ by: "Noa", board: BOARD, huddleId: "pnl_h", huddleName: "Shroud review", live: ["Noa", "Kai"] });
  assert.match(invite, /Noa invited this channel to a huddle on Foundation — Noa, Kai are there now/);
  assert.match(invite, /focus=pnl_h\|Join Shroud review>/);

  // agents can put a channel on the board and read it, by name
  const { id, channel } = (await runTool(ctx, "add_slack_channel", { channel: "#design" })) as { id: string; channel: string };
  assert.equal(channel, "C0DESIGN1");
  const card = boardMaps(getBoard(BOARD).doc).objects.get(id) as { panel: string; name: string; channel: string };
  assert.deepEqual([card.panel, card.name, card.channel], ["slack", "#design", "C0DESIGN1"]);
  assert.match(String(await runTool(ctx, "slack_read", { channel: "C0DESIGN1" })), /Kai: morning/);
  await assert.rejects(runTool(ctx, "add_slack_channel", { channel: "#nope" }), /no Slack channel/);
});
