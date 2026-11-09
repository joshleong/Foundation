# Foundation app icon

An **F laid in masonry**: five blocks of Foundation's federal blue (`#325bb4`, `--color-pulse` by day) on a transparent background, set like stone courses. The top course is one long block and one short one, with its joint offset from the stem's edge (a running bond); the stem is two blocks; the arm is a single shorter block whose bottom shares the stem's first course line. Mortar is 44 units on a 1024 canvas and corners are 12, so the joints still read at 32 px and the letter still reads at 16 px. No texture, gradient, shadow or tile, the same discipline as Vision's star.

It says what Foundation is: a grid of sections that people, apps and agents build on together.

Source: `foundation-icon.svg` (explicit rects, no fonts). `public/foundation.svg` is the same file (the browser tab's icon).

Regenerate the desktop icons from `apps/client`:

```bash
npm run tauri -- icon assets/foundation-icon.svg --output src-tauri/icons
```

Then delete the `android/`, `ios/` and `64x64.png` the CLI also writes (the desktop bundle doesn't use them) and copy the SVG to `public/foundation.svg`. Rebuild the executable to embed the new icon; if Cargo keeps a cached Windows icon resource, touch `src-tauri/build.rs` first.
