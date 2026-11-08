/**
 * Mounts the ASCII wind on `scope` (and any `[data-ascii-wind]` inside it); returns a disposer.
 * `quiet` (Foundation) is how strong the wind stays in the calm patch behind the centre: 0 to 1, where 1 means no calming.
 */
export function initAsciiWind2(scope?: Document | Element, variant?: "wind" | "capillary" | "estuary", options?: { quiet?: number }): () => void;

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
  /** a frame of the field's own glyphs, always faintly lit (`light` 0..1), `depthX`/`depthY` px deep around `rect`; null = none */
  frame(rect: { x: number; y: number; width: number; height: number } | null, depthX?: number, depthY?: number, light?: number): void;
  /** glyphs nearer than `radius` (less a ragged `band`) to (x, y) are gone; the front burns bright. radius 0 = off */
  dissolve(x: number, y: number, radius: number, band: number): void;
  /** draw one frame now (the hooks above draw on the next display frame); for measuring */
  drawNow(): void;
  /** how it's pacing: 0 = every display frame, 1 = 30 fps, 2 = 15 fps; and why it last backed off */
  state(): { backoff: number; suspended: boolean; settled: boolean; backoffs: Array<{ at: number; why: string; to: number }> };
}

declare global {
  interface Element {
    asciiWind?: AsciiWindHooks;
  }
}
