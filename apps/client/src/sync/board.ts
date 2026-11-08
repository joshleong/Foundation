/**
 * Live board sync. The grid's store (state/store.ts) stays the fast local
 * model the 60 fps hot paths read; this module mirrors it into the board's
 * Y.Doc and back:
 *
 *   local edit → store.set() → syncHook → diff by id → Y transaction (origin LOCAL)
 *   remote edit → Y update → observe → rebuild changed slices → applyRemote()
 *
 * Diffs are by object identity (the store replaces what it changes), so a
 * drag frame touches one key. Section scroll stays local; the document holds
 * only what everyone shares. Cursors and selections ride on awareness.
 *
 * A note's text is its own Y.Text (schema 3): a keystroke becomes the
 * smallest insert/delete, so two people typing in one note both keep their
 * words, and the note's card (position, size) is never rewritten by typing.
 * A table's cells are a Y.Map per table (schema 4): an edit writes only the
 * cells it changed, so two people editing one table both land.
 *
 * Transport: y-protocols over WebSocket at /sync/:board, with backoff
 * reconnect; the session cookie authenticates it.
 *
 * Offline: every board keeps a copy on this device (IndexedDB). It opens
 * from that copy before the server answers (or without it), edits made
 * offline are saved there, and the reconnect handshake sends them. A copy
 * only merges into the board it came from: if the server's board has a
 * different epoch (deleted and made again), the copy is set aside.
 */

import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { IndexeddbPersistence } from "y-indexeddb";
import { BOARD_SCHEMA, boardMaps, noteTextOf, rebaseEdit, setNoteText, setTableCells, tableCellMap, tableCellsOf, type ObjectDoc, type SectionDoc, type UserInfo } from "@foundation/protocol";
import { applyRemote, getState, setSyncHook, updateNoteText, type AnyObject, type AppState, type Section } from "../state/store";
import { workbook } from "../engine/workbook";
import { api, wsUrl } from "../lib/api";
import { toast } from "../state/ui";

const LOCAL = Symbol("local");
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

export type SyncStatus = "connecting" | "live" | "offline";

type Kind = "table" | "map" | "note" | "media" | "panel";
const SLICE: Record<Kind, "tables" | "maps" | "notes" | "media" | "panels"> = {
  table: "tables",
  map: "maps",
  note: "notes",
  media: "media",
  panel: "panels",
};

function kindOf(o: AnyObject): Kind {
  if ("panel" in o) return "panel";
  if ("cols" in o) return "table";
  if ("sourceTableId" in o) return "map";
  if ("media" in o) return "media";
  return "note";
}

export interface PeerState {
  clientId: number;
  user: { name: string; color: string; email?: string; agent?: boolean };
  cursor?: { x: number; y: number } | null;
  focus?: string | null;
  /** one of the crew: a visible agent the server runs (apps/server/src/crew.ts) */
  crew?: CrewPresence;
}

export interface CrewPresence {
  id: string;
  /** 0–5: which of the crew colours (--color-crew-n) */
  hue: number;
  /** the person who asked (user id) and their name */
  asker: string;
  askerName: string;
  /** the agent that called this one in */
  lead?: string;
  leadName?: string;
  task: string;
  doing: string;
  target: { id: string; kind: "object" | "section" } | null;
  /** bring the person `to` (the asker) to `target`; a new nonce is a new ask */
  guide: { to: string; target: { id: string; kind: "object" | "section" }; name: string; note?: string; nonce: number } | null;
  status: "working" | "done" | "stopped" | "error";
  at: number;
}

/** someone else writing in a note: their selection (from === to for a bare caret) */
export interface NoteCaret {
  clientId: number;
  name: string;
  color: string;
  from: number;
  to: number;
  /** where their caret is (from or to) */
  head: number;
}

class BoardSync {
  doc = new Y.Doc();
  awareness = new awarenessProtocol.Awareness(this.doc);
  status: SyncStatus = "connecting";
  private ws: WebSocket | null = null;
  private retry = 0;
  /** the store is wired to the doc: from this device's copy, or from the server's first answer */
  private ready = false;
  private idb: IndexeddbPersistence | null = null;
  /** changes made here that the server hasn't been sent yet (offline) */
  pending = false;
  /** the board on screen came from this device's copy (the server hasn't answered yet, or can't) */
  fromDevice = false;
  private closed = false;
  private applyingCells = false;
  private listeners = new Set<() => void>();
  private unsubWorkbook: (() => void) | null = null;
  /** a viewer: the server drops our updates, so local edits are put back from the doc */
  private readOnly = false;
  private reverting = false;

