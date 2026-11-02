/**
 * @foundation/protocol — the one schema shared by the client, the server and
 * every agent that touches a board.
 *
 * A board is a Yjs document. People edit it through the grid; agents edit it
 * through the server (the agent runtime, the MCP endpoint, Hermes). Both sides
 * read and write the same maps below, so nothing has a private copy of the
 * board's shape.
 */

import * as Y from "yjs";

// ---------- board document layout ----------

/** top-level Y.Map names inside a board's Y.Doc */
export const BOARD = {
  grid: "grid", // key "tracks" → GridTracks
  sections: "sections", // id → SectionDoc
  objects: "objects", // id → ObjectDoc
  cells: "cells", // tableId → Record<"c,r", raw>
  links: "links", // id → LinkDoc
  meta: "meta", // name, createdAt, ...
  activity: "activity", // Y.Array<ActivityEntry>
} as const;

export interface GridTracks {
  cols: number[];
  rows: number[];
}

export interface SectionDoc {
  id: string;
  name: string;
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  /**
   * A section can host one app (schema 2): that panel fills the section, the
   * section's header is the app's, and the app's ports sit on the section's
   * edges, so data flows section to section.
   */
  host?: string;
}

/** The board document's schema version (`meta.schema`). 2: sections host apps. */
export const BOARD_SCHEMA = 2;

/** Panel kinds a section can host — whole apps, not artifacts. */
export const HOSTABLE_KINDS = ["app", "link", "machine", "connector"] as const;

export function isHostable(kind: string): boolean {
  return (HOSTABLE_KINDS as readonly string[]).includes(kind);
}

interface ObjectBaseDoc {
  id: string;
  sectionId: string;
  name: string;
  x: number;
  y: number;
  float: boolean;
  bornAt: number;
}

export interface TableDoc extends ObjectBaseDoc {
  kind: "table";
  cols: number;
  rows: number;
}
export interface MapDoc extends ObjectBaseDoc {
  kind: "map";
  w: number;
  h: number;
  sourceTableId: string | null;
  pitched: boolean;
}
export interface NoteDoc extends ObjectBaseDoc {
  kind: "note";
  w: number;
  h: number;
  text: string;
}
export interface MediaDoc extends ObjectBaseDoc {
  kind: "media";
  w: number;
  h: number;
  src: string;
  media: "image" | "video";
  autoplay: boolean;
  muted: boolean;
}

/**
 * Panels are everything that is not a spreadsheet primitive: running apps,
 * uploaded files, web pages, machines, agents, live company data and asks.
 */
export type PanelKind =
  | "app" // a vibe-coded app or any web app, live in a frame, with repo + MCP + ports
  | "link" // a web page
  | "file" // an uploaded file (design, CAD, PDF, text, image, video)
  | "machine" // a VM, container or remote desktop reached by URL (noVNC, ttyd, code-server)
  | "agent" // an agent session working on the board
  | "connector" // live company data (BomForm, FactoryForm, Vision …)
  | "ask" // a Hermes request to a person (e.g. "upload the latest CAD")
  | "stage" // one step of a design pipeline (brief → concept → CAD → simulate → review → release)
  | "huddle" // a video portal: people on the board talk face to face, transcribed and archived
  | "slack"; // a Slack channel on the board: read it, post to it, send it board links, invite it to a huddle

export interface Port {
  id: string;
  name: string;
  dir: "in" | "out";
  /** free-form type hint: "json", "bom", "cad", "image", "text", "number" */
  type?: string;
}

export interface PanelDoc extends ObjectBaseDoc {
  kind: "panel";
  panel: PanelKind;
  w: number;
  h: number;
  url?: string;
  /** "owner/name" on GitHub, or a full git URL */
  repo?: string;
  /** MCP endpoint the app exposes (streamable HTTP) */
  mcp?: string;
  fileId?: string;
  mime?: string;
  text?: string;
  ports: Port[];
  /** connector id for panel === "connector" */
  connector?: string;
  /** Slack channel id — a "slack" card's channel, or the channel a huddle was opened for */
  channel?: string;
  /** a huddle's live state, kept by the server: who is in it now and whether it records; its sessions are archived */
  huddle?: HuddleState;
  /** agent session id for panel === "agent" */
  sessionId?: string;
  /** for asks: who, and whether it's done */
  assignee?: string;
  status?: "open" | "done" | "running" | "idle" | "error";
  createdBy?: string;
  /** last value each output port emitted (JSON-able) */
  outputs?: Record<string, unknown>;
  // ---- design pipeline stages (panel === "stage") ----
  pipeline?: string;
  stage?: StageKey;
  artifacts?: Artifact[];
  checklist?: Array<{ text: string; done: boolean }>;
  /** stage-specific settings, e.g. { analysis: "CFD", loads: "…" } */
  settings?: Record<string, string>;
}

// ---------- huddles: video portals on the board ----------

