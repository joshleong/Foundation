# The desktop app, built and run on Linux (2026-11-07)

On a cloud Linux box (Ubuntu 24.04, no display): installed Tauri's Linux dependencies (`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, `libxdo-dev`), ran `cargo build` in `apps/client/src-tauri` (debug, 2 min 20 s), started `npm run dev`, and ran the binary on a virtual display (Xvfb, 1600×1000).

- 01: the sign-in, with the ASCII wind running in WebKitGTK.
- 02: signed in with dev login (Ada, `ada@normal.dev`), on the company board. The connectors say *Offline* and why: FactoryForm, Vision, Creation and the Data Room don't run on this box. Foundation itself is Live.

Seen in 02: the empty *Apps* section's "Bring work here" welcome sits under the search and talk pills at the bottom of the window. The pills float over the board by design; it only reads oddly when a welcome happens to sit right behind them.
