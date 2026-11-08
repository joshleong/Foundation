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
  cells: "cells", // tableId → Y.Map<"c,r" → raw> (schema 4: one entry per cell; a plain Record before)
  links: "links", // id → LinkDoc
  meta: "meta", // name, createdAt, ...
  activity: "activity", // Y.Array<ActivityEntry>
  noteText: "noteText", // noteId → Y.Text (schema 3: typing merges character by character)
  huddles: "huddles", // huddle panel id → HuddleState (schema 6: kept by the server alone, off the card)
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

/**
 * The board document's schema version (`meta.schema`). 2: sections host apps.
 * 3: note text is a Y.Text. 4: each table's cells are a Y.Map. 5: every table
 * has its cell map from the start (made with the table, never lazily — two
 * people making it at once would each make one, and one would be lost).
 * 6: a huddle's live state lives in `huddles`, not on its card, so moving the
 * card while someone joins can't overwrite who's in it.
 */
export const BOARD_SCHEMA = 6;

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
  /**
   * Who made it, when it wasn't a person at the board: the crew agent's name
   * (notes and tables an agent writes say so on the card). Panels also carry
   * the actor of the tool call that made them.
   */
  createdBy?: string;
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
  /**
   * Only on boards older than schema 3. The text lives in `noteText` (a
   * Y.Text per note) so two people typing in one note merge instead of
   * overwriting each other; read it with noteTextOf, write it with setNoteText.
   */
  text?: string;
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
  /**
   * Only on boards older than schema 6. A huddle's live state lives in the
   * board's `huddles` map, written by the server alone, so a person moving
   * the card while someone joins can't overwrite it; read it with
   * huddleStateOf. Readers ignore this field.
   */
  huddle?: HuddleState;
  /** agent session id for panel === "agent" */
  sessionId?: string;
  /** for asks: who, and whether it's done */
  assignee?: string;
  status?: "open" | "done" | "running" | "idle" | "error";
  /** last value each output port emitted (JSON-able) */
  outputs?: Record<string, unknown>;
  // ---- design pipeline stages (panel === "stage") ----
  pipeline?: string;
  stage?: StageKey;
  artifacts?: Artifact[];
  checklist?: Array<{ text: string; done: boolean }>;
  /** stage-specific settings, e.g. { analysis: "CFD", loads: "…" } */
  settings?: Record<string, string>;
  // ---- machines on a container engine (panel === "machine" without a url) ----
  /** a Linux machine or container this card runs on Kiri or Docker, kept by the server (machines.ts) */
  machine?: MachineState;
}

// ---------- machines: Linux machines and containers on a local engine ----------

/**
 * A machine card's engine-side state. The engine is the truth: the server
 * reads it back (by the container's labels) and writes what it finds here,
 * so everyone sees the same state. Starting needs a person; agents propose.
 */
export interface MachineState {
  /** machine name; the container is `machine-<name>` (Kiri's convention, so `kiri machine shell <name>` finds it) */
  name: string;
  /** image it runs ("ubuntu:24.04"): picked by a person on the card, or proposed by an agent */
  image?: string;
  /** "kiri" | "docker"; unset: the first engine that answers, Kiri first */
  engine?: string;
  state: "absent" | "pulling" | "starting" | "running" | "stopped" | "error";
  /** words for the state: pull progress, why it stopped, the error */
  detail?: string;
  containerId?: string;
  /** container ports to publish on 127.0.0.1 */
  wantPorts?: number[];
  /** what the engine published: container port → host port on 127.0.0.1 */
  ports?: Array<{ port: number; host: number }>;
  proposedBy?: string;
  startedBy?: string;
  /** when it entered this state */
  since?: number;
}

/** Kiri's distro shortcuts (`kiri machine create NAME --distro ubuntu`): these images become long-lived machines */
export const MACHINE_DISTROS: ReadonlyArray<{ id: string; image: string }> = [
  { id: "ubuntu", image: "ubuntu:24.04" },
  { id: "debian", image: "debian:trixie" },
  { id: "alpine", image: "alpine:3.22" },
  { id: "fedora", image: "fedora:42" },
  { id: "arch", image: "archlinux:latest" },
  { id: "rocky", image: "rockylinux:9" },
  { id: "opensuse", image: "opensuse/tumbleweed:latest" },
];

/** a machine name: letters, digits and dashes, not starting with a dash (Kiri's rule), at most 40 */
export function machineName(s: string): string {
  const n = s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return n || "machine";
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
    cells: doc.getMap<TableCells | Record<string, string>>(BOARD.cells),
    links: doc.getMap<LinkDoc>(BOARD.links),
    meta: doc.getMap<unknown>(BOARD.meta),
    activity: doc.getArray<ActivityEntry>(BOARD.activity),
    noteText: doc.getMap<Y.Text>(BOARD.noteText),
    huddles: doc.getMap<HuddleState>(BOARD.huddles),
  };
}

// ---------- huddle state (schema 6) ----------

/** A huddle's live state (who's in it now, whether it records), or none before anyone met there. */
export function huddleStateOf(doc: Y.Doc, huddleId: string): HuddleState | undefined {
  return boardMaps(doc).huddles.get(huddleId);
}

/**
 * Set a huddle's live state. The server alone calls this (huddles.ts); it
 * touches only the huddle's entry in `huddles`, never the card in `objects`.
 * Call inside a transaction.
 */
export function setHuddleState(doc: Y.Doc, huddleId: string, state: HuddleState) {
  boardMaps(doc).huddles.set(huddleId, state);
}

// ---------- table cells (schema 4) ----------

