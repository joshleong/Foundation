# The Rune renderer, first slice (2026-11-12)

Taken by `apps/client/e2e/rune.spec.ts`, headed in Edge on this machine's GPU (WebGPU), on its
own server and data:

```sh
npm run rune:build
PERF_GPU=1 E2E_CLIENT_PORT=15450 npm run e2e -w @foundation/client -- rune
```

| File | What it shows |
|---|---|
| `board-web-night.png`, `board-rune-night.png` | The seeded company board, fitted (0), by each engine. Sections, their headers and the notes sit in the same places; the wires and ports over Rune's canvas are the web layer's. Rune's paper is flat and its type is Inter; the connectors and apps are the web's own cards, as islands over the canvas |
| `islands-rune-night.png` | The second slice: every app and connector on the board live, as the web's own component, in the section Rune drew |
| `table-rune-at-rest.png`, `table-web-in-hand.png` | A table drawn by Rune at rest, and the same table pressed: the web's live sheet in its place, after `=B3+1` was typed into C4 |
| `board-web-day.png`, `board-rune-day.png` | The same, by day |
| `note-writing-rune.png` | A note open in Rune's own text field (the code face, the caret, the selection ring), after typing ", typed in its own field": the store had the text |
| `settings-renderer-night.png`, `settings-renderer-day.png` | Settings → Renderer: the two engines, WebGPU and the build, and the parity ledger |
| `design-rune-night.png`, `design-rune-day.png` | `#/design` → Rune renderer: the mark's three states and the ledger's four words |

What the seven checks hold: the web renderer is the default and requests nothing of Rune's; Rune
draws the board with no GPU errors and the web renderer's sections are gone from the page; a
press selects a section, the wheel pans, Ctrl+wheel zooms, a note dragged 90 × 60 px floats there
(within 3 px), typing in Rune's field reaches the board; with WebGPU taken away the board falls
back to the web renderer and the mark reads *Rune off*; Settings switches engines both ways; every panel is a live island where the store says its
section is (within 1 px) and Rune is handed none of them; a table goes from Rune to the web's
sheet when pressed, takes a formula, and back to Rune with the new value.

Not here: the desktop app with Rune on, macOS, Linux, and any frame-time comparison (SPEC §7).
