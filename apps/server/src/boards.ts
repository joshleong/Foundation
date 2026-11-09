/**
 * Boards: one Y.Doc per board, held in memory while anyone (person or agent)
 * is on it, persisted as an append-only update log in SQLite and compacted
 * into a single snapshot row when the log grows. This is flowform-server's
 * room model (Yjs CRDT + durable log), in TypeScript.
 *
 * Wire protocol at /sync/:boardId is the standard y-protocols one (sync step
 * 1/2 + updates, awareness for cursors and presence), so any Yjs provider
 * speaks it.
 */

import * as Y from "yjs";
import { randomUUID } from "node:crypto";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import type { WebSocket } from "ws";
import { boardMaps, describeBoard, logActivity, noteTextOf, tableCellsOf, type ObjectDoc } from "@foundation/protocol";
import { all, indexDoc, one, run, unindexDoc } from "./db.ts";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const COMPACT_AFTER = 500;

export interface Board {
  id: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<WebSocket, Set<number>>;
  pendingIndex: ReturnType<typeof setTimeout> | null;
}

const boards = new Map<string, Board>();
const boardListeners = new Set<(boardId: string, doc: Y.Doc) => void>();

export function onBoardChange(fn: (boardId: string, doc: Y.Doc) => void) {
  boardListeners.add(fn);
}

export function listBoards() {
  return all<{ id: string; name: string; updated_at: number }>("select id, name, updated_at from boards order by updated_at desc");
}

export function ensureBoardRow(id: string, name: string) {
  if (!one("select id from boards where id = ?", id)) {
    run("insert into boards (id, name, created_at, updated_at) values (?, ?, ?, ?)", id, name, Date.now(), Date.now());
  }
}

export function getBoard(id: string): Board {
  const existing = boards.get(id);
  if (existing) return existing;

  ensureBoardRow(id, id === "company" ? "Form Industries" : id);
  const doc = new Y.Doc({ gc: true });
  const rows = all<{ update_blob: Uint8Array }>("select update_blob from board_updates where board_id = ? order by seq", id);
  for (const r of rows) Y.applyUpdate(doc, r.update_blob, "load");

  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  const board: Board = { id, doc, awareness, conns: new Map(), pendingIndex: null };

  let sinceCompact = rows.length;
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "load") return;
    run("insert into board_updates (board_id, update_blob, at) values (?, ?, ?)", id, update, Date.now());
    run("update boards set updated_at = ? where id = ?", Date.now(), id);
    if (++sinceCompact >= COMPACT_AFTER) {
      compact(board);
      sinceCompact = 1;
    }
    // broadcast to every socket except the one that sent it
    const msg = encoding.createEncoder();
    encoding.writeVarUint(msg, MSG_SYNC);
    syncProtocol.writeUpdate(msg, update);
    const data = encoding.toUint8Array(msg);
    for (const ws of board.conns.keys()) if (ws !== origin) send(ws, data);
    scheduleIndex(board);
    for (const fn of boardListeners) fn(id, doc);
  });

  awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    const changed = added.concat(updated, removed);
    if (origin && board.conns.has(origin as WebSocket)) {
      const ids = board.conns.get(origin as WebSocket)!;
      for (const c of added) ids.add(c);
      for (const c of removed) ids.delete(c);
    }
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    const data = encoding.toUint8Array(enc);
    for (const ws of board.conns.keys()) send(ws, data);
  });

  watchPeopleEdits(board);
  boards.set(id, board);
  // the board's lineage: a device's offline copy only merges into the board it came from
  if (!boardMaps(doc).meta.get("epoch")) doc.transact(() => boardMaps(doc).meta.set("epoch", `ep_${randomUUID()}`), "system");
  scheduleIndex(board);
  return board;
}

// ---------- a person's structural edits, in the activity log ----------

/** what one person added and removed, gathered for a moment so a burst reads as one line */
export interface EditTally {
  sectionsAdded: string[];
  sectionsRemoved: string[];
  cardsAdded: Array<{ kind: string; name?: string; id: string }>;
  cardsRemoved: number;
}

const KIND_WORD: Record<string, string> = { note: "note", table: "table", panel: "card", media: "file", map: "map" };

