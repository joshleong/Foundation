import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CONTENT_PAD,
  GridTracks,
  SECTION_HEADER,
  Section,
  addNote,
  addPanel,
  addSectionAdjacent,
  getLiveScroll,
  getState,
  cellAtWorld,
  edgeAtWorld,
  moveSectionToEdge,
  type BoardEdge,
  createMap,
  createTable,
  effectivePos,
  liveScroll,
  moveSectionTo,
  objectPixelSize,
  removeSection,
  renameSection,
  requestRemoveSection,
  requestSnap,
  sectionCardRect,
  setActiveSection,
  setSectionDragTarget,
  setSectionHost,
  setSectionScroll,
  splitSection,
  useSection,
} from "../state/store";
import { Spring, Spring2D, presets } from "../physics/spring";
import { TableView } from "./TableView";
// MapLibre is ~1 MB: load it only when a board has a map
const MapView = lazy(() => import("./MapView").then((m) => ({ default: m.MapView })));
import { NoteView } from "./NoteView";
import { MediaView } from "./MediaView";
import { PANEL_GLYPH, PanelActions, PanelView } from "../panels/PanelView";
import { isHostable } from "@foundation/protocol";
import { isPanel } from "../state/store";
import { ingest } from "../lib/ingest";
import { SectionEmpty } from "../panels/SectionEmpty";
import { askAgent, setUi } from "../state/ui";
import { openContextMenu, type MenuItem } from "./ContextMenu";
import { api } from "../lib/api";
import { activeBoard } from "../sync/board";
import { toast } from "../state/ui";

interface Props {
  section: Section;
  grid: GridTracks;
  active: boolean;
  canRemove: boolean;
  getScale(): number;
  zoomSpring: Spring;
}