  constructor(
    public boardId: string,
    public user: UserInfo,
  ) {
    this.awareness.setLocalState({ user: { name: user.name, color: user.color, email: user.email }, cursor: null, focus: null });
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === this) return; // came from the server
      if (origin === this.idb) return; // this device's copy, loading: the handshake sends what the server lacks
      if (this.status !== "live" && !this.pending) this.setPending(true);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.send(encoding.toUint8Array(enc));
    });
    this.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin !== "local") {
        this.refreshCarets();
        this.notify();
        return;
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, added.concat(updated, removed)));
      this.send(encoding.toUint8Array(enc));
      this.notify();
    });
    const m = boardMaps(this.doc);
    m.objects.observe((e) => e.transaction.origin !== LOCAL && this.pullObjects([...e.keysChanged]));
    m.sections.observe((e) => e.transaction.origin !== LOCAL && this.pullSections());
    m.grid.observe((e) => e.transaction.origin !== LOCAL && this.pullGrid());
    m.links.observe((e) => e.transaction.origin !== LOCAL && this.pullLinks());
    m.cells.observeDeep((events, tx) => {
      if (tx.origin === LOCAL) return;
      const ids = new Set<string>();
      for (const e of events) {
        if (e.target === m.cells) for (const k of (e as Y.YMapEvent<unknown>).keysChanged) ids.add(k);
        else if (typeof e.path[0] === "string") ids.add(e.path[0]);
      }
      this.pullCells([...ids]);
    });
    m.noteText.observeDeep((events, tx) => {
      if (tx.origin === LOCAL) return;
      const ids = new Set<string>();
      for (const e of events) {
        if (e.target === m.noteText) for (const k of (e as Y.YMapEvent<Y.Text>).keysChanged) ids.add(k);
        else if (typeof e.path[0] === "string") ids.add(e.path[0]);
      }
      this.pullNoteText([...ids]);
    });
    m.activity.observe(() => this.notify());
    void this.start();
  }

  /** the server's board isn't the one we hold: forget ours (kept and offline copy) and start over from the server */
  private async setAside() {
    this.closed = true;
    try {
      await this.idb?.clearData();
    } catch { /* already gone */ }
    toast("This board was reset on the server, so this device's copy was set aside. Reloading…", "warn");
    setTimeout(() => window.location.reload(), 1200);
  }

  /** changes waiting for the server, remembered across a reload */
  private setPending(on: boolean) {
    this.pending = on;
    try {
      if (on) localStorage.setItem(`foundation-pending:${this.boardId}`, "1");
      else localStorage.removeItem(`foundation-pending:${this.boardId}`);
    } catch { /* private window */ }
    this.notify();
  }

  private async start() {
    const name = `foundation-board:${this.boardId}`;
    try {
      this.pending = localStorage.getItem(`foundation-pending:${this.boardId}`) === "1";
    } catch { /* private window */ }
    try {
      // look at this device's copy before it touches the live doc
      const staging = new Y.Doc();
      const peek = new IndexeddbPersistence(name, staging);
      await peek.whenSynced;
      const copyEpoch = boardMaps(staging).meta.get("epoch") as string | undefined;
      const hasCopy = boardMaps(staging).sections.size > 0;
      await peek.destroy();
      staging.destroy();
      const serverEpoch = await fetchEpoch(this.boardId);
      if (this.closed) return;
      if (hasCopy && serverEpoch && copyEpoch !== serverEpoch) {
        // the server's board was made again since this copy: don't merge a different board into it
        await new IndexeddbPersistence(name, new Y.Doc()).clearData();
        toast("This board was reset on the server, so this device's older copy was set aside.", "warn");
      }
      this.idb = new IndexeddbPersistence(name, this.doc);
      await this.idb.whenSynced;
      if (this.closed) return;
      if (boardMaps(this.doc).sections.size > 0) {
        this.fromDevice = true;
        this.wire(false);
      }
    } catch {
      /* no IndexedDB here (a private window): online only */
    }
    if (!this.closed) void this.connect();
  }

  // ---------- transport ----------

  private async connect() {
    if (this.closed) return;
    this.setStatus("connecting");
    // a board on screen only rejoins the board it came from: if the server's was made again, set ours aside
    const mine = boardMaps(this.doc).meta.get("epoch") as string | undefined;
    if (this.ready) {
      const theirs = await fetchEpoch(this.boardId);
      if (this.closed) return;
      if (theirs && theirs !== mine) return this.setAside();
    }
    // say which board we hold (empty: none yet); the server refuses a copy of a board it has since made again
    const ws = new WebSocket(wsUrl(`/sync/${encodeURIComponent(this.boardId)}?epoch=${encodeURIComponent(mine ?? "")}`));
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeSyncStep1(enc, this.doc);
      ws.send(encoding.toUint8Array(enc));
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MSG_AWARENESS);
      encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]));
      ws.send(encoding.toUint8Array(aw));
    };
    ws.onmessage = (ev) => {
      const dec = decoding.createDecoder(new Uint8Array(ev.data as ArrayBuffer));
      const type = decoding.readVarUint(dec);
      if (type === MSG_SYNC) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        const kind = syncProtocol.readSyncMessage(dec, enc, this.doc, this);
        if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
        // our answer to the server's step 1 carried everything it lacked: offline changes included
        if (kind === syncProtocol.messageYjsSyncStep1 && this.pending) this.setPending(false);
        if (kind === syncProtocol.messageYjsSyncStep2) {
          this.wire(true);
          this.fromDevice = false;
          this.setStatus("live");
        } else if (this.ready && this.status !== "live") this.setStatus("live");
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), this);
      }
    };
    ws.onclose = (ev) => {
      this.ws = null;
      if (this.closed) return;
      // an admin changed my role here: the shell reads it again, the socket comes back under it
      if (ev.code === 4001) window.dispatchEvent(new Event("foundation:boards"));
      // the server's board was made again since ours: don't keep offering the old one
      if (ev.code === 4002) return void this.setAside();
      this.setStatus("offline");
      const delay = Math.min(15_000, 400 * 2 ** this.retry++) * (0.75 + Math.random() * 0.5);
      setTimeout(() => void this.connect(), delay);
    };
  }

  private send(data: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  private setStatus(s: SyncStatus) {
    if (this.status === s) return;
    this.status = s;
    this.notify();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private notify() {
    for (const fn of this.listeners) fn();
  }

  // ---------- first sync: doc → store (or seed an empty board from the store) ----------

  /** wire the store to the doc, once: `seed` an empty board from the store (the server's first answer only) */
  private wire(seed: boolean) {
    if (this.ready) return;
    this.ready = true;
    const m = boardMaps(this.doc);
    if (m.sections.size === 0 && seed) {
      this.pushAll(getState());
    } else {
      this.pullGrid();
      this.pullSections();
      this.pullObjects(null);
      this.pullLinks();
      this.pullCells(null);
    }
    setSyncHook((next, prev) => this.push(next, prev));
    this.unsubWorkbook = workbook.subscribeAll((tableId) => {
      if (!this.applyingCells && tableId) {
        if (this.readOnly) this.revert();
        else this.pushCells(tableId);
      }
    });
  }

  // ---------- store → doc ----------

  private pushAll(st: AppState) {
    this.doc.transact(() => {
      const m = boardMaps(this.doc);
      m.meta.set("schema", BOARD_SCHEMA);
      m.grid.set("tracks", st.grid);
      for (const s of Object.values(st.sections)) m.sections.set(s.id, toSectionDoc(s));
      for (const slice of Object.values(SLICE)) {
        for (const o of Object.values(st[slice]) as AnyObject[]) m.objects.set(o.id, toObjectDoc(o));
      }
      for (const n of Object.values(st.notes)) setNoteText(this.doc, n.id, n.text);
      for (const t of Object.keys(st.tables)) tableCellMap(this.doc, t);
      for (const l of Object.values(st.links)) m.links.set(l.id, l);
    }, LOCAL);
    for (const t of Object.keys(st.tables)) this.pushCells(t);
  }

  setReadOnly(on: boolean) {
    if (this.readOnly === on) return;
    this.readOnly = on;
    this.notify();
  }
  get isReadOnly() {
    return this.readOnly;
  }

  /** a viewer changed something locally: put the board back the way the doc has it */
  private revert() {
    if (this.reverting) return;
    this.reverting = true;
    queueMicrotask(() => {
      try {
        this.pullGrid();
        this.pullSections();
        this.pullObjects(null);
        this.pullLinks();
        this.pullCells(null);
      } finally {
        this.reverting = false;
      }
      viewOnlyNotice();
    });
  }

  private push(next: AppState, prev: AppState) {
    if (!this.ready) return;
    if (this.readOnly) {
      // only what everyone shares snaps back; camera, focus and scroll stay local
      const shared = next.grid !== prev.grid || next.sections !== prev.sections || next.links !== prev.links || Object.values(SLICE).some((k) => next[k] !== prev[k]);
      if (shared) this.revert();
      return;
    }
    const m = boardMaps(this.doc);
    this.doc.transact(() => {
      if (next.grid !== prev.grid) m.grid.set("tracks", next.grid);
      if (next.sections !== prev.sections) {
        for (const [id, s] of Object.entries(next.sections)) {
          const p = prev.sections[id];
          if (!p || p.name !== s.name || p.c0 !== s.c0 || p.c1 !== s.c1 || p.r0 !== s.r0 || p.r1 !== s.r1 || p.host !== s.host) m.sections.set(id, toSectionDoc(s));
        }
        for (const id of Object.keys(prev.sections)) if (!next.sections[id]) m.sections.delete(id);
      }
      for (const slice of Object.values(SLICE)) {
        const a = next[slice] as Record<string, AnyObject>;
        const b = prev[slice] as Record<string, AnyObject>;
        if (a === b) continue;
        for (const [id, o] of Object.entries(a)) {
          const was = b[id];
          if (was === o) continue;
          if (slice === "notes") {
            const n = o as AnyObject & { text: string };
            const p = was as (AnyObject & { text: string }) | undefined;
            // typing touches only the text; the card is rewritten only when the card changed
            if (!p || !sameCard(p as unknown as Record<string, unknown>, n as unknown as Record<string, unknown>)) m.objects.set(id, toObjectDoc(o));
            if (!p || p.text !== n.text) setNoteText(this.doc, id, n.text);
          } else {
            m.objects.set(id, toObjectDoc(o));
            // a new table's cell map is made with it, in this same change (see tableCellMap)
            if (slice === "tables" && !was) tableCellMap(this.doc, id);
          }
        }
        for (const id of Object.keys(b)) {
          if (a[id]) continue;
          m.objects.delete(id);
          if (slice === "notes") m.noteText.delete(id);
        }
      }
      if (next.links !== prev.links) {
        for (const [id, l] of Object.entries(next.links)) if (prev.links[id] !== l) m.links.set(id, l);
        for (const id of Object.keys(prev.links)) if (!next.links[id]) m.links.delete(id);
      }
    }, LOCAL);
  }

  private pushCells(tableId: string) {
    const t = workbook.getTable(tableId);
    const m = boardMaps(this.doc);
    if (!t) {
      if (m.cells.has(tableId)) this.doc.transact(() => m.cells.delete(tableId), LOCAL);
      return;
    }
    const raw: Record<string, string> = {};
    for (const [k, c] of t.cells) if (c.raw) raw[k] = c.raw;
    if (sameRecord(tableCellsOf(this.doc, tableId), raw)) return;
    // only the cells that differ: someone editing another cell keeps their edit
    this.doc.transact(() => setTableCells(this.doc, tableId, raw), LOCAL);
  }

  // ---------- doc → store ----------

  private pullGrid() {
    const tracks = boardMaps(this.doc).grid.get("tracks");
    if (tracks) applyRemote({ grid: tracks });
  }

  private pullSections() {
    const st = getState();
    const sections: Record<string, Section> = {};
    for (const s of boardMaps(this.doc).sections.values()) {
      sections[s.id] = { ...s };
    }
    const partial: Partial<AppState> = { sections };
    if (!sections[st.activeSectionId]) {
      const first = Object.keys(sections)[0];
      if (first) partial.activeSectionId = first;
    }
    applyRemote(partial);
  }

  private pullObjects(keys: string[] | null) {
    const st = getState();
    const m = boardMaps(this.doc);
    const slices: Partial<Record<(typeof SLICE)[Kind], Record<string, AnyObject>>> = {};
    const slice = (k: Kind) => (slices[SLICE[k]] ??= { ...(st[SLICE[k]] as Record<string, AnyObject>) });
    if (keys === null) {
      for (const k of Object.keys(SLICE) as Kind[]) slices[SLICE[k]] = {};
      for (const o of m.objects.values()) slice(o.kind)[o.id] = fromObjectDoc(o, this.doc);
    } else {
      for (const id of keys) {
        const o = m.objects.get(id);
        if (o) {
          slice(o.kind)[id] = fromObjectDoc(o, this.doc);
        } else {
          for (const k of Object.keys(SLICE) as Kind[]) {
            const rec = st[SLICE[k]] as Record<string, AnyObject>;
            if (rec[id]) {
              delete slice(k)[id];
              if (k === "table") workbook.removeTable(id);
            }
          }
        }
      }
    }
    // the workbook must know every table before cells arrive
    for (const t of Object.values(slices.tables ?? {}) as Array<{ id: string; name: string; cols: number; rows: number }>) {
      const existing = workbook.getTable(t.id);
      if (!existing) workbook.addTable(t.id, t.name, t.cols, t.rows);
      else {
        if (existing.name !== t.name) workbook.renameTable(t.id, t.name);
        if (existing.cols !== t.cols || existing.rows !== t.rows) workbook.resize(t.id, t.cols, t.rows);
      }
    }
    applyRemote(slices as Partial<AppState>);
  }

  private pullNoteText(ids: string[]) {
    const st = getState();
    const notes = { ...st.notes };
    let changed = false;
    for (const id of ids) {
      const n = notes[id];
      if (!n) continue;
      const text = noteTextOf(this.doc, n);
      if (text !== n.text) {
        notes[id] = { ...n, text };
        changed = true;
      }
    }
    if (changed) applyRemote({ notes });
  }

  private pullLinks() {
    applyRemote({ links: Object.fromEntries(boardMaps(this.doc).links.entries()) });
  }

  private pullCells(keys: string[] | null) {
    const m = boardMaps(this.doc);
    const ids = keys ?? [...m.cells.keys()];
    this.applyingCells = true;
    try {
      for (const tableId of ids) {
        const t = workbook.getTable(tableId);
        if (!t || !m.cells.has(tableId)) continue;
        const raw = tableCellsOf(this.doc, tableId);
        for (const [k, c] of t.cells) if (c.raw && !(k in raw)) setCellKey(tableId, k, "");
        for (const [k, v] of Object.entries(raw)) if (t.cells.get(k)?.raw !== v) setCellKey(tableId, k, v);
      }
    } finally {
      this.applyingCells = false;
    }
  }

  /**
   * A keystroke in a note: the edit that turned `base` (what the editor showed)
   * into `next`, applied to the shared text — rebased past anything that
   * arrived in between, so nobody's characters are lost. Returns the text now.
   */
  editNote(id: string, base: string, next: string): string {
    const t = boardMaps(this.doc).noteText.get(id);
    if (this.readOnly) return t?.toString() ?? base;
    if (!this.ready || !t) return next;
    const e = rebaseEdit(base, next, t.toString());
    if (!e) return t.toString();
    this.doc.transact(() => {
      if (e.remove) t.delete(e.at, e.remove);
      if (e.insert) t.insert(e.at, e.insert);
    }, LOCAL);
    return t.toString();
  }

  // ---------- your own undo in a note ----------

  private undoers = new Map<string, Y.UndoManager>();

  /**
   * Undo (or redo) in a note takes back only what *you* typed there: other
   * people's words stay. One stack per note, kept while the board is open;
   * keystrokes within half a second are one step. Returns whether anything
   * changed (the store hears of it through the note's text observer).
   */
  undoNote(id: string, redo = false): boolean {
    if (this.readOnly) return false;
    const u = this.undoerFor(id);
    if (!u) return false;
    return (redo ? u.redo() : u.undo()) !== null;
  }

  private undoerFor(id: string): Y.UndoManager | null {
    const t = boardMaps(this.doc).noteText.get(id);
    let u = this.undoers.get(id);
    if (u && t && u.scope[0] === t) return u;
    u?.destroy();
    this.undoers.delete(id);
    if (!t) return null;
    u = new Y.UndoManager(t, { trackedOrigins: new Set([LOCAL]), captureTimeout: 500 });
    this.undoers.set(id, u);
    return u;
  }

  /** start tracking a note's edits before the first keystroke, so that keystroke can be undone */
  watchNoteUndo(id: string) {
    this.undoerFor(id);
  }

  // ---------- carets in notes ----------

  /**
   * Where you are writing: the note and your selection, as positions in its
   * shared text (relative, so they stay on the same characters while others
   * type around them). null when you stop writing.
   */
  setCaret(noteId: string | null, anchor = 0, head = anchor) {
    const t = noteId ? boardMaps(this.doc).noteText.get(noteId) : null;
    const next = t
      ? {
          note: noteId,
          anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(t, anchor)),
          head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(t, head)),
        }
      : null;
    const prev = (this.awareness.getLocalState() as { caret?: unknown } | null)?.caret ?? null;
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    this.awareness.setLocalStateField("caret", next);
  }

  /** other people's carets in a note, as indexes into its text now */
  noteCarets(noteId: string): NoteCaret[] {
    const t = boardMaps(this.doc).noteText.get(noteId);
    if (!t) return [];
    const out: NoteCaret[] = [];
    for (const [clientId, s] of this.awareness.getStates()) {
      if (clientId === this.doc.clientID) continue;
      const c = (s as { caret?: { note: string; anchor: unknown; head: unknown } | null; user?: PeerState["user"] }).caret;
      if (!c || c.note !== noteId || !s.user) continue;
      const at = (j: unknown) => {
        const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(j), this.doc);
        return abs && abs.type === t ? abs.index : null;
      };
      const a = at(c.anchor);
      const h = at(c.head);
      if (a === null || h === null) continue;
      out.push({ clientId, name: s.user.name, color: s.user.color, from: Math.min(a, h), to: Math.max(a, h), head: h });
    }
    return out.sort((x, y) => x.clientId - y.clientId);
  }

  private caretSig = new Map<string, string>();
  private caretListeners = new Map<string, Set<() => void>>();

  /** a note hears only when someone's caret in it moves (not on every pointer move) */
  onNoteCarets(noteId: string, fn: () => void) {
    let s = this.caretListeners.get(noteId);
    if (!s) this.caretListeners.set(noteId, (s = new Set()));
    s.add(fn);
    return () => {
      s!.delete(fn);
    };
  }

  private refreshCarets() {
    const sig = new Map<string, string>();
    for (const [clientId, s] of this.awareness.getStates()) {
      if (clientId === this.doc.clientID) continue;
      const c = (s as { caret?: { note: string } | null }).caret;
      if (!c?.note) continue;
      sig.set(c.note, (sig.get(c.note) ?? "") + clientId + JSON.stringify(c));
    }
    for (const note of new Set([...sig.keys(), ...this.caretSig.keys()])) {
      if (sig.get(note) === this.caretSig.get(note)) continue;
      for (const fn of this.caretListeners.get(note) ?? []) fn();
    }
    this.caretSig = sig;
  }

  // ---------- presence ----------

  setCursor(cursor: { x: number; y: number } | null) {
    const cur = this.awareness.getLocalState() ?? {};
    this.awareness.setLocalStateField("cursor", cursor);
    void cur;
  }

  setFocus(focus: string | null) {
    this.awareness.setLocalStateField("focus", focus);
  }

  peers(): PeerState[] {
    const out: PeerState[] = [];
    for (const [clientId, s] of this.awareness.getStates()) {
      if (clientId === this.doc.clientID || !s?.user) continue;
      out.push({ clientId, ...(s as Omit<PeerState, "clientId">) });
    }
    return out;
  }

  activity() {
    return boardMaps(this.doc).activity.toArray();
  }

  destroy() {
    this.closed = true;
    setSyncHook(null);
    for (const u of this.undoers.values()) u.destroy();
    this.undoers.clear();
    this.unsubWorkbook?.();
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
    this.ws?.close();
    void this.idb?.destroy(); // closes the copy; it stays on the device
    this.doc.destroy();
  }
}

