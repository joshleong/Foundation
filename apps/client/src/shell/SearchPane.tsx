/**
 * Search, on the floor at the right (⌘F). Look things up the way flowform
 * did — board cards, files (images show), apps, Slack, GitHub — and drag a
 * result onto the grid: it lands where it's dropped, floating in the section
 * under the pointer. A click does what ⌘K does (frame it, or open it).
 * Before you type, it shows this board's recent files and the known apps.
 */

import { keys } from "../lib/keys";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit } from "@foundation/protocol";
import { api, search } from "../lib/api";
import { toWorld } from "../state/camera";
import { addMedia, addNote, addPanel, getState, placeAtWorld, requestSnap, sectionAtWorld } from "../state/store";
import { WIDTHS, setUi, toast, useUi } from "../state/ui";
import { activeBoard } from "../sync/board";
import { snippetHtml, snippetText } from "../lib/snippet";
import { openHit, openUrlAsPanel } from "./CommandBar";
import { FloorEdge } from "./FloorEdge";
import { PlacesBrowser } from "./PlacesBrowser";

type Filter = "all" | "place" | SearchHit["source"];
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "board", label: "Board" },
  { id: "file", label: "Files" },
  { id: "app", label: "Apps" },
  { id: "slack", label: "Slack" },
  { id: "github", label: "GitHub" },
  // not a kind of result: the folders on this computer an admin approved, to browse and drag from (PlacesBrowser)
  { id: "place", label: "This computer" },
];
const GLYPH: Record<SearchHit["source"], string> = { board: "▦", file: "▤", app: "◳", slack: "#", github: "⌥", activity: "•", huddle: "◉" };
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const VIDEO = /\.(mp4|mov|webm|m4v)$/i;

export function SearchPane() {
  const ui = useUi();
  if (!ui.search || ui.presenting) return null;
  return <Pane />;
}