export interface HuddleState {
  /** set while anyone is in it */
  liveSince?: number;
  /** names of the people in it now (one entry per person, not per tab) */
  people: string[];
  /** someone pressed Record: every participant's own camera and mic are being archived */
  recording?: { by: string; since: number } | null;
  lastEndedAt?: number;
}

/** one line of a huddle's transcript — spoken (each person's browser transcribes their own mic) or typed */
export interface HuddleLine {
  id: string;
  at: number;
  speaker: string;
  text: string;
  source: "speech" | "typed" | "system";
}

/** messages on the huddle socket (/huddle/:board/:huddle) — signalling only; media is peer to peer */
export type HuddleWire =
  | { t: "welcome"; you: string; peers: Array<{ id: string; name: string; color: string; sending: boolean }>; ice: unknown[] }
  | { t: "peer-joined"; id: string; name: string; color: string; sending: boolean }
  | { t: "peer-left"; id: string }
  | { t: "peer-state"; id: string; sending: boolean; muted?: boolean; camOff?: boolean }
  | { t: "signal"; from: string; to: string; data: unknown }
  | { t: "line"; line: HuddleLine }
  | { t: "caption"; from: string; name: string; text: string }
  | { t: "recording"; on: boolean; by: string };

// ---------- design pipelines: design → CAD → simulation → release ----------

export type StageKey = "brief" | "concept" | "cad" | "simulate" | "review" | "release";

export interface Artifact {
  id: string;
  name: string;
  /** "image" | "cad" | "doc" | "data" | "link" | "decision" */
  kind: string;
  fileId?: string;
  url?: string;
  mime?: string;
  /** e.g. the CAD bounding box "212 × 212 × 64 mm" */
  note?: string;
  by: string;
  at: number;
  chosen?: boolean;
}

export interface StageDef {
  key: StageKey;
  title: string;
  glyph: string;
  /** what this stage hands to the next */
  out: { name: string; type: string };
  purpose: string;
  checklist: string[];
}

/** The six stages, in order. One definition for the server, the client and agents. */
export const STAGES: StageDef[] = [
  {
    key: "brief",
    title: "Brief",
    glyph: "✎",
    out: { name: "brief", type: "json" },
    purpose: "What we're making, for whom, and how we'll know it's right.",
    checklist: ["Goal and use case written", "Constraints: size, mass, cost, materials", "Success criteria agreed"],
  },
  {
    key: "concept",
    title: "Concept",
    glyph: "◈",
    out: { name: "concept", type: "image" },
    purpose: "Sketches and renders — from Vision, the team, or references. Star the one we take forward.",
    checklist: ["At least two directions explored", "One direction chosen (★)"],
  },
  {
    key: "cad",
    title: "CAD",
    glyph: "⬡",
    out: { name: "cad", type: "cad" },
    purpose: "The model. Drop a STEP (or ask the owner — Hermes follows up until it lands).",
    checklist: ["STEP uploaded", "Units and envelope check out", "Part numbers assigned"],
  },
  {
    key: "simulate",
    title: "Simulate",
    glyph: "≋",
    out: { name: "results", type: "data" },
    purpose: "Test it before it's made: CFD, FEA, thermal or RF in Vision. Results land here.",
    checklist: ["Analysis and load cases set", "Run in Vision", "Results attached and read"],
  },
  {
    key: "review",
    title: "Review",
    glyph: "◎",
    out: { name: "approved", type: "decision" },
    purpose: "The people who own it look at the design and the results, and decide.",
    checklist: ["Reviewers asked", "Comments resolved", "Decision recorded"],
  },
  {
    key: "release",
    title: "Release",
    glyph: "⇢",
    out: { name: "release", type: "bom" },
    purpose: "Hand it to BomForm and FactoryForm: part numbers, BOM lines, a revision.",
    checklist: ["BOM lines in BomForm", "Revision tagged", "FactoryForm notified"],
  },
];

export function stageDef(key: StageKey | undefined): StageDef | undefined {
  return STAGES.find((s) => s.key === key);
}

export type ObjectDoc = TableDoc | MapDoc | NoteDoc | MediaDoc | PanelDoc;

export interface LinkDoc {
  id: string;
  from: { panel: string; port: string };
  to: { panel: string; port: string };
  label?: string;
  createdBy?: string;
}

export interface ActivityEntry {
  at: number;
  who: string;
  /** "human" | "agent" | "system" */
  role: "human" | "agent" | "system";
  text: string;
  objectId?: string;
}

export const DEFAULT_COL_W = 1560;
export const DEFAULT_ROW_H = 1160;

// ---------- helpers that work on any side ----------

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function boardMaps(doc: Y.Doc) {
  return {
    grid: doc.getMap<GridTracks>(BOARD.grid),
    sections: doc.getMap<SectionDoc>(BOARD.sections),
    objects: doc.getMap<ObjectDoc>(BOARD.objects),
    cells: doc.getMap<Record<string, string>>(BOARD.cells),
    links: doc.getMap<LinkDoc>(BOARD.links),
    meta: doc.getMap<unknown>(BOARD.meta),
    activity: doc.getArray<ActivityEntry>(BOARD.activity),
  };
}

