# Foundation design language

> One language across Form Industries' tools. Foundation wears Vision's `@pacific/ui` (itself from the Airform Data Room, ADR-011), as `packages/ui`. FactoryForm vendors the same tokens. This file is the contract; `packages/ui/src/tokens.css` is its executable half; **`#/design` in the app renders it live**. A change to how Foundation looks lands in those three places together.

## 1. Principles

1. **Paper, ink, one blue.** Warm printed paper (`#f6f3ec`), ink (`#201e19`), federal blue (`#325bb4`). The work brings the colour; the chrome stays quiet.
2. **Colour means state.** Blue is focus and the single forward action. Green is ok/live, amber is waiting, red is broken. **Violet is an agent** — anywhere violet appears, an agent did or will do it. Data uses `--viz-1…8` in order.
3. **Glass floats, paper sits.** Chrome (the capsule, ⌘K, the dock, the activity feed, presentation) is glass over the grid. Content (sections, cards) is paper on the desk. One `backdrop-filter` per composited region.
4. **Night is deliberate.** The orb mixes every token toward navy (`#0a111f`) over 1.4 s, ink flipping hard at the midpoint. The first launch follows the OS; after that the choice is remembered.
5. **Physical, not decorative.** Things move on springs, press 3 % under a finger, lift on hover, settle without wobble. Overshoot only when something *arrives*.
6. **Honest surfaces.** Unknown shows as *unknown*, offline says *offline* and why. A stub says it's a stub.
7. **Panels adapt to their own width.** Container queries, never the window. Decoration leaves first; check 260 / 400 / 560 px.
8. **Delight is earned.** A magical moment follows a real completion (an upload lands, an agent finishes, a wire carries data), lasts under 600 ms, and never blocks.

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
- **Scale:** 11 · 12 · **13 (default)** · 14 · 16 · 20 · 24 · 32. No half sizes.
- **Eyebrow:** 11 px, 600, uppercase, `.22em`, moss. **Brand:** display 14 px, 700, uppercase, `.08em`.
- Titles ≥ 24 px tighten to `-0.02em`. Numbers in metrics use tabular figures.

## 4. Shape and space

- **Radii — nothing in between:** paper 4 · card 8 · pane 14 · pill 999.
- **Space:** 2 · 4 · 8 · 12 · 16 · 24 · 32.
- **Heights:** pill 28 · control 32 · bar 48 · ⌘K field 56.
- **Shadows:** `--shadow-sheet` (resting paper), `--shadow-lift` (held/hovered paper), `--shadow-glass`, `--shadow-pane`.

## 5. Components

| Component | Rules |
|---|---|
| **Capsule** | Glass pill, 48 tall, floating 12 px from the top. Order: brand → board switcher → sync dot → ⌘K field → Layer · Present · Agent → presence → orb → me. One primary at most |
| **Pill (`.f-pill`)** | Secondary by default; `.is-primary` ink-filled (one per bar); `.is-accent` blue (one forward action); `.is-agent` violet (an agent will act) |
| **Card (frame)** | Paper on the desk, 8 px radius, 34 px header with grip · glyph + title · actions (repo, MCP, open, ✦ ask, dock/float, ✕). Body clips; ports and rings sit outside it |
| **Ports** | 12 px rings on the card edge — inputs left, outputs right, 52 px from the top, 26 px apart; filled when carrying a value. Drag from an output to any card to wire |
| **Wires** | App wires: blue, 1.6 px, faint (28 %) until the agent layer is on; dashed and flowing while data moves. Formula wires: green. Ghost wire while dragging: violet dashed |
| **Agent ring** | Violet 2 px rounded rect around a card an agent is working on, breathing 2.4 s |
| **⌘K** | Glass pane, 680 wide, 14 vh from the top. Rows 40 tall: glyph · label · hint · kbd. Search hits lead with a source tag (BOARD / FILE / SLACK / GITHUB / APP) and highlight matches in blue |
| **Dock** | Glass pane at the right, 420 wide. Steps as violet chips that turn green/red; thinking as three violet dots; your turns ink bubbles |
| **Toast** | Glass, bottom centre, 3.6 s |
| **Connector** | Status pill first: Live (ok) · Offline (warn) · Checking. Then metrics as a 3-up grid (2-up under 380 px), 20 px tabular values. Offline shows a hatched, dashed well that says *Not reachable* and why, never a blank. Foot: one violet agent action ("What's going on?" / "How do I connect it?"), Open, and "checked Ns ago" |
| **Empty section** | Never a void. An eyebrow with the section name, "Bring work here" (display 24), four actions as 2-up cards (open an app ⌘L, drop files ⌘U, ask the agent ⌘J (violet), write a note), then a pill shelf of company apps from the registry |
| **Section header** | Solid (no blur). Name 14/600, coords as a moss pill, card count as a neutral pill, actions fade in on hover: ◳ app, ⊞ table, ◍ map, ▤ note, ⇪ upload · ◫ ⬓ split · ⤢ expand, ✦ agent (violet), ✕ |
| **Wire routing** | Forward: one S-curve. Backward (target left of source): out, down a lane in the gap between the two cards' rows (or under both), across, and back in. Never a straight line through the board |

