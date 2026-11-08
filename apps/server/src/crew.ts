/**
 * The crew: every agent turn is someone you can see. Each run gets a
 * generated name, a colour and its own presence on the board, a client of
 * the board's awareness like a person's browser, so several agents can work
 * at once and everyone can tell them apart. (Before, every agent on a board
 * shared the server's one presence.)
 *
 * An agent's presence says what it's aiming at (`target`, a card or section
 * id), what it's doing in a few words, who asked, and, when it wants to show
 * the person who asked something, a `guide` for that person's camera. The
 * browsers draw the cursor and glide it to the target; the server only says
 * where. Writes wait a beat after aiming (`travelMs`), so the cursor gets
 * there before the change lands and people can follow the work.
 *
 * Each agent is its own Awareness on its own small Y.Doc (its own clientID),
 * bridged into the board's awareness. The Awareness renews itself every 15 s,
 * so a long turn never times out on anyone's screen, and leaving removes it
 * everywhere: no ghost cursors.
 */

import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { boardMaps, findSection } from "@foundation/protocol";
import { getBoard } from "./boards.ts";

/** short, unlike anyone's real name: winds, birds, stones, stars */
export const CREW_NAMES = [
  "Wren", "Kestrel", "Basalt", "Mistral", "Quartz", "Heron", "Cobalt", "Zephyr",
  "Lark", "Garnet", "Sirocco", "Tern", "Flint", "Vega", "Plover", "Onyx",
  "Bora", "Finch", "Jasper", "Altair", "Swift", "Mica", "Petrel", "Rigel",
  "Ibis", "Cinder", "Lyra", "Shale", "Merlin", "Talc", "Gannet", "Deneb",
];

/** how many hues the browsers know (violet mixes on tokens; DESIGN §2) */
export const CREW_HUES = 6;
/** helpers one ask may call in, and agents one board may hold at once */
export const MAX_HELPERS = 2;
export const MAX_CREW_PER_BOARD = 6;

export interface CrewTarget {
  /** a card or section id */
  id: string;
  kind: "object" | "section";
  /** point_at: a cell of a table ("B3"), drawn as a laser on it */
  cell?: string;
  /** point_at: a port of a panel (its id or name) */
  port?: string;
}

export interface CrewGuide {
  /** the person whose camera it is: always the one who asked */
  to: string;
  target: CrewTarget;
  name: string;
  note?: string;
  nonce: number;
}

export interface CrewState {
  user: { name: string; color: string; agent: true };
  crew: {
    id: string;
    hue: number;
    /** the person who asked */
    asker: string;
    askerName: string;
    /** the agent that called this one in */
    lead?: string;
    leadName?: string;
    task: string;
    doing: string;
    target: CrewTarget | null;
    guide: CrewGuide | null;
    status: "working" | "done" | "stopped" | "error";
    at: number;
  };
  /** the ring the agent layer draws (as before) */
  focus: string | null;
}

export interface CrewMember {
  id: string;
  name: string;
  hue: number;
  boardId: string;
  userId: string;
  userName: string;
  runId: string;
  lead?: CrewMember;
  helpers: number;
  clientId: number;
  awareness: awarenessProtocol.Awareness;
  doc: Y.Doc;
  state: CrewState;
  left: boolean;
}

const members = new Map<string, CrewMember>();
let seq = 0;

