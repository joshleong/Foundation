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
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import type { WebSocket } from "ws";
import { boardMaps, describeBoard, type ObjectDoc } from "@foundation/protocol";
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

  boards.set(id, board);
  scheduleIndex(board);
  return board;
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
    indexDoc("board", ref, board.id, o.name, objectText(o, m.cells.get(o.id)) + " " + sectionName(o.sectionId));
  }
  for (const ref of indexedRefs.get(board.id) ?? []) if (!seen.has(ref)) unindexDoc("board", ref);
  indexedRefs.set(board.id, seen);
}

function objectText(o: ObjectDoc, cells?: Record<string, string>): string {
  switch (o.kind) {
    case "note":
      return o.text;
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

export function attachConnection(boardId: string, ws: WebSocket) {
  const board = getBoard(boardId);
  board.conns.set(ws, new Set());
  ws.binaryType = "arraybuffer";

  ws.on("message", (raw: ArrayBuffer | Buffer) => {
    const data = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    const dec = decoding.createDecoder(data);
    const type = decoding.readVarUint(dec);
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.readSyncMessage(dec, enc, board.doc, ws);
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