/** A table's cells: "c,r" → the raw text typed (formulas as written). */
export type TableCells = Y.Map<string>;

/** A table's cells as a plain record (either form: before or after schema 4). */
export function tableCellsOf(doc: Y.Doc, tableId: string): Record<string, string> {
  const v = boardMaps(doc).cells.get(tableId);
  if (!v) return {};
  return v instanceof Y.Map ? (v.toJSON() as Record<string, string>) : { ...v };
}

/**
 * The live cell map of a table, made (or upgraded from a plain record) if
 * needed. Call inside a transaction. Make it when the table is made: a map
 * made lazily by two people at once is two maps, and one of them is lost.
 */
export function tableCellMap(doc: Y.Doc, tableId: string): TableCells {
  const m = boardMaps(doc);
  const v = m.cells.get(tableId);
  if (v instanceof Y.Map) return v;
  const map = new Y.Map<string>();
  m.cells.set(tableId, map);
  for (const [k, raw] of Object.entries(v ?? {})) if (raw) map.set(k, raw);
  return map;
}

/**
 * Make a table's cells match `raw`, touching only the cells that differ — so
 * someone editing another cell of the same table keeps their edit. Empty
 * means cleared. Call inside a transaction.
 */
export function setTableCells(doc: Y.Doc, tableId: string, raw: Record<string, string>) {
  const map = tableCellMap(doc, tableId);
  for (const [k, v] of Object.entries(raw)) if (v && map.get(k) !== v) map.set(k, v);
  for (const k of [...map.keys()]) if (!raw[k]) map.delete(k);
}

// ---------- note text (schema 3) ----------

/** The one edit that turns `a` into `b`: keep the common start and end, replace the middle. */
export function textDiff(a: string, b: string): { at: number; remove: number; insert: string } | null {
  if (a === b) return null;
  let start = 0;
  const min = Math.min(a.length, b.length);
  while (start < min && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let end = 0;
  while (end < min - start && a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)) end++;
  // never split a surrogate pair
  if (start > 0 && start < a.length && isLowSurrogate(a.charCodeAt(start))) start--;
  return { at: start, remove: a.length - start - end, insert: b.slice(start, b.length - end) };
}
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * A keystroke as an edit of the shared text: `base` is what the editor showed,
 * `next` what it shows after the key, `current` what the shared text holds
 * now (someone else may have typed in between). The person's edit, moved past
 * the other change so neither loses characters; null when nothing changed.
 */
export function rebaseEdit(base: string, next: string, current: string): { at: number; remove: number; insert: string } | null {
  const mine = textDiff(base, next);
  if (!mine) return null;
  const theirs = textDiff(base, current);
  let { at, remove } = mine;
  if (theirs) {
    const theirEnd = theirs.at + theirs.remove;
    const before = at + remove <= theirs.at && !(at === theirs.at && remove === 0 && theirs.remove === 0);
    if (before) {
      // mine is wholly before theirs: positions hold
    } else if (at >= theirEnd) {
      at += theirs.insert.length - theirs.remove; // after theirs (or both typing at one spot): slide past it
    } else {
      // overlapping: theirs stands, mine goes in just after it, deleting only what's left of my range
      const myEnd = at + remove;
      at = theirs.at + theirs.insert.length;
      remove = Math.max(0, myEnd - theirEnd);
    }
  }
  at = Math.min(at, current.length);
  remove = Math.min(remove, current.length - at);
  return { at, remove, insert: mine.insert };
}

/** A note's text: its Y.Text, or the legacy field on a board that hasn't migrated. */
export function noteTextOf(doc: Y.Doc, note: { id: string; text?: string }): string {
  return boardMaps(doc).noteText.get(note.id)?.toString() ?? note.text ?? "";
}

/**
 * Set a note's text as the smallest edit from what's there, so someone typing
 * elsewhere in the same note keeps their characters. Call inside a transaction.
 */
export function setNoteText(doc: Y.Doc, id: string, text: string) {
  const m = boardMaps(doc);
  let t = m.noteText.get(id);
  if (!t) {
    t = new Y.Text();
    m.noteText.set(id, t);
  }
  const d = textDiff(t.toString(), text);
  if (!d) return;
  if (d.remove) t.delete(d.at, d.remove);
  if (d.insert) t.insert(d.at, d.insert);
}

/** Put a note on the board: the card in `objects`, its text in `noteText`. */
export function putNote(doc: Y.Doc, note: NoteDoc & { text: string }) {
  const { text, ...card } = note;
  boardMaps(doc).objects.set(card.id, card);
  setNoteText(doc, card.id, text);
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
        lines.push(`- note "${o.name}" (${o.id}): ${noteTextOf(doc, o).slice(0, 240).replace(/\n/g, " ")}`);
      } else if (o.kind === "table") {
        const cells = tableCellsOf(doc, o.id);
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
  /** first on every stream: the run it belongs to (reattach with GET /api/agent/runs/:id/events) */
  | { type: "run"; id: string }
  /** the visible agent doing this run: its generated name, hue (0–5) and, for a helper, who called it in */
  | { type: "crew"; id: string; name: string; hue: number; lead?: string; leadName?: string }
  /** a helper this run called in: its own run and session, so its tab can be opened */
  | { type: "helper"; name: string; runId: string; session: string }
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
 * - "script": a fixed playbook for tests and e2e (FOUNDATION_AGENT_SCRIPT=1
 *   only): the same tools, no model.
 */
export type AgentRuntime = "subscription" | "api" | "script";

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
  /** account-wide; a board can set its own (viewer: may read, not change) */
  role: "admin" | "member" | "viewer";
}
