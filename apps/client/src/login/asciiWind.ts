/**
 * ASCII wind — the sign-in backdrop. A field of characters drifting like air
 * over water: elongated value-noise streaks advected left→right, a slow swell
 * underneath, and the pointer as a gust that parts the wind around it.
 *
 * Our own implementation of the effect the team liked on Details.so
 * ("ASCII Cursor 2.0", vault/ascii-wind-2). When the Details MCP is
 * authenticated, compare against the Vault original and tune the constants
 * below (DESIGN.md → Effects → ASCII wind).
 *
 * Canvas 2D, one fillText per visible cell, batched into a handful of alpha
 * buckets so fillStyle changes ~8×/frame. ~9k cells at 1440×900 → 3–5 ms.
 * Pauses when hidden; one still frame under prefers-reduced-motion.
 */

export interface WindOptions {
  /** cell size in css px */
  cell?: number;
  /** wind speed (cells/s) */
  speed?: number;
  night?: boolean;
}

const RAMP = " .·:-~=+*≈%#";
const BUCKETS = 8;

// ---------- value noise ----------

const PERM = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  let seed = 1337;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

function hash(x: number, y: number) {
  return PERM[(PERM[x & 255] + y) & 511] / 255;
}

function noise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number) {
  return noise(x, y) * 0.55 + noise(x * 2.03, y * 2.03) * 0.3 + noise(x * 4.11, y * 4.11) * 0.15;
}

// ---------- the effect ----------

export class AsciiWind {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private t0 = performance.now();
  private w = 0;
  private h = 0;
  private cols = 0;
  private rows = 0;
  private pointer = { x: -1e4, y: -1e4, vx: 0, vy: 0, strength: 0, target: 0 };
  private night: number;
  private nightTarget: number;
  private still: boolean;
  private opts: Required<WindOptions>;

  constructor(
    private canvas: HTMLCanvasElement,
    opts: WindOptions = {},
  ) {
    this.opts = { cell: 14, speed: 5.5, night: false, ...opts };
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.night = this.nightTarget = this.opts.night ? 1 : 0;
    this.still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("pointermove", this.onPointer, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.frame();
  }

  setNight(on: boolean) {
    this.nightTarget = on ? 1 : 0;
    if (this.still) this.draw((performance.now() - this.t0) / 1000);
  }

  private onVisibility = () => {
    cancelAnimationFrame(this.raf);
    if (!document.hidden) this.frame();
  };

  private onPointer = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    this.pointer.vx = x - this.pointer.x;
    this.pointer.vy = y - this.pointer.y;
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.target = 1;
  };

  private resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cols = Math.ceil(this.w / (this.opts.cell * 0.62));
    this.rows = Math.ceil(this.h / this.opts.cell);
    if (this.still) this.draw(0);
  };

  private frame = () => {
    const t = (performance.now() - this.t0) / 1000;
    this.draw(t);
    if (!this.still) this.raf = requestAnimationFrame(this.frame);
  };

  private draw(t: number) {
    const { ctx, cols, rows } = this;
    const cell = this.opts.cell;
    const cw = cell * 0.62;
    this.night += (this.nightTarget - this.night) * 0.06;
    const n = this.night;
    const p = this.pointer;
    p.strength += (p.target - p.strength) * 0.06;
    p.target *= 0.985; // a gust fades unless the pointer keeps moving

    // paper #f6f3ec → navy #0a111f
    const bg = mixRgb([246, 243, 236], [10, 17, 31], n);
    ctx.fillStyle = `rgb(${bg[0]} ${bg[1]} ${bg[2]})`;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.font = `500 ${cell * 0.92}px "Hanken Grotesk Variable", ui-monospace, monospace`;
    ctx.textBaseline = "top";

    const ink = mixRgb([32, 30, 25], [148, 178, 214], n); // ink by day, pale federal blue by night
    const accent = mixRgb([50, 91, 180], [84, 184, 238], n);
    const buckets: Array<Array<[number, number, string]>> = Array.from({ length: BUCKETS }, () => []);
    const hot: Array<[number, number, string, number]> = [];

    const drift = t * this.opts.speed * 0.045;
    const radius = 170;
    for (let r = 0; r < rows; r++) {
      const y = r * cell;
      // a slow swell under the wind: rows bend with time
      const swell = Math.sin(r * 0.11 + t * 0.35) * 0.6;
      for (let c = 0; c < cols; c++) {
        const x = c * cw;
        // domain-warped, horizontally stretched noise reads as gusts of wind
        const warp = noise(c * 0.012 + t * 0.04, r * 0.07 - t * 0.03) * 2.2;
        let sx = c * 0.022 - drift + swell * 0.08 + warp;
        let sy = r * 0.21 + Math.sin(c * 0.018 + t * 0.15) * 0.5 + warp * 0.35;
        // the pointer is a gust: it pushes the field and lights it up
        const dx = x - p.x;
        const dy = y - p.y;
        const d2 = dx * dx + dy * dy;
        let lift = 0;
        if (p.strength > 0.01 && d2 < radius * radius) {
          const f = (1 - Math.sqrt(d2) / radius) ** 2 * p.strength;
          sx -= (dx / radius) * f * 1.4 + p.vx * 0.002 * f;
          sy -= (dy / radius) * f * 1.4;
          lift = f;
        }
        let v = fbm(sx, sy);
        // streaks: wind reads as long thin bands
        v = Math.max(0, v - 0.33) * 1.9;
        v = v * v * (3 - 2 * Math.min(1, v));
        v = Math.min(1, v + lift * 0.35);
        if (v < 0.06) continue;
        const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))];
        if (ch === " ") continue;
        if (lift > 0.25) hot.push([x, y, ch, lift]);
        else buckets[Math.min(BUCKETS - 1, Math.floor(v * BUCKETS))].push([x, y, ch]);
      }
    }
    for (let b = 0; b < BUCKETS; b++) {
      const a = (0.1 + (b / (BUCKETS - 1)) * 0.62) * (n > 0.5 ? 1.1 : 0.9);
      ctx.fillStyle = `rgb(${ink[0]} ${ink[1]} ${ink[2]} / ${a.toFixed(3)})`;
      for (const [x, y, ch] of buckets[b]) ctx.fillText(ch, x, y);
    }
    for (const [x, y, ch, l] of hot) {
      ctx.fillStyle = `rgb(${accent[0]} ${accent[1]} ${accent[2]} / ${(0.35 + l * 0.55).toFixed(3)})`;
      ctx.fillText(ch, x, y);
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("pointermove", this.onPointer);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }
}

function mixRgb(a: number[], b: number[], t: number) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}