/** "added the section “Supply” and a note “Parts”; removed 2 cards" */
export function describeEdits(t: EditTally): string {
  const q = (s: string) => `“${s}”`;
  const list = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  const added: string[] = [];
  if (t.sectionsAdded.length === 1) added.push(`the section ${q(t.sectionsAdded[0])}`);
  else if (t.sectionsAdded.length > 1) added.push(`${t.sectionsAdded.length} sections`);
  if (t.cardsAdded.length === 1) {
    const c = t.cardsAdded[0];
    const word = KIND_WORD[c.kind] ?? "card";
    added.push(`a${/^[aeiou]/.test(word) ? "n" : ""} ${word}${c.name ? ` ${q(c.name)}` : ""}`);
  } else if (t.cardsAdded.length > 1) added.push(`${t.cardsAdded.length} cards`);
  const removed: string[] = [];
  if (t.sectionsRemoved.length === 1) removed.push(`the section ${q(t.sectionsRemoved[0])}`);
  else if (t.sectionsRemoved.length > 1) removed.push(`${t.sectionsRemoved.length} sections`);
  if (t.cardsRemoved === 1) removed.push("a card");
  else if (t.cardsRemoved > 1) removed.push(`${t.cardsRemoved} cards`);
  return [added.length ? `added ${list(added)}` : "", removed.length ? `removed ${list(removed)}` : ""].filter(Boolean).join("; ");
}

const EDIT_SETTLE_MS = 1500;

/**
 * Sections and cards a person adds or removes on the grid (their own socket's
 * updates) go in the activity log under their name, a burst at a time. Moves,
 * resizes and typing don't: the log is for what changed shape, not every drag.
 */
function watchPeopleEdits(board: Board) {
  const m = boardMaps(board.doc);
  const pending = new Map<string, { tally: EditTally; timer: ReturnType<typeof setTimeout> }>();
  const tallyFor = (ws: WebSocket) => {
    const who = socketName.get(ws);
    if (!who) return null;
    let p = pending.get(who);
    if (!p) {
      const tally: EditTally = { sectionsAdded: [], sectionsRemoved: [], cardsAdded: [], cardsRemoved: 0 };
      p = {
        tally,
        timer: setTimeout(() => {
          pending.delete(who);
          const text = describeEdits(tally);
          if (!text) return;
          const objectId = tally.cardsAdded.length === 1 ? tally.cardsAdded[0].id : undefined;
          board.doc.transact(() => logActivity(board.doc, { who, role: "human", text, objectId }), "system");
        }, EDIT_SETTLE_MS),
      };
      pending.set(who, p);
    }
    return p.tally;
  };
  const fromPerson = (origin: unknown) => (origin && board.conns.has(origin as WebSocket) ? (origin as WebSocket) : null);
  m.sections.observe((e) => {
    const ws = fromPerson(e.transaction.origin);
    const tally = ws && tallyFor(ws);
    if (!tally) return;
    for (const [key, change] of e.changes.keys) {
      if (change.action === "add") tally.sectionsAdded.push(m.sections.get(key)?.name ?? "untitled");
      else if (change.action === "delete") tally.sectionsRemoved.push((change.oldValue as { name?: string } | undefined)?.name ?? "untitled");
    }
  });
  m.objects.observe((e) => {
    const ws = fromPerson(e.transaction.origin);
    const tally = ws && tallyFor(ws);
    if (!tally) return;
    for (const [key, change] of e.changes.keys) {
      if (change.action === "add") {
        const o = m.objects.get(key);
        if (o) tally.cardsAdded.push({ kind: o.kind, name: o.name, id: o.id });
      } else if (change.action === "delete") tally.cardsRemoved++;
    }
  });
}

/** which board this is, across deletes and re-creations (see getBoard) */
export function boardEpoch(id: string): string {
  return String(boardMaps(getBoard(id).doc).meta.get("epoch"));
}

function compact(board: Board) {
  const snapshot = Y.encodeStateAsUpdate(board.doc);
  const last = one<{ seq: number }>("select max(seq) as seq from board_updates where board_id = ?", board.id);
  run("delete from board_updates where board_id = ? and seq <= ?", board.id, last?.seq ?? 0);
  run("insert into board_updates (board_id, update_blob, at) values (?, ?, ?)", board.id, snapshot, Date.now());
}

/** Board text goes into the search index a beat after edits settle. */
function scheduleIndex(board: Board) {
  if (board.pendingIndex) clearTimeout(board.pendingIndex);
  board.pendingIndex = setTimeout(() => {
    board.pendingIndex = null;
    indexBoard(board);
  }, 800);
}

const indexedRefs = new Map<string, Set<string>>();

function indexBoard(board: Board) {
  const m = boardMaps(board.doc);
  const seen = new Set<string>();
  const sectionName = (id: string) => m.sections.get(id)?.name ?? "";
  for (const o of m.objects.values()) {
    const ref = o.id;
    seen.add(ref);
    indexDoc("board", ref, board.id, o.name, objectText(o, o.kind === "note" ? noteTextOf(board.doc, o) : undefined, o.kind === "table" ? tableCellsOf(board.doc, o.id) : undefined) + " " + sectionName(o.sectionId));
  }
  for (const ref of indexedRefs.get(board.id) ?? []) if (!seen.has(ref)) unindexDoc("board", ref);
  indexedRefs.set(board.id, seen);
}

