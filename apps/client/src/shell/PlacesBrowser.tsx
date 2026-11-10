/**
 * This computer, in the search pane: the folders an admin approved for
 * Foundation (Settings → Places), browsed like a file panel. Press a folder to
 * open it; pull a file out onto the grid and it's copied into the archive and
 * lands as a card where it was dropped (the original is only read). Nothing
 * outside an approved place is ever listed: the server resolves every path.
 */

import { useEffect, useState } from "react";
import type { SearchHit } from "@foundation/protocol";
import { api, type UploadedFile } from "../lib/api";
import { toast } from "../state/ui";
import { Draggable } from "./SearchPane";

interface Place {
  id: string;
  name: string;
  path: string;
  reachable: boolean;
}
interface Entry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  modified: number;
}

export function sizeWords(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
  return `${(n / 1073741824).toFixed(1)} GB`;
}

export function PlacesBrowser({ board, filter }: { board: string; filter: string }) {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [at, setAt] = useState<{ place: Place; dir: string } | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [more, setMore] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ places: Place[] }>("/api/places").then(
      (r) => setPlaces(r.places),
      (e: Error) => setErr(e.message),
    );
  }, []);

  useEffect(() => {
    if (!at) return;
    let live = true;
    setEntries(null);
    setErr(null);
    api<{ entries: Entry[]; more: number }>(`/api/places/${encodeURIComponent(at.place.id)}/list?dir=${encodeURIComponent(at.dir)}`).then(
      (r) => live && (setEntries(r.entries), setMore(r.more)),
      (e: Error) => live && (setEntries([]), setErr(e.message)),
    );
    return () => {
      live = false;
    };
  }, [at]);

  /** copy the file into the archive, and hand back the search hit its card is made from */
  const bring = async (place: Place, e: Entry): Promise<SearchHit | null> => {
    try {
      const { file } = await api<{ file: UploadedFile }>(`/api/places/${encodeURIComponent(place.id)}/bring?board=${encodeURIComponent(board)}`, { method: "POST", json: { path: e.path } });
      return { source: "file", id: `file:${file.id}`, title: file.name, snippet: file.mime, url: file.url, score: 1 };
    } catch (x) {
      toast(`Couldn't bring ${e.name}: ${(x as Error).message}`);
      return null;
    }
  };

  if (err && !at) return <div className="places"><div className="pane-empty is-bad">{err}</div></div>;
  if (!places) return <div className="places"><div className="pane-empty">Asking the server…</div></div>;

  if (!at) {
    return (
      <div className="places">
        <div className="pane-eyebrow">Approved places on this computer</div>
        {places.length === 0 && (
          <div className="pane-empty">
            No folders are approved yet. An admin approves the ones Foundation may read in <a href="#/settings/places">Settings → Places</a>.
          </div>
        )}
        {places.map((p) => (
          <button key={p.id} className="search-row is-folder" disabled={!p.reachable} onClick={() => setAt({ place: p, dir: "" })} data-tip={p.path}>
            <span className="search-row-glyph">▱</span>
            <span className="search-row-main">
              <span className="search-row-title">{p.name}</span>
              <span className="search-row-snip">{p.reachable ? p.path : `Not reachable now · ${p.path}`}</span>
            </span>
            <span className="search-row-src">folder</span>
          </button>
        ))}
        {places.length > 0 && (
          <div className="places-foot">
            <a href="#/settings/places">Manage places</a>
          </div>
        )}
      </div>
    );
  }

  const crumbs = at.dir ? at.dir.split("/") : [];
  const term = filter.toLowerCase();
  const shown = (entries ?? []).filter((e) => !term || e.name.toLowerCase().includes(term));
  return (
    <div className="places">
      <nav className="places-crumbs" aria-label="Folder">
        <button onClick={() => setAt(null)}>This computer</button>
        <span>›</span>
        <button className={crumbs.length ? "" : "is-here"} onClick={() => setAt({ place: at.place, dir: "" })}>
          {at.place.name}
        </button>
        {crumbs.map((c, i) => (
          <span key={i} className="places-crumb">
            <span>›</span>
            <button className={i === crumbs.length - 1 ? "is-here" : ""} onClick={() => setAt({ place: at.place, dir: crumbs.slice(0, i + 1).join("/") })}>
              {c}
            </button>
          </span>
        ))}
      </nav>
      {err && <div className="pane-empty is-bad">{err}</div>}
      {!entries && <div className="pane-empty">Reading the folder…</div>}
      {entries && !err && shown.length === 0 && <div className="pane-empty">{term ? `Nothing named “${filter}” here.` : "This folder is empty."}</div>}
      {shown.map((e) =>
        e.dir ? (
          <button key={e.path} className="search-row is-folder" onClick={() => setAt({ place: at.place, dir: e.path })}>
            <span className="search-row-glyph">▱</span>
            <span className="search-row-main">
              <span className="search-row-title">{e.name}</span>
            </span>
            <span className="search-row-src">›</span>
          </button>
        ) : (
          <Draggable
            key={e.path}
            className="search-row"
            hit={{ source: "file", id: `place:${at.place.id}:${e.path}`, title: e.name, snippet: "", score: 1 }}
            onPress={() => toast("Drag it onto the grid to bring it in")}
            resolve={() => bring(at.place, e)}
          >
            <span className="search-row-glyph">▤</span>
            <span className="search-row-main">
              <span className="search-row-title">{e.name}</span>
            </span>
            <span className="search-row-src places-size">{sizeWords(e.size)}</span>
          </Draggable>
        ),
      )}
      {more > 0 && <div className="pane-empty">…and {more} more. Type to narrow it down.</div>}
    </div>
  );
}
