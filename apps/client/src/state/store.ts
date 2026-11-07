/**
 * App layout state — one spreadsheet-like Grid of sections.
 *
 * The workspace is a single Grid with column/row tracks (like a spreadsheet).
 * Sections occupy rectangular spans of tracks; splitting a section subdivides
 * a track (shifting/widening every other section that touches it), and
 * resizing a track resizes every section in it. Each section is its own
 * scrollable nested grid holding primitives (tables, maps). The viewport
 * camera snaps to sections, track bands, or the whole grid.
 */

import { useSyncExternalStore } from "react";
import { isHostable, type LinkDoc, type PanelDoc } from "@foundation/protocol";
import { workbook } from "../engine/workbook";

let idCounter = 0;
export function uid(prefix: string): string {
  return `${prefix}_${++idCounter}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- types ----------

interface ObjectBase {
  id: string;
  sectionId: string;
  name: string;
  /** content-space position — used only while floating */
  x: number;
  y: number;
  /** false = docked into the section's flow grid, true = free position */
  float: boolean;
  bornAt: number;
}

export interface TableMeta extends ObjectBase {
  cols: number;
  rows: number;
}

export interface MapMeta extends ObjectBase {
  w: number;
  h: number;
  sourceTableId: string | null;
  pitched: boolean;
}

export interface NoteMeta extends ObjectBase {
  w: number;
  h: number;
  text: string;
}

export interface MediaMeta extends ObjectBase {
  w: number;
  h: number;
  src: string; // object URL (session-lifetime)
  media: "image" | "video";
  autoplay: boolean; // video only
  muted: boolean; // video only
}

/** apps, links, files, machines, agents, connectors and asks — see @foundation/protocol */
export type PanelMeta = Omit<PanelDoc, "kind">;

export type AnyObject = TableMeta | MapMeta | NoteMeta | MediaMeta | PanelMeta;

export function isPanel(o: AnyObject): o is PanelMeta {
  return "panel" in o;
}

export interface Section {
  id: string;
  name: string;
  // inclusive track spans in the grid
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  scroll: { x: number; y: number };
  /** the app this section hosts (schema 2): it fills the section, its ports sit on the section's edges */
  host?: string;
}

export interface GridTracks {
  cols: number[]; // track widths, world px
  rows: number[]; // track heights
}

/** a side of the whole board — dropping a section there appends a track for it */
export type BoardEdge = "left" | "right" | "top" | "bottom";

export type SnapTarget =
  | { kind: "all" }
  | { kind: "section"; id: string }
  | { kind: "object"; id: string };

export interface AppState {
  grid: GridTracks;
  sections: Record<string, Section>;
  tables: Record<string, TableMeta>;
  maps: Record<string, MapMeta>;
  notes: Record<string, NoteMeta>;
  media: Record<string, MediaMeta>;
  panels: Record<string, PanelMeta>;
  /** wires between app ports (the meta layer) */
  links: Record<string, LinkDoc>;
  activeSectionId: string;
  /** which layer the keyboard/context currently addresses */
  focusLevel: "grid" | "section" | "object";
  activeObjectId: string | null;
  snapRequest: (SnapTarget & { nonce: number }) | null;
  /** cell (or board edge) highlighted while a section is being dragged to a new home */
  sectionDragTarget: { sectionId: string; c: number; r: number; edge?: BoardEdge } | null;
  /** section awaiting the remove-confirmation popover (e.g. via context menu) */
  pendingRemoval: string | null;
}

// ---------- geometry constants ----------

export const CELL_W = 148;
export const CELL_H = 40;
export const HEADER_H = 52;
export const ROWNUM_W = 44;
export const COLHEAD_H = 32;

export const DEFAULT_COL_W = 1560;
export const DEFAULT_ROW_H = 1160;
export const MIN_COL_W = 420;
export const MIN_ROW_H = 340;
export const SECTION_HEADER = 42;
/** half the gap between sections: wide enough (40 px) for a road of wires between apps */
export const SECTION_INSET = 20;
export const CONTENT_PAD = 28;

export function tablePixelSize(t: { cols: number; rows: number }) {
  return {
    w: ROWNUM_W + t.cols * CELL_W,
    h: HEADER_H + COLHEAD_H + t.rows * CELL_H,
  };
}

/** height of a card's hover bar (it overlays the card; it adds nothing to the size) */
export const MINI_HEADER = 34;

export function objectPixelSize(obj: AnyObject): { w: number; h: number } {
  if ("cols" in obj) return tablePixelSize(obj);
  if ("sourceTableId" in obj) return { w: obj.w, h: obj.h + HEADER_H };
  return { w: obj.w, h: obj.h }; // cards rest without a header bar; it overlays on hover
}

/** every primitive living in a section */
export function objectsInSection(sectionId: string): AnyObject[] {
  const st = getState();
  const all: AnyObject[] = [
    ...Object.values(st.tables),
    ...Object.values(st.maps),
    ...Object.values(st.notes),
    ...Object.values(st.media),
    ...Object.values(st.panels),
  ];
  return all.filter((o) => o.sectionId === sectionId);
}

export function allObjects(): AnyObject[] {
  const st = getState();
  return [
    ...Object.values(st.tables),
    ...Object.values(st.maps),
    ...Object.values(st.notes),
    ...Object.values(st.media),
    ...Object.values(st.panels),
  ];
}

const FLOW_GAP = 26;

/**
 * Flow layout for a section's docked primitives: shelves packed
 * left-to-right in creation order, wrapping at the section width, and
 * flowing AROUND floating cards so nothing ever overlays anything.
 */
let layoutCacheState: AppState | null = null;
const layoutCache = new Map<string, Map<string, { x: number; y: number }>>();

export function sectionLayout(sectionId: string): Map<string, { x: number; y: number }> {
  const st = getState();
  // overlays ask for layouts every frame; the answer only changes with state
  if (layoutCacheState !== st) {
    layoutCacheState = st;
    layoutCache.clear();
  }
  const hit = layoutCache.get(sectionId);
  if (hit) return hit;
  const computed = computeSectionLayout(st, sectionId);
  layoutCache.set(sectionId, computed);
  return computed;
}

function computeSectionLayout(st: AppState, sectionId: string): Map<string, { x: number; y: number }> {
  const sec = st.sections[sectionId];
  const out = new Map<string, { x: number; y: number }>();
  if (!sec) return out;
  const card = sectionCardRect(st.grid, sec);
  const availW = Math.max(360, card.w - CONTENT_PAD * 2);
  const all = objectsInSection(sectionId).filter((o) => o.id !== sec.host); // the hosted app isn't in the flow
  const docked = all.filter((o) => !o.float).sort((a, b) => a.bornAt - b.bornAt);
  const floaters = all
    .filter((o) => o.float)
    .map((o) => {
      const s = objectPixelSize(o);
      return { x: o.x, y: o.y, w: s.w, h: s.h };
    });
  const collide = (x: number, y: number, w: number, h: number) =>
    floaters.find(
      (f) =>
        x < f.x + f.w + FLOW_GAP &&
        x + w + FLOW_GAP > f.x &&
        y < f.y + f.h + FLOW_GAP &&
        y + h + FLOW_GAP > f.y,
    );

  let x = 0;
  let y = 0;
  let shelfH = 0;
  for (const o of docked) {
    const { w, h } = objectPixelSize(o);
    let guard = 0;
    while (guard++ < 80) {
      if (x > 0 && x + w > availW) {
        x = 0;
        y += shelfH + FLOW_GAP;
        shelfH = 0;
        continue;
      }
      const hit = collide(x, y, w, h);
      if (!hit) break;
      const nextX = hit.x + hit.w + FLOW_GAP;
      if (nextX + w <= availW) {
        x = nextX;
      } else {
        x = 0;
        y = Math.max(y + FLOW_GAP, hit.y + hit.h + FLOW_GAP);
        shelfH = 0;
      }
    }
    out.set(o.id, { x, y });
    x += w + FLOW_GAP;
    shelfH = Math.max(shelfH, h);
  }
  return out;
}

/** where an object actually sits in section content space */
export function effectivePos(obj: AnyObject): { x: number; y: number } {
  if (obj.float) return { x: obj.x, y: obj.y };
  return sectionLayout(obj.sectionId).get(obj.id) ?? { x: obj.x, y: obj.y };
}

export function trackOffsets(tracks: number[]): number[] {
  const out = [0];
  for (const t of tracks) out.push(out[out.length - 1] + t);
  return out;
}

/** full cell-span rect of a section in grid world space */
export function sectionCellRect(grid: GridTracks, s: Section) {
  const xo = trackOffsets(grid.cols);
  const yo = trackOffsets(grid.rows);
  return {
    x: xo[s.c0],
    y: yo[s.r0],
    w: xo[s.c1 + 1] - xo[s.c0],
    h: yo[s.r1 + 1] - yo[s.r0],
  };
}

/** the visible card rect (inset from the cell span) */
export function sectionCardRect(grid: GridTracks, s: Section) {
  const r = sectionCellRect(grid, s);
  return {
    x: r.x + SECTION_INSET,
    y: r.y + SECTION_INSET,
    w: r.w - SECTION_INSET * 2,
    h: r.h - SECTION_INSET * 2,
  };
}

export function gridSize(grid: GridTracks) {
  const xo = trackOffsets(grid.cols);
  const yo = trackOffsets(grid.rows);
  return { w: xo[xo.length - 1], h: yo[yo.length - 1] };
}

/** live (mid-spring) section scroll positions, written by SectionView */
export const liveScroll = new Map<string, { x: number; y: number }>();

export function getLiveScroll(id: string): { x: number; y: number } {
  return liveScroll.get(id) ?? getState().sections[id]?.scroll ?? { x: 0, y: 0 };
}

/**
 * Live (mid-spring) object positions in section content space, written by
 * the object components each animation frame — lets wires and snap targets
 * track cards while they're being dragged or reflowing.
 */
export const liveObjPos = new Map<string, { x: number; y: number }>();

/** world rect of a single grid cell */
export function gridCellRect(grid: GridTracks, c: number, r: number) {
  const xo = trackOffsets(grid.cols);
  const yo = trackOffsets(grid.rows);
  return { x: xo[c], y: yo[r], w: grid.cols[c], h: grid.rows[r] };
}

/** which grid cell contains a world point (null when outside the grid) */
export function cellAtWorld(x: number, y: number): { c: number; r: number } | null {
  const { grid } = getState();
  const xo = trackOffsets(grid.cols);
  const yo = trackOffsets(grid.rows);
  if (x < 0 || y < 0 || x >= xo[xo.length - 1] || y >= yo[yo.length - 1]) return null;
  let c = 0;
  while (c < grid.cols.length - 1 && x >= xo[c + 1]) c++;
  let r = 0;
  while (r < grid.rows.length - 1 && y >= yo[r + 1]) r++;
  return { c, r };
}

export function sectionCovering(c: number, r: number): Section | null {
  for (const s of Object.values(getState().sections)) {
    if (s.c0 <= c && c <= s.c1 && s.r0 <= r && r <= s.r1) return s;
  }
  return null;
}

/** grid cells not covered by any section */
export function emptyCells(): Array<{ c: number; r: number }> {
  const { grid } = getState();
  const out: Array<{ c: number; r: number }> = [];
  for (let c = 0; c < grid.cols.length; c++) {
    for (let r = 0; r < grid.rows.length; r++) {
      if (!sectionCovering(c, r)) out.push({ c, r });
    }
  }
  return out;
}

/** the app a section hosts, if it still lives there */
export function hostOf(sectionId: string): PanelMeta | null {
  const st = getState();
  const id = st.sections[sectionId]?.host;
  const p = id ? st.panels[id] : undefined;
  return p && p.sectionId === sectionId ? p : null;
}

export function isHosted(obj: AnyObject): boolean {
  return getState().sections[obj.sectionId]?.host === obj.id;
}

/** the part of a section below its header — where a hosted app lives */
export function sectionBodyRect(grid: GridTracks, s: Section) {
  const card = sectionCardRect(grid, s);
  return { x: card.x, y: card.y + SECTION_HEADER, w: card.w, h: card.h - SECTION_HEADER };
}

/** world-space rect of an object (accounts for section position + scroll) */
export function objectWorldRect(obj: AnyObject) {
  const st = getState();
  const sec = st.sections[obj.sectionId];
  if (!sec) return null;
  if (sec.host === obj.id) return sectionBodyRect(st.grid, sec); // a hosted app is the section
  const card = sectionCardRect(st.grid, sec);
  const scroll = getLiveScroll(sec.id);
  const { w, h } = objectPixelSize(obj);
  const pos = liveObjPos.get(obj.id) ?? effectivePos(obj);
  // + the section card's 1 px border: its body is laid out inside it, and wires
  // must land where the DOM puts the card (ports sit on this rect's edges)
  return {
    x: card.x + 1 + CONTENT_PAD + pos.x - scroll.x,
    y: card.y + 1 + SECTION_HEADER + CONTENT_PAD + pos.y - scroll.y,
    w,
    h,
  };
}

/**
 * The window a wire between two objects is seen through: when both sit in one
 * section's scrolling body, that body — so a wire to a card scrolled out of
 * view runs to the section's edge rather than across the grid. Otherwise none.
 */
export function wireClipRect(a: AnyObject, b: AnyObject) {
  const sec = sharedSection(a, b);
  return sec ? sectionBodyRect(getState().grid, sec) : null;
}

/** the section whose scrolling body holds both objects (neither a hosted app), if any */
export function sharedSection(a: AnyObject, b: AnyObject) {
  const sec = a.sectionId === b.sectionId ? getState().sections[a.sectionId] : undefined;
  return sec && sec.host !== a.id && sec.host !== b.id ? sec : null;
}

/** Point an SVG wire group at its clip window (a `clipPath` with one rect inside the group), or let it run free. */
export function applyWireClip(g: SVGGElement, clip: { x: number; y: number; w: number; h: number } | null) {
  const path = g.querySelector("clipPath");
  const rect = path?.querySelector("rect");
  if (!clip || !path || !rect) {
    g.removeAttribute("clip-path");
    return;
  }
  rect.setAttribute("x", String(clip.x));
  rect.setAttribute("y", String(clip.y));
  rect.setAttribute("width", String(clip.w));
  rect.setAttribute("height", String(clip.h));
  g.setAttribute("clip-path", `url(#${path.id})`);
}

// ---------- store ----------

const firstSectionId = uid("sec");

let state: AppState = {
  grid: { cols: [DEFAULT_COL_W], rows: [DEFAULT_ROW_H] },
  sections: {
    [firstSectionId]: {
      id: firstSectionId,
      name: "Section 1",
      c0: 0,
      r0: 0,
      c1: 0,
      r1: 0,
      scroll: { x: 0, y: 0 },
    },
  },
  tables: {},
  maps: {},
  notes: {},
  media: {},
  panels: {},
  links: {},
  activeSectionId: firstSectionId,
  focusLevel: "grid",
  activeObjectId: null,
  snapRequest: { kind: "all", nonce: Math.random() },
  sectionDragTarget: null,
  pendingRemoval: null,
};

const listeners = new Set<() => void>();

/**
 * Sync bridge: the board's Y.Doc (sync/board.ts) registers here. Every local
 * change is offered to it; remote changes come back through applyRemote()
 * and are not echoed.
 */
let syncHook: ((next: AppState, prev: AppState) => void) | null = null;
let applyingRemote = false;

export function setSyncHook(fn: typeof syncHook) {
  syncHook = fn;
}

export function applyRemote(partial: Partial<AppState>) {
  applyingRemote = true;
  try {
    state = { ...state, ...partial };
    emit();
  } finally {
    applyingRemote = false;
  }
}

function emit() {
  for (const fn of listeners) fn();
}

// dev: let the browser console (and headless checks) read the live model
if (import.meta.env?.DEV && typeof window !== "undefined") (window as unknown as { __foundation: unknown }).__foundation = { getState: () => state, setState: (p: Partial<AppState>) => set(p), workbook };

export function getState(): AppState {
  return state;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Changes only when cards or sections come or go (not on every drag frame):
 * for views that look things up by id, like a session's steps.
 */
export function useObjectSetVersion(): string {
  return useSyncExternalStore(subscribe, () => {
    const st = getState();
    return [st.panels, st.notes, st.tables, st.maps, st.media, st.sections].map((r) => Object.keys(r).length).join(",");
  });
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

/** what one section draws from the store: its cards, its app, and which of them is active */
export interface SectionSnap {
  /** the cards in the section's flow (not its hosted app) */
  objects: AnyObject[];
  host: PanelMeta | null;
  /** the active card, if it's one of this section's */
  activeObjectId: string | null;
  sectionFocus: boolean;
  pendingRemoval: boolean;
}

const sectionSnaps = new Map<string, { st: AppState; snap: SectionSnap }>();

export function sectionSnap(sectionId: string): SectionSnap {
  const cached = sectionSnaps.get(sectionId);
  if (cached && cached.st === state) return cached.snap;
  const host = hostOf(sectionId);
  const objects = objectsInSection(sectionId).filter((o) => o.id !== host?.id);
  const a = state.focusLevel === "object" ? state.activeObjectId : null;
  const next: SectionSnap = {
    objects,
    host,
    activeObjectId: a && (a === host?.id || objects.some((o) => o.id === a)) ? a : null,
    sectionFocus: state.focusLevel === "section",
    pendingRemoval: state.pendingRemoval === sectionId,
  };
  const prev = cached?.snap;
  // the same cards keep the same array, so the section's layout (and its cards' props) hold
  if (prev && prev.objects.length === objects.length && prev.objects.every((o, i) => o === objects[i])) next.objects = prev.objects;
  const same =
    prev &&
    prev.objects === next.objects &&
    prev.host === next.host &&
    prev.activeObjectId === next.activeObjectId &&
    prev.sectionFocus === next.sectionFocus &&
    prev.pendingRemoval === next.pendingRemoval;
  const snap = same ? prev : next;
  sectionSnaps.set(sectionId, { st: state, snap });
  return snap;
}

/**
 * One section's slice of the store. A section re-renders when its own cards
 * change, or the active card moves into, out of or within it — not when a
 * card elsewhere is pressed, dragged or typed in (which used to re-render
 * every section and every card on the board).
 */
export function useSection(sectionId: string): SectionSnap {
  return useSyncExternalStore(subscribe, () => sectionSnap(sectionId));
}

function set(partial: Partial<AppState>) {
  const prev = state;
  state = { ...state, ...partial };
  if (!applyingRemote && syncHook) syncHook(state, prev);
  emit();
}

// ---------- snap / focus ----------

export function requestSnap(target: SnapTarget) {
  set({ snapRequest: { ...target, nonce: Math.random() } });
}

export function setActiveSection(id: string) {
  if (state.activeSectionId === id && state.focusLevel === "section" && !state.activeObjectId)
    return;
  set({ activeSectionId: id, focusLevel: "section", activeObjectId: null });
}

export function setActiveObject(id: string) {
  const found = findObject(id);
  if (!found) return;
  if (state.activeObjectId === id && state.focusLevel === "object") return;
  set({
    activeObjectId: id,
    activeSectionId: found.obj.sectionId,
    focusLevel: "object",
  });
}

export function setFocusGrid() {
  if (state.focusLevel === "grid") return;
  set({ focusLevel: "grid", activeObjectId: null });
}

/** step one level up: object → section → grid */
export function focusUp() {
  if (state.focusLevel === "object") {
    set({ focusLevel: "section", activeObjectId: null });
    requestSnap({ kind: "section", id: state.activeSectionId });
  } else if (state.focusLevel === "section") {
    set({ focusLevel: "grid", activeObjectId: null });
    requestSnap({ kind: "all" });
  } else {
    requestSnap({ kind: "all" });
  }
}

export function getObject(id: string): AnyObject | null {
  return findObject(id)?.obj ?? null;
}

/** spatially nearest section in a direction (for section-level arrows) */
export function neighborSection(fromId: string, dir: "left" | "right" | "up" | "down"): Section | null {
  const st = getState();
  const cur = st.sections[fromId];
  if (!cur) return null;
  const cr = sectionCellRect(st.grid, cur);
  const cx = cr.x + cr.w / 2;
  const cy = cr.y + cr.h / 2;
  let best: { s: Section; score: number } | null = null;
  for (const s of Object.values(st.sections)) {
    if (s.id === fromId) continue;
    const r = sectionCellRect(st.grid, s);
    const x = r.x + r.w / 2;
    const y = r.y + r.h / 2;
    const dx = x - cx;
    const dy = y - cy;
    let primary = 0;
    let cross = 0;
    if (dir === "left") [primary, cross] = [-dx, Math.abs(dy)];
    else if (dir === "right") [primary, cross] = [dx, Math.abs(dy)];
    else if (dir === "up") [primary, cross] = [-dy, Math.abs(dx)];
    else [primary, cross] = [dy, Math.abs(dx)];
    if (primary <= 1) continue; // wrong direction
    const score = primary + cross * 2;
    if (!best || score < best.score) best = { s, score };
  }
  return best?.s ?? null;
}

// ---------- section actions ----------

let sectionCount = 1;

/**
 * Split a section like a spreadsheet: if it spans multiple tracks, hand the
 * later tracks to the new section; if it spans exactly one, subdivide that
 * track in half — every other section touching the track shifts or widens.
 */
export function splitSection(sectionId: string, dir: "h" | "v") {
  const s = state.sections[sectionId];
  if (!s) return;
  const grid: GridTracks = { cols: [...state.grid.cols], rows: [...state.grid.rows] };
  const sections: Record<string, Section> = { ...state.sections };
  sectionCount++;
  const fresh: Section = {
    id: uid("sec"),
    name: `Section ${sectionCount}`,
    c0: 0,
    r0: 0,
    c1: 0,
    r1: 0,
    scroll: { x: 0, y: 0 },
  };

  if (dir === "h") {
    const span = s.c1 - s.c0 + 1;
    if (span > 1) {
      const mid = s.c0 + Math.ceil(span / 2);
      Object.assign(fresh, { c0: mid, c1: s.c1, r0: s.r0, r1: s.r1 });
      sections[sectionId] = { ...s, c1: mid - 1 };
    } else {
      const k = s.c0;
      const w = grid.cols[k];
      grid.cols.splice(k, 1, Math.round(w / 2), Math.round(w / 2));
      for (const o of Object.values(sections)) {
        if (o.id === sectionId) continue;
        const n = { ...o };
        if (n.c0 > k) n.c0++;
        if (n.c1 >= k) n.c1++;
        sections[o.id] = n;
      }
      Object.assign(fresh, { c0: k + 1, c1: k + 1, r0: s.r0, r1: s.r1 });
      sections[sectionId] = { ...s };
    }
  } else {
    const span = s.r1 - s.r0 + 1;
    if (span > 1) {
      const mid = s.r0 + Math.ceil(span / 2);
      Object.assign(fresh, { r0: mid, r1: s.r1, c0: s.c0, c1: s.c1 });
      sections[sectionId] = { ...s, r1: mid - 1 };
    } else {
      const k = s.r0;
      const h = grid.rows[k];
      grid.rows.splice(k, 1, Math.round(h / 2), Math.round(h / 2));
      for (const o of Object.values(sections)) {
        if (o.id === sectionId) continue;
        const n = { ...o };
        if (n.r0 > k) n.r0++;
        if (n.r1 >= k) n.r1++;
        sections[o.id] = n;
      }
      Object.assign(fresh, { r0: k + 1, r1: k + 1, c0: s.c0, c1: s.c1 });
      sections[sectionId] = { ...s };
    }
  }

  sections[fresh.id] = fresh;
  set({
    grid,
    sections,
    activeSectionId: fresh.id,
    snapRequest: { kind: "section", id: fresh.id, nonce: Math.random() },
  });
}

/**
 * Add a fresh section beside an existing one — inserts a new track next to
 * the section's span (spreadsheet insert-column/row: later sections shift,
 * ranges crossing the insertion point widen).
 */
export function addSectionAdjacent(
  sectionId: string,
  dir: "right" | "below" | "left" | "above",
) {
  const s = state.sections[sectionId];
  if (!s) return;
  const grid: GridTracks = { cols: [...state.grid.cols], rows: [...state.grid.rows] };
  const sections: Record<string, Section> = { ...state.sections };
  sectionCount++;
  const fresh: Section = {
    id: uid("sec"),
    name: `Section ${sectionCount}`,
    c0: 0,
    r0: 0,
    c1: 0,
    r1: 0,
    scroll: { x: 0, y: 0 },
  };

  if (dir === "right" || dir === "left") {
    // new track index: after the span for "right", before it for "left"
    const k = dir === "right" ? s.c1 + 1 : s.c0;
    grid.cols.splice(k, 0, grid.cols[dir === "right" ? s.c1 : s.c0]);
    for (const o of Object.values(sections)) {
      const n = { ...o };
      if (n.c0 >= k) n.c0++;
      if (n.c1 >= k) n.c1++;
      sections[o.id] = n;
    }
    const home = sections[sectionId]; // may have shifted
    Object.assign(fresh, { c0: k, c1: k, r0: home.r0, r1: home.r1 });
  } else {
    const k = dir === "below" ? s.r1 + 1 : s.r0;
    grid.rows.splice(k, 0, grid.rows[dir === "below" ? s.r1 : s.r0]);
    for (const o of Object.values(sections)) {
      const n = { ...o };
      if (n.r0 >= k) n.r0++;
      if (n.r1 >= k) n.r1++;
      sections[o.id] = n;
    }
    const home = sections[sectionId];
    Object.assign(fresh, { r0: k, r1: k, c0: home.c0, c1: home.c1 });
  }

  sections[fresh.id] = fresh;
  set({
    grid,
    sections,
    activeSectionId: fresh.id,
    snapRequest: { kind: "section", id: fresh.id, nonce: Math.random() },
  });
}

/**
 * Remove a section and everything in it. A neighbor sharing the exact same
 * track span on one axis absorbs the freed space; tracks no section uses
 * anymore are pruned (spreadsheet delete-column/row).
 */
export function removeSection(id: string) {
  const doomed = state.sections[id];
  if (!doomed || Object.keys(state.sections).length <= 1) return;

  // drop the section's objects
  const tables = { ...state.tables };
  const maps = { ...state.maps };
  const notes = { ...state.notes };
  const media = { ...state.media };
  for (const t of Object.values(tables)) {
    if (t.sectionId === id) {
      workbook.removeTable(t.id);
      delete tables[t.id];
    }
  }
  for (const m of Object.values(maps)) if (m.sectionId === id) delete maps[m.id];
  for (const n of Object.values(notes)) if (n.sectionId === id) delete notes[n.id];
  for (const m of Object.values(media)) {
    if (m.sectionId === id) {
      URL.revokeObjectURL(m.src);
      delete media[m.id];
    }
  }

  const sections: Record<string, Section> = { ...state.sections };
  delete sections[id];

  // let an aligned neighbor absorb the hole
  const others = Object.values(sections);
  const above = others.find((o) => o.c0 === doomed.c0 && o.c1 === doomed.c1 && o.r1 === doomed.r0 - 1);
  const below = others.find((o) => o.c0 === doomed.c0 && o.c1 === doomed.c1 && o.r0 === doomed.r1 + 1);
  const left = others.find((o) => o.r0 === doomed.r0 && o.r1 === doomed.r1 && o.c1 === doomed.c0 - 1);
  const right = others.find((o) => o.r0 === doomed.r0 && o.r1 === doomed.r1 && o.c0 === doomed.c1 + 1);
  if (above) sections[above.id] = { ...above, r1: doomed.r1 };
  else if (below) sections[below.id] = { ...below, r0: doomed.r0 };
  else if (left) sections[left.id] = { ...left, c1: doomed.c1 };
  else if (right) sections[right.id] = { ...right, c0: doomed.c0 };

  // prune tracks nothing spans anymore
  const grid: GridTracks = { cols: [...state.grid.cols], rows: [...state.grid.rows] };
  pruneEmptyTracks(grid, sections);

  const nextActive =
    state.activeSectionId === id ? Object.keys(sections)[0] : state.activeSectionId;
  const objGone =
    state.activeObjectId !== null && !getObjectIn(state.activeObjectId, tables, maps, notes, media);
  set({
    grid,
    sections,
    tables,
    maps,
    notes,
    media,
    activeSectionId: nextActive,
    ...(objGone ? { activeObjectId: null, focusLevel: "grid" as const } : {}),
    snapRequest: { kind: "all", nonce: Math.random() },
    pendingRemoval: null,
  });
}

function getObjectIn(
  id: string,
  ...records: Array<Record<string, AnyObject>>
): AnyObject | undefined {
  for (const r of records) if (r[id]) return r[id];
  return undefined;
}

/** drop tracks that no section spans anymore, shifting spans down */
/**
 * A section left a rectangle of cells empty: grow neighbours into it rather
 * than leave a void. On any side, the sections touching the hole that
 * together cover that whole side (and stay within it) extend across; the side
 * needing the fewest sections wins (one aligned neighbour is the tidiest).
 * Mutates `sections`; returns false when no side lines up (the cells stay
 * empty, each offering "+ Section").
 */
export function fillHole(sections: Record<string, Section>, hole: { c0: number; c1: number; r0: number; r1: number }): boolean {
  const others = Object.values(sections);
  type Side = { list: Section[]; grow: (o: Section) => Section };
  const tiles = (list: Section[], lo: (o: Section) => number, hi: (o: Section) => number, from: number, to: number) => {
    const sorted = [...list].sort((a, b) => lo(a) - lo(b));
    let at = from;
    for (const o of sorted) {
      if (lo(o) !== at || hi(o) > to) return false;
      at = hi(o) + 1;
    }
    return at === to + 1;
  };
  const sides: Side[] = [];
  const above = others.filter((o) => o.r1 === hole.r0 - 1 && o.c0 >= hole.c0 && o.c1 <= hole.c1);
  if (tiles(above, (o) => o.c0, (o) => o.c1, hole.c0, hole.c1)) sides.push({ list: above, grow: (o) => ({ ...o, r1: hole.r1 }) });
  const left = others.filter((o) => o.c1 === hole.c0 - 1 && o.r0 >= hole.r0 && o.r1 <= hole.r1);
  if (tiles(left, (o) => o.r0, (o) => o.r1, hole.r0, hole.r1)) sides.push({ list: left, grow: (o) => ({ ...o, c1: hole.c1 }) });
  const below = others.filter((o) => o.r0 === hole.r1 + 1 && o.c0 >= hole.c0 && o.c1 <= hole.c1);
  if (tiles(below, (o) => o.c0, (o) => o.c1, hole.c0, hole.c1)) sides.push({ list: below, grow: (o) => ({ ...o, r0: hole.r0 }) });
  const right = others.filter((o) => o.c0 === hole.c1 + 1 && o.r0 >= hole.r0 && o.r1 <= hole.r1);
  if (tiles(right, (o) => o.r0, (o) => o.r1, hole.r0, hole.r1)) sides.push({ list: right, grow: (o) => ({ ...o, c0: hole.c0 }) });
  if (!sides.length) return false;
  const best = sides.reduce((a, b) => (b.list.length < a.list.length ? b : a));
  for (const o of best.list) sections[o.id] = best.grow(o);
  return true;
}

function pruneEmptyTracks(grid: GridTracks, sections: Record<string, Section>) {
  const secList = () => Object.values(sections);
  for (let c = grid.cols.length - 1; c >= 0; c--) {
    if (grid.cols.length <= 1) break;
    if (secList().some((o) => o.c0 <= c && c <= o.c1)) continue;
    grid.cols.splice(c, 1);
    for (const o of secList()) {
      const n = { ...o };
      if (n.c0 > c) n.c0--;
      if (n.c1 >= c) n.c1--;
      sections[o.id] = n;
    }
  }
  for (let r = grid.rows.length - 1; r >= 0; r--) {
    if (grid.rows.length <= 1) break;
    if (secList().some((o) => o.r0 <= r && r <= o.r1)) continue;
    grid.rows.splice(r, 1);
    for (const o of secList()) {
      const n = { ...o };
      if (n.r0 > r) n.r0--;
      if (n.r1 >= r) n.r1--;
      sections[o.id] = n;
    }
  }
}

export function setSectionDragTarget(target: AppState["sectionDragTarget"]) {
  const a = state.sectionDragTarget;
  if (
    a?.sectionId === target?.sectionId &&
    a?.c === target?.c &&
    a?.r === target?.r &&
    a?.edge === target?.edge
  )
    return;
  set({ sectionDragTarget: target });
}

/**
 * Move a section to another grid cell: swap spans when dropping onto a
 * sibling, occupy the cell when dropping onto empty grid.
 */
export function moveSectionTo(id: string, c: number, r: number) {
  const s = state.sections[id];
  if (!s) return;
  if (s.c0 <= c && c <= s.c1 && s.r0 <= r && r <= s.r1) return; // dropped on itself
  const sections: Record<string, Section> = { ...state.sections };
  const target = sectionCovering(c, r);
  if (target) {
    sections[id] = { ...s, c0: target.c0, c1: target.c1, r0: target.r0, r1: target.r1 };
    sections[target.id] = { ...target, c0: s.c0, c1: s.c1, r0: s.r0, r1: s.r1 };
  } else {
    sections[id] = { ...s, c0: c, c1: c, r0: r, r1: r };
    // where it was is a hole now: the neighbours that line up grow into it
    const rest = { ...sections };
    delete rest[id];
    fillHole(rest, s);
    Object.assign(sections, rest);
  }
  const grid: GridTracks = { cols: [...state.grid.cols], rows: [...state.grid.rows] };
  pruneEmptyTracks(grid, sections);
  set({ grid, sections, activeSectionId: id });
}

/** which side of the board a world point lies beyond (null when inside the grid) */
export function edgeAtWorld(x: number, y: number): BoardEdge | null {
  const size = gridSize(getState().grid);
  const out = { left: -x, right: x - size.w, top: -y, bottom: y - size.h };
  let best: BoardEdge | null = null;
  let d = 0;
  for (const k of Object.keys(out) as BoardEdge[]) {
    if (out[k] > d) {
      d = out[k];
      best = k;
    }
  }
  return best;
}

/**
 * Move a section off its cell and append it along a whole side of the board:
 * a new track opens on that side and the section spans the full board beside
 * it. The hole it leaves is absorbed by an aligned neighbour, and tracks
 * nothing spans any more are pruned.
 */
export function moveSectionToEdge(id: string, edge: BoardEdge) {
  const s = state.sections[id];
  if (!s) return;
  const grid: GridTracks = { cols: [...state.grid.cols], rows: [...state.grid.rows] };
  const sections: Record<string, Section> = { ...state.sections };
  delete sections[id];
  fillHole(sections, s);
  const xo = trackOffsets(grid.cols);
  const yo = trackOffsets(grid.rows);
  // the new track takes the section's own size, within a normal track's
  const width = Math.min(DEFAULT_COL_W, Math.max(MIN_COL_W, xo[s.c1 + 1] - xo[s.c0]));
  const height = Math.min(DEFAULT_ROW_H, Math.max(MIN_ROW_H, yo[s.r1 + 1] - yo[s.r0]));
  if (edge === "left" || edge === "right") {
    if (edge === "left") {
      grid.cols.unshift(width);
      for (const o of Object.values(sections)) sections[o.id] = { ...o, c0: o.c0 + 1, c1: o.c1 + 1 };
    } else grid.cols.push(width);
    const c = edge === "left" ? 0 : grid.cols.length - 1;
    sections[id] = { ...s, c0: c, c1: c, r0: 0, r1: grid.rows.length - 1 };
  } else {
    if (edge === "top") {
      grid.rows.unshift(height);
      for (const o of Object.values(sections)) sections[o.id] = { ...o, r0: o.r0 + 1, r1: o.r1 + 1 };
    } else grid.rows.push(height);
    const r = edge === "top" ? 0 : grid.rows.length - 1;
    sections[id] = { ...s, r0: r, r1: r, c0: 0, c1: grid.cols.length - 1 };
  }
  pruneEmptyTracks(grid, sections);
  set({ grid, sections, activeSectionId: id });
}

/** create a fresh section in an uncovered grid cell */
export function createSectionAt(c: number, r: number) {
  if (sectionCovering(c, r)) return;
  sectionCount++;
  const fresh: Section = {
    id: uid("sec"),
    name: `Section ${sectionCount}`,
    c0: c,
    c1: c,
    r0: r,
    r1: r,
    scroll: { x: 0, y: 0 },
  };
  set({
    sections: { ...state.sections, [fresh.id]: fresh },
    activeSectionId: fresh.id,
    snapRequest: { kind: "section", id: fresh.id, nonce: Math.random() },
  });
}

export function renameSection(id: string, name: string) {
  const s = state.sections[id];
  if (!s || !name.trim()) return;
  set({ sections: { ...state.sections, [id]: { ...s, name: name.trim() } } });
}

/** ask a section to show its remove-confirmation popover */
export function requestRemoveSection(id: string | null) {
  if (state.pendingRemoval !== id) set({ pendingRemoval: id });
}

export function setSectionScroll(id: string, x: number, y: number) {
  const s = state.sections[id];
  if (!s) return;
  set({ sections: { ...state.sections, [id]: { ...s, scroll: { x, y } } } });
}

// ---------- track resizing (spreadsheet column/row semantics) ----------

export function resizeCol(i: number, w: number) {
  const cols = [...state.grid.cols];
  if (i < 0 || i >= cols.length) return;
  cols[i] = Math.max(MIN_COL_W, Math.min(2600, Math.round(w)));
  set({ grid: { ...state.grid, cols } });
}

export function resizeRow(i: number, h: number) {
  const rows = [...state.grid.rows];
  if (i < 0 || i >= rows.length) return;
  rows[i] = Math.max(MIN_ROW_H, Math.min(2400, Math.round(h)));
  set({ grid: { ...state.grid, rows } });
}

// ---------- float / dock ----------

type ObjKey = "tables" | "maps" | "notes" | "media" | "panels";

function findObject(id: string): { key: ObjKey; obj: AnyObject } | null {
  for (const key of ["tables", "maps", "notes", "media", "panels"] as ObjKey[]) {
    const obj = (state[key] as Record<string, AnyObject>)[id];
    if (obj) return { key, obj };
  }
  return null;
}

export function setObjectFloat(id: string, float: boolean) {
  const found = findObject(id);
  if (!found || found.obj.float === float) return;
  // when releasing into float, freeze the current flow position so the
  // object doesn't jump
  const pos = float ? effectivePos(found.obj) : { x: found.obj.x, y: found.obj.y };
  set({
    [found.key]: {
      ...(state[found.key] as Record<string, AnyObject>),
      [id]: { ...found.obj, float, x: pos.x, y: pos.y },
    },
  } as Partial<AppState>);
}

/** the section under a world point (null on empty paper or off the grid) */
export function sectionAtWorld(x: number, y: number): Section | null {
  const cell = cellAtWorld(x, y);
  return cell ? sectionCovering(cell.c, cell.r) : null;
}

/**
 * Put a card down where it was dropped: floating in its section, its top-left
 * centred-ish under the pointer (search pane drags). Keeps it inside the body.
 */
export function placeAtWorld(id: string, wx: number, wy: number) {
  const found = findObject(id);
  if (!found) return;
  const sec = state.sections[found.obj.sectionId];
  if (!sec || sec.host === id) return; // an app that became its section's app fills it
  const card = sectionCardRect(state.grid, sec);
  const scroll = getLiveScroll(sec.id);
  const { w } = objectPixelSize(found.obj);
  const x = Math.max(0, wx - card.x - 1 - CONTENT_PAD + scroll.x - Math.min(w / 2, 120));
  const y = Math.max(0, wy - card.y - 1 - SECTION_HEADER - CONTENT_PAD + scroll.y - 16);
  set({
    [found.key]: { ...(state[found.key] as Record<string, AnyObject>), [id]: { ...found.obj, float: true, x, y } },
  } as Partial<AppState>);
}

// ---------- note actions ----------

let noteCount = 0;

export function addNote(sectionId: string, text?: string, opts: { focus?: boolean } = {}): NoteMeta {
  noteCount++;
  const meta: NoteMeta = {
    id: uid("note"),
    sectionId,
    name: `Note ${noteCount}`,
    x: 0,
    y: 0,
    w: 420,
    h: 300,
    text: text ?? "## New note\n\nDouble-click to edit. **Markdown** works:\n\n- lists\n- `code`\n- [links](https://example.com)",
    float: false,
    bornAt: Date.now(),
  };
  set({
    notes: { ...state.notes, [meta.id]: meta },
    activeSectionId: sectionId,
    ...(opts.focus === false ? {} : { snapRequest: { kind: "object" as const, id: meta.id, nonce: Math.random() } }),
  });
  return meta;
}

export function updateNoteText(id: string, text: string) {
  const n = state.notes[id];
  if (!n) return;
  set({ notes: { ...state.notes, [id]: { ...n, text } } });
}

export function removeNote(id: string) {
  const { [id]: gone, ...rest } = state.notes;
  if (!gone) return;
  set({ notes: rest, ...focusCleanup(id) });
}

export function moveNote(id: string, x: number, y: number) {
  const n = state.notes[id];
  if (!n) return;
  set({ notes: { ...state.notes, [id]: { ...n, x: Math.max(0, x), y: Math.max(0, y) } } });
}

export function resizeNote(id: string, w: number, h: number) {
  const n = state.notes[id];
  if (!n) return;
  set({
    notes: {
      ...state.notes,
      [id]: { ...n, w: Math.max(220, Math.min(1200, w)), h: Math.max(120, Math.min(1400, h)) },
    },
  });
}

// ---------- media actions (images & videos from disk) ----------

export function addMedia(
  sectionId: string,
  src: string,
  media: "image" | "video",
  name: string,
  w: number,
  h: number,
  opts: { focus?: boolean } = {},
): MediaMeta {
  // fit oversized media to a sane card size, keep aspect
  const maxW = 560;
  const maxH = 460;
  const scale = Math.min(1, maxW / w, maxH / h);
  const meta: MediaMeta = {
    id: uid("media"),
    sectionId,
    name,
    x: 0,
    y: 0,
    w: Math.max(180, Math.round(w * scale)),
    h: Math.max(120, Math.round(h * scale)),
    src,
    media,
    autoplay: true,
    muted: true,
    float: false,
    bornAt: Date.now(),
  };
  set({
    media: { ...state.media, [meta.id]: meta },
    activeSectionId: sectionId,
    ...(opts.focus === false ? {} : { snapRequest: { kind: "object" as const, id: meta.id, nonce: Math.random() } }),
  });
  return meta;
}

/** swap a local preview for the shared URL once the upload lands */
export function setMediaSrc(id: string, src: string) {
  const m = state.media[id];
  if (!m) return;
  if (m.src.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(m.src), 4000);
  set({ media: { ...state.media, [id]: { ...m, src } } });
}

export function removeMedia(id: string) {
  const { [id]: gone, ...rest } = state.media;
  if (!gone) return;
  if (gone.src.startsWith("blob:")) URL.revokeObjectURL(gone.src);
  set({ media: rest, ...focusCleanup(id) });
}

export function moveMedia(id: string, x: number, y: number) {
  const m = state.media[id];
  if (!m) return;
  set({ media: { ...state.media, [id]: { ...m, x: Math.max(0, x), y: Math.max(0, y) } } });
}

export function resizeMedia(id: string, w: number, h: number) {
  const m = state.media[id];
  if (!m) return;
  set({
    media: {
      ...state.media,
      [id]: { ...m, w: Math.max(160, Math.min(1400, w)), h: Math.max(100, Math.min(1200, h)) },
    },
  });
}

export function setMediaFlag(id: string, patch: Partial<Pick<MediaMeta, "autoplay" | "muted">>) {
  const m = state.media[id];
  if (!m) return;
  set({ media: { ...state.media, [id]: { ...m, ...patch } } });
}

// ---------- table actions ----------

const DEFAULT_COLS = 4;
const DEFAULT_ROWS = 8;
let tableCount = 0;

export function createTable(sectionId: string, atX?: number, atY?: number): TableMeta {
  const id = uid("table");
  tableCount++;
  let name = `Table ${tableCount}`;
  while (!tableNameFree(name)) {
    tableCount++;
    name = `Table ${tableCount}`;
  }
  const cols = DEFAULT_COLS;
  const rows = DEFAULT_ROWS;
  const meta: TableMeta = {
    id,
    sectionId,
    name,
    x: atX ?? 0,
    y: atY ?? 0,
    cols,
    rows,
    float: false,
    bornAt: Date.now(),
  };
  workbook.addTable(id, name, cols, rows);
  set({
    tables: { ...state.tables, [id]: meta },
    activeSectionId: sectionId,
    snapRequest: { kind: "object", id, nonce: Math.random() },
  });
  return meta;
}

function tableNameFree(name: string): boolean {
  return !Object.values(state.tables).some(
    (t) => t.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
}

function focusCleanup(removedId: string): Partial<AppState> {
  if (state.activeObjectId !== removedId) return {};
  return { activeObjectId: null, focusLevel: "section" };
}

export function removeTable(id: string) {
  const { [id]: gone, ...rest } = state.tables;
  if (!gone) return;
  workbook.removeTable(id);
  set({ tables: rest, ...focusCleanup(id) });
}

export function moveTable(id: string, x: number, y: number) {
  const t = state.tables[id];
  if (!t) return;
  set({ tables: { ...state.tables, [id]: { ...t, x: Math.max(0, x), y: Math.max(0, y) } } });
}

export function renameTable(id: string, name: string): boolean {
  const t = state.tables[id];
  if (!t || name.trim() === "") return false;
  if (!workbook.renameTable(id, name.trim())) return false;
  set({ tables: { ...state.tables, [id]: { ...t, name: name.trim() } } });
  return true;
}

export function resizeTable(id: string, cols: number, rows: number) {
  const t = state.tables[id];
  if (!t) return;
  cols = Math.max(1, Math.min(26, cols));
  rows = Math.max(1, Math.min(200, rows));
  workbook.resize(id, cols, rows);
  set({ tables: { ...state.tables, [id]: { ...t, cols, rows } } });
}

// spreadsheet structural edits — formulas are rewritten by the workbook

export function insertTableRows(id: string, at: number, count = 1) {
  const t = state.tables[id];
  if (!t || t.rows + count > 200) return;
  workbook.insertRows(id, at, count);
  set({ tables: { ...state.tables, [id]: { ...t, rows: t.rows + count } } });
}

export function deleteTableRows(id: string, at: number, count = 1) {
  const t = state.tables[id];
  if (!t || t.rows - count < 1) return;
  workbook.deleteRows(id, at, count);
  set({ tables: { ...state.tables, [id]: { ...t, rows: t.rows - count } } });
}

export function insertTableCols(id: string, at: number, count = 1) {
  const t = state.tables[id];
  if (!t || t.cols + count > 26) return;
  workbook.insertCols(id, at, count);
  set({ tables: { ...state.tables, [id]: { ...t, cols: t.cols + count } } });
}

export function deleteTableCols(id: string, at: number, count = 1) {
  const t = state.tables[id];
  if (!t || t.cols - count < 1) return;
  workbook.deleteCols(id, at, count);
  set({ tables: { ...state.tables, [id]: { ...t, cols: t.cols - count } } });
}

// ---------- map actions ----------

const MAP_W = 640;
const MAP_H = 440;
let mapCount = 0;

export function createMap(sectionId: string, atX?: number, atY?: number): MapMeta {
  const id = uid("map");
  mapCount++;
  // default binding: the most recently created table anywhere
  const allTables = Object.values(state.tables);
  const source = allTables.length ? allTables[allTables.length - 1] : null;
  const meta: MapMeta = {
    id,
    sectionId,
    name: `Map ${mapCount}`,
    x: atX ?? 0,
    y: atY ?? 0,
    w: MAP_W,
    h: MAP_H,
    sourceTableId: source?.id ?? null,
    pitched: true,
    float: false,
    bornAt: Date.now(),
  };
  set({
    maps: { ...state.maps, [id]: meta },
    activeSectionId: sectionId,
    snapRequest: { kind: "object", id, nonce: Math.random() },
  });
  return meta;
}

export function removeMap(id: string) {
  const { [id]: gone, ...rest } = state.maps;
  if (!gone) return;
  set({ maps: rest, ...focusCleanup(id) });
}

export function moveMap(id: string, x: number, y: number) {
  const m = state.maps[id];
  if (!m) return;
  set({ maps: { ...state.maps, [id]: { ...m, x: Math.max(0, x), y: Math.max(0, y) } } });
}

export function resizeMap(id: string, w: number, h: number) {
  const m = state.maps[id];
  if (!m) return;
  set({
    maps: {
      ...state.maps,
      [id]: { ...m, w: Math.max(320, Math.min(1600, w)), h: Math.max(240, Math.min(1200, h)) },
    },
  });
}

export function bindMap(id: string, sourceTableId: string | null) {
  const m = state.maps[id];
  if (!m) return;
  set({ maps: { ...state.maps, [id]: { ...m, sourceTableId } } });
}

export function toggleMapPitch(id: string) {
  const m = state.maps[id];
  if (!m) return;
  set({ maps: { ...state.maps, [id]: { ...m, pitched: !m.pitched } } });
}

// ---------- panels (apps, links, files, machines, agents, connectors, asks) ----------

const PANEL_SIZE: Record<PanelMeta["panel"], [number, number]> = {
  app: [720, 520],
  link: [640, 460],
  file: [420, 340],
  machine: [760, 520],
  agent: [420, 360],
  connector: [460, 320],
  ask: [380, 220],
  stage: [460, 440],
  huddle: [560, 420],
  slack: [420, 520],
};

export function addPanel(
  sectionId: string,
  p: Partial<PanelMeta> & Pick<PanelMeta, "panel" | "name">,
  opts: { focus?: boolean } = {},
): PanelMeta {
  const [w, h] = PANEL_SIZE[p.panel];
  // an app opened into an empty section becomes that section's app
  const sec = state.sections[sectionId];
  const hosts = Boolean(sec) && objectsInSection(sectionId).length === 0 && isHostable(p.panel);
  const meta: PanelMeta = {
    id: uid("pnl"),
    sectionId,
    x: 0,
    y: 0,
    float: false,
    bornAt: Date.now(),
    w,
    h,
    ports: [],
    ...p,
  };
  set({
    panels: { ...state.panels, [meta.id]: meta },
    ...(hosts ? { sections: { ...state.sections, [sectionId]: { ...sec, host: meta.id, name: meta.name } } } : {}),
    activeSectionId: sectionId,
    ...(opts.focus === false ? {} : { snapRequest: { kind: "object" as const, id: meta.id, nonce: Math.random() } }),
  });
  return meta;
}

export function updatePanel(id: string, patch: Partial<PanelMeta>) {
  const p = state.panels[id];
  if (!p) return;
  set({ panels: { ...state.panels, [id]: { ...p, ...patch } } });
}

export function removePanel(id: string) {
  const { [id]: gone, ...rest } = state.panels;
  if (!gone) return;
  const links = Object.fromEntries(Object.entries(state.links).filter(([, l]) => l.from.panel !== id && l.to.panel !== id));
  const sec = state.sections[gone.sectionId];
  const sections = sec?.host === id ? { sections: { ...state.sections, [sec.id]: { ...sec, host: undefined } } } : {};
  set({ panels: rest, links, ...sections, ...focusCleanup(id) });
}

/** Host an app in its section (it fills it, ports on the section's edges), or let it go back to being a card. */
export function setSectionHost(sectionId: string, panelId: string | null) {
  const sec = state.sections[sectionId];
  if (!sec) return;
  const p = panelId ? state.panels[panelId] : null;
  set({
    sections: { ...state.sections, [sectionId]: { ...sec, host: p ? p.id : undefined, ...(p ? { name: p.name } : {}) } },
    ...(p ? { panels: { ...state.panels, [p.id]: { ...p, sectionId, float: false, x: 0, y: 0 } } } : {}),
  });
}

export function movePanel(id: string, x: number, y: number) {
  updatePanel(id, { x: Math.max(0, x), y: Math.max(0, y) });
}

export function resizePanel(id: string, w: number, h: number) {
  updatePanel(id, { w: Math.max(240, Math.min(2400, w)), h: Math.max(140, Math.min(1800, h)) });
}

/** an app emitted a value on one of its output ports */
export function emitPort(panelId: string, portId: string, value: unknown) {
  const p = state.panels[panelId];
  if (!p) return;
  updatePanel(panelId, { outputs: { ...(p.outputs ?? {}), [portId]: value } });
}

export function addLink(link: Omit<LinkDoc, "id">): LinkDoc {
  const l: LinkDoc = { ...link, id: uid("lnk") };
  set({ links: { ...state.links, [l.id]: l } });
  return l;
}

export function removeLink(id: string) {
  const { [id]: gone, ...rest } = state.links;
  if (!gone) return;
  set({ links: rest });
}

/** the value arriving at an input port, following the wire back to its source */
export function inputValue(panelId: string, portId: string): unknown {
  for (const l of Object.values(state.links)) {
    if (l.to.panel === panelId && l.to.port === portId) {
      return state.panels[l.from.panel]?.outputs?.[l.from.port];
    }
  }
  return undefined;
}

/** a new named section at the right of the active one (⌘K → New section) */
export function appendSectionLocal(name: string) {
  addSectionAdjacent(state.activeSectionId, "right");
  renameSection(state.activeSectionId, name);
}