function Pane() {
  const ui = useUi();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const board = activeBoard()?.boardId ?? "company";

  useEffect(() => {
    requestAnimationFrame(() => input.current?.focus());
    // before typing: recent files on this board, and the apps Foundation knows
    void Promise.allSettled([
      api<{ files: Array<{ id: string; name: string; mime: string; url: string }> }>(`/api/files?board=${encodeURIComponent(board)}`),
      api<{ apps: Array<{ id: string; name: string; url?: string; description?: string }> }>("/api/apps"),
    ]).then(([f, a]) => {
      const files: SearchHit[] = f.status === "fulfilled" ? f.value.files.slice(0, 24).map((x) => ({ source: "file", id: `file:${x.id}`, title: x.name, snippet: x.mime, url: x.url, score: 1 })) : [];
      const apps: SearchHit[] = a.status === "fulfilled" ? a.value.apps.slice(0, 12).map((x) => ({ source: "app", id: `app:${x.id}`, title: x.name, snippet: x.description ?? x.url ?? "", url: x.url, score: 1 })) : [];
      setRecent([...files, ...apps]);
    });
  }, [board]);

  // local first (a few ms), then everything
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      // a search cut short by clearing the box leaves no dots behind
      setHits([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        setHits((await search(term, board, false, ctrl.signal)).hits);
        setHits((await search(term, board, true, ctrl.signal)).hits);
      } catch {
        /* aborted */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 90);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, board]);

  const shown = useMemo(() => {
    const list = q.trim() ? hits : recent;
    return filter === "all" ? list : list.filter((h) => h.source === filter);
  }, [q, hits, recent, filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const h of q.trim() ? hits : recent) c[h.source] = (c[h.source] ?? 0) + 1;
    return c;
  }, [q, hits, recent]);

  const images = shown.filter((h) => h.source === "file" && h.url && IMAGE.test(h.title));
  const rest = shown.filter((h) => !images.includes(h));

  return (
    <aside className="search-pane floor-pane" style={{ width: ui.searchW }} aria-label="Search">
      <FloorEdge side="left" value={ui.searchW} {...WIDTHS.search} onChange={(w) => setUi({ searchW: w })} label="Search" />
      <header className="search-head">
        <span className="search-glyph">⌕</span>
        <input
          ref={input}
          className="search-field"
          value={q}
          placeholder="Search the board, files, apps, Slack…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (q ? setQ("") : setUi({ search: false }))}
        />
        {loading && <span className="thinking-dots"><i /><i /><i /></span>}
        <button className="top-btn" onClick={() => setUi({ search: false })} title={`Close (${keys("mod+F")})`} aria-label="Close search">
          ✕
        </button>
      </header>
      <div className="search-filters">
        {FILTERS.map((f) => (
          <button key={f.id} className={`search-chip${filter === f.id ? " is-on" : ""}`} onClick={() => setFilter(f.id)}>
            {f.label}
            {f.id !== "all" && counts[f.id] ? <span className="search-chip-n">{counts[f.id]}</span> : null}
          </button>
        ))}
      </div>
      {filter === "place" && <PlacesBrowser board={board} filter={q.trim()} />}
      <div className="search-results" hidden={filter === "place"}>
        {!q.trim() && shown.length > 0 && <div className="pane-eyebrow">Recent on this board</div>}
        {q.trim() && !loading && shown.length === 0 && <div className="pane-empty">Nothing for “{q.trim()}”{filter !== "all" ? ` in ${FILTERS.find((f) => f.id === filter)?.label}` : ""}.</div>}
        {images.length > 0 && (
          <div className="search-tiles">
            {images.map((h) => (
              <Draggable key={h.id} hit={h} className="search-tile">
                <img src={h.url} alt="" loading="lazy" draggable={false} />
                <span className="search-tile-name">{h.title}</span>
              </Draggable>
            ))}
          </div>
        )}
        {rest.map((h) => (
          <Draggable key={h.id} hit={h} className="search-row">
            <span className="search-row-glyph">{GLYPH[h.source]}</span>
            <span className="search-row-main">
              <span className="search-row-title">{h.title}</span>
              {h.snippet && <span className="search-row-snip" dangerouslySetInnerHTML={{ __html: snippetHtml(h.snippet) }} />}
            </span>
            <span className="search-row-src">{h.source}</span>
          </Draggable>
        ))}
      </div>
      <div className="search-foot">Drag onto the grid to place it · click to open</div>
    </aside>
  );
}


// ---------- drag a result onto the grid ----------

/** a result you can press (open) or pull out onto the grid (place) */
export function Draggable({
  hit,
  className,
  children,
  onPress,
  resolve,
}: {
  hit: SearchHit;
  className: string;
  children: React.ReactNode;
  /** a press that isn't a drag (default: open the hit, as ⌘K does) */
  onPress?: () => void;
  /** a hit that has to be fetched before it can be placed (a file brought from a place): called on drop */
  resolve?: () => Promise<SearchHit | null>;
}) {
  const d = useRef<{ x: number; y: number; ghost: HTMLElement | null; target: string | null } | null>(null);

  const end = () => {
    const g = d.current;
    g?.ghost?.remove();
    document.body.classList.remove("is-dragging-hit");
    setDropTarget(null);
    d.current = null;
  };

  return (
    <button
      className={className}
      data-tip={hit.title}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        d.current = { x: e.clientX, y: e.clientY, ghost: null, target: null };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const g = d.current;
        if (!g) return;
        if (!g.ghost) {
          if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 5) return;
          g.ghost = makeGhost(hit);
          document.body.classList.add("is-dragging-hit");
        }
        g.ghost.style.transform = `translate3d(${e.clientX + 12}px, ${e.clientY + 10}px, 0)`;
        const over = gridPoint(e.clientX, e.clientY);
        const sec = over ? sectionAtWorld(over.wx, over.wy) : null;
        g.ghost.classList.toggle("is-over", !!over);
        if ((sec?.id ?? null) !== g.target) {
          g.target = sec?.id ?? null;
          setDropTarget(g.target);
        }
      }}
      onPointerUp={(e) => {
        const g = d.current;
        if (!g) return;
        const dragged = !!g.ghost;
        end();
        if (!dragged) return onPress ? onPress() : openHit(hit);
        const over = gridPoint(e.clientX, e.clientY);
        if (!over) return;
        if (!resolve) return void place(hit, over.wx, over.wy);
        void resolve().then((h) => h && place(h, over.wx, over.wy));
      }}
      onPointerCancel={end}
    >
      {children}
    </button>
  );
}