## 6. Motion

| Spring | k | c | Use |
|---|---|---|---|
| camera | 170 | 26 | grid camera, snaps |
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

Durations: press 80 · quick 160 · pane 280 · lift 350 · rise 800 (ms). Continuous motion (pan, zoom, drag, fling) runs on the shared spring engine and writes `transform` directly — never React state. `prefers-reduced-motion` collapses transitions to 1 ms and freezes the ASCII wind on one frame.

### 6.1 Presentation (after Details "Infinite Gallery")

- Chrome fades out over 280 ms; the grid camera glides to each section on the camera spring.
- The filmstrip is an **infinite loop**: each slide sits at its nearest wrapped distance `d` from a continuous offset `x`; `translateX = d · 218`, `scale = 1 − min(|d|,3) · .047`, `opacity = max(.35, 1 − min(|d|,3) · .22)`.
- Drag adds velocity; release projects 0.18 s ahead and settles on the nearest slide (k 120, c 24). Wheel scrolls it; 120 ms of quiet snaps.
- Titles rise 14 px over 600 ms on `--ease-out-soft`, words staggered 40 ms.
- **To do:** tune against the Vault original once the Details MCP is authenticated (SPEC §6.9).

## 7. Effects

| Effect | Where | Spec | Budget |
|---|---|---|---|
| **ASCII wind** | sign-in, design page | Characters ` .·:-~=+*≈%#` on a 14 px cell (8.7 px advance), domain-warped value noise stretched 1 : 10 horizontally, drifting left→right at 5.5 cells/s with a slow row swell. The pointer is a gust: radius 170 px, pushes the field and lights it in the accent. Ink on paper by day; pale federal blue on navy by night. Our implementation of the effect from Details' "ASCII Cursor 2.0" (vault/ascii-wind-2) — tune against the original | < 5 ms/frame, paused when hidden |
| **Paper shader** | grid | Vision's paper: grain ±.018 at 2 Hz, a 28 px dot grid synced to the camera, pointer light σ 220 px, vignette .965; mixes to navy with `uNight` | ≤ 2 draws/s idle |
| **Glass** | chrome | fill abyss 72 % (strong 86 %), edge frost 14 %, blur 18 + saturate 1.4, inset highlight | one region each |
| **Wire flow** | agent layer | dash 6/8 moving 28 px per 1.4 s while a source port has a value | CSS only |
| **Agent ring** | agent layer | violet, stroke 2→5, opacity .9→.35, 2.4 s | CSS only |
| **Night** | everywhere | `--night` over 1.4 s, `--night-hard` over .5 s | registered properties, no JS per frame |

## 8. Layers (z-order)

grid paper (WebGL) → grid chrome → sections → cards → formula wires → **app wires + agent rings** → peer cursors → activity feed → capsule → dock / repo drawer → presentation → ⌘K → toast.

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
