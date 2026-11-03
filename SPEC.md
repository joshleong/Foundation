# Foundation — spec

> The company brain of Form Industries: one shared grid where people, the apps we build, and the agents that work with us meet. This document is the plan every session (human or agent) builds from. **DESIGN.md** is its visual contract. Status is honest: _done_ means it ran and was checked; _partial_ and _stub_ say what's missing.

Last updated 2026-11-02 · branch `main` · evidence in `docs/evidence/2026-11-02_foundation-v0/`

---

## Open to-dos (kept by Josh, 2026-11-02)

- [ ] **Repo visibility** — `joshleong/Foundation` is public; decide private / move to the Form Industries org (§6.1)
- [x] **Phase 1 · Solid ground** (§8): Y.Text notes, per-table cells, viewer role, offline, the two-browser Playwright test and the perf trace — done 2026-11-03
- [ ] **Keys and setup** — Slack, BomForm + CA, API credits, `npx rea-agents setup` (§6)
- [ ] **Slack app** — create it from `docs/slack-app-manifest.yml`, set `SLACK_BOT_TOKEN`, then open a real channel card: huddles and Slack cards were verified against a stand-in Slack only (§3, §6.7)
- [x] **Vision loop** (Phase 2, 2026-11-03): briefs start Supervised Vision Code threads (a person presses Run); exports come back as cards; reviewers asked; CAD cards show the part. Remove the scratch "Foundation hand-offs" project left in Vision Code by the check run
- [ ] **Release → BomForm** — write BOM lines from the Release stage once BomForm's write tools are keyed

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

## 1. What Foundation is

| | |
|---|---|
| **For** | Everyone at Form Industries, and their agents |
| **Is** | A shared, infinite, spreadsheet-like grid of sections. A section holds cards: notes, tables, maps, media, and **panels**: live apps, web pages, machines, files and CAD, company connectors, agent jobs, and asks to people |
| **Above the grid** | The **agent layer**: wires between app ports, rings where agents are working, and an activity feed of who did what |
| **Agents can** | Run the whole interface through one tool surface (§4): organize, open and wire apps, find repos, read company systems, brief Vision, ask people for CAD (Hermes), queue reverse-engineering (REA) |
| **Runs** | Locally with one command (`npm run dev`). Desktop via Tauri (`npm run tauri dev`) |

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

