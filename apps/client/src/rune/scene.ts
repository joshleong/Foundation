/**
 * The board, as Rune is handed it (apps/rune/src/scene.rs reads this shape;
 * keep the two in step and bump SCENE_VERSION together).
 *
 * Everything is already laid out by the store's own geometry — the same
 * functions the web renderer, the wires and the cursors read — so the two
 * engines can't disagree about where a section or a card is. Colours arrive
 * resolved from the design tokens. Rune decides neither.
 */

import { isHostable } from "@foundation/protocol";
import {
  CONTENT_PAD,
  SECTION_HEADER,
  SECTION_INSET,
  childrenOf,
  emptyCells,
  gridCellRect,
  gridSize,
  isPanel,
  objectPixelSize,
  objectWorldRect,
  objectsInSection,
  sectionFlow,
  sectionRestRect,
  trackOffsets,
  type AnyObject,
  type AppState,
} from "../state/store";
import { colName, gutterRuns } from "../lib/gridLines";

export const SCENE_VERSION = 1;

/** sRGB, straight alpha, 0..1 */
export type Rgba = [number, number, number, number];

/** the tokens Rune draws with (packages/ui/src/tokens.css), by the name scene.rs gives them */
export const TOKEN_VARS = {
  void: "--color-void",
  abyss: "--color-abyss",
  panel: "--color-panel",
  raise: "--color-raise",
  frost: "--color-frost",
  mist: "--color-mist",
  dim: "--color-dim",
  pulse: "--color-pulse",
  moss: "--color-moss",
  agent: "--color-agent",
  line: "--color-line",
  lineStrong: "--color-line-strong",
} as const;
export type SceneTokens = Record<keyof typeof TOKEN_VARS, Rgba>;

export type CardKind = "note" | "table" | "map" | "image" | "video" | "panel";

export interface SceneCard {
  id: string;
  kind: CardKind;
  x: number;
  y: number;
  w: number;
  h: number;
  s: number;
  name: string;
  text: string;
  src: string;
  what: string;
  agent: string;
  active: boolean;
}

export interface Scene {
  version: number;
  view: { left: number; top: number; right: number };
  paper: boolean;
  readOnly: boolean;
  tokens: SceneTokens;
  grid: {
    w: number;
    h: number;
    cols: Array<{ at: number; len: number; label: string }>;
    rows: Array<{ at: number; len: number; label: string }>;
    lines: Array<{ x: number; y: number; len: number; vertical: boolean }>;
  };
  sections: Array<{ id: string; name: string; x: number; y: number; w: number; h: number; coords: string; count: string; active: boolean }>;
  empties: Array<{ c: number; r: number; x: number; y: number; w: number; h: number; label: string }>;
  cards: SceneCard[];
}

export interface SceneOptions {
  insets: { left: number; top: number; right: number };
  readOnly: boolean;
  tokens: SceneTokens;
  /** Rune paints the paper (its canvas isn't see-through here) */
  paper: boolean;
  /** the address Rune can fetch an image from, or "" when it can't (a blob: the web renderer made, a file behind a bearer) */
  imageSrc?(src: string): string;
}

const WHAT: Record<string, string> = {
  table: "Table",
  map: "Map",
  video: "Video",
  image: "Image",
};

function kindOf(o: AnyObject): CardKind {
  if (isPanel(o)) return "panel";
  if ("cols" in o) return "table";
  if ("sourceTableId" in o) return "map";
  if ("media" in o) return o.media === "video" ? "video" : "image";
  return "note";
}

