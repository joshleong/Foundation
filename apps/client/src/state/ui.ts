/**
 * Shell UI state — what's open, which layer is showing. Tiny external store;
 * nothing here is shared with other people (that's the board doc).
 *
 * The top bar's tabs are spaces (boards: a grid, a deck, a web page). The left
 * pane lists them (recent, or by project folder) or shows the open space's own
 * people and activity. A session with the agent is a column of its own, opened
 * from the bottom bar.
 *
 * The floor: the side pane, the top bar, an open session and the search pane
 * are drawn on the paper itself, not floated over it. `floorInsets()` says how
 * much of the screen they take on each side; the grid masks its cards out of
 * that ground and frames into what's left.
 */

import { useSyncExternalStore } from "react";

/**
 * A conversation with the agent (or a Vision Code thread), shown in the session
 * column. Opened from the bottom bar; it is not a tab: the tabs are spaces.
 */
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
  /** the left pane: open or folded away, and which of its two faces shows */
  pane: boolean;
  paneW: number;
  /** "spaces": every space, by recent or by project folder · "info": the open space's own people and activity */
  paneView: "spaces" | "info";
  spacesView: "recent" | "folders";
  /** the top bar's tabs: the spaces open in this window (board ids), in order */
  spaces: string[];
  /** sessions opened in this window, and the one showing in the session column (null: none) */
  sessions: SessionTab[];
  session: string | null;
  sessionW: number;
  /** text queued into the showing agent session's composer */
  draft: string;
  /** the search pane on the right */
  search: boolean;
  searchW: number;
  /** cards the showing session touched — ringed on the grid */
  touched: string[];
  /** my role on the board that's showing: a viewer reads, and edits snap back */
  role: "admin" | "member" | "viewer";
}

export const TOP_BAR = 44;
export const WIDTHS = {
  pane: { min: 220, max: 420, initial: 272 },
  session: { min: 360, max: 720, initial: 460 },
  search: { min: 300, max: 600, initial: 380 },
};

const KEY = "foundation-floor";
type Stored = Pick<UiState, "pane" | "paneW" | "paneView" | "spacesView" | "spaces" | "sessions" | "session" | "sessionW" | "search" | "searchW">;

function stored(): Partial<Stored> {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Stored> & { tabs?: SessionTab[]; tab?: string | null };
    // before spaces, sessions were the top bar's tabs
    if (s.sessions === undefined && Array.isArray(s.tabs)) s.sessions = s.tabs;
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
  paneView: s0.paneView === "info" ? "info" : "spaces",
  spacesView: s0.spacesView === "folders" ? "folders" : "recent",
  spaces: Array.isArray(s0.spaces) ? s0.spaces.filter((id) => typeof id === "string").slice(0, 24) : [],
  sessions: Array.isArray(s0.sessions) ? s0.sessions.filter((t) => t && typeof t.id === "string").slice(0, 12) : [],
  session: null,
  sessionW: clampW(s0.sessionW, WIDTHS.session),
  draft: "",
  search: s0.search ?? false,
  searchW: clampW(s0.searchW, WIDTHS.search),
  touched: [],
  role: "member",
};
if (s0.session && ui.sessions.some((t) => t.id === s0.session)) ui.session = s0.session;

const listeners = new Set<() => void>();

export function getUi() {
  return ui;
}
/** the least open paper the grid keeps: below it, the side pane folds to make room */
export const MIN_PAPER = 440;