**Panel kinds:** `app`, `link`, `file`, `machine`, `agent`, `connector`, `ask`, `stage`, `huddle` (a video portal; `huddle` holds who's in it now and whether it records, kept by the server), `slack` (a channel; `channel` is its id — a huddle opened for a channel carries it too). Each kind has optional `url`, `repo`, `mcp`, `fileId`/`mime`, `ports[]`, `outputs{portId: value}`, `status`, `assignee`, `sessionId`.

**Rules:**
- Section scroll is local, never shared.
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
| | Peer cursors | partial | Code done; needs a second signed-in person to verify by eye |
| **Grid** | Original Foundation grid (sections, tracks, springs, tables with formulas, maps, notes, media) | done | Now night-aware and on tokens. Layout memoised per state |
| **Checks in a real browser** (2026-11-03, phase 1) | `npm run e2e -w @foundation/client`: Playwright (Chromium 1.64.1), its own server and data (:4430/:1450) and a stand-in Slack (:4440), no agent runtime. Two people in two browsers (one note typed at once, one table written at once, a rename); sections moved and split, each step checked for cell clashes, overlaps, spills, clipped welcomes and new voids, and photographed; the perf trace; voice → session; the four layouts | done | 17 pass, 1 skipped by design. Found and fixed: the lazy cell-map race, section names that didn't drag, voids after moves, clipped welcomes. Screenshots in `docs/evidence/2026-11-03_{sections,together,build,perf}/` |
| **Moving and splitting sections** (2026-11-03) | Drag by the name (or anywhere on the header); a gap a section leaves is filled by the neighbours that line one side of it (fewest wins); a short or narrow empty section shows a compact welcome | done | `test/sections.test.ts` (4), `e2e/sections.spec.ts` |
| **Voice** (2026-11-03) | Talk to the agent from anywhere: the HUD's mic pill or V; the words show as heard; when you stop they go to the session on screen (or a new one) and run; Esc drops them. The composer's mic shares the same voice code | done | Checked with a stand-in recogniser; not with a real voice. Web Speech sends audio to the browser maker's service (§7) |
| **Agent construction** (2026-11-03) | `find_images` (archive full text + where it came from, board, Slack: `search.files` phrase then words, or the bot's `files.list`) and `lay_out` (a section as a grid, mood board, document or timeline; Slack images copied into the archive; captions with title, source and date). The agent is told when to build pages | partial | Real agent turn on the subscription, against a stand-in Slack: "lay out all the images from Slack related to the Airform PTHP" → 3, then (after phrase-then-word search) 4 as a mood board. **Real Slack not run**: needs a token (§6.7). `test/construct.test.ts` (4) |
| **Offline** (2026-11-03, phase 1) | Every board opened here keeps a copy on the device (IndexedDB via `y-indexeddb`); the app opens from it before the server answers or without it, with the person and the board list remembered. Edits made offline are saved there and sent by the reconnect handshake. Board tab: **Saved on this device** (changes waiting, survives a reload) or **This device's copy**. Each board has an epoch: a copy of a board the server has since made again is set aside, checked when the board opens, before every reconnect, and by the server at the socket (`syncAccess`: mismatch refused; a client that doesn't say reads only). Sign-out forgets the person, the copies and the waiting flags | done | Verified with the API taken down and brought back: offline rename + note line survived a reload and reached the server; a reset board stayed clean (`docs/evidence/2026-11-03_offline/`). `offline.test.ts` (3). Not run in the Tauri app |
| **Roles** (2026-11-03, phase 1) | **Viewers read; they can't change a board.** A person's role on a board is what an admin set for that board (side pane → People on this board: Can edit / View only / the account's role), else their account's (admin, member, or viewer for a flowform viewer let in by `FLOWFORM_ADMIT_VIEWERS`). Enforced on the server: the sync socket drops a viewer's updates (they still get the board and send presence); `runTool` refuses all but read-only tools, which covers HTTP tools, MCP and the agent (it's told the person is view-only); the HTTP gate refuses a viewer's other writes. A role change closes their socket and their tab re-reads it, so it applies at once. In the app, a View only pill, editing controls hidden, and any local edit snaps back with a notice | done | Invariant tests: `roles.test.ts` (4). Browser: an admin made a member view-only live; their rename snapped back, `add_note` and an upload got 403, `read_board` worked; reversed live (`docs/evidence/2026-11-03_viewer-role/`) |
| | **Tables two people can edit** (2026-11-03, phase 1): each table's cells are their own shared map, so an edit writes only the cells it changed and someone editing another cell keeps theirs | done | Two browsers writing different cells within 8 ms converged (`docs/evidence/2026-11-03_table-cells/`); `tables.test.ts` (3) covers both writing blind |
| | **Notes two people can write in** (2026-11-03, phase 1): every keystroke goes out as it's typed, as the smallest edit to the note's `Y.Text`, rebased past anything that arrived while it was typed (`rebaseEdit`); someone else's words land in an open editor without moving the caret. Agents' `update_card` writes the smallest edit too, so a person typing keeps their words | done | Two browsers typing at opposite ends of one note converged, carets kept (`docs/evidence/2026-11-03_live-notes/`); `notes.test.ts` (5). Esc no longer reverts a note (the words were already shared) |
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
| **Login** | The ASCII wind with a frame drawn in its own glyphs; the wind runs inside it and clears only behind the text. Inside: a grey eyebrow, the title, and a light **Connect with Google** pill on springs, with the email sign-in folded behind "Use your email". Always day colours. The frame opens on arrival; typing, presses and errors stir the wind; signing in dissolves outward into the board (also on arrival back from flowform, `?arrive`) | done (`docs/evidence/2026-11-03_sign-in-frame/`) | The Details original ("ASCII Cursor 2.0", WebGL2) plus Foundation hooks (`root.asciiWind`: tap, stir, holes, frame, dissolve; and the `quiet` option). `#/design/sign-in` previews it while signed in. Without WebGL2, or under reduced motion / high contrast, it's the same form on plain paper with a mask-only dissolve |
| **Design** | `#/design` living page; DESIGN.md | done | |
| **Desktop** | Tauri config points at :1430 | partial | Not rebuilt this session |
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
| Admin (users, audit, crashes, maintenance) | — | deferred |

---

## 4. The board tool surface

One definition (`apps/server/src/tools.ts`), three doors: the built-in agent, `/mcp`, and `POST /api/boards/:id/tools/:name`.

| Category | Tools |
|---|---|
| Reading | `read_board`, `search`, `company`, `read_file`, `read_repo`, `find_repo`, `app_tools` |
| Organizing | `add_section`, `add_note`, `update_card`, `delete_card` (confirm), `focus`, `set_plan` (the goal and steps a session tab shows; writes nothing) |
| Apps | `add_panel` (app, link, machine, connector, agent), `connect`, `send_to_port`, `call_app_tool` |
| People and studios | `ask_person` (Hermes), `vision_brief`, `reverse_engineer` (REA, person-run) |
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
| ASCII wind | < 5 ms/frame at 1440×900 | WebGL2, two draws a frame at 25 fps (100 fps only while a ripple runs); backs off then suspends on late frames; paused when hidden or unfocused; settles after 3 min until touched |

**Measured** (2026-11-03, `e2e/perf.spec.ts`; 180 notes + 20 live frames, headless Chromium with software WebGL, so upper bounds; `docs/evidence/2026-11-03_perf/`):

| Action | p50 | p95 | Longest | Frames > 33 ms | Long tasks |
|---|---|---|---|---|---|
| Pan | 16.7 ms | 16.8 ms | 33.4 ms | 2 of 712 | 1 |
| Pinch zoom | 16.7 ms | 33.4 ms | 33.5 ms | 30 of 664 | 0 |
| Drag a card | 16.7 ms | 16.8 ms | 99.9 ms | 3 of 294 | 2 |
| Pan with 8 live frames running | 16.7 ms | 33.4 ms | 50.1 ms | 38 of 678 | 0 |

Pan and drag hold 60 fps. Live frames and zoom drop about 5 % of frames to 30 fps. Picking up a docked card has one ~100 ms frame (the section lays out again). Next: measure on a real GPU and trackpad, then decide between pausing frames while the camera moves (a still in their place) and leaving them live.

---

## 6. Hookups a person needs to do

Every integration is off until its key exists; the server always starts. Copy `.env.example` to `.env`.

| # | Hookup | Why | How |
|---|---|---|---|
| 1 | **Repo visibility** | `joshleong/Foundation` is **public**; company plans and connector names are in it | Make it private, or move it to the Form Industries org |
| 2 | **Google sign-in** | Real accounts | Works out of the box through flowform-server (`FLOWFORM_URL`). flowform's client secret stays in AWS SSM; Foundation never needs it. Set `FOUNDATION_DEV_LOGIN=0` in shared deployments. A hosted Foundation that isn't on loopback needs flowform's `native_loopback_callback` widened, or its own `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| 3 | **Allowlist** | Who can enter | `FOUNDATION_ALLOWLIST=@formindustries.com,@normallab.co,…` |
| 4 | **Anthropic API credits** | API runtime | `ANTHROPIC_API_KEY`. The subscription runtime needs only `claude` installed and signed in |
| 5 | **BomForm** | The connector | Now reads the **Airform Data Room's daily copy** through its read-only `GET /api/foundation/bomform` digest (branch `foundation-bomform-read` in AirformDataRoom): set `FOUNDATION_READ_TOKEN` there and `DATAROOM_BOMFORM_URL` + `DATAROOM_READ_TOKEN` here. Locally the launcher runs that branch's worktree on :3010 (`node scripts/sibling.mjs dataroom AirformDataRoom-foundation`). **For production:** merge the branch, set the token on Vercel, deploy, and point `DATAROOM_BOMFORM_URL` at airformdata.com. **The copy is stale:** last synced 2026-09-05; the Data Room's daily sync has stopped (check `BOMFORM_API_KEY` / `CRON_SECRET` on Vercel). A direct BomForm key (`BOMFORM_MCP_URL` + `BOMFORM_API_KEY` + `NODE_EXTRA_CA_CERTS`) still takes precedence when present |
| 6 | **FactoryForm, Creation** | Live factory data; the studio and its Hub | `npm run services` starts FactoryForm (:3001), Creation (:5173 — its own config says 1420, Vision's port) and the Creation Hub (:4317) from the sibling folders (or `FOUNDATION_SIBLINGS`); each is also a launch config. FactoryForm is followed live through its `/api/events` stream. For FactoryForm writes over MCP, `FACTORY_MCP_TOKEN` |
| 7 | **Slack** | Channel cards, links, huddle invites, Hermes DMs, search | Create the app from **`docs/slack-app-manifest.yml`** (api.slack.com/apps → From a manifest), install it, and set the bot token as `SLACK_BOT_TOKEN`. That covers channel cards (read, post as the person, links, invites, huddle notes) and Hermes DMs. For ⌘K search, set the user token as `SLACK_USER_TOKEN` (`search:read`). For private channels, `/invite @Foundation` first. For the agent to lay out Slack images: the user token's search:read finds them by full text; the bot token needs `files:read` (in the manifest now), and then finds them by name |
| 8 | **GitHub** | Repo discovery across the org | `GITHUB_TOKEN` (falls back to the `gh` login) and `FOUNDATION_GITHUB_ORG` |
| 10 | **REA** | Reverse engineering | `npx rea-agents setup` once (registers REA's MCP with Claude Code; MIT; verify it's `morluto/rea`). Then use Run on a reverse-engineering card |
| 11 | **Lufga** | Display face | Install the licensed files locally; the stack falls back to Hanken Grotesk. Don't commit them to a public repo |
| 12 | **Vision ↔ Foundation** | Hand-offs to Vision Code | Works with Vision Code running on this machine (T3 :3783). Foundation finds its CLI at `~/Development/Vision/.tools/code-server/t3` and its data at Vision's T3CODE_HOME; set `T3_CLI`, `T3CODE_HOME` and `T3_URL` if they live elsewhere. A hosted Foundation needs its own route to Vision Code (a pairing link instead of the local CLI). Approve a thread's file writes in Vision Code |

---

## 7. Known issues

- **Two people editing the same cell** still resolve last-writer-wins for that cell (Yjs picks one). Different cells merge.
- **Adding a table (⌘K) into a section that hosts an app** puts it behind the app, where nobody sees it. Cards added to an app section should go to the nearest non-app section, or show the app as a card.
- **Roles are per board or per account, with no per-section or per-card permissions.** Admins are global (`FOUNDATION_ADMIN_EMAILS`, or flowform admins). A viewer can still start agent sessions (read-only) and join huddles. A viewer's presence (cursor) still shows to others.
- **Offline is per board and per device.** Only boards opened on this device are kept. The copy isn't encrypted at rest (sign-out deletes it). Card positions and other per-card fields are last-writer-wins when two devices edited the same card offline (notes and cells merge).
- **A build from before epochs can read but not write** until it reloads (by design, so an old open tab can't pour a stale board into a reset one).
- **WebSocket auth uses the cookie**, which is fine same-origin. A remote Tauri client needs a header-capable transport (ticket exchange, like T3's `websocket-ticket`).
- **Flowform sign-in attempts live in server memory** for up to 10 minutes. A server restart (tsx watch) in the middle of a sign-in expires it, and the person has to click again.
- **Linking accounts is a command, not a screen.** One person can end up with two Foundation users: a dev-login address, and the address flowform signs them in with (flowform keeps the sign-up address, josh@normallab.co, for the Google identity josh@formindustries.co). `npm run link-accounts -w apps/server -- <keep> <other>` folds one into the other: sessions, files, runs and asks move, and the flowform link moves, so Google signs in as the kept user. Josh's accounts were linked on 2026-11-02 (kept josh.leong@gmail.com). There's no admin UI for this yet.
- **The REA job runner and the Vision brief are unexercised end to end.**
- **The ASCII wind shows nothing under reduced motion**, on machines without WebGL2, or on software renderers — the Details original's choice; the sign-in page is plain paper there. It also fades out while the window is unfocused.
- **Hidden windows pause `requestAnimationFrame`.** Overlays catch up when shown. `?rafshim` (dev) drives frames from a timer for headless capture.
- **Panel iframes use `sandbox` with `allow-same-origin`**, so a hostile app on the same origin could escape. Only add apps you trust; serve third-party apps from their own origins.
- **A section narrower than its content starts with cards out of view.** Rim-drive fan v3's column is now 1,080 px, but its stages need 1,500 px, so CAD and Release sit scrolled off to the right. Its wires now stop at the edge rather than loop outside, but it still reads as a pipeline missing a stage. A pipeline could reflow to its section's width, or the section could show what's off the side.
- **Backward wires into the first column hook tightly**: the input sits 28 px from the section's wall, so the U-turn into it has about 14 px. A wider content pad on the left of pipeline sections would give it room.
- **Landing collisions push apart along an edge but not at the far end**, so two different apps crowding one edge can tilt one wire into a short diagonal. Rare on the company board (none today).
- **The "+" add-section buttons sit in the gaps between sections**, so a double-click aimed at the gap can hit one and add a section. Move them off the gap or require a single deliberate click target.
- **Throw momentum is generous** (velocity × 125 ms); tune on a real trackpad.
- **The old toolbar CSS** (`.app-bar`) is still in `App.css`; prune it. A few small hover transitions on `background` remain in `App.css` and lag the night fade the way pills did.
- **Snap framing to a section** at 1440×900 lands at about 0.55 zoom; an empty section's welcome card reads small. Consider a tighter section frame when it holds one card or none.
- **Huddles are a mesh**: each person sends one stream per other person, so beyond about six it strains uplinks. An SFU (LiveKit, self-hosted) is the step up. Only STUN by default, so people behind strict NATs won't connect until `FOUNDATION_ICE_SERVERS` names a TURN server.
- **Transcription uses the browser's speech service.** In Chrome it sends mic audio to Google's servers while you're in a huddle. Firefox has none (type notes instead). A local path (Whisper on the server, or Vision's `@pacific/voice`) would keep audio in-house. It also hasn't been run with a real voice (§3).
- **Recording has no per-person opt-out.** Anyone in a huddle can start it and everyone sees REC, but nobody can stay out while it runs except by leaving. Chrome's WebM recordings carry no duration, so the archive's player can't seek until it has played through.
- **Huddle state lives on the panel object**, which the server writes when people join or leave. A person moving the card at the same moment can overwrite it (last writer per object, as with notes) until the next join or leave.
- **Slack is polled, not pushed**: 5 s while a card is on screen. Threads show a reply count but can't be opened. Socket Mode would make it live without a public URL.
- **Inviting a channel to a brand-new huddle waits 400 ms** for the new card to sync before the server can name it. A server-side create-and-invite would remove the wait.
- **Opening the side pane by hand beside a session on a narrow window** leaves the grid a sliver (the floor only gives way on its own). Consider narrowing the session instead.
- **Note editing is a plain textarea.** Concurrent edits rebase as one contiguous change each, so two people editing the very same word can interleave letters, and the browser's undo stack resets when someone else's text lands. A CodeMirror + y-codemirror binding would add shared cursors and per-person undo.
- **The floor's fade is a mask over the whole world layer.** Measured smooth here, but it's one more full-screen composite; profile on a big board.
- **Touched-card rings come from ids in tool inputs and results**, so a card a tool changed without naming it (rare) goes unringed.
- **Live frames and zoom cost frames:** with live apps on screen, about 5 % of frames drop to 30 fps in headless Chromium (§5). Measure on a GPU first.
- **Picking up a docked card has one ~100 ms frame** while its section lays out again.
- **Framing a section zooms to its cards**, so its top-right tools can sit off screen. Hover still finds them once you pan.
- **A wire from a split app section can run tight along a neighbour's edge.**
- **find_images can't see inside images.** It matches titles, names, comments and where an image came from. A picture shared with no words around it is only found by browsing.
- **Laid-out sections are a default track wide.** A long document or a big grid scrolls inside its section; sizing the track to the layout would affect neighbours in that column.
- **Hand-offs reach Vision Code through its CLI on the same machine.** A hosted Foundation can't run it; it needs a T3 pairing link and a stored client credential, which is a decision for Josh.
- **A hand-off thread's file writes wait for approval in Vision Code** (Supervised, by design). Nothing comes back until someone approves there.
- **Exports are found by watching a folder**, every 4 s. A thread that writes elsewhere brings nothing back; the brief tells it where.
- **Reviews return as asks to people**, not as a verdict from Vision's own review tools.
- **Cards at rest have no title** (by design); a connector shown as a card (not hosted) reads by its body only. Hosted apps and pipeline stages name themselves.

---

## 8. Plan

| Phase | Scope |
|---|---|
| **1 · Solid ground (done 2026-11-03)** | ~~`Y.Text` notes~~, ~~per-table cell maps~~, ~~viewer role~~, ~~offline~~, ~~Playwright two-browser test~~, ~~perf trace~~. Viewer role. `y-indexeddb` offline. Measured perf trace. Playwright two-browser convergence test. Prune legacy CSS. Get `check-design` going (ratchet raw colours like the Data Room) |
| **2 · Vision loop (done 2026-11-03)** | Foundation starts Vision Code (T3) threads for a brief (`orchestration.dispatchCommand` `thread.turn.start`, see Vision `apps/vision/src/code/handoff.ts`). Vision's exports land back as file panels. A CAD 3D preview via Vision's OpenCascade. Reviews return as asks |
| **3 · Company brain** | BomForm snapshot cached and diffed. FactoryForm SSE (`/api/events`) pushed into the connector live. A daily "what changed" digest note by the agent. Voice: Vision's `@pacific/voice` realtime session for spoken conversations about the company |
| **4 · Search depth** | flowform's semantic search (e5 text vectors, SigLIP images, RRF k=60). Slack per-user OAuth with visibility that fails closed. Google Drive and Figma connectors |
| **5 · Apps as first-class** | An app registry UI. `foundation.json` adoption across our vibe-coded apps. Wires that call MCP tools on input. Machines: noVNC/ttyd presets, Docker launch from a card |
| **Huddles next** | Real-voice transcription check, then a local transcriber. Per-person recording opt-out. Slack Socket Mode (live messages), threads, and posting a summary when a session ends (person-approved). Screen share into the portal. Spatial audio (voices fade with distance from the portal while you roam). SFU past six people |
| **6 · Ship** | Tauri desktop builds in CI, a hosted server (S3 media, Postgres or libsql), Data Room / Creation / Vision panels sharing `@foundation/ui` (or Vision's `@pacific/ui` directly) |

### Session routine (for every human or agent picking this up)

1. Read SPEC.md (this), DESIGN.md, and the last entries in `docs/evidence/`.
2. `npm install && npm test && npm run typecheck`. If red, fixing that is the session.
3. Take the top unchecked item of the current phase, or a §7 issue if it's worse.
4. UI lands on `#/design` first, on tokens only. Check light and night, and 260/400/560-wide panels.
5. Capture evidence (screenshots and numbers) in `docs/evidence/<date>_<slice>/`.
6. Update §3 status and §7 issues honestly. Commit with a message that says what changed and how it was checked.
