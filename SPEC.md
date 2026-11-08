# Foundation — spec

> The company brain of Form Industries: one shared grid where people, the apps we build, and the agents that work with us meet. This document is the plan every session (human or agent) builds from. **DESIGN.md** is its visual contract. Status is honest: _done_ means it ran and was checked; _partial_ and _stub_ say what's missing.

Last updated 2026-11-07 · branch `main` · evidence in `docs/evidence/` (latest: `2026-11-07_plan-board/`) · **the plan is a kanban board**: `docs/plan.json`, GitHub issues, and Settings → Plan in the app (§8)

---

## Waiting on a person (from the plan board's **Needs you** column)

The plan moved to a kanban board on 2026-11-07 (§8). What only a person can do, at the top of it:

- **Put the plan on GitHub**: issues are off on `joshleong/Foundation` (a fork), and publishing to a public repo was left to you. Turn them on (`gh repo edit joshleong/Foundation --enable-issues`), then `npm run plan:push`: one issue per card, with `status:` / `kind:` / `area:` labels and a milestone each. For a GitHub Projects board too, `gh auth refresh -s project` and `npm run plan:project`
- **Repo visibility**: `joshleong/Foundation` is public (§6 #1), and the issues will be too
- **Keys**: Slack app (§6 #7), BomForm and the Data Room's stopped sync (§6 #5), API credits, `npx rea-agents setup`
- **Checks only a person can do**: a real voice in a huddle and to the crew's sheet, an approved export from a real Vision Code thread, `npm run kiri:install` on a Mac and on Linux

## 0. How this brief was framed

The original ask (Josh, 2026-11-02) was broad: unify Vision, Creation and the Data Room's UI work into Foundation; rebuild flowform's features with better design and agents; build a company view of BomForm, FactoryForm and the other apps; reach 60 fps; write a spec and a design language; then build, test and push. Before building, five questions were answered:

**1. What would a top professional do that wasn't asked for?**
A principal product engineer would make the board's _data model and protocol_ the product. Every surface (people, the built-in agent, external agents over MCP, embedded apps over postMessage) would read and write one versioned document, so a panel, a wire or an ask is the same object whoever made it. They would carry over the predecessor's hard-won invariants as tests, not as folklore: hashed bearers, archive-never-delete, confirm-to-delete, idempotent agent writes, viewer-write rejection. They would set a performance budget and measure against it rather than promise "60 fps". And they would make the system honest about what isn't wired yet (offline connectors say _offline_ and why).

**2. The rawest material.**
Not summaries of the old app but its source: `flowform-server` (Axum, ~275k lines of Rust: the Yjs room protocol, persistence, auth, search, MCP) and `flowform-client` (GPUI, ~336k lines: LOD, media residency, viewport culling). Vision's `packages/ui` `tokens.css`, `motion.ts` and `gl.ts` are the design truth, ahead of any screenshot. The real HTTP and MCP surfaces of FactoryForm (`docs/API.md`, `server/erp/routes.js`) and BomForm (`lib/bomform/client.ts` in the Data Room). The live services on this machine (Vision Code/T3 on :3783, the Archive on :63727, FactoryForm on :3001).

**3. Methods and tools.**
- **Sync and state:** a CRDT (Yjs) document per board with the y-protocols sync/awareness wire.
- **Storage and search:** SQLite (node:sqlite) for durable state, with an FTS5 index tuned for prefix search on part numbers.
- **Agents and interop:** MCP (streamable HTTP) as the agent interface. The agent runs on two runtimes: Claude Code headless on the person's subscription (`claude -p --output-format stream-json`, the T3-style session) or the Anthropic API on credits. A postMessage bridge carries ports between embedded apps.
- **Rendering:**
  - Off the React hot path: springs write styles directly.
  - Idle-aware WebGL.
  - IntersectionObserver and zoom-gated iframes, which is flowform's iframe-snapshot idea.
  - Memoised layout per state snapshot.
- **Verification:** `node:test` for invariants, a real browser for the UI, and the real services for connectors.

**4. What, other than you or me, shows it's right?**
The running system:
- two browser sessions converge on the same board;
- an agent run through Claude Code changes the board and the change appears live for everyone;
- search finds a STEP file by the part name inside its header;
- FactoryForm's own server answers the connector;
- the tests enforce the invariants;
- screenshots in light and night, on tokens only.

**5. The rewritten brief (what this session executed):**

> Build Foundation v0 as an npm-workspaces monorepo: `apps/server` (Node 22 + TypeScript: SQLite, Yjs board sync, auth, files, search, MCP, agent runtime, connectors, Hermes, REA jobs), `apps/client` (the existing React grid, synced through Yjs, plus panels, the agent layer, ⌘K, the agent dock, login, presentation, design page), `packages/protocol` (the board schema all sides share), and `packages/ui` (Vision's design language as Foundation's tokens). Port flowform's valuable server behaviour and invariants, and drop its Gantt and digital twin. Seed a company board where Vision, BomForm, FactoryForm, the Data Room, Creation and Foundation are live connectors wired by real data flows. Verify in a browser (light and night), run one real agent turn on the subscription runtime, test the invariants, write SPEC.md and DESIGN.md with honest status and the hookups a person must do, and push to `main`.

### 0.1 Huddles and Slack channels (Josh, 2026-11-02)

**The ask.** Right-click should also open a **video portal**: your camera streams live into the board for everyone on it, a spatial huddle. Slack channels become a primitive. You can read and post to a channel, send it links to places on the board, and invite it to a Foundation huddle instead of a Slack one. Everything said is archived with the recordings, like Granola.

**What a professional adds.** A portal costs nothing until someone is in it. People who are only looking watch without sending, and only while the portal is on screen. The call goes with you as you roam the board (a chip in the corner, with the sound). Each browser transcribes **its own** mic, so every line knows its speaker without diarization. Recording is visible to all (REC), and each person records themselves, so nobody's stream is captured by someone else's machine. Posts carry the person's name ("Josh via Foundation"). Links into the board frame the place they point at. Each time people gather is a **session** with its own transcript, recordings and people, searchable from ⌘K and readable by agents.

**Rawest material.** WebRTC's perfect-negotiation pattern. The Web Speech API and MediaRecorder. Slack's Web API: `conversations.*`, `chat.postMessage` with `chat:write.customize` and message metadata. flowform-server's Slack connector (per-user OAuth, read scopes only) and its transcription stub (AWS Transcribe, never wired).

**Methods.** A WebRTC mesh relayed by `/huddle/:board/:huddle`: fine for about six people, with nothing paid or third-party carrying media. STUN, plus TURN when `FOUNDATION_ICE_SERVERS` is set. SQLite for sessions, lines and recording links. Recordings are ordinary uploaded files (archived, never deleted). FTS5 for transcripts. A bot token for Slack, polled while a card is on screen and cached server-side.

**What shows it's right.** Two browsers signed in as two people (`localhost` and `kai.localhost`). Each receives the other's 640×360 video and audio, measured from the `<video>` elements. Typed lines reach the other side live. Both recordings upload and decode. The archive shows the session. ⌘K finds a phrase from it. A Slack card reads, posts, links and invites against a stand-in Slack API. Tests cover the server, sockets included (`apps/server/test/huddle.test.ts`). Evidence: `docs/evidence/2026-11-02_huddles-slack/`.

---

### 0.2 Machines in a section: Kiri or Docker (Josh, 2026-11-07)

**The ask.** Start and load virtual machines in a section of Foundation, through Docker or through Kiri (github.com/libracoder/kiri), a lightweight VM host.

**1. What a top professional would do that wasn't asked for.**
- **Not write two drivers.** Kiri is a small Linux VM that serves the **Docker Engine API**, so Kiri and Docker are one wire: the engine's own socket (a named pipe on Windows) and its HTTP API. Shell out to neither CLI, and install nothing.
- **Make "a machine" mean what Kiri means.** A long-lived container named `machine-<name>`, labelled `dev.kiri.machine`, so `kiri machine shell <name>` reaches what Foundation started. Foundation's own labels tie it to its card. The engine stays the truth: the card shows what the engine says, read back while someone looks at it.
- **Treat Start as running third-party code**, because it is. Only a person starts, stops, restarts, removes or loads, from a browser session (a cookie). A bearer token (an agent, MCP or the service token) is refused. Agents may propose a machine and read its state and screen.
- **Remove** destroys the disk, so it needs `confirm`. **Viewers** watch the terminal and can't type in it.
- **Confine by default.** Nothing from this computer is mounted, nothing is privileged, ports publish on 127.0.0.1 only, and memory, CPU and process caps are set.
- **One terminal per machine, shared.** Two people at one shell, like the board itself, with the screen replayed to late joiners and to agents.
- **The machine's ports are the way out.** A published port opens as a page in the section beside it.
- **"Load" means `docker load`.** An image file someone saved goes into the engine from the archive, and the file stays archived.

**2. The rawest material.** Not Kiri's README but its source:
- `crates/kiri/src/machine.rs`: what a machine is: distro images, the sleep loop, labels, `machine-<name>`.
- `crates/kiri/src/daemon/api.rs`: which Engine API routes it serves, its 101 hijack for exec, API 1.47, version-prefix stripping.
- `crates/kiri/src/client.rs` and `docs/features.md`: its sockets: `\\.\pipe\kiri`, `~/.kiri/run/docker.sock`, `/run/kiri/docker.sock`.
- `daemon/hostopts.rs`: it doesn't keep `Memory`/`NanoCpus`; Kiri caps its whole VM instead. *(Wrong for Kiri 0.1.18 on Windows, found running it 2026-11-07: a machine's cgroup has `memory.max` 2 GiB, `cpu.max` 2 CPUs and `pids.max` 1024, the caps Foundation sends.)*
- The Docker Engine API reference: create, start, exec, the hijacked raw stream, resize, load.
- The live engine on this computer (Docker Desktop 28.3, API 1.51, on `\\.\pipe\docker_engine`).

**3. Methods and tools.**
- **Engine:** Node's `http` over the engine's socket path (named pipe or unix socket), with no SDK. Label filters find a card's container. The exec stream is taken over with `Connection: Upgrade` (a 101 response), and the server relays it to browsers over `/machines/:board/:panel/tty`.
- **Terminal:** xterm.js with its fit addon. Its colours come from the tokens through a probe element, so night mixes resolve.
- **State:** the board's Y.Doc (`PanelDoc.machine`) for state everyone sees.
- **Tests:** `node:test` with a stand-in Engine API on a named pipe.
- **Checks in a real browser** with two people, against the real engine.
- **`npm run machines:smoke`:** the driver against whatever engine is installed.

**4. What, other than you or me, shows it's right.**
- **The engine itself.** `docker ps` / `docker inspect` (or `kiri machine list`) shows the container the card claims, with its labels, no mounts, the caps, and a port on 127.0.0.1 only. When it's removed, the engine has nothing left.
- **The machine itself.** `/etc/os-release` typed into the card answers from inside it. A page served on its port opens in the next section, and `curl` gets it.
- **A second person.** Kai's command shows in Ada's terminal.
- **The server's refusals.** A bearer token gets 403; a remove without `confirm` gets 400; a viewer's keys never reach the shell.
- **The tests**, and screenshots day and night on tokens.

**5. The rewritten brief (what this session executed):**

> Add **machines** to Foundation: a section can hold a Linux machine or container that runs on this computer's container engine, **Kiri or Docker**, through the Docker Engine API both serve, over the engine's own socket. A machine is Kiri's kind (`machine-<name>`, `dev.kiri.machine`), labelled with its board and card; the engine is the truth and the card mirrors it. A person picks an image on the card (a distro, one the engine already has, or a `docker save` file loaded from the archive) and presses Start; it pulls with progress, runs confined (no host mounts, not privileged, ports on 127.0.0.1, caps), and opens a terminal shared by everyone on the board (viewers watch). Ports open as pages in the next section. Stop keeps the disk; Remove needs confirm. Agents get `propose_machine` and a read-only `machines` (state, ports, the last screen); every action that runs code needs a person's browser session. Test the invariants against a stand-in engine; check it in a real browser with two people against the real engine on this machine; add a smoke script for Kiri; show it on `#/design` day and night; update SPEC and DESIGN honestly; push to `main`.

Evidence: `docs/evidence/2026-11-07_machines/`.

### 0.3 The crew: agents you can see (Josh, 2026-11-07)

**The ask.** Agent cursors with generated names that help whenever you ask for something. They can take your view and bring you to a section, make primitives, hook up data sources, and move around, improve and organize the interface themselves. You mostly call on them by holding the space bar: a voice input rises from the bottom, and you say what you need.

**1. What a top professional would do that wasn't asked for.**
- **One identity per agent, end to end.** Before this, every agent on a board shared the server's one presence: one ring and no name. Each agent turn now joins the board as its own awareness client, with a generated name and a colour. Every write it makes is signed with that name, in the activity log and as `createdBy` on panels.
- **Anticipation.** An agent's cursor goes to where the change will land and waits a beat (`FOUNDATION_CREW_TRAVEL_MS`, 520 ms) before the change lands. A creation aims at the next free slot in its section's flow. People can follow the work instead of watching cards pop in.
- **Consent over your camera.** Only the person who asked is moved. If they were moving around in the last 1.8 s, the agent asks first (**Go**) instead of yanking the view. **Back** always returns them to where they were.
- **Space still pans.** If a pointer goes down while Space is held, it's a pan, and the sheet stands down before it has heard anything. A quick tap types instead, for no mic or no recogniser.
- **Bounded crews.** Helpers come only inside a person's ask: at most two per ask, never a helper's helper, at most six agents on a board. Every agent can be stopped from the sheet, all of yours at once with **Stop all** (2026-11-07), and no cursor outlives its run.

**2. The rawest material.**
- The y-protocols awareness wire (client ids, clocks, the 30 s timeout).
- Claude Code's `stream-json` events and the MCP calls they make.
- The board's Y.Doc.
- The camera spring.
- The mic itself: Web Speech for words, and an `AnalyserNode` for the real input level.

**3. Methods and tools.**
- **Identity:** one `Awareness` per agent, on its own small Y.Doc, bridged into the board's awareness (it renews every 15 s and leaves cleanly).
- **MCP:** a crew id carried on the MCP URL (`&crew=`) and honoured only for the bearer's own person and board.
- **Motion:** springs that write `transform` directly (travel k 140, c 22; the arrival on the pop spring).
- **Tests:** a `script` runtime (`FOUNDATION_AGENT_SCRIPT=1`, tests only) that runs a fixed playbook through the real tools, so the browser checks are the same every time; Playwright with two people; `node:test` for the invariants.

**4. What, other than you or me, shows it's right.**
- **A second person's browser.** Kai sees each agent by name, and its cursor is already inside the section when each card lands (measured: 0.5–2.5 s ahead).
- **The board's own activity**, which names every agent that wrote.
- **The asker's measured camera.** Ada is moved and **Back** restores her to within 2 px. Kai's camera doesn't move.
- **The server's awareness**, which is empty once the run ends.
- **A real Claude Code turn.** The runtime ran here, but its sign-in had expired (§7), so this check still waits.

**5. The rewritten brief (what this session executed):**

> Add a crew to Foundation. Hold Space and a voice sheet rises from the bottom: a live mic level, your words as heard; release sends, Esc drops, a quick tap types. Each ask gets an agent with a generated name and its own cursor and colour. Several can work at once, and a lead may call in up to two helpers within your ask. A cursor travels to what it's about to change before the change lands, and says what it's doing. Agents create primitives (sections, notes, tables with data, panels), hook up data sources (connectors, apps, wires), and move, rename and organize, all through the one tool surface, with every write attributed by name. An agent can bring the asker to a section: it glides there, or asks if they're busy, and Back returns them; others just watch the agent go. Prove it with a scripted runtime in two-browser e2e, server tests for identity, caps, attribution, viewer refusal and cleanup, one real subscription turn, and `#/design` day and night. Update SPEC and DESIGN, then push to main.

Evidence: `docs/evidence/2026-11-07_crew/`.

## 1. What Foundation is

| | |
|---|---|
| **For** | Everyone at Form Industries, and their agents |
| **Is** | A shared, infinite, spreadsheet-like grid of sections. A section holds cards: notes, tables, maps, media, and **panels**: live apps, web pages, machines, files and CAD, company connectors, agent jobs, and asks to people |
| **Above the grid** | The **agent layer**: wires between app ports, rings where agents are working, and an activity feed of who did what |
| **Agents can** | Work in the open as **the crew** (named cursors, §0.3), and run the whole interface through one tool surface (§4): make sections, notes and tables, organize, open and wire apps, bring a person to what they made, find repos, read company systems, brief Vision, ask people for CAD (Hermes), queue reverse-engineering (REA) |
| **Runs** | Locally with one command (`npm run dev`), on macOS, Linux or Windows. Desktop via Tauri (`npm run desktop`: the server and the window together) |

### 1.1 Architecture

```
                 ┌────────────────────────── apps/client (React 19 + Vite, :1430; Tauri shell) ──────────────────────────┐
  people ───────▶│ Login (ASCII wind) · Side pane · Grid (springs, WebGL paper) · App sections · Agent layer · ⌘K · Dock │
                 │ store.ts (60 fps local model) ⇄ sync/board.ts (Yjs mirror, diff by identity) ⇄ WebSocket /sync/:board  │
                 └───────────────▲──────────────────────────────────────────────────────────────▲──────────────────────────┘
                                 │ postMessage bridge (foundation:input/output/ports)          │ HTTP /api /auth /files, SSE /api/agent
                     embedded apps (iframes)                                                     │
                 ┌───────────────────────────────────────── apps/server (Node 22 + TS, :4410) ───┴──────────────────────────┐
                 │ boards.ts  Y.Doc per board · update log + compaction · awareness · FTS indexing                         │
                 │ auth.ts    Google via flowform (flowform.ts) / dev login · hashed sessions · service token                        │
                 │ files.ts   content-addressed uploads · range streaming · text + STEP/IGES header extraction · archive    │
                 │ search.ts  FTS5 (board, files) + Slack + GitHub + apps, local-first                                      │
                 │ tools.ts   the board tool surface ──▶ agent.ts (Claude Code subscription | Anthropic API)                │
                 │                                    ──▶ mcp.ts (/mcp — Claude Code, Codex, Vision attach here)            │
                 │ connectors.ts  FactoryForm (:3001 REST) · BomForm (remote MCP) · Vision (T3 :3783, Archive :63727) …     │
                 │ hermes.ts  asks + nudges (board activity, Slack DM)   jobs.ts  REA reverse-engineering (person presses Run)│
                 │ machines.ts  Kiri or Docker over the Engine API socket · a shared terminal (a person presses Start)        │
                 └─────────────────────────────────────── SQLite: data/foundation.db · files: data/files/<sha256> ─────────┘
```

### 1.2 Repo map

```
apps/client      React grid, shell, panels, login, design page (src-tauri for the desktop build)
apps/server      the Foundation server (src/*.ts, test/*.test.ts)
packages/protocol  board schema (Y.Doc layout, PanelDoc, LinkDoc, AgentEvent) — one schema, no copies
packages/ui      tokens.css + TS tokens, springs, night engine (Vision's language, Foundation's additions)
docs/evidence    screenshots per slice
SPEC.md DESIGN.md README.md CLAUDE.md
```

---

## 2. The board document (packages/protocol)

One Y.Doc per board, with these top-level maps:
- `grid.tracks`: `{cols, rows}`
- `sections`: id → `{name, c0, r0, c1, r1, host?}` — `host` is the app (panel id) the section hosts: it fills the section and its ports sit on the section's edges
- `objects`: id → table | map | note | media | **panel**
- `cells`: tableId → `{"c,r": raw}`
- `links`: id → `{from:{panel,port}, to:{panel,port}, label}`
- `meta`: `schema: 2`, name
- `activity`: bounded array of `{at, who, role, text, objectId}`

**Panel kinds:** `app`, `link`, `file`, `machine`, `agent`, `connector`, `ask`, `stage`, `huddle` (a video portal; `huddle` holds who's in it now and whether it records, kept by the server), `slack` (a channel; `channel` is its id — a huddle opened for a channel carries it too). A `machine` is a web desktop reached by `url` (noVNC, ttyd, code-server) or, with `machine` set, a Linux machine on Kiri or Docker whose state (`MachineState`: name, image, engine, state, ports, who proposed and started it) the server keeps from what the engine says. Each kind has optional `url`, `repo`, `mcp`, `fileId`/`mime`, `ports[]`, `outputs{portId: value}`, `status`, `assignee`, `sessionId`.

**Rules:**
- A section never scrolls: it fits its cards to its body (the wheel always belongs to the grid). How it's fitted and whether it's expanded are local to the window, never shared.
- `blob:` URLs never enter the document.
- The schema version lives in `meta.schema`. flowform shipped unversioned fields and paid for it; bump it and migrate on change. Migrations are numbered steps in `apps/server/src/migrate.ts`, run at boot. **2:** sections host apps — a section of only apps (the company board's six connectors) becomes one section per app where its card was, other sections shift, nothing overlaps; a section holding one app hosts it (`apps/server/test/hosting.test.ts`). **3:** a note's text is a `Y.Text` in `noteText` (keyed by note id), written as the smallest edit (`setNoteText`, `putNote`); the card in `objects` no longer carries `text`, so typing never rewrites its position or size (`apps/server/test/notes.test.ts`). **4:** each table's cells are a `Y.Map` ("c,r" → raw) per table in `cells`; edits write only the cells that changed (`setTableCells`, `tableCellsOf` reads either form) (`apps/server/test/tables.test.ts`). **5:** every table has its cell map from the start, made in the same change as the table: a map made lazily by two people at once is two maps, and one is lost (found by the two-browser test).

### 2.1 The Foundation bridge (apps ↔ grid)

An app inside a panel talks to the grid with `postMessage`:

| Direction | Message |
|---|---|
| app → grid | `{type:"foundation:ports", ports:[{name, dir:"in"\|"out", type}]}` declares its ports |
| app → grid | `{type:"foundation:output", port, value}` emits a value; wires carry it on |
| grid → app | `{type:"foundation:hello", panel, ports}` on load |
| grid → app | `{type:"foundation:input", port, value}` whenever an upstream value changes |

An app can also publish `/.well-known/foundation.json` (`{name, description, mcp, repo, ports}`). Opening its URL then gives it a name, ports, an MCP badge and its repo automatically.

---

## 3. Feature status

| Area | Feature | Status | Notes |
|---|---|---|---|
| **Monorepo** | npm workspaces, `npm run dev` runs both, Tauri still builds the client | done | Client moved to `apps/client` with `git mv` (history kept). Port 1430: Vision owns 1420 |
| **Auth** | Google through flowform-server: flowform's own client, PKCE and signup allowlist. Foundation verifies the hand-off at `/auth/me` (email_verified), revokes flowform's bearer and mints its own session. The web path is bound to the browser that started it; the desktop path uses the system browser and the window polls. Also dev login (allowlist), an optional own Google client, hashed 30-day sessions, and the service token | done: `test/flowform.test.ts`, plus the desktop app signed in for real through server.formresearch.ai (`docs/evidence/2026-11-02_flowform-signin/`). Users are keyed by flowform account; an address flowform hasn't verified can create a user but never claim an existing one | Flowform admins become Foundation admins. Viewers are refused unless `FLOWFORM_ADMIT_VIEWERS=1` |
| **Sync** | Yjs board docs, y-protocols wire, update log + compaction, reconnect with backoff, presence/awareness | done | Agent edits verified streaming live into an open browser |
| | Peer cursors | done (2026-11-07) | Two browsers each see the other's named pointer (`e2e/together.spec.ts`) |
| **Grid** | Original Foundation grid (sections, tracks, springs, tables with formulas, maps, notes, media) | done | Now night-aware and on tokens. Layout memoised per state |
| **Checks in a real browser** (2026-11-03, phase 1) | `npm run e2e -w @foundation/client`: Playwright (Chromium 1.64.1), its own server and data (:4430/:1450, or `E2E_SERVER_PORT` / `E2E_CLIENT_PORT` / `E2E_SLACK_PORT` where Windows has reserved those) and a stand-in Slack (:4440); `E2E_BUILD=1` runs it on the production build, no agent runtime. Two people in two browsers (one note typed at once, one table written at once, a rename); sections moved and split, each step checked for cell clashes, overlaps, spills, clipped welcomes and new voids, and photographed; the perf trace; voice → session; the four layouts | done | 17 pass, 1 skipped by design. Found and fixed: the lazy cell-map race, section names that didn't drag, voids after moves, clipped welcomes. Screenshots in `docs/evidence/2026-11-03_{sections,together,build,perf}/` |
| **Sections fit; Expand opens one as its own grid** (2026-11-07, Josh: "Scrolling shouldn't be taken over by a section") | A section no longer scrolls or catches the wheel: the wheel and trackpad always pan the grid. It lays its docked cards out at the width that lets them show largest (tried at 100 % down to 40 % in steps; a wider flow has to win clearly) and scales them to fit its body, gliding on the camera spring. Below 40 % it stops shrinking and a pill says **n more · ⤢ Expand**. **Expand** (the pill, the ⤢ tool, or the right-click menu) opens the section as its own grid: it reflows at its own width, at full size, and grows from its corner as long as it needs; its neighbours step back to 12 % and let the pointer through, the camera frames it from the top, and the wheel reads on down it. Esc, ⤡ or **Back to the board** closes it. Pressing inside a section holds its fit, so a card being dragged never rescales under the finger. Wires, ports and drops use the fitted geometry (`objectWorldRect` carries the scale) | done | Browser (`docs/evidence/2026-11-07_section-fit/`, day and night, and `#/design`): 13 cards fitted at 59 % on a 1,827 px flow, 51 cards clipped at 40 % with "15 more", the wheel panned the board 400 px with the cards still, Expand grew the section to 1,130 × 8,610 framed at 89 %, Esc came back to 40 %; a card dragged 150 × 50 px moved exactly that on screen with the fit held; DOM and store rects agree to under 1 px. `e2e/wheel.spec.ts` (3) and `e2e/sections.spec.ts` (6) pass. App sections are unchanged (⤢ still fills the screen with the app) |
| **Moving and splitting sections** (2026-11-03) | Drag by the name (or anywhere on the header); a gap a section leaves is filled by the neighbours that line one side of it (fewest wins); a short or narrow empty section shows a compact welcome | done | `test/sections.test.ts` (4), `e2e/sections.spec.ts` |
| **Voice** (2026-11-03; the crew's sheet 2026-11-07) | Talk to the agent from anywhere: hold Space (or V, or the HUD's mic pill) and the crew's sheet listens; the words show as heard; let go and they go to the session on screen if one is showing, else to a new crew agent; Esc drops them. The composer's mic shares the same voice code | done | Checked with a stand-in recogniser; not with a real voice. Web Speech sends audio to the browser maker's service (§7) |
| **Agent construction** (2026-11-03) | `find_images` (archive full text + where it came from, board, Slack: `search.files` phrase then words, or the bot's `files.list`) and `lay_out` (a section as a grid, mood board, document or timeline; Slack images copied into the archive; captions with title, source and date). The agent is told when to build pages | partial | Real agent turn on the subscription, against a stand-in Slack: "lay out all the images from Slack related to the Airform PTHP" → 3, then (after phrase-then-word search) 4 as a mood board. **Real Slack not run**: needs a token (§6.7). `test/construct.test.ts` (4) |
| **Offline** (2026-11-03, phase 1) | Every board opened here keeps a copy on the device (IndexedDB via `y-indexeddb`); the app opens from it before the server answers or without it, with the person and the board list remembered. Edits made offline are saved there and sent by the reconnect handshake. Board tab: **Saved on this device** (changes waiting, survives a reload) or **This device's copy**. Each board has an epoch: a copy of a board the server has since made again is set aside, checked when the board opens, before every reconnect, and by the server at the socket (`syncAccess`: mismatch refused; a client that doesn't say reads only). Sign-out forgets the person, the copies and the waiting flags | done | Verified with the API taken down and brought back: offline rename + note line survived a reload and reached the server; a reset board stayed clean (`docs/evidence/2026-11-03_offline/`). `offline.test.ts` (3). Run in the packaged Windows app too (2026-11-07): the server taken down, the board reopened from the device copy, and it reconnected by itself (`docs/evidence/2026-11-07_desktop-windows/`) |
| **Roles** (2026-11-03, phase 1) | **Viewers read; they can't change a board.** A person's role on a board is what an admin set for that board (side pane → People on this board: Can edit / View only / the account's role), else their account's (admin, member, or viewer for a flowform viewer let in by `FLOWFORM_ADMIT_VIEWERS`). Enforced on the server: the sync socket drops a viewer's updates (they still get the board and send presence); `runTool` refuses all but read-only tools, which covers HTTP tools, MCP and the agent (it's told the person is view-only); the HTTP gate refuses a viewer's other writes. A role change closes their socket and their tab re-reads it, so it applies at once. In the app, a View only pill, editing controls hidden, and any local edit snaps back with a notice | done | Invariant tests: `roles.test.ts` (4). Browser: an admin made a member view-only live; their rename snapped back, `add_note` and an upload got 403, `read_board` worked; reversed live (`docs/evidence/2026-11-03_viewer-role/`) |
| | **Tables two people can edit** (2026-11-03, phase 1): each table's cells are their own shared map, so an edit writes only the cells it changed and someone editing another cell keeps theirs | done | Two browsers writing different cells within 8 ms converged (`docs/evidence/2026-11-03_table-cells/`); `tables.test.ts` (3) covers both writing blind |
| | **Notes two people can write in** (2026-11-03, phase 1): every keystroke goes out as it's typed, as the smallest edit to the note's `Y.Text`, rebased past anything that arrived while it was typed (`rebaseEdit`); someone else's words land in an open editor without moving the caret. Agents' `update_card` writes the smallest edit too, so a person typing keeps their words | done | Two browsers typing at opposite ends of one note converged, carets kept (`docs/evidence/2026-11-03_live-notes/`); `notes.test.ts` (5). Esc no longer reverts a note (the words were already shared) |
| | **Writing together** (2026-11-07): in an open note you see where others are writing (their caret and selection, in their colour, named while it moves) as Yjs relative positions on awareness; a closed note names who's writing in it. ⌘Z / ⇧⌘Z (and the app menu's Edit → Undo) take back only your own typing, through a per-note `Y.UndoManager` | done | Ada's ⌘Z removed her line and left Kai's in both browsers; redo put it back; carets and the chip seen in both (`docs/evidence/2026-11-07_together-notes/`, `#/design` day and night) |
| **Files** | Upload anything with progress; images and video show instantly, then swap to the shared URL; range streaming; archive-never-delete | done | |
| | CAD cards (the part in 3D, size, download, Send to Vision) | done | See Vision loop |
| **Search** | ⌘K and the search pane (⌘F): board cards, files (full text and CAD headers), apps, GitHub (token or `gh`), Slack (`search.messages` with a user token) | done (Slack untested) | Local results in ms, remote with a 2.5 s cap. Stemming removed for prefixes |
| **Panels** | Live app/link/machine frames | done | Mount only on screen at ≥0.3 zoom, poster otherwise. Click to engage, Esc to release. Frame policy probed |
| | Repo drawer (README, commits), MCP badge, ports, drag-to-connect wires, postMessage bridge | done | Bridge not yet exercised by a real app (§7) |
| **Agent layer** | Port wires (faint, bright with A), agent rings from presence and running cards, activity feed | done | |
| **Agent** | Session tabs (below) replace the ⌘J dock: streaming steps, runtime picker, voice (Web Speech: the mic fills the composer and sends when you stop) | done | Voice not exercised with a real voice (headless) |
| | Subscription runtime (Claude Code + Foundation MCP, resumable sessions) | done | Verified: wrote a note and focused it |
| | API runtime (Opus 5.5, adaptive thinking, manual tool loop) | partial | Code done, untested (no `ANTHROPIC_API_KEY` here) |
| **MCP** | `/mcp?board=…`, 19 board tools, `⌘K → Connect Claude Code` copies the `claude mcp add` command | done | |
| **Company board** | Six live connectors wired by real flows | done | 2026-11-02: FactoryForm, Creation (+ Hub), Vision, Data Room and Foundation all Live locally; FactoryForm pushed live (SSE relay → cards refetch), floor shown as a station strip + open alerts, provenance stated ("prototype: stations demo · 40 units imported (snapshot 2026-07-07)"). BomForm reads the Data Room's copy (§6.5) — Live, labelled "copy · 58d old" because the Data Room's sync stopped on Sep 5 |
| | (previous note) | | FactoryForm answered from :3001. Vision found T3 and the Archive up. BomForm offline until keyed (§6) |
| **Hermes** | Ask cards, drop-to-answer, 4-hourly nudges on the board, Slack DM with a bot token | partial | Slack path untested |
| **REA** | `reverse_engineer` tool queues a job card. A person presses Run; it runs `rea-agents` (local apps) or Claude Code with REA's MCP | partial | Not run in this session: the tool downloads and runs third-party code, so a person should run `npx rea-agents setup` first (§6) |
| **Vision** | Vision Code (T3) threads listed in the side pane and replayed in a tab, read from T3's own store | done | |
| **Vision loop** (Phase 2, 2026-11-03) | `vision_brief` and the pipeline's Concept/Simulate hand-offs write the brief and a hand-off card. A person presses Run, and a **Supervised** Vision Code thread starts on the brief (a 10-minute T3 session, minted with T3's CLI, used on its `/ws` for `thread.turn.start`, then revoked). The thread puts its work in the hand-off's `exports/`, and Foundation archives what lands and puts it beside the brief. Once the thread settles with something to show, the reviewers are asked | done | `test/vision.test.ts` (3) against a stand-in T3. One real hand-off to Vision Code: the thread started, read the brief and waited on approval; the session was revoked. An export from a real thread is not yet seen (it waits on that approval). `docs/evidence/2026-11-03_vision-loop/` |
| | **CAD on a card**: STEP/IGES through OpenCascade (`occt-import-js`, as Vision's ModelForm), and STL/OBJ/GLB through three.js. Rendered once to a still with size and triangle count, turned by dragging (one live viewer at a time) | done | Vision's vane-board STEP: 150 × 54 × 40 mm, 2,184 triangles. `e2e/cad.spec.ts`, day and night. OpenCascade's wasm (~10 MB) loads only when a B-rep card shows |
| **Presentation** | P: chrome fades, camera glides section to section, infinite looping filmstrip with drag/wheel inertia | done | |
| **Login** | The ASCII wind with no card and no frame: it knows each element on the page, parts around it and traces its outline in faintly lit glyphs (text by its words, controls by their rounded boxes), and the one under the pointer or holding focus lights up. A grey eyebrow, the title, and a light **Connect with Google** pill on springs, with the email sign-in folded behind "Use your email". Always day colours. The outlines come up top to bottom on arrival; typing, presses and errors stir the wind; signing in dissolves outward into the board once it has loaded behind the page (also on arrival back from flowform, `?arrive`). The wind runs at the display's rate (60 fps measured, 2026-11-07, §5) | done (`docs/evidence/2026-11-03_sign-in-frame/`; per-element outlines `docs/evidence/2026-11-07_sign-in-shapes/`; pacing `docs/evidence/2026-11-07_frames/`) | The Details original ("ASCII Cursor 2.0", WebGL2) plus Foundation hooks (`root.asciiWind`: tap, stir, shapes, dissolve, drawNow, state; and the `quiet` option). `#/design/sign-in` previews it while signed in. Without WebGL2, or under reduced motion / high contrast, it's the same form on plain paper with a mask-only dissolve |
| **Design** | `#/design` living page; DESIGN.md | done | |
| **Plan board** (2026-11-07) | The plan as a kanban: `docs/plan.json` (71 cards: bugs and plans from §7 and the old §8 phases, hookups from §6), `scripts/plan.mjs` keeps it in step with GitHub issues (push, pull, a Projects board), and **Settings** (`#/settings`, new) shows it: six columns, filters, search, cards that open in place; admins drag cards between columns (`POST /api/plan/cards/:id`, a person's session only), which writes the file and marks the card until it's pushed. Settings also has **Services** (what this server is connected to). The side pane's "The plan" opens it | partial: the board and moves done; **not yet on GitHub** | Browser at 1440 and 400 px, day and night: 71 cards, a card moved Next → Doing by an admin, the file written, the card marked (`docs/evidence/2026-11-07_plan-board/`). `test/plan.test.ts` (server 3, client 3). Pushing to GitHub was held back: issues are off on the public fork, and publishing there is Josh's call (top of this file) |
| **Release & plan** (2026-11-03) | A side-pane group: **App floorplan** opens a map of Foundation's own code (`/floorplan.html`: every part, all 126 code files and the links between them, named and described in plain words, with a Start-here tour and three flows: two people editing, an agent turn, a part from brief to release), and **The plan** opens the plan board (Settings → Plan; it opened §8 on GitHub until 2026-11-07). Made with the floorplan plugin and exported without the Ask bar, machine paths or the health list (the repo is public) | done | Opened from the side pane in a real browser, day and night (`docs/evidence/2026-11-03_floorplan/`). A snapshot: refresh it after a release (`docs/floorplan.md`) |
| **Desktop** | `npm run desktop` (dev: the window shows Vite on :1430). Packaged (`npm run tauri build`): the app serves its own page from http://localhost:31440 (`tauri-plugin-localhost`), so a server on http://localhost:4410 is the same site and its cookie, sync socket and SSE work unchanged; one copy at a time (a second launch shows the open window); a plain message if the port is taken. `.env.desktop` sets the server | partial | **Windows, 2026-11-07** (Windows 11, WebView2 157): dev window signed in and live; packaged build makes an NSIS `setup.exe` (6.2 MB) and an `.msi` (7.4 MB), and its exe, from a cleared profile, signed in through the form, synced live, reopened the board from the device's copy with the server down and reconnected by itself when it came back (`docs/evidence/2026-11-07_desktop-windows/`, driven over WebView2's DevTools port by `scripts/desktop-probe.mjs`). The installers weren't run, and nothing is signed. Linux (WebKitGTK under Xvfb, 2026-11-07): dev window (`docs/evidence/2026-11-07_desktop-linux/`). The macOS build wasn't rebuilt. The packaged app needs a local server: a hosted one is cross-site (§7) |
| **Grid feel** (2026-11-02) | ~~Magnetic snapping~~ (replaced by keyboard-only framing, see Chrome on call). Safe-area framing clear of the side pane and search pill. Sections frame their cards (sparse sections at ~105% instead of ~55%). Trackpad pinch 1:1, two-finger pan everywhere. Keys 0 / ⇧1 / F / ⇧2 / 1 / + / −, Space-drag. Live zoom % in the HUD. Cards lift and lean when dragged | done | `docs/evidence/2026-11-02_grid-feel/`. Not yet measured on a real trackpad (headless only) |
| **Flow wires** (2026-11-02) | Vision's flow-diagram rules on app and pipeline wires: 45° roads with straight leads, back-routes through the gap, parallel lanes, stable over/under tunnels, typed tones, port pill intakes with a landing per wire, hover tooltips with live values, select + ⌫, magnetic drag with compatible-port highlighting, grab-to-re-route | done | `docs/evidence/2026-11-02_flow-wires/`, `apps/client/test/wires.test.ts`. Table→map and formula wires follow the same rules, and over/under is decided across both layers (shell/routeRegistry.ts). Wires route round every card in their way (routeAvoiding) — measured: 0 of 12 company-board wires cross a card |
| **Design pipelines** (2026-11-02) | Brief → Concept → CAD → Simulate → Review → Release as six wired stage panels in their own section | done (Vision run is manual) | `docs/evidence/2026-11-02_design-pipeline/`, `apps/server/test/pipeline.test.ts` |
| | Stages: status (waiting / active / done), owner, editable brief, artifacts (renders, STEP measured on arrival, results, decisions), self-ticking checklist where the evidence is clear, ★ to choose what goes forward | done | |
| | Hand-offs (`stage_request`): CAD asks the owner via Hermes and the STEP lands back on the stage. Concept and Simulate write a Vision brief from the stage (chosen concept; CAD size + analysis/loads/target). Review asks every reviewer | done | Vision still runs by hand; phase 2 starts T3 threads |
| | Complete → output goes down the wire and the next stage opens. "Request changes" at Review reopens CAD and Simulate. Agents drive all of it through the same tools; ⌘K "Start a design pipeline: …" | done | |
| | Release → BomForm | stub | Completes the stage; nothing is written to BomForm yet |
| **The floor** (2026-11-02, Josh: the left pane drawn on the grid's dot layer, tabs at the top, T3-style sessions that work on the grid, search on the right with drag-to-grid, resizable panes) | The top bar, side pane, an open session and search are drawn on the paper; the cards are masked out where they are (56 px fade) and the view slides over by half a pane as one opens, so nothing hides under them; framing fits what's left. Every pane resizes from its inner edge; widths, open tabs and the open panes are remembered | done | `docs/evidence/2026-11-02_floor/`. The mask needs its own compositor layer (NOTES.md) |
| | **Top bar**: fold · tabs (the board, then sessions; ⌘1 board, ⌘2…9, ⌘W) · ＋ new session (⌘J) · people · search ⌘F · commands ⌘K · agent layer · present | done | |
| | **Turns outlive the page** (2026-11-03): a run lives on the server, keeps its events and saves its transcript as it goes; the page follows it by run id. Reload or close mid-turn and the turn carries on; reopening the tab replays it and follows live. Stop ends the run on the server (`POST /api/agent/runs/:id/stop`, status `stopped`). Runs a restarted server left "running" are marked as errors at boot | done | Verified: reloaded at 0/3, reattached at 1/3, finished 3/3; Stop recorded `stopped` (`docs/evidence/2026-11-03_live-notes/`) |
| | **The floor gives way**: on load, on resize, and when a session or search opens, if the open paper would drop under 440 px the side pane folds, then search closes. Opening a pane by hand still opens it | done | |
| | **Agent sessions**: each tab is its own conversation (`session` on `/api/agent`; runs keep `session_id` and the Claude Code session, so a tab resumes after a reload or a server restart). The tab shows the goal and steps the agent keeps with the new `set_plan` tool, every tool step (↗ frames the card it names), and rings the cards it touched on the grid. A run keeps streaming while its tab is in the background | done | Verified with one real subscription turn: plan 0/3 → 3/3, section + two notes made, step ↗ framed the note, rings on all three. `apps/server/test/sessions.test.ts` |
| | **Vision Code threads** in the side pane and as read-only tabs: messages, reasoning, tool steps (last state per call), proposed plan, status (running / waiting on you / error), "Open in Vision Code ↗". Read from `<T3CODE_HOME>/userdata/state.sqlite`, read-only — no token, nothing written | partial | Read path verified against Josh's 100 threads. Replying happens in Vision Code. The link opens T3's web UI, which wants its own sign-in outside the Vision app |
| | **Search pane** (⌘F, right): filters with counts, images as tiles, recent files + apps before typing. Press opens (as ⌘K); drag places the card floating where it's dropped, the section under the pointer ringed | done | Verified: dragged a STEP result into a section. Board results already on the board frame instead of copying |
| **Chrome on call** (2026-11-02) | No top capsule, no logo, no grid reticle. A collapsible side pane (⌘\, remembered) holds boards, tools, activity and settings; a small search pill + zoom at the bottom opens ⌘K. The camera rests wherever pan / pinch / wheel leave it; only the keyboard (0, F, ⇧1/⇧2, arrows) snaps to framings; double-click zooms in on the card or section under the pointer (once framed, the double-click goes through to edit), or 2× on empty paper | done | `docs/evidence/2026-11-02_chrome-on-call/`. Checked: a throw comes to rest at its own position (no snap) |
| | Cards rest without a bar; a glass bar drops in on hover. Images and video have no bar: mute / remove icons slide out from behind the card, the card is the drag handle, a tap plays/pauses video. Pipeline stages name themselves in their body | done | Tables and maps keep their own headers |
| | Sections: track lines and gutters only where they divide sections — seams inside a merged section are invisible until hovered. Drag a section past any board edge to append it along that whole side (new track, sized like the section, capped at a normal track); its hole is absorbed by an aligned neighbour | done | Checked in the browser: dropped below the board → full-width row, pipeline section widened into the hole |
| | **Sections host apps** (schema 2). An app fills its section; the section header is the app's; ports sit on the section's edges; wires run section to section and treat every other section as an obstacle. The company board migrated to one section per app. An app opened into an empty section (people or `add_panel`) is hosted; "Show as a card" / "Let it fill the section" toggles | done | Gaps between sections widened to 40 px so wires have a road |
| | App sections use all four edges: each wire lands on the edge facing the other app (wider gap wins; symmetric), centred on the stretch the two share — neighbours join by one straight segment across the gap, offset apps by one long diagonal. Unwired ports wait on the sides. Short hops hide their label until hover | done | Company board: 14 landings on all four sides, 24/24 wire ends at 0.00 px. `wires.test.ts` (15). `#/design` → Effects → App sections |
| | Wires: turns are long 45° runs (up to 480 px a side, shortened where they'd enter a card) instead of 14 px chamfers; a height change with room ahead is one diagonal. Port pills centred exactly on the wire's landing (was 1–2 px off: the section border wasn't counted) | done | Measured: 24 of 24 wire ends at 0.00 px from their pill centre. `wires.test.ts` (13) |
| | **Wire roads, 2026-11-03** (Josh: "the connection in the rim drive is … loose"; longer 45° runs, rounded corners). A wire with both ends in one section is seen through that section's body: clipped to it, steered round that section's cards and walls only (except a wall one of its own cards is scrolled behind), so a wire to a card scrolled out of view stops at the edge instead of looping across the grid. A turn hemmed in by a card takes the longest diagonal that clears it (it used to halve), and a corner takes the part of a run its neighbour can't use. Bends are arcs (radius 20, kept within half a run) | done | `docs/evidence/2026-11-03_wire-roads/`. Rim-drive fan v3: CAD → Simulate went from 34/166/47/24 px diagonals and a loop outside the section to 24/202 px, inside the body. Scrolled to CAD: 57/176/57. `wires.test.ts` (18). Day and night |
| **Hover chrome pass** (2026-11-02) | Image/video buttons reachable: a ghost rail bridges the 8 px gap between the card and its icons (before, crossing it dropped the hover and the icons slid away), and every hover chrome lingers 140–180 ms after the pointer leaves. Section header has no bar: name, coords and count sit on the section's paper; tools wait in a ghost toolbar top-right, only while the pointer is on the section, grouped add (app ⌘L, table, map, note, upload ⌘U) · arrange (split ◫ ⬓, fill ⤢) · agent ✦ ⌘J · remove; an app section's repo/MCP/open/show-as-card lead it. Every chrome button names itself on roll-over (one screen-space label, `shell/Tip.tsx`, `data-tip`/`data-kbd`). Flicker: no `backdrop-filter` left inside the zoomed world (card bars and media icons were blurred per card), the section selection ring fades on `::after` instead of transitioning a whole section's `box-shadow` and border, and toolbar buttons no longer spring-scale on hover. Radii quieter: paper 3 · card 5 · pane 8 (was 4 · 8 · 14); hard-coded 4–8 px radii moved onto tokens | done | `docs/evidence/2026-11-02_section-chrome/`. Measured: the pointer in the old gap now hits the rail (`.frame-icons`), the card keeps hover, icons stay at 36 px; selecting a section starts 2 opacity fades (was 10 border/shadow transitions + a toolbar fade); 0 in-world `backdrop-filter`s. Day and night checked; flicker itself judged by measurement, not by eye on a real display |
| **Machines** (2026-11-07) | A section holds a Linux machine or container on this computer's engine, **Kiri or Docker**, over the Docker Engine API both serve (`apps/server/src/machines.ts`; the engine's socket, a named pipe on Windows). Right-click → **Start a machine here**, or an agent's `propose_machine`. On the card: pick a distro (Kiri's seven), an image the engine has, or a saved image from the archive (**Load**, `docker load`); **Start** (a person) pulls with progress and runs it confined (no host mounts, not privileged, ports on 127.0.0.1, 2 GB / 2 CPUs / 1024 processes by default). Running: a terminal (xterm.js) shared by everyone on the board, editors type and viewers watch, the screen replayed to late joiners, reconnecting by itself; ports as pills that open the port as a page in a section beside it. Stop keeps the disk; Remove asks twice and sends `confirm`. The card mirrors the engine (a machine removed outside Foundation shows Not started; one whose engine has stopped answering shows **Out of reach**, its disk kept). Containers are Kiri's `machine-<name>` with `dev.kiri.machine`, so `kiri machine shell <name>` reaches them. **Kiri is part of the build** (2026-11-07): `npm run kiri:install` (`scripts/kiri.mjs`) downloads the pinned Kiri release (0.1.18), checks its SHA-256 against the release's `SHA256SUMS`, and on Windows installs it per user (no administrator) with Kiri's own Linux imported into WSL 2 as `kiri`, then starts it. Elsewhere it checks the download and prints the one install command. `npm run dev` / `npm run desktop` start Kiri if it's installed. Kiri comes first: installed but asleep, the card says **Kiri · asleep**, and a person's Start, Stop, Restart or Remove wakes it (`wakeKiri`) | done on Kiri and Docker | `machines.test.ts` (9, stand-in engine: an engine that stops answering leaves its machines Out of reach, not removed; Kiri found where its installer puts it). `npm run machines:smoke` against Docker Desktop 28.3 and **Kiri 0.1.18** on Windows (`docs/evidence/2026-11-07_kiri/smoke-kiri.txt`: start 2 s, the shared terminal, stop and start again in 151 ms with the disk kept, remove). In the browser on Kiri: Start from asleep woke Kiri and ran alpine in about 1.5 s. Inside, `Alpine Linux v3.22 on …-microsoft-standard-WSL2`, a port served from the machine answered on 127.0.0.1 and was refused on the Wi-Fi and WSL addresses, and the cgroup held the caps. With Kiri quit, the card said Out of reach; Start brought back the same container, and Remove (twice) woke Kiri and left it empty (`docs/evidence/2026-11-07_kiri/`, and `…_machines/` for Docker and two people). The macOS and Linux paths of `kiri.mjs` haven't been run |
| **The crew** (2026-11-07, §0.3) | Agents you can see. Every agent turn joins the board with a generated name (winds, birds, stones, stars), one of six violet colours and its own cursor (`apps/server/src/crew.ts`, `shell/Crew.tsx`). The cursor glides to what the agent is about to change and waits a beat before the change lands (creations aim at the section's next free slot), and says in a few words what it's doing. Writes are signed with its name. New tools: `add_table` (a table filled with data), `rename_section`, `arrange_section` (orders a section's flow), `bring_view` (brings the asker there: moved if idle, asked first if busy, Back returns) and `call_in_help` (a helper with its own name, run and session: two per ask, none from a helper, six per board). **Hold Space** anywhere and a sheet rises from the bottom: the mic's level, the words as heard, the crew at work with Open and Stop. Let go and it sends, without opening a tab; a tap of Space types instead; a pointer pressed while Space is held is a pan. A failed ask says why in a toast, in the agent's name | done; three real model turns | `crew.test.ts` (8): distinct names and presences, aim before the write, signed activity, `bring_view` only for the asker, helper caps, a viewer's agent refused, arrange keeps times, MCP crew id bound to its person and board, no presence left after a run. `e2e/crew.spec.ts` (5), two people in Chromium: Kai saw the cursor inside the section 0.5–2.5 s before each card landed; Ada was brought, Kai wasn't moved, Back restored Ada to within 2 px; busy, Ada was asked first; Stop stopped it; no cursor left on either screen; `#/design` day and night (`docs/evidence/2026-11-07_crew/`). **Real Claude Code turns** (after `claude auth login`, §6 #4), asked from the sheet on a real server with no script. Swift made Supply chain (table, note, FactoryForm wired) and brought Josh there in 29 s. Twice, an Ops review ask: a lead and a helper each worked under their own cursor, and Josh was brought there in 39–44 s. The run surfaced five faults, all fixed with tests (§7): a connector hooked up first hid the cards after it; note tables showed as pipes; wire labels showed port ids; a helper's brief was logged as the person's ask; arrange named the section by id. `crew.test.ts` now has 10 tests, plus `test/markdown.test.ts` (3) |
| **Huddles** (2026-11-02) | Right-click a section → **Start a huddle here**: a video portal lands where you clicked. **Join** sends camera + mic (WebRTC mesh, perfect negotiation, server relays signalling only). Anyone with the portal on screen sees the people in it (receive-only, *Listen in* for sound). Mute, camera off, leave, and a call chip in the corner that carries the sound and follows you round the board | done (two people, headless test camera) | `docs/evidence/2026-11-02_huddles-slack/` 01–04: two signed-in people, each receiving the other's 640×360 video + audio track (readyState 4). `?fakecam` draws a test camera; a real camera wasn't available headless |
| | Transcript: each joined browser transcribes its own mic (Web Speech) into speaker-attributed lines; interim words show as live captions (never stored); typed notes join the transcript. **Record** (anyone in it): every participant's browser records itself and uploads to the archive. **Archive**: sessions with people, duration, recordings, transcript; ✦ Summarize (agent, via `huddle_transcript`); Post notes to Slack. Transcripts are searchable in ⌘K | partial | Typed lines, recording (2 × 33 s clips, both decode) and the archive verified in the browser. **Speech transcription not exercised**: the headless test camera has no voice, so no speech lines |
| **Slack channels** (2026-11-02) | Right-click → **Add a Slack channel**: pick a channel, read it (polled 5 s while on screen, one shared read), post as "Name via Foundation" (joins a public channel on `not_in_channel`). **↗ Link a place**: sends a deep link to the whole board, a section, or any card. **◐ Invite to a huddle**: the channel's huddle, else the section's, else a new one beside the card. A section's right-click sends any channel on the board a link to it. `?focus=` links frame their target on open | done against a stand-in Slack | `docs/evidence/…` 07–10 and `huddle.test.ts`. **Never run against real Slack**: no `SLACK_BOT_TOKEN` here (§6.7). Without one the card says "Slack isn't connected" and how to fix it |
| **Interface pass 1** (2026-11-02) | Connector status pills and offline states. Foundation's own live counts. Backward wires loop through the gap between rows. Empty sections offer open/drop/ask/note and a company app shelf. Panels opened from the shelf carry the registry's repo and MCP. Section headers with a card count (bar removed in the hover chrome pass). Glass pill HUD. Presentation title scrim, HUD hidden. Capsule truly centred. The grid can't be scrolled by focus. My avatar shown once | done | Evidence in `docs/evidence/2026-11-02_interface-pass/` |

### 3.1 flowform → Foundation port map

| flowform | Foundation | |
|---|---|---|
| Google OAuth + allowlist, hashed bearers, 30-day sessions | `auth.ts`, `flowform.ts` | federated: the same Google login on the same server (`/auth/google/start?cb=<loopback>`). Cookie + Bearer; Foundation's tokens never go in URLs |
| Yjs rooms, durable log, compaction, presence | `boards.ts`, standard y-protocols wire (not the custom bincode one) | ported |
| Server-side agent writes, `request_id` idempotency, confirm-token deletes, visible agent presence | `tools.ts` | ported |
| MCP endpoint over the canvas | `mcp.ts` (19 tools) | ported, extended |
| Media archive-never-delete; content-addressed bytes | `files.ts` | ported (local disk; S3 later) |
| File search (BM25 FTS) | `search.ts` | ported (lexical). Semantic (e5/SigLIP + RRF k=60) deferred |
| Slack search | `search.messages` with a user token | simplified. flowform's per-user OAuth + mirrored visibility is the target (§8) |
| Messaging (DMs, channels, threads) | — | deferred: the board's activity + asks cover v0; Slack stays the chat |
| Code tab (T3 gateway, Codex/Claude Code) | Session tabs (subscription runtime, goals + steps); Vision Code threads read-only in the side pane | partial |
| LOD, media residency, viewport culling, iframe snapshots | zoom-gated frames, IO-mounted panels, idle shader, memoised layout | partial (§5) |
| Gantt / Timeline & tasks | — | **dropped** (as asked) |
| Digital twin (factory sim, Kapaʻa 3D, mechanical/electrical benches, deployments, demo scenes) | — | **dropped** (as asked). FactoryForm owns the twin |
| Rooms, room_members, room media (S3) | `flowform-import.ts`, `members.ts`, `files.ts` | imported from Flowform's data backup, re-runnable (`docs/flowform-import.md`). Groups, card arrows, dataflow wires, directives, floor plans, camera feeds and board jumps are counted, not carried |
| Admin (users, audit, crashes, maintenance) | — | deferred |

---

## 4. The board tool surface

One definition (`apps/server/src/tools.ts`), three doors: the built-in agent, `/mcp`, and `POST /api/boards/:id/tools/:name`.

| Category | Tools |
|---|---|
| Reading | `read_board`, `search`, `company`, `read_file`, `read_repo`, `find_repo`, `app_tools` |
| Organizing | `add_section`, `rename_section`, `add_note`, `add_table` (with data), `update_card`, `arrange_section` (a section's flow order), `delete_card` (confirm), `focus`, `set_plan` (the goal and steps a session tab shows; writes nothing) |
| The crew | `bring_view` (brings the person who asked to a section or card: their view glides there, or they're asked first if busy; read-only), `call_in_help` (a helper agent for an independent part of the ask: its own name, cursor, run and session; two per ask, none from a helper, six agents per board). Every Foundation run is a crew member: its tool calls carry its id (`ToolCtx.crew`, MCP `&crew=`), aim its cursor first and sign its writes |
| Apps | `add_panel` (app, link, machine, connector, agent), `connect`, `send_to_port`, `call_app_tool` |
| People and studios | `ask_person` (Hermes), `vision_brief`, `reverse_engineer` (REA, person-run) |
| Machines | `propose_machine` (a card waiting for a person's Start), `machines` (read: engines, state, ports as URLs, the last screen of each shared terminal). Start, stop, restart, remove and load are a person's, from the card |
| Huddles and Slack | `open_huddle`, `huddle_transcript` (read), `add_slack_channel`, `slack_read`. Agents read Slack; posting stays with people on the card |
| Design pipelines | `start_design_pipeline`, `pipeline_status`, `stage_attach`, `stage_choose`, `stage_check`, `stage_settings`, `stage_request` (hand-off), `complete_stage` (Review: approved / changes) |

**Invariants**, from flowform and tested in `apps/server/test`:
- Every write names its board.
- `request_id` makes a write idempotent.
- Deletes need `confirm: true`.
- Every write lands in `activity` and moves the agent's presence ring.
- Nothing that spends money or runs third-party code starts without a person.
- A viewer can't change a board: not through its sync socket, a tool (HTTP, MCP, the agent) or any other write (`roles.test.ts`).

---

## 5. Performance budget

| Surface | Budget | How |
|---|---|---|
| Pan, zoom, drag | 60 fps, no React render on the hot path | Springs write `transform` directly (`physics/spring.ts`). Sync diffs by object identity, so a drag touches one key |
| Grid paper | ≤ 2 draws/s while still | `gl/background.ts` draws only when a uniform changes or the 2 Hz grain ticks (was 60/s) |
| Overlays (wires, rings) | Read-only per frame | `sectionLayout` memoised per state snapshot. DOM written only when a path changes |
| Live frames | ≤ the frames on screen | IntersectionObserver plus zoom ≥ 0.3 gate; posters otherwise; pointer events only when engaged |
| Connectors | Poll only while visible | 20 s while on screen; server cache 20 s |
| Search | Local < 20 ms; remote ≤ 2.5 s | FTS5 with prefix indexes; remote sources raced against a timeout |
| ASCII wind | 60 fps (every display frame); < 5 ms/frame | WebGL2, two draws a frame on every display frame (2026-11-07; was 25 fps on a timer). Backs off to 30, then 15 fps, then suspends only when *its own* work is behind (the GPU hasn't finished a frame three frames on, or draws cost the main thread > 4 ms), and steps back up after 180 frames of keeping up (6 s at 30 fps); the page's own busy frames no longer count against it. Page hooks draw on the next frame, once. Paused when hidden or unfocused; settles after 3 min until touched |
| Every surface, on a real GPU | p95 frame ≤ 16.7 ms × 1.25, ≤ 5 % of frames over | `e2e/frames.spec.ts` (`PERF_GPU=1`): headed Edge (WebView2's engine) on the machine's GPU at 2×, page frames (rAF), Long Animation Frames, and the wind's own draws. The board's first load behind the sign-in is reported, not held to it (§7) |

**Measured** (2026-11-03, `e2e/perf.spec.ts`; 180 notes + 20 live frames, headless Chromium with software WebGL, so upper bounds; `docs/evidence/2026-11-03_perf/`):

| Action | p50 | p95 | Longest | Frames > 33 ms | Long tasks |
|---|---|---|---|---|---|
| Pan | 16.7 ms | 16.8 ms | 33.4 ms | 2 of 712 | 1 |
| Pinch zoom | 16.7 ms | 33.4 ms | 33.5 ms | 30 of 664 | 0 |
| Drag a card | 16.7 ms | 16.8 ms | 99.9 ms | 3 of 294 | 2 |
| Pan with 8 live frames running | 16.7 ms | 33.4 ms | 50.1 ms | 38 of 678 | 0 |

Pan and drag hold 60 fps. Live frames and zoom drop about 5 % of frames to 30 fps. ~~Picking up a docked card has one ~100 ms frame~~: that frame was React re-rendering every section and card on each press, not the relayout. Sections and apps now subscribe to their own slice of the store (`useSection`, links-only `usePortLayout`), so a press renders 1–2 cards instead of 38. Measured on a slower cloud box, the drag's longest frame fell from 250 ms to 67 ms (`docs/evidence/2026-11-07_perf-renders/`). Re-run `perf.spec.ts` on the Mac to refresh this table. Next: measure on a real GPU and trackpad, then decide between pausing frames while the camera moves (a still in their place) and leaving them live.

**Measured on a real GPU** (2026-11-07, `PERF_GPU=1 npm run e2e -w @foundation/client -- frames`; Windows 11, RTX 5080, 60 Hz, Edge 157 headed, 2× pixels; the same 200-card board; `docs/evidence/2026-11-07_frames/`). The sign-in was never measured before: headless Chromium is SwiftShader, and the wind refuses software renderers.

| Surface | Before (dev server) | After, dev server | After, production build, 1440×900 | After, production build, 2560×1400 |
|---|---|---|---|---|
| Sign-in wind at rest / stirred / pressed / typed into | **10 / 10 / 10 / 1 fps** (page 60) | 60 / 60 / 60 / 60 fps | 60 / 60 / 60 / 60 fps | 60 / 60 / 60 / 60 fps |
| Sign-in dissolving into the board | p95 66.7 ms, 9 % of frames over (with the board's load; measured apart after) | p95 16.7 ms, 0 over | p95 16.8 ms, 0 over | p95 16.7 ms, 0 over |
| Side pane, search, ⌘K open and close | p95 49.9 ms, **28 % over**, one 388 ms task | p95 16.8 ms, 2.6 % over | p95 16.7 ms, 0 over | p95 16.7 ms, 0.8 % over |
| Pan / pinch zoom | 0.1 % / 0.3 % over | 0.1 % / 0.3 % over | 0 / 0 over | 0 / 0 over |
| Drag a card | 0.6 % over, longest 133 ms | 1.2 % over, longest 815 ms (once, in the test page's iframe) | 0 over, longest 16.8 ms | 0 over, longest 19.1 ms |
| Pan with 20 live frames | 0 over | 0.5 % over | 0 over | 0 over |
| Framing glides (0, ⇧1, F) | 2.7 % over | 1.8 % over | 0 over | 1.9 % over, longest 33 ms |
| First wind frame after navigation | — | 1.5–2.4 s (Vite's dev modules) | 0.9–1.1 s | 1.3 s |

What it was: **(1)** the wind drew at 25 fps on a timer, and a burst of page work at boot (React mounting, shaders linking) dropped it to a 12 fps backoff it never left, then suspended it (it faded out) at the next burst, so on this machine it ran at 10 fps and vanished while typing. **(2)** `publishCamera` read the viewport's rect on every camera frame, forcing a layout of the whole board each frame (≈ 390 ms of a pane opening on 200 cards); it's now measured on resize. **(3)** The floor's edges were inherited custom properties transitioning on `.grid-viewport`, so every card restyled on each frame of a pane opening; they're now non-inherited and set on `.world-mask` alone. **(4)** The dissolve now waits for the board to be live and the page to draw on time before it starts (the wind keeps turning meanwhile). Also: the wind reveals in 1.6 s (was 4 s, which read as a slow load). Next: a slower GPU (the integrated Radeon here, a MacBook Air) and a real trackpad.

---

## 6. Hookups a person needs to do

Every integration is off until its key exists; the server always starts. Copy `.env.example` to `.env`.

| # | Hookup | Why | How |
|---|---|---|---|
| 1 | **Repo visibility** | `joshleong/Foundation` is **public**; company plans and connector names are in it | Make it private, or move it to the Form Industries org |
| 2 | **Google sign-in** | Real accounts | Works out of the box through flowform-server (`FLOWFORM_URL`). flowform's client secret stays in AWS SSM; Foundation never needs it. Set `FOUNDATION_DEV_LOGIN=0` in shared deployments. A hosted Foundation that isn't on loopback needs flowform's `native_loopback_callback` widened, or its own `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| 3 | **Allowlist** | Who can enter | `FOUNDATION_ALLOWLIST=@formindustries.com,@normallab.co,…` |
| 4 | **Anthropic API credits** | API runtime | `ANTHROPIC_API_KEY`. The subscription runtime needs only `claude` installed and signed in. On Josh's Windows machine (2026-11-07) Claude Code's own sign-in had expired ("OAuth session expired and could not be refreshed"). Signing in to the Claude desktop app doesn't sign in the CLI: `claude auth status` said `loggedIn: false` until **`claude auth login`** was run in a terminal. Since then real crew turns run |
| 5 | **BomForm** | The connector | Now reads the **Airform Data Room's daily copy** through its read-only `GET /api/foundation/bomform` digest (branch `foundation-bomform-read` in AirformDataRoom): set `FOUNDATION_READ_TOKEN` there and `DATAROOM_BOMFORM_URL` + `DATAROOM_READ_TOKEN` here. Locally the launcher runs that branch's worktree on :3010 (`node scripts/sibling.mjs dataroom AirformDataRoom-foundation`). **For production:** merge the branch, set the token on Vercel, deploy, and point `DATAROOM_BOMFORM_URL` at airformdata.com. **The copy is stale:** last synced 2026-09-05; the Data Room's daily sync has stopped (check `BOMFORM_API_KEY` / `CRON_SECRET` on Vercel). A direct BomForm key (`BOMFORM_MCP_URL` + `BOMFORM_API_KEY` + `NODE_EXTRA_CA_CERTS`) still takes precedence when present |
| 6 | **FactoryForm, Creation** | Live factory data; the studio and its Hub | `npm run services` starts FactoryForm (:3001), Creation (:5173 — its own config says 1420, Vision's port) and the Creation Hub (:4317) from the sibling folders (or `FOUNDATION_SIBLINGS`); each is also a launch config. FactoryForm is followed live through its `/api/events` stream. For FactoryForm writes over MCP, `FACTORY_MCP_TOKEN` |
| 7 | **Slack** | Channel cards, links, huddle invites, Hermes DMs, search | Create the app from **`docs/slack-app-manifest.yml`** (api.slack.com/apps → From a manifest), install it, and set the bot token as `SLACK_BOT_TOKEN`. That covers channel cards (read, post as the person, links, invites, huddle notes) and Hermes DMs. For ⌘K search, set the user token as `SLACK_USER_TOKEN` (`search:read`). For private channels, `/invite @Foundation` first. For the agent to lay out Slack images: the user token's search:read finds them by full text; the bot token needs `files:read` (in the manifest now), and then finds them by name |
| 8 | **GitHub** | Repo discovery across the org | `GITHUB_TOKEN` (falls back to the `gh` login) and `FOUNDATION_GITHUB_ORG` |
| 10 | **REA** | Reverse engineering | `npx rea-agents setup` once (registers REA's MCP with Claude Code; MIT; verify it's `morluto/rea`). Then use Run on a reverse-engineering card |
| 11 | **Lufga** | Display face | Install the licensed files locally; the stack falls back to Hanken Grotesk. Don't commit them to a public repo |
| 13 | **Kiri or Docker** | Machines in sections | **`npm run kiri:install`** installs Kiri: the pinned release from GitHub, SHA-256 checked. On Windows (needs WSL 2) it's per user, into `%LOCALAPPDATA%\Kiri`, with the WSL distro `kiri`; it changes no docker context or PATH, so Docker Desktop stays docker's default. On macOS and Linux it prints the `.dmg` / `sudo apt install ./….deb` step. `npm run kiri` starts it, `npm run kiri -- status` says what's there, and `npm run dev` starts it too (`FOUNDATION_KIRI=0` leaves it alone). To move to a new Kiri, change `VERSION` and the hashes in `scripts/kiri.mjs` from that release's `SHA256SUMS`. Or install Docker Desktop. Foundation finds `\\.\pipe\kiri`, `~/.kiri/run/docker.sock`, `/run/kiri/docker.sock`, then Docker's socket (or `DOCKER_HOST`); `FOUNDATION_ENGINES=kiri=<socket>,docker=<socket>` names them instead (and wakes nothing). `FOUNDATION_MACHINE_MEMORY_MB` / `FOUNDATION_MACHINE_CPUS` change the caps; both engines honour them. Check with `npm run machines:smoke -w @foundation/server [-- kiri]` (it runs alpine) |
| 12 | **Vision ↔ Foundation** | Hand-offs to Vision Code | Works with Vision Code running on this machine (T3 :3783). Foundation looks for its CLI in a Vision checkout (`~/Development/Vision`, `~/Dev/Vision`, `C:\Dev\Vision`: `.tools/code-server/t3`, `t3.exe` on Windows), then an installed Vision's `code-server/`, then `t3` on PATH. It reads Vision's T3CODE_HOME from `~/Library/Application Support/co.normallab.vision/code` (macOS), `%APPDATA%\co.normallab.vision\code` (Windows) or `~/.local/share/co.normallab.vision/code` (Linux) (`t3paths.ts`). If nothing is found, the side pane and the hand-off card list where it looked. Without `T3_URL`, Foundation reads Vision Code's address from `<T3CODE_HOME>/userdata/server-runtime.json`, which T3 writes when it starts (Vision takes the next free port if :3783 is taken), and uses `http://127.0.0.1:3783` if that file is missing or unusable. Set `T3_CLI`, `T3CODE_HOME` and `T3_URL` if they live elsewhere; when set, they're the only places looked. A hosted Foundation needs its own route to Vision Code (a pairing link instead of the local CLI). Approve a thread's file writes in Vision Code |

---

## 7. Known issues

- **Two people editing the same cell** still resolve last-writer-wins for that cell (Yjs picks one). Different cells merge.
- **A card added into a section that hosts an app** used to land behind the app. Fixed for agents (`cardSection`, tools.ts) and, since 2026-11-07, for people: every client add path makes the app a card in the flow beside the new one (`unhostFor` in store.ts, `test/hosting.test.ts`). The app stays a card until someone chooses "Let it fill the section" again.
- **Roles are per board or per account, with no per-section or per-card permissions.** Admins are global (`FOUNDATION_ADMIN_EMAILS`, or flowform admins). A viewer can still start agent sessions (read-only) and join huddles. A viewer's presence (cursor) still shows to others.
- **Offline is per board and per device.** Only boards opened on this device are kept. The copy isn't encrypted at rest (sign-out deletes it). Card positions and other per-card fields are last-writer-wins when two devices edited the same card offline (notes and cells merge).
- **A build from before epochs can read but not write** until it reloads (by design, so an old open tab can't pour a stale board into a reset one).
- **WebSocket auth uses the cookie**, which is fine same-origin. A remote Tauri client needs a header-capable transport (ticket exchange, like T3's `websocket-ticket`).
- **Flowform sign-in attempts live in server memory** for up to 10 minutes. A server restart (tsx watch) in the middle of a sign-in expires it, and the person has to click again.
- **Linking accounts is a command, not a screen.** One person can end up with two Foundation users: a dev-login address, and the address flowform signs them in with (flowform keeps the sign-up address, josh@normallab.co, for the Google identity josh@formindustries.co). `npm run link-accounts -w apps/server -- <keep> <other>` folds one into the other: sessions, files, runs and asks move, and the flowform link moves, so Google signs in as the kept user. Josh's accounts were linked on 2026-11-02 (kept josh.leong@gmail.com). There's no admin UI for this yet.
- **The REA job runner and the Vision brief are unexercised end to end.**
- **The app floorplan is a snapshot** (`apps/client/public/floorplan.html`, 2.3 MB). It doesn't update itself; refresh it after a release (`docs/floorplan.md`). The map's sources (`floorplan/`) stay out of git, so a fresh clone redraws them.
- **The ASCII wind shows nothing under reduced motion**, on machines without WebGL2, or on software renderers — the Details original's choice; the sign-in page is plain paper there. It also fades out while the window is unfocused.
- **Hidden windows pause `requestAnimationFrame`.** Overlays catch up when shown. `?rafshim` (dev) drives frames from a timer for headless capture.
- **Panel iframes use `sandbox` with `allow-same-origin`**, so a hostile app on the same origin could escape. Only add apps you trust; serve third-party apps from their own origins.
- **A section narrower than its content** now fits it (2026-11-07): Rim-drive fan v3's 1,500 px of stages in a 1,080 px column should show whole at about 70 %. Not checked on that board (it isn't in this machine's data); the pipeline itself still doesn't reflow, it's scaled.
- **Fitted cards can be small.** At 40 % on a zoomed-out board a note's text is unreadable until you zoom in or Expand. The floor (`MIN_FIT`) is a judgement call; tune it on a real display.
- **An expanded section's wires**: wires between the sections that stepped back now fade with them (2026-11-07, `wireBackstage`); a wire with one end in the open section stays at full strength and can cross the open section's paper on its way out.
- **An expanded section keeps its floating cards where they were**, so a card dropped far right in the fitted view makes the open section wide, and the camera frames it smaller. Docked cards reflow; floaters don't.
- **The open section's size snaps** while its card eases to it over 0.5 s, so wires jump to the new rects at once. Animating the store's rect would make them travel together.
- **Backward wires into the first column hook tightly**: the input sits 28 px from the section's wall, so the U-turn into it has about 14 px. A wider content pad on the left of pipeline sections would give it room.
- **Landing collisions push apart along an edge but not at the far end**, so two different apps crowding one edge can tilt one wire into a short diagonal. Rare on the company board (none today).
- **The "+" add-section buttons sit in the gaps between sections.** Since 2026-11-07 a press waits out the double-click window (300 ms, armed in blue at once) and a second click cancels it, so a double-click in the gap zooms instead of adding. A slower double-click than 300 ms (Windows allows up to 500) still adds; tune on a real mouse.
- **Throw momentum is generous** (velocity × 125 ms); tune on a real trackpad.
- **Raw colours left in components (19, allowlisted).** The old toolbar CSS and other dead rules are gone (2026-11-07), and no component transitions `background`/`color` any more; both are enforced by `apps/client/test/design.test.ts`. What remains: white text on solid fills (no on-fill token), the port gloss (no highlight token), the orb artwork, the iframe canvas, Drive's brand green and four script-side colours. Adding `--color-on-fill` and a highlight token to `tokens.css` would clear most of them. Hovers on table cells, gutters and top-bar buttons now change colour at once instead of fading.
- **Snap framing to a section** at 1440×900 lands at about 0.55 zoom; an empty section's welcome card reads small. Consider a tighter section frame when it holds one card or none.
- **Huddles are a mesh**: each person sends one stream per other person, so beyond about six it strains uplinks. An SFU (LiveKit, self-hosted) is the step up. Only STUN by default, so people behind strict NATs won't connect until `FOUNDATION_ICE_SERVERS` names a TURN server.
- **Transcription uses the browser's speech service.** In Chrome it sends mic audio to Google's servers while you're in a huddle. Firefox has none (type notes instead). A local path (Whisper on the server, or Vision's `@pacific/voice`) would keep audio in-house. It also hasn't been run with a real voice (§3).
- **Recording has no per-person opt-out.** Anyone in a huddle can start it and everyone sees REC, but nobody can stay out while it runs except by leaving. Chrome's WebM recordings are written live with no duration; since 2026-11-07 the client writes Segment → Info → Duration (wall-clock start to stop) into each file before it uploads, so the archive's player shows the length and can seek (a 3 s recording in Chromium: `Infinity` → 2.98 s), and a file it can't safely patch uploads unchanged. Not yet run through a two-person huddle into the archive player.
- **Huddle state lives on the panel object**, which the server writes when people join or leave. A person moving the card at the same moment can overwrite it (last writer per object, as with notes) until the next join or leave.
- **Slack is polled, not pushed**: 5 s while a card is on screen. Threads show a reply count but can't be opened. Socket Mode would make it live without a public URL.
- **Inviting a channel to a brand-new huddle waits 400 ms** for the new card to sync before the server can name it. A server-side create-and-invite would remove the wait.
- **Opening the side pane by hand beside a session on a narrow window** leaves the grid a sliver (the floor only gives way on its own). Consider narrowing the session instead.
- **Note editing is a plain textarea.** Concurrent edits rebase as one contiguous change each, so two people editing the very same word can interleave letters. Shared carets and per-person undo landed on 2026-11-07 without CodeMirror; a CodeMirror + y-codemirror binding would still fix the interleaving and bring syntax-aware editing. Carets are drawn with a mirror of the textarea's text, so they assume the editor's own font metrics. A note's undo history lasts while the board is open (not across reloads).
- **The floor's fade is a mask over the whole world layer.** Its edges used to restyle the whole board on every frame of a pane opening; scoped to the mask on 2026-11-07, and measured at 0–0.8 % of frames over on a 200-card board (§5). It still re-rasterises a full-screen mask while a pane slides; profile on a weaker GPU.
- **The board's first load is one burst of main-thread work** (100–150 ms in the production build on a 200-card board: the sync message, then React rendering every section at once). Signing in now waits for it before dissolving, so the dissolve holds 60 fps, but the wind stutters for that moment, and switching boards has the same burst. A first render that yields (a transition, or sections mounted a few per frame) would remove it.
- **The dev server costs more than the build**: React's development build makes a card pick-up 120–190 ms and a framing key 55–70 ms there, against 0 frames over in the production build (§5). The section-scroll commit (500 ms after a scroll stops) is one ~65 ms frame in dev. Judge feel on `E2E_BUILD=1` or the packaged app.
- **The frames check needs a GPU and a display**: `e2e/frames.spec.ts` skips without `PERF_GPU=1`, so CI can't hold the 60 fps line yet. A self-hosted runner with a GPU could.
- **Live frames and zoom cost frames** in headless Chromium (about 5 % drop to 30 fps, §5). On a real GPU (RTX 5080, 2026-11-07) 20 live frames cost nothing measurable; a weaker GPU is still unmeasured.
- **Touched-card rings come from ids in tool inputs and results**, so a card a tool changed without naming it (rare) goes unringed.
- **Lifting a docked card reflows the cards after it** (they close the gap at once), and those cards render again because they really move. The whole-board re-render on press is fixed (2026-11-07). Holding the gap until the drop would move the remaining cost to the drop; that's a design call.
- **Other whole-store subscribers**: `GridViewport`, `WireLayer`, `MapView` and the agent layer still read the whole store. They are one component each (not per card), but on a big board they render on every change; narrow them the way `useSection` did.
- **Framing a section zooms to its cards**, so its top-right tools can sit off screen. Hover still finds them once you pan.
- **A wire from a split app section can run tight along a neighbour's edge.**
- **find_images can't see inside images.** It matches titles, names, comments and where an image came from. A picture shared with no words around it is only found by browsing.
- **Laid-out sections are a default track wide.** A long document or a big grid is fitted (down to 40 %) and past that clipped with Expand, rather than scrolling inside its section; sizing the track to the layout would affect neighbours in that column.
- **Windows runs** (2026-11-07, on a Windows 11 machine): `npm test` (26 + 46), typecheck, `npm run desktop` and the packaged build (Desktop, §3). Found there: Node before 22.16 has no FTS5 in `node:sqlite`, so the server can't start (`engines` now says 22.16; the README did say 22.13); the Vision test's stand-in CLI was a `#!` file Windows can't start (now `t3.cjs`, and a `T3_CLI` that names a script runs under Node). Still open on Windows:
  - **Stopping the launcher from outside stops its children, after a second or two** (2026-11-07). On Windows, `scripts/dev.mjs` hands each child to a detached watchdog (`scripts/dev-watchdog.mjs`). When the launcher dies, however it dies, or npm above it in `npm run dev` does, the watchdog lists processes once through PowerShell and ends the children's whole trees; Kiri keeps running. `node scripts/dev-orphans-check.mjs` proves it on :15441/:15431 (before: 9 processes and both ports left; after: all gone in 4–7 s). macOS/Linux still rely on process groups, so a `kill -9` of the launcher there leaves them running, and `npm run desktop` hasn't been through the check. `FOUNDATION_CLIENT_PORT` moves Vite off 1430.
  - **Keys say ⌘ on Windows** (42 labels in 12 files: ⌘F, ⌘K, ⌘L…). The shortcuts themselves take Ctrl. `Ctrl+` is wider than `⌘` in the key chips, so this wants a pass on `#/design`.
  - **Windows can reserve the dev ports.** Hyper-V and WSL reserve blocks of the dynamic port range at boot. That range is 49152+ by default, but on Josh's machine it's 1024–15000, so after a reboot :1430 or :4410 can fail to bind (WSAEACCES; `netsh int ipv4 show excludedportrange protocol=tcp` lists the blocks). The packaged app's :31440 sits above both ranges for this reason.
  - **A packaged app can't use a hosted server yet.** Its page is http://localhost:31440; a server elsewhere is cross-site, so the `SameSite=Lax` cookie doesn't travel. It needs a header-capable transport (the ticket exchange above).
  - Still Mac-only: the REA job, which spawns `npx` without a shell (it would need `npx.cmd` resolved safely, since its arguments include a target). Vision Code hand-offs now find T3 on Windows and Linux (2026-11-07, `t3paths.ts`): on Josh's machine the CLI at `C:\Dev\Vision\.tools\code-server\t3.exe` and the store at `%APPDATA%\co.normallab.vision\code` were found and its threads read, but no real hand-off has run on Windows yet. The agent needs `claude.exe` on PATH. A Windows CI job (`npm test`, typecheck and `cargo build` on windows-latest) would prove it on every push.
- **Hand-offs reach Vision Code through its CLI on the same machine.** A hosted Foundation can't run it; it needs a T3 pairing link and a stored client credential, which is a decision for Josh.
- **A hand-off thread's file writes wait for approval in Vision Code** (Supervised, by design). Nothing comes back until someone approves there.
- **Exports are found by watching a folder**, every 4 s. A thread that writes elsewhere brings nothing back; the brief tells it where.
- **Reviews return as asks to people**, not as a verdict from Vision's own review tools.
- **Kiri's Windows installer is unsigned** (Kiri's Authenticode signing isn't in place yet; see its RELEASES.md). `npm run kiri:install` checks the MSI against a SHA-256 pinned in `scripts/kiri.mjs`, copied from that release's `SHA256SUMS`. That catches a corrupted or swapped download, but not a bad release published as such: the pin and the file come from the same GitHub release.
- **Foundation installs Kiri without Kiri's first-run window.** It imports Kiri Linux into WSL as `kiri` and starts `kiri-win.exe --distro kiri`: the same steps as choosing "Kiri Linux" there. But it doesn't add the `kiri` docker context, Kiri's `bin` on PATH, or start-at-sign-in. Opening Kiri from the Start menu shows its setup once (choose Kiri Linux; it finds the distro). Removing it is Apps & features → Kiri, which also unregisters the distro and deletes its disk.
- **Kiri's engine in WSL outlives its app.** If `kiri-win` quits, the machines keep running inside WSL but Foundation can't reach them: the card says Out of reach until Start (or `npm run kiri`) brings the app back. Kiri also keeps running after `npm run dev` stops, as Docker does.
- **`scripts/kiri.mjs` has been run on Windows only.** Its macOS (`.dmg`, `open -a Kiri`) and Linux (`.deb`/`.rpm`, `kiri daemon`) paths are written from Kiri's docs and not yet tried.
- **Machines run on the computer the server runs on.** A hosted Foundation would start machines on the host, which is a different trust question: who may start what, and on whose hardware. Ports are on that computer's 127.0.0.1, so a page opened from a port works only in a browser on the same computer (the desktop app, `npm run dev`).
- **A machine's terminal is one shell for everyone, and anyone who can edit the board can type into it as root.** Board roles are the only gate; there are no per-machine permissions. The shell lasts 5 minutes after the last person leaves, and is lost when the server restarts (the machine keeps running; the card reconnects to a new shell). Its screen is held in memory only, not archived.
- **The terminal at zooms other than 100 %**: text renders right (xterm measures cells unscaled), but a mouse selection lands off by the zoom factor. Typing is unaffected.
- **A port opened as a page shows what it last loaded** after the machine stops (the frame isn't told).
- **The crew has had three real model turns, all typed into the sheet, on one machine** (2026-11-07, Claude Code subscription, `docs/evidence/2026-11-07_crew/` 10–14). Each read the board first, made its things in one new section, called `bring_view` once at the end, and was honest about offline data ("not filled in yet: FactoryForm is offline"). Twice it called in a helper for the separate part (a standup checklist), and the helper signed its note. 29–44 s from ask to done. The automated two-person e2e still runs on the `script` runtime: a real turn isn't repeatable and spends the plan. Not yet seen from a real model: a voice ask, an ask while someone else is watching, an ask that should *not* bring you anywhere.
- **What a real turn found, fixed the same day.** (1) It hooked the connector up first, so the connector hosted the new section and the table and notes landed hidden under it. Agents' cards now un-host the app (above). (2) It wrote a markdown table in a note, which showed as raw pipes: notes render tables now. (3) Cursor labels read "wiring port_… → port_…" (the model wires by id): they name the cards now. (4) The helper's brief was logged as the person's ask; the lead now signs "called in Finch: …" instead. (5) "arranged 4 cards in sec_…": the section's name now.
- **A real turn's cards are signed in the activity but not on notes and tables themselves** (`createdBy` is set on panels only). The card doesn't say which agent made it.
- **A crew cursor is drawn where this browser lays the target out.** Two people with different section scroll see it at different places in a section; a card scrolled out of view inside its section gets the cursor at the section's nearest edge.
- **Aim-then-act adds about half a second per write** (`FOUNDATION_CREW_TRAVEL_MS`, 520 ms; reads don't wait). A long build of many cards is slower than before by design. Set it to 0 for scripts.
- **Space now does two things**: held, it's still the pan with a drag; held still, it listens after 240 ms; tapped, it opens typing. Someone who holds Space and waits before dragging sees the sheet flash. Measure on a real trackpad with real people.
- **Agents asked from the sheet run without a tab.** Their sessions are listed in the side pane and the roster's Open shows them, but a finished ask leaves the roster when its agent leaves (2.4 s after it's done).
- **Helpers share the asker's sign-in and run on the same runtime.** A helper on the subscription runtime is a second `claude -p` at once on the person's plan. On the API runtime it spends credits; the person's ask is what allows it (two at most).
- **The mic level opens the microphone a second time** (getUserMedia beside Web Speech). In the desktop app and some browsers that's a second permission prompt. Without it the bars breathe instead.
- **The flowform importer's fixture rooms were never committed** (`apps/server/test/fixtures/flowform/data/rooms`): the root `.gitignore`'s `data/` caught them, so on a fresh clone `flowform-import.test.ts` crashed and `npm test` was red on `main`. Its six tests now skip and say why, and the rule is `/data/`. Whoever has the rooms should commit them. `main` also didn't typecheck: `index.ts` used `requireBoard`/`hiddenBoards`/`canSeeBoard` without importing them from `members.ts` (fixed).
- **The e2e client port :1450 sits in a block Windows reserves on this machine** (1437–1536). `E2E_CLIENT_PORT` moves it (`E2E_CLIENT_PORT=15450 npm run e2e -w @foundation/client`).
- **Cards at rest have no title** (by design); a connector shown as a card (not hosted) reads by its body only. Hosted apps and pipeline stages name themselves.

---

## 8. Plan

**The plan is a kanban board** (2026-11-07, Josh: "the plan forward should be a kanban board that we move through issues").

- **`docs/plan.json`** is the plan: every bug, plan and hookup as a card with a column, a milestone, an area and (once pushed) its GitHub issue.
- **GitHub issues** are where the team moves cards: `npm run plan:push` makes or updates one issue per card (labels `plan`, `kind: …`, `status: …`, `area: …`; a milestone each; Done closes it), and `npm run plan:pull` reads columns, titles and bodies back, and brings in any issue labelled `plan` that was opened on GitHub. `npm run plan:project` also lays them out as a GitHub Projects board (needs `gh auth refresh -s project`). `npm run plan:check` validates the file (also in `npm test`).
- **Settings → Plan** in the app shows the board: the copy bundled with the build, refreshed from the server's file. An admin can drag a card to another column; the move writes the file and the card says *moved here* until it's pushed.

Columns: **Needs you** (a key, an install, a decision) · **Next** (in order) · **Doing** · **Review** (built; waiting to merge or for a person to check) · **Backlog** · **Done**.

Milestones (what the old phases became; finished phases 1 and 2 are gone from the plan):

| Milestone | What it covers |
|---|---|
| Polish | Bugs and rough edges in what ships (most of §7) |
| Vision loop | Hand-offs on Windows, an export seen from a real thread, Release → BomForm, a pairing link for a hosted server |
| The crew | A real model turn, crew-wide stop, follow and point, spatial voice |
| Company brain | BomForm diffed, the daily digest, spoken conversations |
| Search depth | Semantic search, Slack per person, Drive and Figma |
| Apps first-class | The registry, foundation.json, wires that call MCP, machines next |
| Huddles | A local transcriber, recording opt-out, live Slack, screen share, an SFU |
| Ship | CI on three systems, signed installers, a hosted server, a header-capable sync transport |

### Session routine (for every human or agent picking this up)

1. Read SPEC.md (this), DESIGN.md, and the last entries in `docs/evidence/`.
2. `npm install && npm test && npm run typecheck`. If red, fixing that is the session.
3. Take the top card in **Next** (Settings → Plan, or the issues labelled `status: next`), or a §7 issue if it's worse. Move it to Doing in `docs/plan.json`.
4. UI lands on `#/design` first, on tokens only. Check light and night, and 260/400/560-wide panels.
5. Capture evidence (screenshots and numbers) in `docs/evidence/<date>_<slice>/`.
6. Update §3 status and §7 issues honestly, and move the card (Review or Done). Commit with a message that says what changed and how it was checked; `npm run plan:push` when you have GitHub access.