export function readTracks(doc: Y.Doc): GridTracks {
  return (
    boardMaps(doc).grid.get("tracks") ?? { cols: [DEFAULT_COL_W], rows: [DEFAULT_ROW_H] }
  );
}

/** Add a section as a new column on the right edge of the grid (agents use this). */
export function appendSection(doc: Y.Doc, name: string): SectionDoc {
  const m = boardMaps(doc);
  const tracks = readTracks(doc);
  const sections = [...m.sections.values()];
  let sec: SectionDoc;
  if (sections.length === 0) {
    sec = { id: uid("sec"), name, c0: 0, r0: 0, c1: 0, r1: tracks.rows.length - 1 };
  } else {
    const c = tracks.cols.length;
    tracks.cols = [...tracks.cols, DEFAULT_COL_W];
    sec = { id: uid("sec"), name, c0: c, r0: 0, c1: c, r1: tracks.rows.length - 1 };
    m.grid.set("tracks", tracks);
  }
  m.sections.set(sec.id, sec);
  return sec;
}

export function findSection(doc: Y.Doc, nameOrId: string): SectionDoc | undefined {
  const m = boardMaps(doc);
  const direct = m.sections.get(nameOrId);
  if (direct) return direct;
  const needle = nameOrId.trim().toLowerCase();
  return [...m.sections.values()].find((s) => s.name.trim().toLowerCase() === needle);
}

export function logActivity(doc: Y.Doc, entry: Omit<ActivityEntry, "at">) {
  const arr = boardMaps(doc).activity;
  arr.push([{ ...entry, at: Date.now() }]);
  // keep the log bounded; the server's journal keeps everything
  if (arr.length > 400) arr.delete(0, arr.length - 400);
}

/** Short plain-text digest of a board — what agents read first. */
export function describeBoard(doc: Y.Doc): string {
  const m = boardMaps(doc);
  const lines: string[] = [];
  for (const s of m.sections.values()) {
    const host = s.host ? m.objects.get(s.host) : undefined;
    lines.push(`## Section "${s.name}" (${s.id})${host ? ` — hosts the app "${host.name}" (${host.id}); its ports are the section's` : ""}`);
    for (const o of m.objects.values()) {
      if (o.sectionId !== s.id) continue;
      if (o.kind === "panel") {
        const extra = [o.pipeline && `pipeline=${o.pipeline}`, o.url && `url=${o.url}`, o.repo && `repo=${o.repo}`, o.mcp && `mcp=${o.mcp}`, o.status && `status=${o.status}`, o.assignee && `assignee=${o.assignee}`]
          .filter(Boolean)
          .join(" ");
        const ports = o.ports.map((p) => `${p.dir}:${p.name}`).join(",");
        lines.push(`- ${o.panel} "${o.name}" (${o.id}) ${extra}${ports ? ` ports[${ports}]` : ""}`);
        if (o.text) lines.push(`  ${o.text.slice(0, 240).replace(/\n/g, " ")}`);
      } else if (o.kind === "note") {
        lines.push(`- note "${o.name}" (${o.id}): ${o.text.slice(0, 240).replace(/\n/g, " ")}`);
      } else if (o.kind === "table") {
        const cells = m.cells.get(o.id) ?? {};
        const head = [0, 1, 2, 3, 4, 5].map((c) => cells[`${c},0`] ?? "").filter(Boolean);
        lines.push(`- table "${o.name}" (${o.id}) ${o.cols}×${o.rows} headers: ${head.join(" | ")}`);
      } else {
        lines.push(`- ${o.kind} "${o.name}" (${o.id})`);
      }
    }
  }
  const links = [...m.links.values()];
  if (links.length) {
    lines.push("## Connections");
    for (const l of links) lines.push(`- ${l.from.panel}.${l.from.port} → ${l.to.panel}.${l.to.port}${l.label ? ` (${l.label})` : ""}`);
  }
  return lines.join("\n") || "(empty board)";
}

// ---------- wire messages (agent stream, server → client) ----------

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "tool_result"; name: string; ok: boolean; summary: string }
  | { type: "status"; status: string }
  | { type: "done"; runtime: AgentRuntime; usage?: { input: number; output: number } }
  | { type: "error"; message: string };

/**
 * Where an agent turn runs.
 * - "subscription": Claude Code on this machine (`claude -p`), the T3-style
 *   session mechanism — the user's plan pays, never an API key.
 * - "api": the Anthropic API with the workspace key (credits).
 */
export type AgentRuntime = "subscription" | "api";

export interface SearchHit {
  source: "board" | "file" | "slack" | "github" | "app" | "activity" | "huddle";
  id: string;
  title: string;
  snippet: string;
  url?: string;
  objectId?: string;
  score: number;
}

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  color: string;
  role: "admin" | "member";
}
