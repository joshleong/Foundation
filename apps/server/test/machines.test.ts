/**
 * Machines on Kiri or Docker, against a stand-in Engine API on a named pipe
 * (Windows) or unix socket — the same wire both engines serve.
 *
 * Invariants checked: nothing runs without a person (agents and bearer tokens
 * are refused; an agent's proposal starts nothing on the engine); viewers
 * can't start machines or type into their terminals; removing needs confirm;
 * a second Start while one is starting creates one container, not two; the
 * container is Kiri-shaped (machine-<name>, dev.kiri.machine) and confined
 * (no host mounts, not privileged, ports on 127.0.0.1, limits set); the
 * engine is the truth (a container removed outside Foundation shows absent);
 * the shared terminal reaches late joiners; image files load from the archive.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FOUNDATION_DATA_DIR = mkdtempSync(join(tmpdir(), "foundation-machines-"));
process.env.FOUNDATION_ADMIN_EMAILS = "";

// ---------- a stand-in Engine API ----------

interface Box {
  Id: string;
  Name: string;
  Image: string;
  State: string;
  Labels: Record<string, string>;
  body: Record<string, any>;
}
const engine = {
  images: new Set<string>(["alpine:3.22"]),
  boxes: new Map<string, Box>(),
  calls: [] as string[],
  pullDelayMs: 60,
  loaded: [] as Buffer[],
};
const findBox = (ref: string) => engine.boxes.get(ref) ?? [...engine.boxes.values()].find((b) => b.Name === ref);

const fake = createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://docker");
  const path = u.pathname;
  engine.calls.push(`${req.method} ${path}`);
  const body = await new Promise<Buffer>((ok) => {
    const c: Buffer[] = [];
    req.on("data", (d) => c.push(d));
    req.on("end", () => ok(Buffer.concat(c)));
  });
  const json = (v: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json", server: "Kiri/0.9 (linux)" });
    res.end(JSON.stringify(v));
  };
  const err = (status: number, message: string) => json({ message }, status);
  let m: RegExpExecArray | null;
  if (req.method === "GET" && path === "/version") return json({ Version: "0.9.0", ApiVersion: "1.47", Os: "linux", Platform: { Name: "Kiri" } });
  if (req.method === "GET" && (m = /^\/images\/(.+)\/json$/.exec(path))) {
    return engine.images.has(decodeURIComponent(m[1])) ? json({ Id: "sha256:x" }) : err(404, "No such image");
  }
  if (req.method === "POST" && path === "/images/create") {
    const ref = `${u.searchParams.get("fromImage")}:${u.searchParams.get("tag")}`;
    if (ref.startsWith("nope")) return json({ error: `pull access denied for ${ref}` }); // engines say it in the stream, with a 200
    res.writeHead(200, { "content-type": "application/json" });
    res.write(JSON.stringify({ status: "Pulling fs layer", id: "l1" }) + "\n");
    res.write(JSON.stringify({ status: "Downloading", id: "l1", progressDetail: { current: 1048576, total: 4194304 } }) + "\n");
    await new Promise((r) => setTimeout(r, engine.pullDelayMs));
    engine.images.add(ref);
    return res.end(JSON.stringify({ status: `Downloaded newer image for ${ref}` }) + "\n");
  }
  if (req.method === "GET" && path === "/images/json") return json([...engine.images].map((t) => ({ RepoTags: [t], Size: 1, Created: 1 })));
  if (req.method === "POST" && path === "/images/load") {
    engine.loaded.push(body);
    engine.images.add("built-here:1");
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ stream: "Loaded image: built-here:1\n" }) + "\n");
  }
  if (req.method === "GET" && path === "/containers/json") {
    const f = JSON.parse(u.searchParams.get("filters") ?? "{}") as { label?: string[] };
    const rows = [...engine.boxes.values()].filter((b) => (f.label ?? []).every((l) => {
      const [k, v] = l.split("=");
      return v === undefined ? k in b.Labels : b.Labels[k] === v;
    }));
    return json(rows.map((b) => ({ Id: b.Id, Names: [`/${b.Name}`], Image: b.Image, State: b.State, Status: b.State === "running" ? "Up 1 second" : "Exited (0) 1 second ago", Labels: b.Labels, Ports: b.State === "running" ? Object.keys(b.body.ExposedPorts ?? {}).map((p, i) => ({ PrivatePort: Number(p.split("/")[0]), PublicPort: 40000 + i, IP: "127.0.0.1", Type: "tcp" })) : [] })));
  }
  if (req.method === "POST" && path === "/containers/create") {
    const name = u.searchParams.get("name")!;
    if (findBox(name)) return err(409, `Conflict. The container name "/${name}" is already in use`);
    const b = JSON.parse(body.toString()) as Record<string, any>;
    if (!engine.images.has(b.Image)) return err(404, `No such image: ${b.Image}`);
    const Id = randomBytes(32).toString("hex");
    engine.boxes.set(Id, { Id, Name: name, Image: b.Image, State: "created", Labels: b.Labels ?? {}, body: b });
    return json({ Id, Warnings: [] }, 201);
  }
  if ((m = /^\/containers\/([^/]+)\/(start|stop|restart|json)$/.exec(path))) {
    const b = findBox(decodeURIComponent(m[1]));
    if (!b) return err(404, "No such container");
    if (m[2] === "json") return json({ Id: b.Id, Name: `/${b.Name}`, State: { Status: b.State } });
    if (m[2] === "stop" && b.State !== "running") return res.writeHead(304).end();
    b.State = m[2] === "stop" ? "exited" : "running";
    return res.writeHead(204).end();
  }
  if (req.method === "DELETE" && (m = /^\/containers\/([^/]+)$/.exec(path))) {
    const b = findBox(m[1]);
    if (!b) return err(404, "No such container");
    engine.boxes.delete(b.Id);
    return res.writeHead(204).end();
  }
  if (req.method === "POST" && (m = /^\/containers\/([^/]+)\/exec$/.exec(path))) {
    const b = findBox(m[1]);
    if (!b || b.State !== "running") return err(409, "container is not running");
    return json({ Id: `exec-${b.Id.slice(0, 8)}` }, 201);
  }
  if (req.method === "POST" && /^\/exec\/[^/]+\/resize$/.test(path)) return res.writeHead(200).end();
  return err(404, `stand-in engine has no ${req.method} ${path}`);
});
// the exec stream: hijacked, then an echo that shouts back, with a prompt
fake.on("upgrade", (req: IncomingMessage, sock: Socket) => {
  engine.calls.push(`UPGRADE ${req.url}`);
  sock.write("HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n");
  sock.write("root@box:~# ");
  sock.on("data", (d: Buffer) => sock.write(d.toString().toUpperCase()));
});

const pipe = process.platform === "win32" ? `\\\\.\\pipe\\foundation-engine-${randomBytes(4).toString("hex")}` : join(mkdtempSync(join(tmpdir(), "fe-")), "docker.sock");
await new Promise<void>((ok) => fake.listen(pipe, ok));
process.env.FOUNDATION_ENGINES = `kiri=${pipe},docker=${process.platform === "win32" ? "\\\\.\\pipe\\foundation-no-engine-here" : "/nonexistent/docker.sock"}`;

const { upsertUser, createSession, requirePerson } = await import("../src/auth.ts");
const { run } = await import("../src/db.ts");
const { setBoardRole } = await import("../src/roles.ts");
const { runTool } = await import("../src/tools.ts");
const { editBoard, getBoard, closeBoards } = await import("../src/boards.ts");
const { boardMaps, appendSection } = await import("@foundation/protocol");
const machines = await import("../src/machines.ts");

after(async () => {
  machines.closeTerminals();
  closeBoards();
  await new Promise((ok) => fake.close(ok));
});

const ada = upsertUser("ada@formindustries.com", "Ada");
const vic = upsertUser("vic@formindustries.com", "Vic");
const BOARD = "mb";
editBoard(BOARD, "test", (doc) => appendSection(doc, "Machines"));
setBoardRole({ ...ada, role: "admin" }, BOARD, vic.id, "viewer");

const panelOf = (id: string) => {
  const o = boardMaps(getBoard(BOARD).doc).objects.get(id);
  assert.ok(o && o.kind === "panel");
  return o;
};
const fakeReq = (headers: Record<string, string>) => ({ headers, query: new URLSearchParams() }) as never;

test("engines: Kiri answers on its socket, a missing Docker says why", async () => {
  const list = await machines.engineStatus(true);
  const kiri = list.find((e) => e.id === "kiri")!;
  assert.equal(kiri.up, true);
  assert.equal(kiri.version, "0.9.0");
  const docker = list.find((e) => e.id === "docker")!;
  assert.equal(docker.up, false);
  assert.match(docker.error!, /isn't running here|didn't answer/);
  // defaults name each engine's own socket
  const win = machines.engineCandidates({}, "win32").map((e) => `${e.id} ${e.at}`);
  assert.deepEqual(win, ["kiri \\\\.\\pipe\\kiri", "docker \\\\.\\pipe\\docker_engine"]);
  const mac = machines.engineCandidates({ HOME: "/Users/ada" }, "darwin").map((e) => e.at);
  assert.deepEqual(mac, ["/Users/ada/.kiri/run/docker.sock", "/var/run/docker.sock", "/Users/ada/.docker/run/docker.sock"]);
});

test("an agent proposes; nothing runs until a person presses Start", async () => {
  const before = engine.calls.length;
  const out = (await runTool({ boardId: BOARD, actor: "Foundation Agent", userId: ada.id }, "propose_machine", { name: "Build box", image: "ubuntu", ports: [8080] })) as { card: string };
  const p = panelOf(out.card);
  assert.equal(p.panel, "machine");
  assert.equal(p.machine?.state, "absent");
  assert.equal(p.machine?.image, "ubuntu:24.04");
  assert.equal(p.machine?.proposedBy, "Foundation Agent");
  assert.deepEqual(p.machine?.wantPorts, [8080]);
  assert.ok(!engine.calls.slice(before).some((c) => c.startsWith("POST")), "the proposal touched nothing on the engine");
  // the agent's read sees it
  const seen = (await runTool({ boardId: BOARD, actor: "Foundation Agent", userId: ada.id }, "machines", {})) as { machines: Array<{ id: string; state: string }> };
  assert.deepEqual(seen.machines.map((x) => [x.id, x.state]), [[out.card, "absent"]]);
  // a viewer may read but not propose
  await assert.rejects(() => runTool({ boardId: BOARD, actor: "Vic", userId: vic.id }, "propose_machine", { name: "x" }), /View only/);
  await runTool({ boardId: BOARD, actor: "Vic", userId: vic.id }, "machines", {});
});

test("Start needs a person at a browser: bearer tokens (agents, MCP, the service token) are refused", () => {
  const token = createSession(ada.id);
  assert.throws(() => requirePerson(fakeReq({ authorization: `Bearer ${token}` }), "Starting a machine"), /needs a person/);
  assert.throws(() => requirePerson(fakeReq({ authorization: `Bearer ${token}`, cookie: `foundation_session=${token}` })), /needs a person/);
  assert.equal(requirePerson(fakeReq({ cookie: `foundation_session=${token}` })).id, ada.id);
});

test("a person starts it: pulled once, Kiri-shaped, confined, running; two presses make one machine", async () => {
  const card = [...boardMaps(getBoard(BOARD).doc).objects.values()].find((o) => o.kind === "panel" && o.panel === "machine")!;
  const [a, b] = await Promise.all([machines.startMachine(BOARD, card.id, "Ada"), machines.startMachine(BOARD, card.id, "Ada")]);
  assert.equal(a.state, "running");
  assert.equal(b.state, "running");
  assert.equal(engine.calls.filter((c) => c === "POST /containers/create").length, 1);
  assert.equal(engine.calls.filter((c) => c === "POST /images/create").length, 1);
  const box = [...engine.boxes.values()][0];
  assert.equal(box.Name, "machine-build-box");
  assert.deepEqual(box.Labels, { "dev.foundation.board": BOARD, "dev.foundation.panel": card.id, "dev.kiri.machine": "build-box", "dev.foundation.by": "Ada" });
  const hc = box.body.HostConfig;
  assert.equal(hc.Binds, undefined, "nothing mounted from this computer");
  assert.equal(hc.Privileged, undefined);
  assert.deepEqual(hc.PortBindings, { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }] });
  assert.ok(hc.Memory > 0 && hc.NanoCpus > 0 && hc.PidsLimit > 0);
  assert.deepEqual(box.body.Cmd.slice(0, 2), ["/bin/sh", "-c"], "a distro keeps running");
  const p = panelOf(card.id);
  assert.equal(p.machine?.state, "running");
  assert.equal(p.machine?.engine, "kiri");
  assert.equal(p.machine?.containerId, box.Id);
  assert.deepEqual(p.machine?.ports, [{ port: 8080, host: 40000 }]);
  assert.equal(p.status, "running");
  const acts = boardMaps(getBoard(BOARD).doc).activity.toArray().map((x) => x.text);
  assert.ok(acts.some((t) => /started the machine build-box \(ubuntu:24.04\) on Kiri/.test(t)));
});

test("the shared terminal: editors type, viewers watch, late joiners see the screen", async () => {
  const card = [...boardMaps(getBoard(BOARD).doc).objects.values()].find((o) => o.kind === "panel" && o.panel === "machine")!;
  const ada1 = new FakeWs();
  await machines.attachTerminal(BOARD, card.id, ada1 as never, { name: "Ada" }, true);
  assert.equal(ada1.control()[0].t, "hello");
  ada1.key("ls\n");
  await ada1.until(/LS/);
  const vic1 = new FakeWs();
  await machines.attachTerminal(BOARD, card.id, vic1 as never, { name: "Vic" }, false);
  assert.match(vic1.text(), /root@box:~# .*LS/s, "the late joiner got the screen so far");
  vic1.key("rm -rf /\n");
  ada1.key("pwd\n");
  await vic1.until(/PWD/);
  assert.doesNotMatch(ada1.text() + vic1.text(), /RM -RF/, "a viewer's keys never reach the shell");
  assert.equal(engine.calls.filter((c) => c.startsWith("UPGRADE")).length, 1, "one shell, shared");
  // an agent reads the screen, without colours
  const seen = (await runTool({ boardId: BOARD, actor: "Agent", userId: ada.id }, "machines", {})) as { machines: Array<{ terminal: string }> };
  assert.match(seen.machines[0].terminal, /PWD/);
});

test("stop keeps the disk; remove needs confirm; the engine is the truth", async () => {
  const card = [...boardMaps(getBoard(BOARD).doc).objects.values()].find((o) => o.kind === "panel" && o.panel === "machine")!;
  const stopped = await machines.stopMachine(BOARD, card.id, "Ada");
  assert.equal(stopped.state, "stopped");
  assert.equal(engine.boxes.size, 1);
  const again = await machines.startMachine(BOARD, card.id, "Ada");
  assert.equal(again.state, "running");
  assert.equal(engine.calls.filter((c) => c === "POST /containers/create").length, 1, "started again, not made again");
  await assert.rejects(() => machines.removeMachine(BOARD, card.id, "Ada", false), /confirm/);
  assert.equal(engine.boxes.size, 1);
  // removed outside Foundation (`kiri machine rm build-box`): the card finds out
  engine.boxes.clear();
  const r = await machines.reconcileMachine(BOARD, card.id);
  assert.equal(r.machine?.state, "absent");
  assert.match(r.machine?.detail ?? "", /removed outside Foundation/);
});

test("errors are the engine's own words; an image file loads from the archive", async () => {
  const out = (await runTool({ boardId: BOARD, actor: "Ada", userId: ada.id }, "propose_machine", { name: "Bad", image: "nope/nothing:1" })) as { card: string };
  await assert.rejects(() => machines.startMachine(BOARD, out.card, "Ada"), /pull access denied/);
  assert.equal(panelOf(out.card).machine?.state, "error");
  // an image someone saved with `docker save`, in the archive
  const bytes = Buffer.from("not really a tar, the stand-in doesn't mind");
  const sha = createHash("sha256").update(bytes).digest("hex");
  mkdirSync(join(process.env.FOUNDATION_DATA_DIR!, "files"), { recursive: true });
  writeFileSync(join(process.env.FOUNDATION_DATA_DIR!, "files", sha), bytes);
  run("insert into files (id, board_id, name, mime, size, sha256, uploaded_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)", "f_img", BOARD, "built-here.tar", "application/x-tar", bytes.length, sha, ada.id, Date.now());
  const loaded = await machines.loadImage(BOARD, "f_img", "Ada");
  assert.deepEqual(loaded.images, ["built-here:1"]);
  assert.equal(engine.loaded[0].toString(), bytes.toString());
  await assert.rejects(() => machines.loadImage(BOARD, "f_nope", "Ada"), /no such file/);
});

// ---------- a WebSocket stand-in ----------

class FakeWs extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  frames: Array<Buffer | string> = [];
  send(d: Buffer | string) {
    this.frames.push(d);
    this.emit("_frame");
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  key(s: string) {
    this.emit("message", Buffer.from(s), true);
  }
  text() {
    return this.frames.filter((f): f is Buffer => Buffer.isBuffer(f)).map((b) => b.toString()).join("");
  }
  control() {
    return this.frames.filter((f): f is string => typeof f === "string").map((s) => JSON.parse(s) as { t: string });
  }
  until(re: RegExp) {
    return new Promise<void>((ok, fail) => {
      const t = setTimeout(() => fail(new Error(`never saw ${re} in ${JSON.stringify(this.text())}`)), 2000);
      const check = () => {
        if (re.test(this.text())) {
          clearTimeout(t);
          this.off("_frame", check);
          ok();
        }
      };
      this.on("_frame", check);
      check();
    });
  }
}
