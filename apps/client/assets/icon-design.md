# Foundation app icon

**Four panels on a grid**: two full-width rows over a row split in two, as Josh drew it (2026-11-10). It is Foundation's own floor in miniature: sections laid on a grid, one of them split.

- `foundation-mark.svg` is the drawing itself: 451×418, white panels, corners 5, 23 between rows and 19 between the two bottom panels. Use it as it is on a solid fill or dark ground.
- `foundation-icon.svg` is the app icon: the same panels centred on a 1024 canvas (768 wide, rows 212 tall, 38 between rows, 32 between the bottom pair, corners 9) in Foundation's federal blue (`#325bb4`, `--color-pulse` by day) on a transparent background. Blue, because a taskbar, dock or desktop can be light or dark and white would vanish on a light one. No texture, gradient, shadow or tile, the same discipline as Vision's star.
- `public/foundation.svg` is the browser tab's icon: the icon's geometry, blue in a light browser and white in a dark one (`prefers-color-scheme`).
- In the app it is `src/brand/Mark.tsx`, drawn in `currentColor`: `tone="pulse"` on paper and glass, `tone="on-fill"` (white) on a solid fill.

Regenerate the desktop icons from `apps/client`:

```bash
npm run tauri -- icon assets/foundation-icon.svg --output src-tauri/icons
```

Then delete the `android/`, `ios/` and `64x64.png` the CLI also writes (the desktop bundle doesn't use them). Rebuild the executable to embed the new icon; if Cargo keeps a cached Windows icon resource, touch `src-tauri/build.rs` first.
