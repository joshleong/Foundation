/**
 * @foundation/ui — design tokens in TypeScript (for canvas/WebGL surfaces
 * that can't read CSS), the night engine, and the motion constants.
 * DESIGN.md is the contract.
 */

export const paper = {
  void: "#f6f3ec",
  abyss: "#fcfbf7",
  panel: "#efece3",
  raise: "#ffffff",
  frost: "#201e19",
  mist: "#5f5b51",
  dim: "#8a8577",
  pulse: "#325bb4",
  volt: "#27488f",
  moss: "#2e5d43",
  ok: "#2e7d54",
  warn: "#a16207",
  bad: "#b3261e",
  agent: "#6b5bd6",
} as const;

export const night = {
  void: "#0a111f",
  abyss: "#111a2c",
  panel: "#0d1526",
  raise: "#172239",
  frost: "#e6ecf7",
  mist: "#94a2b9",
  dim: "#5f6e85",
  pulse: "#54b8ee",
  volt: "#2492cc",
  moss: "#2fc98f",
  ok: "#2fc98f",
  warn: "#e89b2c",
  bad: "#e4574e",
  agent: "#8f76ee",
} as const;

export const viz = {
  day: ["#325bb4", "#c07a10", "#2e7d54", "#6b5bd6", "#1f8f9c", "#b3476e", "#64748b", "#8b7ae6"],
  night: ["#3f97d6", "#c97a1c", "#27a877", "#8f76ee", "#2ab0be", "#d8628f", "#8ea0b8", "#b39cff"],
} as const;

/** Spring presets (stiffness, damping, mass) — shared with Vision's motion.ts. */
export const springs = {
  camera: { stiffness: 170, damping: 26, mass: 1 },
  pop: { stiffness: 260, damping: 20, mass: 1 },
  drag: { stiffness: 550, damping: 38, mass: 1 },
  soft: { stiffness: 90, damping: 22, mass: 1 },
  /** presentation-mode glide: long, no overshoot */
  glide: { stiffness: 120, damping: 24, mass: 1 },
} as const;

export const durations = { press: 80, quick: 160, pane: 280, lift: 350, rise: 800, delightMax: 600 } as const;
export const easings = {
  outSoft: [0.22, 1, 0.36, 1],
  move: [0.2, 0.8, 0.2, 1],
  spring: [0.22, 1.4, 0.36, 1],
  settle: [0.22, 1.3, 0.36, 1],
} as const;

// ---------- night engine ----------

const KEY = "foundation-night";
type Listener = (isNight: boolean) => void;
const listeners = new Set<Listener>();

export function isNight(): boolean {
  return document.documentElement.classList.contains("is-night");
}

export function setNight(on: boolean, persist = true) {
  document.documentElement.classList.toggle("is-night", on);
  if (persist) {
    try {
      localStorage.setItem(KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }
  for (const fn of listeners) fn(on);
}

export function onNight(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** First launch follows the OS; after that the orb's choice is remembered. */
export function initNight() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  const on = stored === null ? window.matchMedia("(prefers-color-scheme: dark)").matches : stored === "1";
  setNight(on, false);
}