function setCellKey(tableId: string, key: string, raw: string) {
  const [c, r] = key.split(",").map((n) => parseInt(n, 10));
  workbook.setCell(tableId, c, r, raw);
}

function sameRecord(a: Record<string, string>, b: Record<string, string>) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

function toSectionDoc(s: Section): SectionDoc {
  const doc: SectionDoc = { id: s.id, name: s.name, c0: s.c0, r0: s.r0, c1: s.c1, r1: s.r1 };
  if (s.host) doc.host = s.host;
  return doc;
}

/** a note's card, ignoring its text (which lives in its Y.Text) */
function sameCard(a: Record<string, unknown>, b: Record<string, unknown>) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (k !== "text" && a[k] !== b[k]) return false;
  return true;
}

function toObjectDoc(o: AnyObject): ObjectDoc {
  const doc = { ...o, kind: kindOf(o) } as Record<string, unknown>;
  if (doc.kind === "note") delete doc.text; // in its Y.Text
  // blob: URLs only live in this tab; never share them
  if (typeof doc.src === "string" && (doc.src as string).startsWith("blob:")) doc.src = "";
  return doc as unknown as ObjectDoc;
}

function fromObjectDoc(o: ObjectDoc, doc: Y.Doc): AnyObject {
  const { kind: _k, ...rest } = o as ObjectDoc & Record<string, unknown>;
  const local = getState();
  if (_k === "note") rest.text = noteTextOf(doc, o);
  // keep a local blob preview while the shared copy has no URL yet
  if (_k === "media" && !rest.src) {
    const mine = local.media[o.id];
    if (mine?.src) rest.src = mine.src;
  }
  return rest as unknown as AnyObject;
}