export const SectionView = memo(function SectionView({
  section,
  grid,
  active,
  canRemove,
  getScale,
  zoomSpring,
}: Props) {
  const view = useSection(section.id);
  const cardRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dropping, setDropping] = useState(false);

  // ----- drag the whole section to another grid cell -----
  const moveDrag = useRef({
    down: false,
    dragging: false,
    startX: 0,
    startY: 0,
    target: null as { c: number; r: number } | null,
    edge: null as BoardEdge | null,
    justDragged: false,
  });

  const worldPoint = useCallback(
    (clientX: number, clientY: number) => {
      const world = cardRef.current?.closest(".world");
      if (!world) return null;
      const wr = (world as HTMLElement).getBoundingClientRect();
      const s = getScale();
      return { x: (clientX - wr.left) / s, y: (clientY - wr.top) / s };
    },
    [getScale],
  );

  const onSectionHeaderDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // the name is a button (click to rename) and also the natural handle: it drags too
    if ((e.target as HTMLElement).closest("button:not(.section-name), input")) return;
    const d = moveDrag.current;
    d.down = true;
    d.dragging = false;
    d.startX = e.clientX;
    d.startY = e.clientY;
    d.target = null;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* synthetic */ }
  }, []);

  const onSectionHeaderMove = useCallback(
    (e: React.PointerEvent) => {
      const d = moveDrag.current;
      if (!d.down) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.dragging) {
        if (Math.hypot(dx, dy) < 7) return; // preserve click / double-click
        d.dragging = true;
        cardRef.current?.classList.add("section-dragging");
      }
      const s = getScale();
      const el = cardRef.current;
      if (el) el.style.translate = `${dx / s}px ${dy / s}px`;
      const pt = worldPoint(e.clientX, e.clientY);
      const cell = pt ? cellAtWorld(pt.x, pt.y) : null;
      // past the board's edge: append the section along that whole side
      const edge = pt && !cell ? edgeAtWorld(pt.x, pt.y) : null;
      d.target = cell;
      d.edge = edge;
      setSectionDragTarget(cell ? { sectionId: section.id, c: cell.c, r: cell.r } : edge ? { sectionId: section.id, c: -1, r: -1, edge } : null);
    },
    [getScale, worldPoint, section.id],
  );

  const onSectionHeaderUp = useCallback(() => {
    const d = moveDrag.current;
    if (!d.down) return;
    d.down = false;
    if (d.dragging) {
      d.dragging = false;
      // the click that ends a drag isn't a click on the name
      d.justDragged = true;
      setTimeout(() => (d.justDragged = false), 0);
      const el = cardRef.current;
      if (el) {
        el.style.translate = "";
        el.classList.remove("section-dragging");
      }
      setSectionDragTarget(null);
      if (d.target) moveSectionTo(section.id, d.target.c, d.target.r);
      else if (d.edge) moveSectionToEdge(section.id, d.edge);
    }
  }, [section.id]);

  const rect = sectionCardRect(grid, section);
  // a section that hosts an app is that app; any other cards sit over it
  const { host, objects } = view;
  const hostable = !host && objects.length === 1 && isPanel(objects[0]) && isHostable(objects[0].panel) ? objects[0] : null;
  const lastLayout = useRef(new Map<string, { x: number; y: number }>());
  const layout = useMemo(
    () => {
      // a card that didn't move keeps its position object, so it doesn't render again when a neighbour is picked up
      const m = new Map<string, { x: number; y: number }>();
      for (const o of objects) {
        const p = effectivePos(o);
        const was = lastLayout.current.get(o.id);
        m.set(o.id, was && was.x === p.x && was.y === p.y ? was : p);
      }
      lastLayout.current = m;
      return m;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objects, rect.w, section.id],
  );

  // ----- scrollable content (spring-smoothed nested grid) -----
  const scroll = useMemo(
    () => new Spring2D(section.scroll.x, section.scroll.y, presets.camera),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section.id],
  );

  const extent = useMemo(() => {
    let w = 0;
    let h = 0;
    for (const o of objects) {
      const s = objectPixelSize(o);
      const p = layout.get(o.id) ?? { x: o.x, y: o.y };
      w = Math.max(w, p.x + s.w);
      h = Math.max(h, p.y + s.h);
    }
    return { w: w + CONTENT_PAD * 2, h: h + CONTENT_PAD * 2 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  const maxScroll = useCallback(() => {
    const viewW = rect.w - CONTENT_PAD;
    const viewH = rect.h - SECTION_HEADER - CONTENT_PAD;
    return {
      x: Math.max(0, extent.w - viewW),
      y: Math.max(0, extent.h - viewH),
    };
  }, [rect.w, rect.h, extent]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const apply = (x: number, y: number) => {
      el.style.transform = `translate3d(${-x}px, ${-y}px, 0)`;
      liveScroll.set(section.id, { x, y });
    };
    apply(scroll.x.value, scroll.y.value);
    return scroll.onChange(apply);
  }, [scroll, section.id]);

  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleCommit = useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      setSectionScroll(section.id, scroll.x.goal, scroll.y.goal);
    }, 500);
  }, [section.id, scroll]);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return; // viewport zoom
      if (getScale() < 0.55) return; // zoomed way out → viewport pan
      if ((e.target as HTMLElement).closest(".map-body, .wheel-own")) return;
      const m = maxScroll();
      const nx = Math.max(0, Math.min(m.x, scroll.x.goal + e.deltaX));
      const ny = Math.max(0, Math.min(m.y, scroll.y.goal + e.deltaY));
      // a section that can't scroll this way hands the gesture to the grid,
      // so two-finger panning never dead-ends on a section
      if (Math.abs(nx - scroll.x.goal) < 0.5 && Math.abs(ny - scroll.y.goal) < 0.5) return;
      e.stopPropagation();
      scroll.x.to(nx);
      scroll.y.to(ny);
      scheduleCommit();
    },
    [scroll, maxScroll, getScale, scheduleCommit],
  );

  // ----- media intake: desktop drag-drop + open dialog -----
  const ingestFiles = useCallback((files: FileList | File[]) => ingest(section.id, files), [section.id]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDropping(false);
      void ingestFiles(e.dataTransfer.files);
    },
    [ingestFiles],
  );

  const scrollable = maxScroll();
  const iconSpring = { type: "spring", stiffness: 500, damping: 22 } as const;

  // ----- right-click menu on the section's own surface -----
  const onSectionContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // primitives own their right-click (table cells etc.)
      if ((e.target as HTMLElement).closest(".obj-slot")) return;
      e.preventDefault();
      e.stopPropagation();
      setActiveSection(section.id);
      // live things land where you clicked, not in the flow
      const at = (w: number, h: number) => {
        const pt = worldPoint(e.clientX, e.clientY);
        const st = getState();
        if (!pt) return {};
        const card = sectionCardRect(st.grid, section);
        const scroll = getLiveScroll(section.id);
        // centred on the click, kept inside what's visible of the section
        const roomW = card.w - 2 - CONTENT_PAD * 2;
        const roomH = card.h - 2 - SECTION_HEADER - CONTENT_PAD * 2;
        const x = Math.min(pt.x - card.x - 1 - CONTENT_PAD - w / 2, roomW - w) + scroll.x;
        const y = Math.min(pt.y - card.y - 1 - SECTION_HEADER - CONTENT_PAD - h / 3, roomH - h) + scroll.y;
        return { float: true, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
      };
      const channels = Object.values(getState().panels).filter((p) => p.panel === "slack" && p.channel);
      const tellSlack: MenuItem[] = channels.slice(0, 3).map((c) => ({
        icon: "↗",
        label: `Send ${c.name} a link here`,
        action: () =>
          void api(`/api/slack/channels/${c.channel}/share`, { method: "POST", json: { board: activeBoard()?.boardId ?? "company", objectId: section.host ?? section.id, title: section.name } })
            .then(() => toast(`Sent ${c.name} a link to ${section.name}`, "ok"))
            .catch((err) => toast((err as Error).message, "bad")),
      }));
      openContextMenu(e.clientX, e.clientY, [
        { icon: "⊞", label: "Add table", action: () => createTable(section.id) },
        { icon: "◍", label: "Add map", action: () => createMap(section.id) },
        { icon: "▤", label: "Add note", action: () => addNote(section.id) },
        { icon: "⇪", label: "Add image / video…", action: () => fileRef.current?.click() },
        { divider: true },
        { icon: "◐", label: "Start a huddle here", action: () => addPanel(section.id, { panel: "huddle", name: "Huddle", ...at(560, 420) }) },
        { icon: "#", label: "Add a Slack channel", action: () => addPanel(section.id, { panel: "slack", name: "Slack", ...at(420, 520) }) },
        ...tellSlack,
        ...(host
          ? [{ icon: "◱", label: `Show ${host.name} as a card`, action: () => setSectionHost(section.id, null) }]
          : hostable
            ? [{ icon: "◳", label: `Let ${hostable.name} fill the section`, action: () => setSectionHost(section.id, hostable.id) }]
            : []),
        { divider: true },
        { icon: "←", label: "Insert section left", action: () => addSectionAdjacent(section.id, "left") },
        { icon: "→", label: "Insert section right", action: () => addSectionAdjacent(section.id, "right") },
        { icon: "↑", label: "Insert section above", action: () => addSectionAdjacent(section.id, "above") },
        { icon: "↓", label: "Insert section below", action: () => addSectionAdjacent(section.id, "below") },
        { divider: true },
        { icon: "◫", label: "Split column", action: () => splitSection(section.id, "h") },
        { icon: "⬓", label: "Split row", action: () => splitSection(section.id, "v") },
        { divider: true },
        { icon: "⤢", label: "Expand section", action: () => requestSnap({ kind: "section", id: section.id }) },
        {
          icon: "🗑",
          label: "Remove section…",
          danger: true,
          disabled: !canRemove,
          action: () => requestRemoveSection(section.id),
        },
      ]);
    },
    [section.id, canRemove, host, hostable, worldPoint, section],
  );

  // confirmation can be requested locally (✕ button) or via the context menu
  const confirmingActive = confirming || view.pendingRemoval;
  const cancelConfirm = () => {
    setConfirming(false);
    requestRemoveSection(null);
  };

  // one toolbar button: its label rolls over (shell/Tip.tsx), never a native title
  const tool = (tip: string, glyph: string, onClick: () => void, cls = "", kbd?: string) => (
    <button className={"sec-tool " + cls} data-tip={tip} data-kbd={kbd} aria-label={tip} onClick={onClick}>
      {glyph}
    </button>
  );

  const sectionCtx = active && view.sectionFocus;

  return (
    <motion.div
      ref={cardRef}
      className={
        "section-card" +
        (active ? " active" : "") +
        (sectionCtx ? " ctx-active" : "") +
        (dropping ? " dropping" : "") +
        (confirmingActive ? " confirming" : "")
      }
      data-section-id={section.id}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 22 }}
      onPointerDown={(e) => {
        // clicks on primitives set the object context themselves
        if ((e.target as HTMLElement).closest(".obj-slot")) return;
        setActiveSection(section.id);
      }}
      onContextMenu={onSectionContextMenu}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={onDrop}
    >
      {/* header — drag it to move the section to another grid cell */}
      <div
        className="section-header"
        style={{ height: SECTION_HEADER }}
        onPointerDown={onSectionHeaderDown}
        onPointerMove={onSectionHeaderMove}
        onPointerUp={onSectionHeaderUp}
        onPointerCancel={onSectionHeaderUp}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("button, input")) return;
          requestSnap({ kind: "section", id: section.id });
        }}
      >
        {renaming ? (
          <input
            className="section-name-input"
            defaultValue={section.name}
            autoFocus
            spellCheck={false}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                renameSection(section.id, (e.target as HTMLInputElement).value);
                setRenaming(false);
              } else if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={(e) => {
              renameSection(section.id, e.target.value);
              setRenaming(false);
            }}
          />
        ) : (
          <button className="section-name" onClick={() => !moveDrag.current.justDragged && setRenaming(true)} data-tip="Rename · drag to move">
            {host && <span className="section-app-glyph">{PANEL_GLYPH[host.panel]}</span>}
            {section.name}
          </button>
        )}
        <span className="section-coords">
          {colName(section.c0)}
          {section.r0 + 1}
          {(section.c1 !== section.c0 || section.r1 !== section.r0) &&
            `:${colName(section.c1)}${section.r1 + 1}`}
        </span>
        {objects.length > 0 && <span className="section-count">{objects.length}</span>}

        {/* tools wait in the top-right corner until the pointer is on the section */}
        <div className="section-tools" role="toolbar" aria-label={`${section.name} tools`}>
          {host && (
            <div className="sec-group">
              <PanelActions panel={host} ask={false} />
              {tool(`Show ${host.name} as a card`, "◱", () => setSectionHost(section.id, null))}
            </div>
          )}
          <div className="sec-group">
            {hostable && tool(`Let ${hostable.name} fill the section`, "◳", () => setSectionHost(section.id, hostable.id))}
            {!host &&
              tool("Open an app or link", "◳", () => {
                setActiveSection(section.id);
                setUi({ command: true });
              }, "", "⌘L")}
            {tool("Add a table", "⊞", () => createTable(section.id))}
            {tool("Add a map", "◍", () => createMap(section.id))}
            {tool("Add a note", "▤", () => addNote(section.id))}
            {tool("Upload an image or video", "⇪", () => fileRef.current?.click(), "", "⌘U")}
          </div>
          <div className="sec-group">
            {tool("Split into two columns", "◫", () => splitSection(section.id, "h"))}
            {tool("Split into two rows", "⬓", () => splitSection(section.id, "v"))}
            {tool("Fill the screen with this section", "⤢", () => requestSnap({ kind: "section", id: section.id }))}
          </div>
          <div className="sec-group">
            {host
              ? tool(`Ask the agent about ${host.name}`, "✦", () => askAgent(`About “${host.name}”: `), "sec-agent", "⌘J")
              : tool("Ask the agent about this section", "✦", () => askAgent(`In the “${section.name}” section: `), "sec-agent", "⌘J")}
            {canRemove && tool("Remove this section…", "✕", () => setConfirming(true), "sec-remove")}
          </div>
        </div>
      </div>

      {/* remove confirmation */}
      <AnimatePresence>
        {confirmingActive && (
          <motion.div
            className="confirm-pop"
            initial={{ opacity: 0, y: -10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 400, damping: 26 }}
          >
            <span>
              Remove <b>{section.name}</b>
              {objects.length > 0 && ` and ${objects.length} item${objects.length === 1 ? "" : "s"}`}?
            </span>
            <motion.button
              className="confirm-btn danger"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => removeSection(section.id)}
            >
              Remove
            </motion.button>
            <motion.button
              className="confirm-btn"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.92 }}
              onClick={cancelConfirm}
            >
              Cancel
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* hidden file input for the open dialog */}
      <input
        ref={fileRef}
        type="file"

        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) void ingestFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* scrollable nested grid */}
      <div className="section-body" onWheel={onWheel}>
        <div ref={contentRef} className="section-content">
          {objects.map((o) => {
            const pos = layout.get(o.id) ?? { x: o.x, y: o.y };
            const isObjActive = view.activeObjectId === o.id;
            const slot = (child: React.ReactNode) => (
              <div key={o.id} className="obj-slot" data-obj-id={o.id} style={{ left: CONTENT_PAD, top: CONTENT_PAD }}>
                {child}
              </div>
            );
            if (isPanel(o))
              return slot(<PanelView panel={o} pos={pos} isActive={isObjActive} getScale={getScale} />);
            if ("cols" in o)
              return slot(
                <TableView table={o} framePos={pos} isActive={isObjActive} getScale={getScale} />,
              );
            if ("sourceTableId" in o)
              return slot(
                <Suspense fallback={null}>
                  <MapView
                    map={o}
                    framePos={pos}
                    isActive={isObjActive}
                    getScale={getScale}
                    zoomSpring={zoomSpring}
                  />
                </Suspense>,
              );
            if ("text" in o)
              return slot(
                <NoteView note={o} pos={pos} isActive={isObjActive} getScale={getScale} />,
              );
            return slot(
              <MediaView item={o} pos={pos} isActive={isObjActive} getScale={getScale} />,
            );
          })}
        </div>

        {objects.length === 0 && !host && (
          <SectionEmpty
            name={section.name}
            onUpload={() => fileRef.current?.click()}
            onNote={() => addNote(section.id)}
            onFocus={() => setActiveSection(section.id)}
          />
        )}

        {(scrollable.x > 1 || scrollable.y > 1) && <div className="scroll-hint" />}
      </div>

      {/* the hosted app fills the section; its ports sit on the section's edges */}
      {host && (
        <PanelView
          panel={host}
          pos={{ x: 0, y: 0 }}
          hosted
          isActive={view.activeObjectId === host.id}
          getScale={getScale}
        />
      )}

      {/* add-section affordances on all four edges */}
      <motion.button
        className="add-btn add-section-right"
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.8 }}
        transition={iconSpring}
        data-tip="Add a section to the right"
        aria-label="Add a section to the right"
        onClick={() => addSectionAdjacent(section.id, "right")}
      >
        +
      </motion.button>
      <motion.button
        className="add-btn add-section-below"
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.8 }}
        transition={iconSpring}
        data-tip="Add a section below"
        aria-label="Add a section below"
        onClick={() => addSectionAdjacent(section.id, "below")}
      >
        +
      </motion.button>
      <motion.button
        className="add-btn add-section-left"
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.8 }}
        transition={iconSpring}
        data-tip="Add a section to the left"
        aria-label="Add a section to the left"
        onClick={() => addSectionAdjacent(section.id, "left")}
      >
        +
      </motion.button>
      <motion.button
        className="add-btn add-section-above"
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.8 }}
        transition={iconSpring}
        data-tip="Add a section above"
        aria-label="Add a section above"
        onClick={() => addSectionAdjacent(section.id, "above")}
      >
        +
      </motion.button>
    </motion.div>
  );
});

function colName(col: number): string {
  let s = "";
  let n = col;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