function objectText(o: ObjectDoc, note: string | undefined, cells?: Record<string, string>): string {
  switch (o.kind) {
    case "note":
      return note ?? "";
    case "table":
      return Object.values(cells ?? {}).join(" ");
    case "panel":
      return [o.panel, o.url, o.repo, o.text, o.assignee, o.connector].filter(Boolean).join(" ");
    default:
      return o.kind;
  }
}

function send(ws: WebSocket, data: Uint8Array) {
  if (ws.readyState !== 1) return;
  try {
    ws.send(data);
  } catch {
    ws.close();
  }
}

/** who each sync socket belongs to, so a role change can make them reconnect */
const socketUser = new WeakMap<WebSocket, string>();
/** and their name, for the activity log */
const socketName = new WeakMap<WebSocket, string>();

/** `readOnly`: a viewer — they get the board and send presence, but their updates are dropped */
export function attachConnection(boardId: string, ws: WebSocket, readOnly = false, userId?: string, userName?: string) {
  const board = getBoard(boardId);
  if (userId) socketUser.set(ws, userId);
  if (userName) socketName.set(ws, userName);
  board.conns.set(ws, new Set());
  ws.binaryType = "arraybuffer";

  ws.on("message", (raw: ArrayBuffer | Buffer) => {
    const data = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    const dec = decoding.createDecoder(data);
    const type = decoding.readVarUint(dec);
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      if (readOnly) {
        // a viewer may ask for the board (step 1); anything that would change it is dropped
        if (decoding.readVarUint(dec) !== syncProtocol.messageYjsSyncStep1) return;
        syncProtocol.readSyncStep1(dec, enc, board.doc);
      } else syncProtocol.readSyncMessage(dec, enc, board.doc, ws);
      if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc));
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(board.awareness, decoding.readVarUint8Array(dec), ws);
    }
  });

  ws.on("close", () => {
    const ids = board.conns.get(ws);
    board.conns.delete(ws);
    if (ids?.size) awarenessProtocol.removeAwarenessStates(board.awareness, [...ids], null);
  });

  // sync step 1 from the server, then the current awareness
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MSG_SYNC);
  syncProtocol.writeSyncStep1(enc, board.doc);
  send(ws, encoding.toUint8Array(enc));
  const states = board.awareness.getStates();
  if (states.size) {
    const aw = encoding.createEncoder();
    encoding.writeVarUint(aw, MSG_AWARENESS);
    encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(board.awareness, [...states.keys()]));
    send(ws, encoding.toUint8Array(aw));
  }
}

/** Who is on a board right now (from awareness). */
export function presence(boardId: string) {
  const board = boards.get(boardId);
  if (!board) return [];
  return [...board.awareness.getStates().values()]
    .map((s) => (s as { user?: { name: string; color: string; email?: string } }).user)
    .filter(Boolean);
}

/** Run an edit against a board as an agent or service (origin tags the change). */
export function editBoard<T>(boardId: string, origin: string, fn: (doc: Y.Doc) => T): T {
  const board = getBoard(boardId);
  let out!: T;
  board.doc.transact(() => {
    out = fn(board.doc);
  }, origin);
  return out;
}

export function boardDigest(boardId: string) {
  return describeBoard(getBoard(boardId).doc);
}

/** release every board's timers (tests, shutdown) */
export function closeBoards() {
  for (const b of boards.values()) {
    if (b.pendingIndex) clearTimeout(b.pendingIndex);
    b.awareness.destroy();
    b.doc.destroy();
  }
  boards.clear();
}

/** a person's role on a board changed: close their sockets, and the client reconnects under the new role */
export function dropConnections(boardId: string, userId: string) {
  const board = boards.get(boardId);
  if (!board) return 0;
  let n = 0;
  for (const ws of board.conns.keys()) {
    if (socketUser.get(ws) !== userId) continue;
    ws.close(4001, "role changed");
    n++;
  }
  return n;
}

/**
 * What a sync socket may do. `said` is the epoch the client says it holds
 * (empty: it holds no board yet; missing: a build from before epochs).
 * A copy of a board the server has since made again is refused, so it can't
 * pour the old board into the new one; a client that doesn't say can read.
 */
export function syncAccess(said: string | null, epoch: string, writer: boolean): "refuse" | "read" | "write" {
  if (said && said !== epoch) return "refuse";
  if (said === null || !writer) return "read";
  return "write";
}
