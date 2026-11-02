# Foundation — spec

> The company brain of Form Industries: one shared grid where people, the apps we build, and the agents that work with us meet. This document is the plan every session (human or agent) builds from. **DESIGN.md** is its visual contract. Status is honest: _done_ means it ran and was checked; _partial_ and _stub_ say what's missing.

Last updated 2026-11-02 · branch `main` · evidence in `docs/evidence/2026-11-02_foundation-v0/`

---

## Open to-dos (kept by Josh, 2026-11-02)

- [ ] **Repo visibility** — `joshleong/Foundation` is public; decide private / move to the Form Industries org (§6.1)
- [ ] **Phase 1 · Solid ground** — proposed as its own session (§8): Y.Text notes, per-table cells, viewer role, offline, perf trace
- [ ] **Keys and setup** — Slack, BomForm + CA, API credits, `npx rea-agents setup` (§6)
- [ ] **Vision loop** — the Simulate/Concept hand-off writes the brief today; next it should start a Vision Code (T3) thread and attach what comes back (§8 phase 2)
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

**Panel kinds:** `app`, `link`, `file`, `machine`, `agent`, `connector`, `ask`. Each kind has optional `url`, `repo`, `mcp`, `fileId`/`mime`, `ports[]`, `outputs{portId: value}`, `status`, `assignee`, `sessionId`.

