/**
 * Flowform, in the search pane: your rooms and your files, read through your
 * Flowform link (Settings → Services).
 *
 * Before you type: the rooms you're in. Press one to bring it in as a board
 * (or open it, once it's here); it's then kept up to date from Flowform every
 * few minutes. Type, and it searches the files Flowform can see for you
 * (uploads, board media, Slack, Figma): drag one onto the grid. With file
 * downloads allowed (Settings → Services) it's copied into this board's archive
 * and lands as the image, video or file itself. Without, a file with an address
 * of its own (Slack, Figma) lands as a link card, anything else as a note naming it.
 */

import { useEffect, useState } from "react";
import type { SearchHit } from "@foundation/protocol";
import { api, type UploadedFile } from "../lib/api";
import { activeBoard } from "../sync/board";
import { toast } from "../state/ui";
import { snippetHtml } from "../lib/snippet";
import { Draggable } from "./SearchPane";
import { sizeWords } from "./PlacesBrowser";

interface Room {
  room_id: string;
  name: string;
  role: string;
  asset_count: number;
  live: { board_id: string; pulled_at: number; cards: number; error: string | null } | null;
}
interface FfHit {
  file_id: string;
  title: string;
  kind: string;
  source: string;
  snippet?: string;
  external_url?: string | null;
  revision_id?: string | null;
  context?: { channel?: string | null; board?: string | null; poster?: string | null; date?: number | null };
  byte_size?: number | null;
}
interface ToolAnswer<T> {
  isError: boolean;
  text: string;
  structured?: T;
}

const GLYPH: Record<string, string> = { image: "▣", video: "▶", pdf: "▤", doc: "▤", model: "◇" };

function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

/** Flowform marks a match with <b>…</b>; as Foundation's «…» it's escaped and drawn like any other snippet (no HTML of theirs is ever inserted) */
const ffSnippet = (s: string) =>
  s
    .replace(/<b>/g, "«")
    .replace(/<\/b>/g, "»")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const openBoard = (id: string) => window.dispatchEvent(new CustomEvent("foundation:board", { detail: id }));