export function travelMs() {
  const v = Number(process.env.FOUNDATION_CREW_TRAVEL_MS ?? "520");
  return Number.isFinite(v) && v >= 0 ? v : 520;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function crewOn(boardId: string): CrewMember[] {
  return [...members.values()].filter((m) => m.boardId === boardId && !m.left);
}

export function crewMember(id: string | null | undefined): CrewMember | undefined {
  const m = id ? members.get(id) : undefined;
  return m && !m.left ? m : undefined;
}

/** a name nobody else on this board is using right now, picked from the run id */
function pickName(boardId: string, seed: string) {
  const taken = new Set(crewOn(boardId).map((m) => m.name));
  const start = hash(seed) % CREW_NAMES.length;
  for (let i = 0; i < CREW_NAMES.length; i++) {
    const n = CREW_NAMES[(start + i * 7) % CREW_NAMES.length];
    if (!taken.has(n)) return n;
  }
  return `${CREW_NAMES[start]} ${crewOn(boardId).length + 1}`;
}

function pickHue(boardId: string, seed: string) {
  const taken = new Set(crewOn(boardId).map((m) => m.hue));
  const start = hash(seed + "/hue") % CREW_HUES;
  for (let i = 0; i < CREW_HUES; i++) if (!taken.has((start + i) % CREW_HUES)) return (start + i) % CREW_HUES;
  return start;
}

/** an agent arrives on the board: a name, a colour and a presence everyone sees */
export function joinCrew(opts: { boardId: string; userId: string; userName: string; runId: string; task: string; lead?: CrewMember }): CrewMember {
  if (opts.lead && opts.lead.left) throw new Error("the agent that called for help has finished");
  if (crewOn(opts.boardId).length >= MAX_CREW_PER_BOARD) throw new Error(`this board already has ${MAX_CREW_PER_BOARD} agents working; wait for one to finish`);
  const board = getBoard(opts.boardId);
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const id = `crew_${(++seq).toString(36)}${hash(opts.runId).toString(36).slice(0, 4)}`;
  const name = pickName(opts.boardId, opts.runId);
  const hue = pickHue(opts.boardId, opts.runId);
  const m: CrewMember = {
    id,
    name,
    hue,
    boardId: opts.boardId,
    userId: opts.userId,
    userName: opts.userName,
    runId: opts.runId,
    lead: opts.lead,
    helpers: 0,
    clientId: doc.clientID,
    awareness,
    doc,
    left: false,
    state: {
      user: { name, color: "#6b5bd6", agent: true },
      crew: {
        id,
        hue,
        asker: opts.userId,
        askerName: opts.userName,
        lead: opts.lead?.id,
        leadName: opts.lead?.name,
        task: opts.task.slice(0, 200),
        doing: opts.lead ? `called in by ${opts.lead.name}` : "reading the ask",
        target: null,
        guide: null,
        status: "working",
        at: Date.now(),
      },
      focus: null,
    },
  };
  // bridge: every change to this agent's presence (and its 15 s renewals) reaches the board
  awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changed = added.concat(updated, removed);
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, changed);
    awarenessProtocol.applyAwarenessUpdate(board.awareness, update, "crew");
  });
  members.set(id, m);
  publish(m);
  return m;
}

function publish(m: CrewMember) {
  if (m.left) return;
  m.state.crew.at = Date.now();
  m.awareness.setLocalState({ ...m.state, crew: { ...m.state.crew } });
}

/** what the agent is doing now, in a few words */
export function setDoing(m: CrewMember, doing: string) {
  m.state.crew.doing = doing.slice(0, 80);
  publish(m);
}

/** resolve a card id, section id or section name on the board */
export function resolveTarget(boardId: string, ref: string | undefined | null): CrewTarget | null {
  if (!ref) return null;
  const doc = getBoard(boardId).doc;
  const m = boardMaps(doc);
  if (m.objects.has(ref)) return { id: ref, kind: "object" };
  const sec = findSection(doc, ref);
  return sec ? { id: sec.id, kind: "section" } : null;
}

/** aim the cursor at a card or section (null: stay where it is) */
export function aim(m: CrewMember, target: CrewTarget | null, doing?: string) {
  if (target) {
    m.state.crew.target = target;
    m.state.focus = target.kind === "object" ? target.id : null;
  }
  if (doing) m.state.crew.doing = doing.slice(0, 80);
  publish(m);
}