export function setUi(patch: Partial<UiState>) {
  const before = ui;
  ui = { ...ui, ...patch };
  if (patch.session !== undefined && patch.session !== before.session) ui.touched = patch.touched ?? [];
  // opening a session or search (or widening one) on a narrow screen: the side pane gives way
  const opened = (ui.session && !before.session) || (ui.search && !before.search) || ui.sessionW > before.sessionW || ui.searchW > before.searchW;
  if (opened && ui.pane && patch.pane === undefined && typeof window !== "undefined") {
    const f = floorInsets(ui);
    if (window.innerWidth - f.left - f.right < MIN_PAPER) ui.pane = false;
  }
  // the side pane opened by hand beside a session: it stays (it was asked for); the session narrows to make room,
  // then search closes, then the pane itself narrows, so the grid keeps its paper instead of a sliver
  if (patch.pane === true && !before.pane && typeof window !== "undefined") {
    const short = () => MIN_PAPER - (window.innerWidth - floorInsets(ui).left - floorInsets(ui).right);
    if (short() > 0 && ui.session) ui.sessionW = Math.max(WIDTHS.session.min, ui.sessionW - short());
    if (short() > 0 && ui.search) ui.search = false;
    if (short() > 0) ui.paneW = Math.max(WIDTHS.pane.min, ui.paneW - short());
  }
  if ((["pane", "paneW", "paneView", "spacesView", "spaces", "sessions", "session", "sessionW", "search", "searchW"] as const).some((k) => k in patch)) {
    try {
      const keep: Stored = { pane: ui.pane, paneW: ui.paneW, paneView: ui.paneView, spacesView: ui.spacesView, spaces: ui.spaces, sessions: ui.sessions, session: ui.session, sessionW: ui.sessionW, search: ui.search, searchW: ui.searchW };
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

/**
 * Keep the grid at least MIN_PAPER wide when the window can't hold every
 * open pane (a narrow window, or a layout remembered from a wider one): the
 * side pane folds first, then search closes. Runs at start and on resize.
 */
export function fitFloor() {
  if (typeof window === "undefined") return;
  const room = () => window.innerWidth - floorInsets(ui).left - floorInsets(ui).right;
  const patch: Partial<UiState> = {};
  if (room() < MIN_PAPER && ui.pane) patch.pane = false;
  if (room() - (patch.pane === false ? ui.paneW : 0) < MIN_PAPER && ui.search && ui.session) patch.search = false;
  if (Object.keys(patch).length) setUi(patch);
}
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => fitFloor());
  queueMicrotask(fitFloor);
}

/** how much of the screen the floor chrome takes on each side (px) */
export function floorInsets(u: UiState = ui) {
  if (u.presenting) return { left: 0, top: 0, right: 0, bottom: 0 };
  const session = u.session ? u.sessionW : 0;
  return { left: (u.pane ? u.paneW : 0) + session, top: TOP_BAR, right: u.search ? u.searchW : 0, bottom: 0 };
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(text: string, tone?: NonNullable<UiState["toast"]>["tone"]) {
  setUi({ toast: { text, tone, at: Date.now() } });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setUi({ toast: null }), 3600);
}

const sid = () => `ses_${Math.random().toString(36).slice(2, 12)}`;
/** a session id for a turn that runs without the column open (the crew: asked from the voice sheet) */
export const newSessionId = sid;

/** show a session in the column (adding it to this window's if it's new here) */
export function openSession(t: SessionTab) {
  const sessions = ui.sessions.some((x) => x.id === t.id) ? ui.sessions : [...ui.sessions, t].slice(-12);
  setUi({ sessions, session: t.id, command: false });
}

/** a fresh agent session, with an optional first message waiting in its composer */
export function newSession(draft = "") {
  const t: SessionTab = { id: sid(), kind: "agent", title: "New session" };
  setUi({ sessions: [...ui.sessions, t].slice(-12), session: t.id, draft, command: false });
  return t;
}

/** the bottom bar's button: put the conversation away if it's showing, else bring back the last one (or start one) */
export function toggleSession() {
  if (ui.session) return setUi({ session: null });
  const last = ui.sessions[ui.sessions.length - 1];
  if (last) setUi({ session: last.id });
  else newSession();
}

/** drop a session from this window (the server keeps it; the history lists it) */
export function closeSession(id: string) {
  if (!ui.sessions.some((t) => t.id === id)) return;
  setUi({ sessions: ui.sessions.filter((t) => t.id !== id), session: ui.session === id ? null : ui.session });
}

export function renameSession(id: string, title: string) {
  if (!ui.sessions.some((t) => t.id === id && t.title !== title)) return;
  setUi({ sessions: ui.sessions.map((t) => (t.id === id ? { ...t, title } : t)) });
}

/** "ask the agent": into the agent session that's showing, else a new one */
export function askAgent(text: string) {
  const showing = ui.sessions.find((t) => t.id === ui.session);
  if (showing?.kind === "agent") setUi({ draft: text, command: false });
  else newSession(text);
}

// ---------- spaces: the top bar's tabs ----------

const OPENED = "foundation-space-opened";
/** when each space was last opened on this device (for Recent) */
export function spaceOpenedAt(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(OPENED) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/** a space is showing: it has a tab, and it's the most recent */
export function noteSpaceOpen(id: string) {
  try {
    localStorage.setItem(OPENED, JSON.stringify({ ...spaceOpenedAt(), [id]: Date.now() }));
  } catch { /* private window */ }
  if (!ui.spaces.includes(id)) setUi({ spaces: [...ui.spaces, id].slice(-24) });
}

/** close a tab; says which space to show now when the closed one was showing (null: nothing changes) */
export function closeSpaceTab(id: string, current: string): string | null {
  const i = ui.spaces.indexOf(id);
  if (i < 0 || ui.spaces.length < 2) return null;
  const spaces = ui.spaces.filter((x) => x !== id);
  setUi({ spaces });
  return id === current ? spaces[Math.min(i, spaces.length - 1)] : null;
}