/** what Rune should draw for the store as it stands */
export function buildScene(st: AppState, opts: SceneOptions): Scene {
  const size = gridSize(st.grid);
  const xo = trackOffsets(st.grid.cols);
  const yo = trackOffsets(st.grid.rows);
  const sections = Object.values(st.sections);

  const lines = gutterRuns(st.grid, sections)
    .filter((g) => !g.interior)
    .map((g) =>
      g.axis === "col"
        ? { x: xo[g.index + 1], y: yo[g.from], len: yo[g.to + 1] - yo[g.from], vertical: true }
        : { x: xo[g.from], y: yo[g.index + 1], len: xo[g.to + 1] - xo[g.from], vertical: false },
    );

  const cards: SceneCard[] = [];
  const outSections: Scene["sections"] = [];
  for (const s of sections) {
    const rect = sectionRestRect(st.grid, s);
    const kids = s.virtual ? [] : childrenOf(s.id, st.allSections);
    const objects = objectsInSection(s.id);
    outSections.push({
      id: s.id,
      name: s.name,
      ...rect,
      coords: `${colName(s.c0)}${s.r0 + 1}${s.c1 !== s.c0 || s.r1 !== s.r0 ? `:${colName(s.c1)}${s.r1 + 1}` : ""}`,
      count: kids.length ? `▦ ${kids.length}` : objects.length ? String(objects.length) : "",
      active: st.activeSectionId === s.id,
    });
    // a section's body never scrolls: below its smallest fit it shows what fits (the rest is one Expand away)
    const flow = sectionFlow(s.id);
    const bodyW = rect.w - 2;
    const bodyH = rect.h - 2 - SECTION_HEADER;
    for (const o of objects) {
      const r = objectWorldRect(o);
      if (!r) continue;
      const hosted = s.host === o.id;
      const px = objectPixelSize(o);
      if (!hosted && flow.clipped) {
        const p = flow.pos.get(o.id) ?? { x: o.x, y: o.y };
        if ((CONTENT_PAD + p.x + px.w) * flow.fit > bodyW + 1 || (CONTENT_PAD + p.y + px.h) * flow.fit > bodyH + 1) continue;
      }
      const kind = kindOf(o);
      cards.push({
        id: o.id,
        kind,
        x: r.x,
        y: r.y,
        // a hosted app is its section's body; any other card keeps its own size, drawn at the section's fit
        w: hosted ? r.w : px.w,
        h: hosted ? r.h : px.h,
        s: hosted ? 1 : r.s,
        name: o.name,
        text: "text" in o && typeof o.text === "string" ? o.text : "",
        src: kind === "image" && "src" in o ? (opts.imageSrc ? opts.imageSrc(o.src) : o.src) : "",
        what: isPanel(o) ? (isHostable(o.panel) ? `App · ${o.panel}` : o.panel) : (WHAT[kind] ?? ""),
        agent: o.createdBy ?? "",
        active: st.focusLevel === "object" && st.activeObjectId === o.id,
      });
    }
  }

  return {
    version: SCENE_VERSION,
    view: opts.insets,
    paper: opts.paper,
    readOnly: opts.readOnly,
    tokens: opts.tokens,
    grid: {
      w: size.w,
      h: size.h,
      cols: st.grid.cols.map((len, i) => ({ at: xo[i], len, label: colName(i) })),
      rows: st.grid.rows.map((len, i) => ({ at: yo[i], len, label: String(i + 1) })),
      lines,
    },
    sections: outSections,
    empties: emptyCells().map(({ c, r }) => {
      const rect = gridCellRect(st.grid, c, r);
      return { c, r, x: rect.x + SECTION_INSET, y: rect.y + SECTION_INSET, w: rect.w - SECTION_INSET * 2, h: rect.h - SECTION_INSET * 2, label: `${colName(c)}${r + 1}` };
    }),
    cards,
  };
}

/**
 * What's under a point of the grid's world, by the same rects Rune draws:
 * the topmost card, else the section whose paper it's on. The camera and its
 * gestures stay in the client for both engines, and ask this where the web
 * renderer asks the DOM.
 */
export function hitWorld(st: AppState, x: number, y: number): { section: string | null; object: string | null } {
  const inside = (r: { x: number; y: number; w: number; h: number }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  for (const s of Object.values(st.sections)) {
    if (!inside(sectionRestRect(st.grid, s))) continue;
    const objects = objectsInSection(s.id);
    for (let i = objects.length - 1; i >= 0; i--) {
      const r = objectWorldRect(objects[i]);
      if (r && inside(r)) return { section: s.id, object: objects[i].id };
    }
    return { section: s.id, object: null };
  }
  return { section: null, object: null };
}