function makeGhost(hit: SearchHit) {
  const el = document.createElement("div");
  el.className = "search-ghost";
  const img = hit.source === "file" && hit.url && IMAGE.test(hit.title) ? `<img src="${hit.url}" alt="">` : `<span class="search-row-glyph">${GLYPH[hit.source]}</span>`;
  el.innerHTML = `${img}<span>${hit.title.replace(/</g, "&lt;")}</span>`;
  document.body.appendChild(el);
  return el;
}

/** the world point under a screen point, if it's on open grid (not a pane or the bar) */
function gridPoint(cx: number, cy: number): { wx: number; wy: number } | null {
  const vp = document.querySelector<HTMLElement>(".grid-viewport");
  if (!vp) return null;
  const top = document.elementFromPoint(cx, cy);
  if (!top || top.closest(".floor-pane, .top-bar, .search-ghost") || !vp.contains(top)) return null;
  const r = vp.getBoundingClientRect();
  const w = toWorld(cx - r.left, cy - r.top);
  return { wx: w.x, wy: w.y };
}

/** a section lights up while a result is held over it */
function setDropTarget(id: string | null) {
  document.querySelectorAll(".section-card.is-hit-target, [data-section-id].is-hit-target").forEach((el) => el.classList.remove("is-hit-target"));
  if (id) document.querySelector(`[data-section-id="${CSS.escape(id)}"]`)?.classList.add("is-hit-target");
}

/** make the card the result stands for, where it was dropped */
async function place(hit: SearchHit, wx: number, wy: number) {
  const st = getState();
  const sec = sectionAtWorld(wx, wy) ?? st.sections[st.activeSectionId] ?? Object.values(st.sections)[0];
  if (!sec) return;
  const existing = hit.objectId && (st.panels[hit.objectId] || st.notes[hit.objectId] || st.tables[hit.objectId] || st.media[hit.objectId] || st.maps[hit.objectId]);
  if (existing) {
    // it's already on the board: show it rather than copy it
    requestSnap({ kind: "object", id: hit.objectId! });
    toast(`“${hit.title}” is already on the board`);
    return;
  }
  let id: string | null = null;
  if (hit.source === "file" && hit.url && (IMAGE.test(hit.title) || VIDEO.test(hit.title))) {
    const video = VIDEO.test(hit.title);
    const { w, h } = video ? { w: 640, h: 360 } : await imageSize(hit.url);
    id = addMedia(sec.id, hit.url, video ? "video" : "image", hit.title, w, h, { focus: false }).id;
  } else if (hit.source === "file") {
    id = addPanel(sec.id, { panel: "file", name: hit.title, fileId: hit.id.replace(/^file:/, "") }, { focus: false }).id;
  } else if (hit.source === "app" && hit.url) {
    void openUrlAsPanel(hit.url, "app", { name: hit.title, description: hit.snippet }, sec.id, (pid) => placeAtWorld(pid, wx, wy));
    return;
  } else if (hit.url) {
    id = addPanel(sec.id, { panel: "link", name: hit.title, url: hit.url }, { focus: false }).id;
  } else {
    id = addNote(sec.id, `## ${hit.title}\n\n${snippetText(hit.snippet)}`, { focus: false }).id;
  }
  if (id) placeAtWorld(id, wx, wy);
}

function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok({ w: img.naturalWidth || 480, h: img.naturalHeight || 360 });
    img.onerror = () => ok({ w: 480, h: 360 });
    img.src = src;
  });
}
