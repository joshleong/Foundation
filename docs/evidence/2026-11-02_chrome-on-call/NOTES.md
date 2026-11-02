# Chrome on call · app sections · long diagonals (2026-11-02)

Checked in the browser at 1440×900 (`?rafshim`), day and night, on the live company board.

| Check | Result |
|---|---|
| Pan release | camera rests where thrown: `translate3d(356.4, 6.5) scale(0.236)` before and 1.5 s after release (no snap) |
| Double-click | empty paper → 2× around the pointer; video card → framed at 105%; section → its focus frame |
| Port alignment | 24 of 24 wire ends at **0.00 px** from their pill centre (14 hosted-app ports, 10 card ports) at 64% zoom; was 1 px (cards) |
| Migration 1 → 2 | company board: six connectors → six app sections in the designed layout, other sections shifted, no overlaps (`apps/server/test/hosting.test.ts`, which fails on the stale-read bug the first run hit) |
| Drag to edge | "Section 2" dropped below the board → full-width bottom row; the pipeline section absorbed its hole. Board restored afterwards |
| Tests | client 13 (wires incl. one-long-diagonal and turn-shortens-at-a-card), server 9 |

00-before is the board as it was (capsule, reticle, connectors as cards in one section).
