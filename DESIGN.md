# Foundation design language

> One language across Form Industries' tools. Foundation wears Vision's `@pacific/ui` (itself from the Airform Data Room, ADR-011), as `packages/ui`. FactoryForm vendors the same tokens. This file is the contract; `packages/ui/src/tokens.css` is its executable half; **`#/design` in the app renders it live**. A change to how Foundation looks lands in those three places together.

## 1. Principles

1. **Paper, ink, one blue.** Warm printed paper (`#f6f3ec`), ink (`#201e19`), federal blue (`#325bb4`). The work brings the colour; the chrome stays quiet.
2. **Colour means state.** Blue is focus and the single forward action. Green is ok/live, amber is waiting, red is broken. **Violet is an agent** — anywhere violet appears, an agent did or will do it. Data uses `--viz-1…8` in order.
3. **Glass floats, paper sits, the floor is the paper.** Passing chrome (the search pill, ⌘K, hover bars, presentation) is glass over the grid. Content (sections, cards) is paper on the desk. The panes you work in — the top bar, the side pane, a session, search — are drawn on the grid's own paper (§5 The floor). One `backdrop-filter` per composited region.
4. **Night is deliberate.** The orb mixes every token toward navy (`#0a111f`) over 1.4 s, ink flipping hard at the midpoint. The first launch follows the OS; after that the choice is remembered.
5. **Physical, not decorative.** Things move on springs, press 3 % under a finger, lift on hover, settle without wobble. Overshoot only when something *arrives*.
6. **Honest surfaces.** Unknown shows as *unknown*, offline says *offline* and why. A stub says it's a stub.
7. **Panels adapt to their own width.** Container queries, never the window. Decoration leaves first; check 260 / 400 / 560 px.
8. **Chrome on call.** The grid runs edge to edge. Chrome waits until it's called: one slim top bar (fold, tabs, tools), search as a small pill at the bottom, a card's bar on hover. Nothing sits on the board that the person didn't ask for (no logo, no reticle).
9. **Delight is earned.** A magical moment follows a real completion (an upload lands, an agent finishes, a wire carries data), lasts under 600 ms, and never blocks.

## 2. Colour