/** aim, then give the cursor time to get there before the change lands */
export async function travel(m: CrewMember, target: CrewTarget | null, doing?: string) {
  const moved = target && (m.state.crew.target?.id !== target.id);
  aim(m, target, doing);
  const ms = travelMs();
  if (moved && ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/** bring the person who asked to a card or section: their browser moves their camera (or asks first) */
export function guide(m: CrewMember, target: CrewTarget, name: string, note?: string) {
  m.state.crew.guide = { to: m.userId, target, name, note: note?.slice(0, 120), nonce: Date.now() + Math.random() };
  aim(m, target, `showing ${m.userName.split(" ")[0]} ${name}`);
}

/** the agent is done: it says so for a moment where it is, then leaves everyone's screen */
export function leaveCrew(m: CrewMember, status: "done" | "stopped" | "error" = "done", lingerMs = 2400) {
  if (m.left) return;
  m.state.crew.status = status;
  m.state.crew.doing = status === "done" ? "done" : status === "stopped" ? "stopped" : "hit a problem";
  m.state.crew.guide = null;
  publish(m);
  const go = () => {
    if (m.left) return;
    m.left = true;
    m.awareness.setLocalState(null); // removal reaches the board through the bridge
    m.awareness.destroy();
    m.doc.destroy();
    members.delete(m.id);
  };
  if (lingerMs > 0) setTimeout(go, lingerMs).unref?.();
  else go();
}

/** may this agent call in another? (only within the person's ask, and a few at most) */
export function canCallHelp(m: CrewMember): string | null {
  if (m.lead) return "a helper can't call in helpers of its own";
  if (m.helpers >= MAX_HELPERS) return `at most ${MAX_HELPERS} helpers per ask`;
  if (crewOn(m.boardId).length >= MAX_CREW_PER_BOARD) return `this board already has ${MAX_CREW_PER_BOARD} agents working`;
  return null;
}

/** the few words a cursor shows for a tool step */
export function describeStep(name: string, input: Record<string, unknown>, boardId?: string): string {
  const q = (k: string) => (typeof input[k] === "string" ? String(input[k]).slice(0, 40) : "");
  /** a card's name, not its id (a real model wires by ids) */
  const named = (k: string) => {
    const ref = q(k);
    if (!boardId || !ref) return ref;
    const o = boardMaps(getBoard(boardId).doc).objects.get(ref) as { name?: string } | undefined;
    return o?.name?.slice(0, 40) || ref;
  };
  switch (name) {
    case "read_board":
      return "reading the board";
    case "search":
      return `searching “${q("query")}”`;
    case "company":
      return input.connector ? `reading ${q("connector")}` : "reading the company";
    case "add_section":
      return `making section “${q("name")}”`;
    case "rename_section":
      return `renaming to “${q("name")}”`;
    case "add_note":
      return `writing “${q("title")}”`;
    case "add_table":
      return `making table “${q("name")}”`;
    case "add_panel":
      return input.panel === "connector" ? `hooking up ${q("name") || q("connector")}` : `opening ${q("name")}`;
    case "connect":
      return `wiring ${named("from_panel")} → ${named("to_panel")}`;
    case "update_card":
      return input.section ? `moving it to ${q("section")}` : "tidying a card";
    case "arrange_section":
      return "arranging the section";
    case "delete_card":
      return "removing a card";
    case "bring_view":
      return "showing you";
    case "call_in_help":
      return "calling in help";
    case "focus":
      return q("note") || "pointing";
    case "set_plan":
      return "planning";
    case "find_images":
      return `finding images of ${q("query")}`;
    case "lay_out":
      return "laying out a page";
    default:
      return name.replace(/_/g, " ");
  }
}

/** which card or section a step is about, before it runs (creations aim at their section) */
export function stepTarget(boardId: string, name: string, input: Record<string, unknown>): CrewTarget | null {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  if (name === "connect") return resolveTarget(boardId, s("to_panel"));
  if (name === "bring_view") return null; // the tool aims itself
  return resolveTarget(boardId, s("id") ?? s("object_id") ?? s("panel") ?? s("section") ?? null);
}

/** for tests */
export function _resetCrew() {
  for (const m of [...members.values()]) leaveCrew(m, "done", 0);
}