// ---------- the active board ----------

let current: BoardSync | null = null;
const boardListeners = new Set<() => void>();

export function joinBoard(boardId: string, user: UserInfo): BoardSync {
  if (current && current.boardId === boardId) return current;
  current?.destroy();
  current = new BoardSync(boardId, user);
  for (const fn of boardListeners) fn();
  return current;
}

export function activeBoard(): BoardSync | null {
  return current;
}
// dev: the live sync, for headless checks
if ((import.meta.env?.DEV || import.meta.env?.VITE_E2E_HOOKS) && typeof window !== "undefined") (window as unknown as { __foundationBoard: () => BoardSync | null }).__foundationBoard = () => current;

export function onBoardChange(fn: () => void) {
  boardListeners.add(fn);
  return () => {
    boardListeners.delete(fn);
  };
}

export type { BoardSync };

/** ⌘Z / ⇧⌘Z in a note: only your own typing (see BoardSync.undoNote) */
export function undoNoteText(id: string, redo = false): boolean {
  return current?.undoNote(id, redo) ?? false;
}

/** a keystroke in a note, through the board's shared text (see BoardSync.editNote) */
export function editNoteText(id: string, base: string, next: string) {
  const text = current ? current.editNote(id, base, next) : next;
  updateNoteText(id, text);
  return text;
}

let lastNotice = 0;
function viewOnlyNotice() {
  if (Date.now() - lastNotice < 4000) return;
  lastNotice = Date.now();
  toast("View only — you can look around, but changes don't stick. An admin can make you a member.", "warn");
}

async function fetchEpoch(boardId: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    return (await api<{ epoch: string }>(`/api/boards/${encodeURIComponent(boardId)}/epoch`, { signal: ctrl.signal })).epoch;
  } catch {
    return null; // offline (or signed out): this device's copy stands
  } finally {
    clearTimeout(t);
  }
}

/** signing out: this device forgets every board copy it kept */
export async function forgetDevice() {
  current?.destroy();
  current = null;
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      dbs
        .filter((d) => d.name?.startsWith("foundation-board:"))
        .map((d) => new Promise<void>((ok) => {
          const r = indexedDB.deleteDatabase(d.name!);
          r.onsuccess = r.onerror = r.onblocked = () => ok();
        })),
    );
  } catch {
    /* nothing kept */
  }
}