| Token | Day | Night | Use |
|---|---|---|---|
| `--color-void` | `#f6f3ec` | `#0a111f` | page, grid paper |
| `--color-abyss` | `#fcfbf7` | `#111a2c` | sheets, panel bodies |
| `--color-panel` | `#efece3` | `#0d1526` | insets, wells |
| `--color-raise` | `#ffffff` | `#172239` | cards, controls |
| `--color-frost` | `#201e19` | `#e6ecf7` | ink, primary button fill |
| `--color-mist` | `#5f5b51` | `#94a2b9` | secondary text |
| `--color-dim` | `#8a8577` | `#5f6e85` | tertiary text, captions |
| `--color-pulse` | `#325bb4` | `#54b8ee` | focus, selection, accent action, wires |
| `--color-moss` | `#2e5d43` | `#2fc98f` | eyebrows |
| `--color-ok / warn / bad` | `#2e7d54 / #a16207 / #b3261e` | `#2fc98f / #e89b2c / #e4574e` | state |
| `--color-agent` | `#6b5bd6` | `#8f76ee` | **agents** (Foundation's addition) |
| `--color-line(-strong)` | ink 14 % (26 %) | frost 13 % (28 %) | rules, borders |

Never write a hex or `rgba()` in a component; mix tokens (`color-mix(in srgb, var(--color-pulse) 12%, transparent)`). `App.css` has 6 legacy `rgba()` left (white highlights, a modal shadow) — ratchet them out.

## 3. Type

- **Sans:** Hanken Grotesk Variable (OFL, bundled via `@fontsource-variable`). **Display:** Lufga where licensed, else Hanken. **Code:** Cascadia Code / SF Mono.
- **Scale:** 11 · 12 · **13 (default)** · 14 · 16 · 20 · 24 · 32. No half sizes. One exception: **40** (`--text-40`), for the Shiba's words on Today, in display 300 — a voice set in type (it steps down to 24 on narrow screens).
- **Eyebrow:** 11 px, 600, uppercase, `.22em`, moss. **Brand:** display 14 px, 700, uppercase, `.08em`.
- Titles ≥ 24 px tighten to `-0.02em`. Numbers in metrics use tabular figures.

## 4. Shape and space

- **Radii — nothing in between, and quiet:** paper 3 · card 5 · pane 8 · pill 999. Pills stay round (they are status and the HUD); everything else keeps its corners small.
- **Space:** 2 · 4 · 8 · 12 · 16 · 24 · 32.
- **Heights:** pill 28 · control 32 · bar 48 · ⌘K field 56.
- **Shadows:** `--shadow-sheet` (resting paper), `--shadow-lift` (held/hovered paper), `--shadow-glass`, `--shadow-pane`.

## 5. Components

| Component | Rules |
|---|---|
| **The floor** | The top bar, side pane, an open session and search sit on the grid's paper: transparent, the dots running underneath, ink straight on the paper (raised fills only for the plan card, composer, search field and the current tab/row). The cards are masked out where the floor is, fading in over 56 px at a pane's edge (28 px under the top bar); the view slides by half a pane's width as it opens, so what you were looking at stays in the middle of what's left, and framing (0, F) fits into that space. Each pane's inner edge drags to resize (hairline + blue on hover, double-click resets) and the widths are remembered. The grid keeps at least 440 px of open paper: when it wouldn't, the side pane folds, then search closes |
| **Top bar** | 44 tall, on the floor. Left: the side pane fold (⌘\). Then the tabs: the board (▦ name + sync dot) always first, then each open session (✦ violet for agent sessions, breathing while one runs; ⌥ for Vision Code threads), close on hover, ＋ new agent session (⌘J). Right: people here, ⌕ search (⌘F), ⌘ commands (⌘K), ◇ agent layer (A), ▶ present (P). Tabs 30 tall, the current one raised. ⌘1 the board, ⌘2…9 the tabs, ⌘W closes |
| **Side pane** | On the floor, 272 wide (220–420), under the top bar. Groups (11 px uppercase eyebrows, no rules): **Sessions** (violet; this board's agent sessions, ＋ new) · **Vision Code** (T3 threads: blue dot running, amber waiting on you, red error; six, then "n more") · **Boards** · **People on this board** (admins only: avatar · name · a pill picker — Can edit / View only / the account's role; View only reads amber) · **Activity** · **Tools** (upload, new section, fit, connect Claude Code, design language). Foot: me, sign out, night orb. Rows 32 tall |
| **Session** | A tab's column on the floor beside the side pane, 460 wide (360–720), the grid live to its right. Head: ✦ title (the first ask) + runtime. **Goal card** (raised, violet eyebrow, n/m): the goal sentence and a checklist — done ticked in violet and struck through, the active step's box breathing. Then the conversation: your asks as ink bubbles, the agent's text as markdown, tool steps as a violet-ruled list (name · the input that matters · ↗ when it names a card: click frames it). The cards a showing session touched wear a violet ring (2 px + 7 px dim). Composer raised, violet when focused; a mic pill at its left (breathing violet while listening — it sends when you stop), Send/Stop at its right. A turn keeps running when the page reloads; the tab picks it back up. A Vision Code thread shows the same way, read-only: proposed plan, messages, reasoning in dim italics, steps in code type, "Open in Vision Code ↗" |
| **Search pane** | On the floor at the right, 380 wide (300–600), ⌘F. Field (raised, blue when focused) · filter chips (All, Board, Files, Apps, Slack, GitHub, with counts) · results: images as square tiles (name on hover), everything else 44-tall rows (glyph tile · title + snippet with matches in blue · source). Empty: recent files on the board, then known apps. Press to open (as ⌘K does); pull past 5 px to drag — a raised ghost follows, solid over the grid, and the section under it rings blue; drop places the card floating where it was let go |
| **Offline** | The board tab's dot turns amber and a blue uppercase pill (10 px, 18 tall) says where the board is: **Saved on this device** while changes wait for the server, **This device's copy** while showing the kept copy before the server answers. Nothing else changes: you keep working. If the server's board was made again, one amber toast says the device's copy was set aside, and the page reloads onto the server's board |
| **View only** | For a viewer on this board: an amber uppercase pill (10 px, 18 tall) in the board's tab. Controls that change the board aren't offered (add, section tools, card actions, resize, gutters, ports, new board, new session); a note doesn't open for writing; anything changed anyway snaps back with one amber toast |
| **Hand-off card** (Vision Code) | An agent card under its brief: status dot + word, and **Run** (violet pill) top-right, below where the card's bar drops in. Idle, it says what Run does (a Supervised thread; what it makes comes back here). Running, it says it's Supervised and offers **Open in Vision Code ↗**. Error, it says why in the card's own words. What comes back sits beside the brief: renders as image cards named "… · Vision", files as file cards |
| **CAD card** | The part on a soft radial ground (raise → panel), rendered once as a still in studio light (CAD's Z-up stood upright), turned by dragging (grab cursor, one live viewer on the board at a time). Under it, the size (mm for STEP/IGES) and triangle count in dim tabular figures, then Download and Send to Vision |
| **Talk (HUD)** | A glass pill beside search: a mic glyph and the V key. Listening, it rings violet and breathes, and the words show above the HUD in a glass card (14 px, up to three lines, a violet breathing dot) as they're heard. When the speaker stops, they're sent to the agent; Esc drops them |
| **Laid-out pages** (agent `lay_out`) | A section of their own. **Grid**: masonry columns (2–4 by count, 340–520 wide, 24 px gaps); each image keeps its shape, with a caption card under it (the title in bold, then where it came from and when). **Board**: the same, with every third image two columns wide where two columns end level (never a hole). **Document**: one 760-wide column: an H1 and intro card, then each image at full width with its caption. **Timeline**: one row in time order, fitted to the section's width, a date-led caption under each. An intro card heads a grid when there is one |
| **Search pill (HUD)** | Glass pills, 36 tall, bottom centre of the open paper, 16 px up: ⌕ Search ⌘F (opens the search pane; hidden while it's open) and the live zoom % (click for 100%) |
| **Pill (`.f-pill`)** | Secondary by default; `.is-primary` ink-filled (one per bar); `.is-accent` blue (one forward action); `.is-agent` violet (an agent will act) |
| **Card (frame)** | Paper on the desk, card radius, **no bar at rest** — the card is its content. On hover a bar (30 tall, 5 px inset; solid glass fill, no blur inside the world) drops in over the top edge and lingers 140 ms after the pointer leaves: grip · glyph + title · actions (repo, MCP, open, ✦ ask, dock/float, ✕); it is the drag handle. Cards whose title matters at rest name themselves in their body (pipeline stages). Body clips; ports and rings sit outside it. Tables and maps keep their own headers (the sheet needs them) |
| **Note** | Markdown rendered on its card at rest. Double-click to write: a mono editor that starts below the card's bar (the bar sits over the top edge while it has focus). What you type is shared as you type it — other people's words appear in place and your caret stays put. Esc or ⌘↵ or clicking away goes back to the rendered note (nothing to save, nothing to revert) |
| **Media card** | Images and video have no bar at all. Round 28 px icons wait behind the card's right edge and slide out (spring, 40 ms stagger) while the pointer is on it: mute (video) and remove. A **ghost rail** (frost 4 %, pill) runs from under the card's edge out past them, so the pointer never crosses dead space on its way to a button; they go back 150 ms after the pointer leaves. The whole card is the drag handle; a tap on a video plays/pauses it |
| **App section** | A section can **host an app** (`SectionDoc.host`, schema 2): the app fills the section body, the section's header is the app's (glyph, name, repo / MCP / open / ✦), and **each wire lands on whichever edge faces the app at its other end** — across the wider gap, so apps in a row use left/right and stacked apps top/bottom; both ends choose symmetrically. A landing sits at the middle of the stretch the two sections share along that edge (so neighbours join by one straight segment), level with a card's port, or as near the other end as the edge allows; landings bound for the same app sit 18 px apart, 28 px from corners, below the header on the sides. Unwired ports wait in the usual left/right stack so a wire can be dragged out. An app opened into an empty section is hosted by it; "Show as a card" lets it go. Wires between apps run section to section |
| **Ports** | Pill intakes on the card (or app section) edge (Vision's pipe-intake): 14 px wide, centred exactly on the edge where the wire lands (the rail matches the card's border box; checked to 0 px), inputs left, outputs right, from 52 px down, 26 px rows. A port grows 18 px per extra wire so each wire owns a landing, ordered by where its other end sits. Tinted with the type's tone; filled when data is on it. Hover shows name · type · current value · what a drag will do |
| **Agent ring** | Violet 2 px rounded rect around a card an agent is working on, breathing 2.4 s |
| **⌘K** | Glass pane, 680 wide, 14 vh from the top. Rows 40 tall: glyph · label · hint · kbd. Search hits lead with a source tag (BOARD / FILE / SLACK / GITHUB / APP) and highlight matches in blue |
| **Toast** | Glass, bottom centre, 3.6 s |
| **Roll-over label (`.f-tip`)** | Every chrome button names itself: `data-tip` (and `data-kbd` for its shortcut) on the button, one label for the whole app (`shell/Tip.tsx`) in screen space so it reads the same at any zoom. Ink on paper (frost fill, void text), 12/500, paper radius, under the button (above when there's no room). Appears after 320 ms; moving along a toolbar the next one follows at once. Never a native `title` on chrome |
| **Connector** | Status pill first: Live (ok) · Offline (warn) · Checking. Then metrics as a 3-up grid (2-up under 380 px), 20 px tabular values. Offline shows a hatched, dashed well that says *Not reachable* and why, never a blank. Foot: one violet agent action ("What's going on?" / "How do I connect it?"), Open, and "checked Ns ago" |
| **Empty section** | Never a void. An eyebrow with the section name, "Bring work here" (display 24), four actions as 2-up cards (open an app ⌘L, drop files ⌘U, ask the agent ⌘J (violet), write a note), then a pill shelf of company apps from the registry |
| **Section header** | **No bar** — name 14/600, coords as a moss pill and card count as a neutral pill sit on the section's own paper. **Tools on call:** a ghost toolbar (solid paper, line border, no blur) in the top-right corner, shown only while the pointer is on the section (or a tool has focus), hidden 180 ms after it leaves. Groups, divided by a hairline: *app* (repo, MCP, open, show as a card — app sections only) · *add* (◳ app ⌘L, ⊞ table, ◍ map, ▤ note, ⇪ upload ⌘U) · *arrange* (◫ ⬓ split, ⤢ fill the screen) · ✦ agent ⌘J (violet) · ✕. The selection ring is an `::after` that fades (never a transitioned `box-shadow`). Drag it to move the section: onto a cell (swap or occupy) or **past any edge of the board**, which appends a track there and lays the section along that whole side (a dashed band shows where) |
| **Section seams** | Sections sit 40 px apart (a road for wires). Track lines and resize gutters show only where they divide sections; inside a merged section the seam is invisible until the pointer finds it, then its line and grab knob appear |
| **Pipeline stage** | 460×440 card in a 3×2 snake (Brief → Concept → CAD over Simulate → Review → Release), 520/560 px pitch, a fourth column for Vision briefs. Head: stage glyph tile · status pill (Waiting grey, Active blue with a 3 px blue halo on the card, Done green) · owner pill · n/m checklist. Waiting stages dim to 55% except their drop zone, which says what they wait on. Artifacts are 132 px tiles (210 px for CAD and data, so the measurement reads); ★ marks what goes forward. Footer: the hand-off as a violet pill on the left, Complete → (ink) on the right; Review has Request changes / Approve |
| **Huddle portal** | A card (560×420) that lands where you right-clicked. Its head at rest has a status pill: **Live · n** (ok, breathing dot) or **Quiet** (dim). Beside it **REC** (bad red, 1.6 s breathing dot) while recording, the one place red means something other than broken, because everyone reads it. Then a **Slack** chip if it was opened for a channel. The room is a tile grid (1 → 2 → 3 columns by count; one fewer under 400 px), paper-radius tiles on `--color-panel`, video `cover`, your own tile mirrored. Each tile has a name pill bottom-left with a red mic-off mark. Live captions are ink on paper, centred over the tiles. Nobody in it: a dashed, hatched well that says so. Controls and the Room · Notes · Archive tabs sit along the **bottom**, because the hover bar covers the top: round 28 px mic / camera / record controls (red when off), a note, Leave (red text), tabs. Not joined: **Join** is the one blue action. Notes: turns by speaker (600 name, tabular time, `note` for typed), system lines centred and dim. Archive: sessions as rows, opened to recordings (16:9 tiles), transcript, ✦ Summarize (violet) and Post notes to Slack |
| **Call chip** | While you're in a huddle: a glass pill at the bottom right, 48 tall. It shows a face (the first person with video), the huddle's name and who's in it, REC, mute and Leave. It carries the call's sound, so the call goes with you round the board. A tap on the face frames the portal. Hidden while presenting |
| **Slack card** | 420×520. The head has a **Slack** live pill and the topic. Messages are oldest first and scroll on their own (`.wheel-own`). A run from one person within 5 min drops the repeated name. Our posts ("Name via Foundation") get a 2 px blue rule. Links are blue, and replies show as a count. The composer: 2-row field (Enter sends, ⇧Enter new line), then ↗ Link a place · ◐ Invite to a huddle · **Send** (blue). Link a place lies over the messages as a raised sheet: the board, then each section with its cards indented. No token: the dashed *Slack isn't connected* well, with the reason and a violet "How do I connect it?" |
| **Today** | Home before the boards. The **Shiba's room** fills the window edge to edge: Vision's ethereal shiba (`@foundation/ui/shiba`, vendored from `@pacific/ui`), warm paper at rest, lilac listening, frosted blue thinking, dusk speaking, glowing with the arrival of its words. At night a veil mixes `--color-void` over it (58 %), and a gradient from the bottom keeps paper under the words. **Top bar** (56): a Today eyebrow, the company apps as glass chips (glyph disc · name · live dot; dashed and mist when not linked, the role on roll-over), New conversation (ghost), **Boards** (ink, B), the night orb, me. **The words**, bottom left, up to 780 wide: the earlier talk faint above (14, mist, fading by age), an eyebrow (date at rest; Listening/Thinking in violet), the line in display 300 at 40 (24–40 by width, pre-line, balanced; rises 14 px on arrival), a 14 px sub-line (what it's doing, or how to talk), then the composer: a raised pill, 48 tall, the mic disc on the left (violet and breathing while listening), Ask (violet) / Stop on the right. **The day** on glass at the right (340–420): Focus today and Goals. Under 900 px the room is the top 78 vh and the day follows it in one scroll |
| **Focus row** | 28 px glyph tile by kind (? asked of you · ◆ your stage · @ tagged · ⇪ new file · ↻ changed · ∿ your work), the title (13/600, two lines), why it's here (12, mist, one line), the board as a pill. Tone on the tile: overdue red (its why in red too), owned amber, agent violet. The whole row is the link to its place on the board |
| **Goal row** | A round check (fills green when done), the title (13/600; struck and dim when done), date in bold + detail (12), a 4 px blue progress bar (green when done), the percentage in tabular figures. "Add a goal…" is a dashed field that turns solid blue when focused |
| **Pointed** | What the Shiba is talking about wears the agent ring: violet 2 px + 7 px dim, breathing 2.4 s, on rows, goals and chips alike |
| **Chrome popup** | 360 wide, on the same tokens and font, following the OS's light/dark. Date eyebrow, "Name, n things want you." (display 20), ◌ Ask the Shiba (violet) and ▦ Boards, then Focus (24 px glyph tiles, one-line title and why), Goals (title · 64 px bar · %), Apps as pills (dashed when not linked), and the address at the foot (opens options). The new tab is a paper page that hands straight to Today; if Foundation doesn't answer, after 2.5 s it says so and offers to change the address |
| **Wires** | See §5.1 |

### 5.1 Wires — the flow-diagram rules (shared with Vision)

Ported from Vision (`apps/vision/src/components/wireGeometry.ts`, `@pacific/ui/data-pipes`); Foundation's copy is `apps/client/src/shell/wireGeometry.ts`, tested in `apps/client/test/wires.test.ts`.

1. **Roads, not strings.** Only horizontal, vertical and 45° runs; each bend drawn round on a 20 px arc (smaller where a run is too short to hold it), caps round. **Turns are long 45° runs**: a turn takes as much of the runs either side as it can (up to 480 px each way, sharing a run with the next turn, which takes whatever its neighbour can't use) and the longest diagonal that stays out of every card, so a change of height reads as one clean diagonal; in a tight gap it falls back towards a 14 px step.
2. **Straight leads.** Every wire leaves its port square to the edge and enters square to the edge on a 48 px straight lead (shorter when the cards are close). Cards leave right and enter left; app sections leave and enter by the edge facing the other app. Facing edges are turned a quarter at a time onto the right→left case and use the same router; a corner pair (right→top) takes the cheapest L or Z, and an L is one long diagonal. Labels on hops under 160 px (neighbouring apps) show on hover.
3. **Shortest road.** With room ahead: lead, one long diagonal, lead. Too steep: diagonals that take all the room ahead, with a vertical run between them.
4. **Going back.** A wire whose target is behind its source goes out and round beside the source, across through the gap between the two cards (or 28 px clear of both, whichever way is shorter), and round into the target. Never through a card.
5. **Lanes.** Wires into the same card share a run in parallel lanes 4 px apart, ordered by where they come from (likewise out of a card); offsets are intersected so lanes stay even through bends.
6. **Over and under.** Where two wires cross, the one with the earlier id goes *under* — a stable order, so nothing flickers. The under-wire is cut for the crossing (≈18 px + 3), with a portal mark at each mouth and a faint 7 % trace through; packets don't show in the tunnel. Crossings within 36 px of a port never tunnel; near-duplicate crossings merge.
7. **Look.** A 9 px road at 8 % ink, a 2.6 px wire tinted by the port type (json blue, image rose, cad amber, data green, bom violet, decision green, number teal, text slate), and 10/150 packets moving at 160 px / 4 s while the source port holds a value. Faint (38 %) until the agent layer is on, hovered or selected.
8. **Interaction.** Hover: the wire thickens and a tooltip says what it carries, from → to, and its current value. Click: selected (heavier, in its tone); ⌫ removes. Drag from an output: every compatible input lights (others step back to 20 %), the ghost is routed by the same rules, and it magnetises to an input within 32 px; dropping on a card body uses its first compatible input or makes one. Grab a connected input to lift the nearest wire off — drop it elsewhere to re-route, or on nothing to disconnect.
9. **Types.** A wire may join ports of the same type, or any port to a `json` port.
10. **Round every card — and every other app.** A wire never runs through a card, not just its own two, nor through a section neither end lives in: wires between apps run section to section through the 40 px gaps. When the plain road is clear it wins; otherwise roads through the channels beside cards (narrow gaps included) and the corridors above and below them are scored by length + 24 px per turn + a soft cost for brushing a card's 14 px padding, and any road through a card loses to any that isn't. A card right beside a port shortens that lead to half the gap. Results are cached per layout, so a still board costs nothing.
11. **Seen through its section.** A wire with both ends in one section's body is clipped to that body and goes round that section's cards and walls only. A wire to a card scrolled out of view runs to the edge and stops there, never across the grid.
12. **One road system.** App and pipeline wires and the spreadsheet's own wires (table → map in blue, formulas in green, both attached level with the card's header) publish their routes to one registry, so over/under is decided across all of them with the same stable order. Sheet wires rest stronger (85 %) than app wires (38 %) because they are the sheet's own data flow.

## 6. Motion

| Spring | k | c | Use |
|---|---|---|---|
| camera | 170 | 26 | grid camera: glides to framings the keyboard asks for (0, F, arrows, ⇧1/⇧2) and double-click zooms; pan, pinch and wheel rest wherever they're left — no snapping |
| pop | 260 | 20 | arrivals (the only overshoot) |
| drag | 550 | 38 | cards following a finger |
| soft | 90 | 22 | ambient |
| glide | 120 | 24 | presentation strip |

| Curve | Value | Use |
|---|---|---|
| `--ease-out-soft` | `(.22, 1, .36, 1)` | default for fades and reveals |
| `--ease-move` | `(.2, .8, .2, 1)` | position changes without a spring |
| `--ease-spring` | `(.22, 1.4, .36, 1)` | small pops (buttons, ports) |
| `--ease-settle` | `(.22, 1.3, .36, 1)` | layout settling |

Durations: press 80 · quick 160 · pane 280 · lift 350 · rise 800 (ms). Continuous motion (pan, zoom, drag, fling) runs on the shared spring engine and writes `transform` directly — never React state. `prefers-reduced-motion` collapses transitions to 1 ms and turns the ASCII wind off (paper only).

### 6.1 Presentation (after Details "Infinite Gallery")

- Chrome fades out over 280 ms; the grid camera glides to each section on the camera spring.
- The filmstrip is an **infinite loop**: each slide sits at its nearest wrapped distance `d` from a continuous offset `x`; `translateX = d · 218`, `scale = 1 − min(|d|,3) · .047`, `opacity = max(.35, 1 − min(|d|,3) · .22)`.
- Drag adds velocity; release projects 0.18 s ahead and settles on the nearest slide (k 120, c 24). Wheel scrolls it; 120 ms of quiet snaps.
- Titles rise 14 px over 600 ms on `--ease-out-soft`, words staggered 40 ms.

## 7. Effects

| Effect | Where | Spec | Budget |
|---|---|---|---|
| **ASCII wind** | sign-in, design page | Details' "ASCII Cursor 2.0" (vault/ascii-wind-2), the original: monospace glyphs on a 6.5 px cell, lit by gusting curl noise that blows at a random angle each visit (one of three glyph sets: mixed, lettered, figured). The pointer leaves a warm wake; a press sends a ripple that lights glyphs in the glow colour. **The sign-in sits in a frame drawn in the field**, not on a card: a ring of the field's own glyphs, always faintly lit and snapped to its cells (`asciiWind.frame`). The wind blows on inside it and clears only the cells behind the text (`asciiWind.holes`). Inside: a grey eyebrow, the display title, and one light pill, **Connect with Google**, in the paper's own tone, raised (it lifts 1 px on hover and presses 3 % on a spring). The email sign-in is folded behind "Use your email" and opens on a spring. On arrival the ring opens out of a slot. Typing stirs the wind at the cursor, a press ripples from the button, and an error ripples where it's written. Signing in dissolves outward from the press, a ragged front of bright glyphs (`asciiWind.dissolve`) with paper and form masked away behind it, into the board underneath. The sign-in is always day (`.f-day`, which re-declares the tokens with night off). Ink is `--ascii-color` (frost), glow `--ascii-glow` (pulse): ink on paper by day, frost on navy by night. Code: `login/asciiWind2.js`; untouched original in `docs/reference/details/` | WebGL2 at 25 fps, self-throttling; paused when hidden or unfocused |
| **Paper shader** | grid | Vision's paper: grain ±.018 at 2 Hz, a 28 px dot grid synced to the camera, pointer light σ 220 px, vignette .965; mixes to navy with `uNight` | ≤ 2 draws/s idle |
| **Glass** | chrome | fill abyss 72 % (strong 86 %), edge frost 14 %, blur 18 + saturate 1.4, inset highlight | one region each |
| **Wire flow** | agent layer | dash 6/8 moving 28 px per 1.4 s while a source port has a value | CSS only |
| **Agent ring** | agent layer | violet, stroke 2→5, opacity .9→.35, 2.4 s | CSS only |
| **Night** | everywhere | `--night` over 1.4 s, `--night-hard` over .5 s | registered properties, no JS per frame |

## 8. Layers (z-order)

Today (its own page): the Shiba (WebGL) → the veil → top bar, words and the day's glass.

The board: grid paper (WebGL) → grid chrome → sections (hosted apps) → cards → formula wires → **app wires + agent rings** → peer cursors → *(the floor mask)* → search pill → call chip → the floor (session, side pane, search, top bar) → repo drawer → presentation → ⌘K → toast.

## 9. Checklist for any new UI

- [ ] On tokens only — no hex, no `rgba()`
- [ ] Shown on `#/design` first
- [ ] Day and night both checked
- [ ] Narrowest width first; container queries; 260 / 400 / 560 checked for panels
- [ ] Moves on a spring or a named curve; no React state on a per-frame path
- [ ] Says *offline / unknown / stub* when it is
- [ ] Violet only if an agent is involved
- [ ] No per-element `background`/`color` transitions on tokened surfaces (they lag the night fade)
- [ ] Nothing positioned with `transform` that an animation also drives (use margins/insets)
- [ ] Hover chrome is reachable: no dead gap between what's hovered and its buttons (bridge it), and it lingers a beat on leave
- [ ] Chrome buttons carry `data-tip` (and `data-kbd`), not `title`
- [ ] No `backdrop-filter` inside the zoomed world; no transitioned `box-shadow` on a section-sized element
