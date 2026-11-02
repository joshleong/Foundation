/**
 * Shell UI state — what's open, which layer is showing. Tiny external store;
 * nothing here is shared with other people (that's the board doc).
 *
 * The floor: the side pane, the top bar, an open session and the search pane
 * are drawn on the paper itself, not floated over it. `floorInsets()` says how
 * much of the screen they take on each side; the grid masks its cards out of
 * that ground and frames into what's left.
 */

import { useSyncExternalStore } from "react";

/** a tab in the top bar: the board is always first and isn't one of these */
export interface SessionTab {
  id: string;
  /** "agent": a Foundation agent session on this board · "t3": a Vision Code thread, read-only */
  kind: "agent" | "t3";
  title: string;
}

export interface UiState {
  /** the meta layer: agents, presence rings, app port wires */
  agentLayer: boolean;
  command: boolean;
  presenting: boolean;
  view: "grid" | "company";
  /** a card whose app frame is "engaged" (live input); others show a still */
  engaged: string | null;
  toast: { text: string; tone?: "ok" | "warn" | "bad" | "agent"; at: number } | null;
  /** the side pane (sessions, boards, activity, settings): open or folded away */
  pane: boolean;
  paneW: number;
  /** open session tabs, and which one is showing (null: just the board) */
  tabs: SessionTab[];
  tab: string | null;
  sessionW: number;
  /** text queued into the showing agent session's composer */
  draft: string;
  /** the search pane on the right */
  search: boolean;
  searchW: number;
  /** cards the showing session touched — ringed on the grid */
  touched: string[];
}

export const TOP_BAR = 44;
export const WIDTHS = {
  pane: { min: 220, max: 420, initial: 272 },
  session: { min: 360, max: 720, initial: 460 },
  search: { min: 300, max: 600, initial: 380 },
};

const KEY = "foundation-floor";
type Stored = Pick<UiState, "pane" | "paneW" | "tabs" | "tab" | "sessionW" | "search" | "searchW">;

function stored(): Partial<Stored> {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Stored>;
    // the old key, from before the floor
    if (s.pane === undefined && localStorage.getItem("foundation-pane") === "open") s.pane = true;
    return s;
  } catch {
    return {};
  }
}

const s0 = stored();
const clampW = (v: number | undefined, w: { min: number; max: number; initial: number }) =>
  typeof v === "number" && isFinite(v) ? Math.max(w.min, Math.min(w.max, v)) : w.initial;

let ui: UiState = {
  agentLayer: false,
  command: false,
  presenting: false,
  view: "grid",
  engaged: null,
  toast: null,
  pane: s0.pane ?? false,
  paneW: clampW(s0.paneW, WIDTHS.pane),
  tabs: Array.isArray(s0.tabs) ? s0.tabs.filter((t) => t && typeof t.id === "string").slice(0, 12) : [],
  tab: null,
  sessionW: clampW(s0.sessionW, WIDTHS.session),
  draft: "",
  search: s0.search ?? false,
  searchW: clampW(s0.searchW, WIDTHS.search),
  touched: [],
};
if (s0.tab && ui.tabs.some((t) => t.id === s0.tab)) ui.tab = s0.tab;

const listeners = new Set<() => void>();

export function getUi() {
  return ui;
}
export function setUi(patch: Partial<UiState>) {
  const before = ui;
  ui = { ...ui, ...patch };
  if (patch.tab !== undefined && patch.tab !== before.tab) ui.touched = patch.touched ?? [];
  if ((["pane", "paneW", "tabs", "tab", "sessionW", "search", "searchW"] as const).some((k) => k in patch)) {
    try {
      const keep: Stored = { pane: ui.pane, paneW: ui.paneW, tabs: ui.tabs, tab: ui.tab, sessionW: ui.sessionW, search: ui.search, searchW: ui.searchW };
      localStorage.setItem(KEY, JSON.stringify(keep));
    } catch { /* private window */ }
  }
  for (const fn of listeners) fn();
}
export function useUi(): UiState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => ui,
  );
}

/** how much of the screen the floor chrome takes on each side (px) */
export function floorInsets(u: UiState = ui) {
  if (u.presenting) return { left: 0, top: 0, right: 0, bottom: 0 };
  const session = u.tab ? u.sessionW : 0;
  return { left: (u.pane ? u.paneW : 0) + session, top: TOP_BAR, right: u.search ? u.searchW : 0, bottom: 0 };
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(text: string, tone?: NonNullable<UiState["toast"]>["tone"]) {
  setUi({ toast: { text, tone, at: Date.now() } });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setUi({ toast: null }), 3600);
}

const sid = () => `ses_${Math.random().toString(36).slice(2, 12)}`;

/** open a tab (or show it if it's already open) */
export function openTab(t: SessionTab) {
  const tabs = ui.tabs.some((x) => x.id === t.id) ? ui.tabs : [...ui.tabs, t];
  setUi({ tabs, tab: t.id, command: false });
}

/** a fresh agent session tab, with an optional first message waiting in its composer */
export function newSession(draft = "") {
  const t: SessionTab = { id: sid(), kind: "agent", title: "New session" };
  setUi({ tabs: [...ui.tabs, t], tab: t.id, draft, command: false });
  return t;
}

export function closeTab(id: string) {
  const i = ui.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const tabs = ui.tabs.filter((t) => t.id !== id);
  const tab = ui.tab === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : ui.tab;
  setUi({ tabs, tab });
}

export function renameTab(id: string, title: string) {
  if (!ui.tabs.some((t) => t.id === id && t.title !== title)) return;
  setUi({ tabs: ui.tabs.map((t) => (t.id === id ? { ...t, title } : t)) });
}

/** "ask the agent": into the agent session that's showing, else a new one */
export function askAgent(text: string) {
  const showing = ui.tabs.find((t) => t.id === ui.tab);
  if (showing?.kind === "agent") setUi({ draft: text, command: false });
  else newSession(text);
}