**Rules:**
- Section scroll is local, never shared.
- `blob:` URLs never enter the document.
- The schema version lives in `meta.schema`. flowform shipped unversioned fields and paid for it; bump it and migrate on change. Migrations are numbered steps in `apps/server/src/migrate.ts`, run at boot. **2:** sections host apps — a section of only apps (the company board's six connectors) becomes one section per app where its card was, other sections shift, nothing overlaps; a section holding one app hosts it (`apps/server/test/hosting.test.ts`).

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
| **Auth** | Google through flowform-server: flowform's own client, PKCE and signup allowlist. Foundation verifies the hand-off at `/auth/me` (email_verified), revokes flowform's bearer and mints its own session. The web path is bound to the browser that started it; the desktop path uses the system browser and the window polls. Also dev login (allowlist), an optional own Google client, hashed 30-day sessions, and the service token | done (`test/flowform.test.ts`; live hand-off to Google verified) | Flowform admins become Foundation admins. Viewers are refused unless `FLOWFORM_ADMIT_VIEWERS=1` |
| **Sync** | Yjs board docs, y-protocols wire, update log + compaction, reconnect with backoff, presence/awareness | done | Agent edits verified streaming live into an open browser |
| | Peer cursors | partial | Code done; needs a second signed-in person to verify by eye |
| **Grid** | Original Foundation grid (sections, tracks, springs, tables with formulas, maps, notes, media) | done | Now night-aware and on tokens. Layout memoised per state |
| **Files** | Upload anything with progress; images and video show instantly, then swap to the shared URL; range streaming; archive-never-delete | done | |
| | CAD cards (STEP/IGES header text, download, Send to Vision) | partial | No 3D preview yet (Vision's OpenCascade path is the plan) |
| **Search** | ⌘K: board cards, files (full text and CAD headers), apps, GitHub (token or `gh`), Slack (`search.messages` with a user token) | done (Slack untested) | Local results in ms, remote with a 2.5 s cap. Stemming removed for prefixes |
| **Panels** | Live app/link/machine frames | done | Mount only on screen at ≥0.3 zoom, poster otherwise. Click to engage, Esc to release. Frame policy probed |
| | Repo drawer (README, commits), MCP badge, ports, drag-to-connect wires, postMessage bridge | done | Bridge not yet exercised by a real app (§7) |
| **Agent layer** | Port wires (faint, bright with A), agent rings from presence and running cards, activity feed | done | |
| **Agent** | ⌘J dock, streaming steps, voice input (Web Speech), runtime picker | done | |
| | Subscription runtime (Claude Code + Foundation MCP, resumable sessions) | done | Verified: wrote a note and focused it |
| | API runtime (Opus 5.5, adaptive thinking, manual tool loop) | partial | Code done, untested (no `ANTHROPIC_API_KEY` here) |
| **MCP** | `/mcp?board=…`, 19 board tools, `⌘K → Connect Claude Code` copies the `claude mcp add` command | done | |
| **Company board** | Six live connectors wired by real flows | done | 2026-11-02: FactoryForm, Creation (+ Hub), Vision, Data Room and Foundation all Live locally; FactoryForm pushed live (SSE relay → cards refetch), floor shown as a station strip + open alerts, provenance stated ("prototype: stations demo · 40 units imported (snapshot 2026-07-07)"). BomForm reads the Data Room's copy (§6.5) — Live, labelled "copy · 58d old" because the Data Room's sync stopped on Sep 5 |
| | (previous note) | | FactoryForm answered from :3001. Vision found T3 and the Archive up. BomForm offline until keyed (§6) |
| **Hermes** | Ask cards, drop-to-answer, 4-hourly nudges on the board, Slack DM with a bot token | partial | Slack path untested |
| **REA** | `reverse_engineer` tool queues a job card. A person presses Run; it runs `rea-agents` (local apps) or Claude Code with REA's MCP | partial | Not run in this session: the tool downloads and runs third-party code, so a person should run `npx rea-agents setup` first (§6) |
| **Vision** | `vision_brief`: brief card, Vision panel, review asks | partial | Vision exposes no design API yet; the T3 bridge is §8 phase 2 |
| **Presentation** | P: chrome fades, camera glides section to section, infinite looping filmstrip with drag/wheel inertia | done | |
| **Login** | ASCII wind background (light and night), glass card | done | The Details original ("ASCII Cursor 2.0", WebGL2), from Josh's download 2026-11-02; `#/design/sign-in` previews it while signed in. Draws nothing without WebGL2, on software GPUs, or under reduced motion / high contrast |
| **Design** | `#/design` living page; DESIGN.md | done | |
| **Desktop** | Tauri config points at :1430 | partial | Not rebuilt this session |
| **Grid feel** (2026-11-02) | ~~Magnetic snapping~~ (replaced by keyboard-only framing, see Chrome on call). Safe-area framing clear of the side pane and search pill. Sections frame their cards (sparse sections at ~105% instead of ~55%). Trackpad pinch 1:1, two-finger pan everywhere. Keys 0 / ⇧1 / F / ⇧2 / 1 / + / −, Space-drag. Live zoom % in the HUD. Cards lift and lean when dragged | done | `docs/evidence/2026-11-02_grid-feel/`. Not yet measured on a real trackpad (headless only) |
| **Flow wires** (2026-11-02) | Vision's flow-diagram rules on app and pipeline wires: 45° roads with straight leads, back-routes through the gap, parallel lanes, stable over/under tunnels, typed tones, port pill intakes with a landing per wire, hover tooltips with live values, select + ⌫, magnetic drag with compatible-port highlighting, grab-to-re-route | done | `docs/evidence/2026-11-02_flow-wires/`, `apps/client/test/wires.test.ts`. Table→map and formula wires follow the same rules, and over/under is decided across both layers (shell/routeRegistry.ts). Wires route round every card in their way (routeAvoiding) — measured: 0 of 12 company-board wires cross a card |
| **Design pipelines** (2026-11-02) | Brief → Concept → CAD → Simulate → Review → Release as six wired stage panels in their own section | done (Vision run is manual) | `docs/evidence/2026-11-02_design-pipeline/`, `apps/server/test/pipeline.test.ts` |
| | Stages: status (waiting / active / done), owner, editable brief, artifacts (renders, STEP measured on arrival, results, decisions), self-ticking checklist where the evidence is clear, ★ to choose what goes forward | done | |
| | Hand-offs (`stage_request`): CAD asks the owner via Hermes and the STEP lands back on the stage. Concept and Simulate write a Vision brief from the stage (chosen concept; CAD size + analysis/loads/target). Review asks every reviewer | done | Vision still runs by hand; phase 2 starts T3 threads |
| | Complete → output goes down the wire and the next stage opens. "Request changes" at Review reopens CAD and Simulate. Agents drive all of it through the same tools; ⌘K "Start a design pipeline: …" | done | |
| | Release → BomForm | stub | Completes the stage; nothing is written to BomForm yet |
| **Chrome on call** (2026-11-02) | No top capsule, no logo, no grid reticle. A collapsible side pane (⌘\, remembered) holds boards, tools, activity and settings; a small search pill + zoom at the bottom opens ⌘K. The camera rests wherever pan / pinch / wheel leave it; only the keyboard (0, F, ⇧1/⇧2, arrows) snaps to framings; double-click zooms in on the card or section under the pointer (once framed, the double-click goes through to edit), or 2× on empty paper | done | `docs/evidence/2026-11-02_chrome-on-call/`. Checked: a throw comes to rest at its own position (no snap) |
| | Cards rest without a bar; a glass bar drops in on hover. Images and video have no bar: mute / remove icons slide out from behind the card, the card is the drag handle, a tap plays/pauses video. Pipeline stages name themselves in their body | done | Tables and maps keep their own headers |
| | Sections: track lines and gutters only where they divide sections — seams inside a merged section are invisible until hovered. Drag a section past any board edge to append it along that whole side (new track, sized like the section, capped at a normal track); its hole is absorbed by an aligned neighbour | done | Checked in the browser: dropped below the board → full-width row, pipeline section widened into the hole |
| | **Sections host apps** (schema 2). An app fills its section; the section header is the app's; ports sit on the section's edges; wires run section to section and treat every other section as an obstacle. The company board migrated to one section per app. An app opened into an empty section (people or `add_panel`) is hosted; "Show as a card" / "Let it fill the section" toggles | done | Gaps between sections widened to 40 px so wires have a road |
| | App sections use all four edges: each wire lands on the edge facing the other app (wider gap wins; symmetric), centred on the stretch the two share — neighbours join by one straight segment across the gap, offset apps by one long diagonal. Unwired ports wait on the sides. Short hops hide their label until hover | done | Company board: 14 landings on all four sides, 24/24 wire ends at 0.00 px. `wires.test.ts` (15). `#/design` → Effects → App sections |
| | Wires: turns are long 45° runs (up to 480 px a side, shortened where they'd enter a card) instead of 14 px chamfers; a height change with room ahead is one diagonal. Port pills centred exactly on the wire's landing (was 1–2 px off: the section border wasn't counted) | done | Measured: 24 of 24 wire ends at 0.00 px from their pill centre. `wires.test.ts` (13) |
| **Hover chrome pass** (2026-11-02) | Image/video buttons reachable: a ghost rail bridges the 8 px gap between the card and its icons (before, crossing it dropped the hover and the icons slid away), and every hover chrome lingers 140–180 ms after the pointer leaves. Section header has no bar: name, coords and count sit on the section's paper; tools wait in a ghost toolbar top-right, only while the pointer is on the section, grouped add (app ⌘L, table, map, note, upload ⌘U) · arrange (split ◫ ⬓, fill ⤢) · agent ✦ ⌘J · remove; an app section's repo/MCP/open/show-as-card lead it. Every chrome button names itself on roll-over (one screen-space label, `shell/Tip.tsx`, `data-tip`/`data-kbd`). Flicker: no `backdrop-filter` left inside the zoomed world (card bars and media icons were blurred per card), the section selection ring fades on `::after` instead of transitioning a whole section's `box-shadow` and border, and toolbar buttons no longer spring-scale on hover. Radii quieter: paper 3 · card 5 · pane 8 (was 4 · 8 · 14); hard-coded 4–8 px radii moved onto tokens | done | `docs/evidence/2026-11-02_section-chrome/`. Measured: the pointer in the old gap now hits the rail (`.frame-icons`), the card keeps hover, icons stay at 36 px; selecting a section starts 2 opacity fades (was 10 border/shadow transitions + a toolbar fade); 0 in-world `backdrop-filter`s. Day and night checked; flicker itself judged by measurement, not by eye on a real display |
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
| Code tab (T3 gateway, Codex/Claude Code) | Agent dock (subscription runtime); T3 bridge planned | partial |
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
| Organizing | `add_section`, `add_note`, `update_card`, `delete_card` (confirm), `focus` |
| Apps | `add_panel` (app, link, machine, connector, agent), `connect`, `send_to_port`, `call_app_tool` |
| People and studios | `ask_person` (Hermes), `vision_brief`, `reverse_engineer` (REA, person-run) |
| Design pipelines | `start_design_pipeline`, `pipeline_status`, `stage_attach`, `stage_choose`, `stage_check`, `stage_settings`, `stage_request` (hand-off), `complete_stage` (Review: approved / changes) |

**Invariants**, from flowform and tested in `apps/server/test`:
- Every write names its board.
- `request_id` makes a write idempotent.
- Deletes need `confirm: true`.
- Every write lands in `activity` and moves the agent's presence ring.
- Nothing that spends money or runs third-party code starts without a person.

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

**To measure next:**
- A Playwright trace of pan, zoom and drag with 200 cards and 20 live frames.
- The long-task count.
- Frame time p95.
- Record the numbers in `docs/evidence`.

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
| 7 | **Slack** | Search and Hermes DMs | User token (`SLACK_USER_TOKEN`, scope `search:read`) for search. Bot token (`SLACK_BOT_TOKEN`, `users:read.email` + `chat:write`) for DMs |
| 8 | **GitHub** | Repo discovery across the org | `GITHUB_TOKEN` (falls back to the `gh` login) and `FOUNDATION_GITHUB_ORG` |
| 10 | **REA** | Reverse engineering | `npx rea-agents setup` once (registers REA's MCP with Claude Code; MIT; verify it's `morluto/rea`). Then use Run on a reverse-engineering card |
| 11 | **Lufga** | Display face | Install the licensed files locally; the stack falls back to Hanken Grotesk. Don't commit them to a public repo |
| 12 | **Vision ↔ Foundation** | Agents driving Vision | Phase 2 (§8): Foundation will start threads in Vision Code (T3 :3783) the way Vision's own agent does |

---

## 7. Known issues

- **Notes are last-writer-wins per card.** Each object is one JSON value in a Y.Map. Two people typing in one note at once will clobber each other. Move note text to `Y.Text` (flowform had the same flaw).
- **The cells map is per table**, so two people editing different cells of one table rewrite the same map entry (last writer wins). Move to one Y.Map per table.
- **No viewer role yet.** Every signed-in member can write. flowform dropped viewer writes on the server; add `room_role` and drop writes in `attachConnection`.
- **No offline outbox.** The doc lives in memory; a tab closed while offline loses its edits. Add `y-indexeddb`.
- **WebSocket auth uses the cookie**, which is fine same-origin. A remote Tauri client needs a header-capable transport (ticket exchange, like T3's `websocket-ticket`).
- **The REA job runner and the Vision brief are unexercised end to end.**
- **The ASCII wind shows nothing under reduced motion**, on machines without WebGL2, or on software renderers — the Details original's choice; the sign-in page is plain paper there. It also fades out while the window is unfocused.
- **Hidden windows pause `requestAnimationFrame`.** Overlays catch up when shown. `?rafshim` (dev) drives frames from a timer for headless capture.
- **Panel iframes use `sandbox` with `allow-same-origin`**, so a hostile app on the same origin could escape. Only add apps you trust; serve third-party apps from their own origins.
- **Landing collisions push apart along an edge but not at the far end**, so two different apps crowding one edge can tilt one wire into a short diagonal. Rare on the company board (none today).
- **The "+" add-section buttons sit in the gaps between sections**, so a double-click aimed at the gap can hit one and add a section. Move them off the gap or require a single deliberate click target.
- **Throw momentum is generous** (velocity × 125 ms); tune on a real trackpad.
- **The old toolbar CSS** (`.app-bar`) is still in `App.css`; prune it. A few small hover transitions on `background` remain in `App.css` and lag the night fade the way pills did.
- **Snap framing to a section** at 1440×900 lands at about 0.55 zoom; an empty section's welcome card reads small. Consider a tighter section frame when it holds one card or none.
- **Cards at rest have no title** (by design); a connector shown as a card (not hosted) reads by its body only. Hosted apps and pipeline stages name themselves.

---

## 8. Plan

| Phase | Scope |
|---|---|
| **1 · Solid ground (next)** | `Y.Text` notes and per-table cell maps. Viewer role. `y-indexeddb` offline. Measured perf trace. Playwright two-browser convergence test. Prune legacy CSS. Get `check-design` going (ratchet raw colours like the Data Room) |
| **2 · Vision loop** | Foundation starts Vision Code (T3) threads for a brief (`orchestration.dispatchCommand` `thread.turn.start`, see Vision `apps/vision/src/code/handoff.ts`). Vision's exports land back as file panels. A CAD 3D preview via Vision's OpenCascade. Reviews return as asks |
| **3 · Company brain** | BomForm snapshot cached and diffed. FactoryForm SSE (`/api/events`) pushed into the connector live. A daily "what changed" digest note by the agent. Voice: Vision's `@pacific/voice` realtime session for spoken conversations about the company |
| **4 · Search depth** | flowform's semantic search (e5 text vectors, SigLIP images, RRF k=60). Slack per-user OAuth with visibility that fails closed. Google Drive and Figma connectors |
| **5 · Apps as first-class** | An app registry UI. `foundation.json` adoption across our vibe-coded apps. Wires that call MCP tools on input. Machines: noVNC/ttyd presets, Docker launch from a card |
| **6 · Ship** | Tauri desktop builds in CI, a hosted server (S3 media, Postgres or libsql), Data Room / Creation / Vision panels sharing `@foundation/ui` (or Vision's `@pacific/ui` directly) |

### Session routine (for every human or agent picking this up)

1. Read SPEC.md (this), DESIGN.md, and the last entries in `docs/evidence/`.
2. `npm install && npm test && npm run typecheck`. If red, fixing that is the session.
3. Take the top unchecked item of the current phase, or a §7 issue if it's worse.
4. UI lands on `#/design` first, on tokens only. Check light and night, and 260/400/560-wide panels.
5. Capture evidence (screenshots and numbers) in `docs/evidence/<date>_<slice>/`.
6. Update §3 status and §7 issues honestly. Commit with a message that says what changed and how it was checked.