export function FlowformBrowser({ filter }: { filter: string }) {
  const [linked, setLinked] = useState<boolean | null>(null);
  /** file downloads allowed: a dragged file brings its bytes */
  const [downloads, setDownloads] = useState(false);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hits, setHits] = useState<FfHit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // bumped by Try again: the server may have been restarting, or Flowform away for a moment
  const [attempt, setAttempt] = useState(0);

  const loadRooms = () =>
    api<{ rooms: Room[] }>("/api/flowform/rooms").then(
      (r) => setRooms(r.rooms),
      (e: Error) => setErr(e.message),
    );

  useEffect(() => {
    setErr(null);
    api<{ connected: boolean; downloads?: boolean }>("/api/flowform/link").then(
      (s) => {
        setLinked(s.connected);
        setDownloads(Boolean(s.downloads));
        if (s.connected) void loadRooms();
      },
      (e: Error) => setErr(e.message),
    );
  }, [attempt]);

  // searching Flowform's files, a moment after typing stops
  const term = filter.trim();
  useEffect(() => {
    if (!linked || !term) return setHits(null);
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api<ToolAnswer<{ results: FfHit[] }>>("/api/flowform/tools/search", { method: "POST", json: { query: term, limit: 30 } });
        const results = r.structured?.results ?? (JSON.parse(r.text || "{}") as { results?: FfHit[] }).results ?? [];
        if (live) (setHits(results), setErr(null));
      } catch (e) {
        if (live) (setHits([]), setErr((e as Error).message));
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [linked, term, attempt]);

  /** copy a Flowform file into this board's archive; the search hit its card is made from */
  const bringFile = async (h: FfHit): Promise<SearchHit | null> => {
    const board = activeBoard()?.boardId ?? "company";
    try {
      const { file } = await api<{ file: UploadedFile }>(`/api/flowform/files/${encodeURIComponent(h.file_id)}/bring?board=${encodeURIComponent(board)}`, {
        method: "POST",
        json: { revision: h.revision_id, name: h.title },
      });
      return { source: "file", id: `file:${file.id}`, title: file.name, snippet: file.mime, url: file.url, score: 1 };
    } catch (x) {
      toast(`Couldn't bring ${h.title}: ${(x as Error).message}`, "bad");
      return null;
    }
  };

  const bring = async (room: Room) => {
    setBusy(room.room_id);
    try {
      const r = await api<{ board: string; cards: Record<string, number>; byName: number }>(`/api/flowform/rooms/${encodeURIComponent(room.room_id)}/pull?board=ff-${encodeURIComponent(room.room_id)}`, { method: "POST", json: {} });
      const n = r.cards.create + r.cards.update;
      toast(room.live ? (n ? `${room.name}: ${n} card${n === 1 ? "" : "s"} brought up to date` : `${room.name} is up to date`) : `${room.name} is here, and stays in step with Flowform`);
      window.dispatchEvent(new Event("foundation:boards"));
      openBoard(r.board);
      void loadRooms();
    } catch (e) {
      toast(`Couldn't bring in ${room.name}: ${(e as Error).message}`, "bad");
    } finally {
      setBusy(null);
    }
  };

  const again = (
    <div className="places-foot">
      <a href="#" onClick={(e) => (e.preventDefault(), setRooms(null), setHits(null), setAttempt((n) => n + 1))}>
        Try again
      </a>
    </div>
  );
  if (err && !rooms && !hits)
    return (
      <div className="places">
        <div className="pane-empty is-bad">{err}</div>
        {again}
      </div>
    );
  if (linked === null) return <div className="places"><div className="pane-empty">Asking the server…</div></div>;
  if (!linked)
    return (
      <div className="places">
        <div className="pane-empty">
          Flowform isn't connected for you. Connect it in <a href="#/settings/services">Settings → Services</a>, and your rooms and files show here.
        </div>
      </div>
    );

  if (term) {
    return (
      <div className="places">
        <div className="pane-eyebrow">Your Flowform files</div>
        {!hits && <div className="pane-empty">Searching Flowform…</div>}
        {hits && hits.length === 0 && (err ? <><div className="pane-empty is-bad">{err}</div>{again}</> : <div className="pane-empty">Nothing in Flowform for “{term}”.</div>)}
        {hits?.map((h) => {
          const where = [h.source, h.context?.channel && `#${h.context.channel}`, h.context?.board].filter(Boolean).join(" · ");
          const hit: SearchHit = h.external_url
            ? { source: "app", id: `flowform:${h.file_id}`, title: h.title, snippet: where, url: h.external_url, score: 1 }
            : { source: "board", id: `flowform:${h.file_id}`, title: h.title, snippet: `${/^[aeiou]/i.test(h.kind) ? "An" : "A"} ${h.kind} in Flowform${h.byte_size ? `, ${sizeWords(h.byte_size)}` : ""}${where ? ` (${where})` : ""}. Allow Flowform file downloads (Settings → Services) to bring the file itself.`, score: 1 };
          return (
            <Draggable
              key={h.file_id}
              className="search-row"
              hit={hit}
              onPress={() => (h.external_url ? window.open(h.external_url, "_blank", "noopener") : toast("Drag it onto the grid to place it"))}
              // with downloads, the file itself; else a link card (made as a link: an outside page can't be framed as an app), or the note
              resolve={async () => (downloads && h.revision_id ? bringFile(h) : h.external_url ? { ...hit, source: "slack" } : hit)}
            >
              <span className="search-row-glyph">{GLYPH[h.kind] ?? "▤"}</span>
              <span className="search-row-main">
                <span className="search-row-title">{h.title}</span>
                {h.snippet ? <span className="search-row-snip" dangerouslySetInnerHTML={{ __html: snippetHtml(ffSnippet(h.snippet)) }} /> : <span className="search-row-snip">{where}</span>}
              </span>
              <span className="search-row-src">{h.source}</span>
            </Draggable>
          );
        })}
      </div>
    );
  }

  return (
    <div className="places">
      <div className="pane-eyebrow">Your Flowform rooms</div>
      {!rooms && <div className="pane-empty">Reading your rooms…</div>}
      {rooms && rooms.length === 0 && <div className="pane-empty">You're not in any Flowform rooms.</div>}
      {rooms?.map((r) => {
        const viewer = r.role === "viewer";
        const status = r.live
          ? r.live.error
            ? `Couldn't update ${ago(r.live.pulled_at)}: ${r.live.error}`
            : `Here, ${r.live.cards} cards · checked ${ago(r.live.pulled_at)}`
          : viewer
            ? "View only in Flowform: an editor can bring it in"
            : `${r.asset_count} file${r.asset_count === 1 ? "" : "s"} · press to bring it in`;
        return (
          <button
            key={r.room_id}
            className="search-row is-folder"
            disabled={busy !== null || (viewer && !r.live)}
            onClick={() => (r.live && !busy ? openBoard(r.live.board_id) : bring(r))}
            data-tip={r.live ? "Open its board" : "Bring it in as a board, kept in step with Flowform"}
          >
            <span className="search-row-glyph">▦</span>
            <span className="search-row-main">
              <span className="search-row-title">{r.name}</span>
              <span className={`search-row-snip${r.live?.error ? " is-bad" : ""}`}>{busy === r.room_id ? "Reading it from Flowform…" : status}</span>
            </span>
            {r.live && !viewer ? (
              <span
                className="search-row-src flowform-again"
                role="button"
                tabIndex={0}
                data-tip="Read it from Flowform again now"
                onClick={(e) => (e.stopPropagation(), busy === null && bring(r))}
              >
                ↻
              </span>
            ) : (
              <span className="search-row-src">{r.role}</span>
            )}
          </button>
        );
      })}
      <div className="places-foot">Type to search your Flowform files · rooms brought in are read again every few minutes</div>
    </div>
  );
}
