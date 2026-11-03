/** Mounts the ASCII wind on `scope` (and any `[data-ascii-wind]` inside it); returns a disposer. */
export function initAsciiWind2(scope?: Document | Element, variant?: "wind" | "capillary" | "estuary"): () => void;

/**
 * Foundation's hooks, on the root element once the field is running (the
 * root fires `ascii-wind:ready`). Absent without WebGL2, under reduced motion
 * or high contrast. Positions are css px from the root's top-left.
 */
export interface AsciiWindHooks {
  /** a ripple, as a press would make (force 1 = a press) */
  tap(x: number, y: number, force?: number): void;
  /** a wake, as if the pointer had passed (x, y) moving (wayX, wayY) */
  stir(x: number, y: number, wayX: number, wayY: number, force?: number): void;
  /** up to 12 rects the wind's glyphs keep out of (the page draws its own characters there) */
  holes(rects: Array<{ x: number; y: number; width: number; height: number }>): void;
  /** glyphs nearer than `radius` (less a ragged `band`) to (x, y) are gone; the front burns bright. radius 0 = off */
  dissolve(x: number, y: number, radius: number, band: number): void;
}

declare global {
  interface Element {
    asciiWind?: AsciiWindHooks;
  }
}
