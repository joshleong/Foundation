import { ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { motion } from "motion/react";
import { MINI_HEADER, liveObjPos, setActiveObject, setObjectFloat } from "../state/store";
import { Spring2D, presets } from "../physics/spring";
import { countRender } from "../state/renders";

/**
 * Shared card frame for the lightweight primitives (notes, images, videos,
 * panels): spring drag (auto-floats when grabbed), pin/dock toggle, resize
 * handle, remove button, springy entrance.
 *
 * Cards rest clean — no menu bar. Their chrome is called by the pointer:
 * `bar` (default) slides a glass bar in over the card's top edge on hover;
 * `icons` (images, video) slides a few round buttons out from behind the
 * card's right edge, and the card itself is the drag handle.
 */
interface Props {
  id: string;
  title: string;
  pos: { x: number; y: number };
  width: number;
  float: boolean;
  isActive?: boolean;
  getScale(): number;
  onMove(x: number, y: number): void;
  onResize?(dw: number, dh: number): void;
  onRemove(): void;
  headerExtras?: ReactNode;
  children: ReactNode;
  bodyClass?: string;
  /** extra class on the card (e.g. panel kind) */
  cardClass?: string;
  /** data-* attributes on the anchor (panels: data-panel-id for drag-to-connect) */
  data?: Record<string, string>;
  /** rendered outside the clipped body, positioned against the card (ports) */
  overlay?: ReactNode;
  /** how the card's chrome appears on hover (see above) */
  chrome?: "bar" | "icons";
  /** for `icons` chrome: the buttons that slide out (remove is added last) */
  icons?: ReactNode;
  /** for `icons` chrome: a press on the card that didn't become a drag */
  onTap?(): void;
}

export function ObjectFrame({
  id,
  title,
  pos,
  width,
  float,
  isActive,
  getScale,
  onMove,
  onResize,
  onRemove,
  headerExtras,
  children,
  bodyClass,
  cardClass,
  data,
  overlay,
  chrome = "bar",
  icons,
  onTap,
}: Props) {
  countRender("ObjectFrame");
  const rootRef = useRef<HTMLDivElement>(null);

  const spring = useMemo(
    () => new Spring2D(pos.x, pos.y, presets.drag),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const apply = (x: number, y: number) => {
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      liveObjPos.set(id, { x, y });
    };
    apply(spring.x.value, spring.y.value);
    const unsub = spring.onChange(apply);
    return () => {
      unsub();
      liveObjPos.delete(id);
    };
  }, [spring, id]);

  useEffect(() => {
    if (!dragRef.current.active) spring.to(pos.x, pos.y);
  }, [pos.x, pos.y, spring]);

  const dragRef = useRef({ active: false, moved: false, startX: 0, startY: 0, origX: 0, origY: 0, lastX: 0, lastT: 0, lean: 0 });

  /** the held card lifts and leans into its motion (DESIGN.md §6: lean ≤ 6°) */
  const setLean = (deg: number, lifted: boolean) => {
    const card = rootRef.current?.querySelector<HTMLElement>(".frame-card");
    if (!card) return;
    card.style.rotate = `${deg.toFixed(2)}deg`;
    card.style.scale = lifted ? "1.015" : "";
  };

  const onHeaderDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button, input, select")) return;
      e.stopPropagation();
      setActiveObject(id);
      const d = dragRef.current;
      d.moved = false;
      d.active = true;
      d.startX = e.clientX;
      d.startY = e.clientY;
      d.origX = spring.x.goal;
      d.origY = spring.y.goal;
      d.lastX = e.clientX;
      d.lastT = performance.now();
      d.lean = 0;
      rootRef.current?.classList.add("dragging");
      setLean(0, true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch { /* synthetic */ }
    },
    [spring, id, float],
  );

  const onHeaderMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d.active) return;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return; // still a tap
        d.moved = true;
        if (!float) setObjectFloat(id, true); // grabbing undocks it from the flow
      }
      const s = getScale();
      spring.to(
        Math.max(0, d.origX + (e.clientX - d.startX) / s),
        Math.max(0, d.origY + (e.clientY - d.startY) / s),
      );
      const now = performance.now();
      const vx = (e.clientX - d.lastX) / Math.max(1, now - d.lastT); // px/ms
      d.lastX = e.clientX;
      d.lastT = now;
      d.lean = d.lean * 0.8 + Math.max(-6, Math.min(6, vx * 4)) * 0.2;
      setLean(d.lean, true);
    },
    [spring, getScale, float, id],
  );

  const onHeaderUp = useCallback(() => {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    rootRef.current?.classList.remove("dragging");
    setLean(0, false);
    if (d.moved) onMove(spring.x.goal, spring.y.goal);
    else onTap?.();
  }, [spring, onMove, onTap]);

  // ----- resize -----
  const resizeRef = useRef({ active: false, startX: 0, startY: 0 });
  const onResizeDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    const d = resizeRef.current;
    d.active = true;
    d.startX = e.clientX;
    d.startY = e.clientY;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* synthetic */ }
  }, []);
  const onResizeMove = useCallback(
    (e: React.PointerEvent) => {
      const d = resizeRef.current;
      if (!d.active || !onResize) return;
      const s = getScale();
      onResize((e.clientX - d.startX) / s, (e.clientY - d.startY) / s);
      d.startX = e.clientX;
      d.startY = e.clientY;
    },
    [onResize, getScale],
  );
  const onResizeUp = useCallback(() => {
    resizeRef.current.active = false;
  }, []);

  const dragHandlers = {
    onPointerDown: onHeaderDown,
    onPointerMove: onHeaderMove,
    onPointerUp: onHeaderUp,
    onPointerCancel: onHeaderUp,
  };

  return (
    <div
      ref={rootRef}
      className={`frame-anchor chrome-${chrome}`}
      style={{ width }}
      {...Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]))}
    >
      {chrome === "icons" && (
        <div className="frame-icons">
          {icons}
          <button className="frame-icon is-remove" data-tip="Remove" aria-label="Remove" onClick={onRemove}>
            ✕
          </button>
        </div>
      )}
      <motion.div
        className={"frame-card" + (isActive ? " ctx-active" : "") + (cardClass ? ` ${cardClass}` : "")}
        initial={{ scale: 0.55, opacity: 0, y: 50 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 20 }}
        onPointerDown={() => setActiveObject(id)}
      >
        {chrome === "bar" && (
          <div className="frame-header" style={{ height: MINI_HEADER - 4 }} {...dragHandlers}>
            <div className="grip mini">
              <span />
              <span />
            </div>
            <span className="frame-title">{title}</span>
            <div className="header-actions">
              {headerExtras}
              <button
                className={"icon-btn float-btn" + (float ? " floating" : "")}
                data-tip={float ? "Dock into the section" : "Float freely"}
                aria-label={float ? "Dock into the section" : "Float freely"}
                onClick={() => setObjectFloat(id, !float)}
              >
                {float ? "✥" : "⌗"}
              </button>
              <button className="icon-btn is-remove" data-tip="Remove" aria-label="Remove" onClick={onRemove}>
                ✕
              </button>
            </div>
          </div>
        )}
        <div className={"frame-body " + (bodyClass ?? "")} {...(chrome === "icons" ? dragHandlers : {})}>
          {children}
        </div>
        {overlay}
        {onResize && (
          <div
            className="map-resize"
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
            data-tip="Resize"
          />
        )}
      </motion.div>
    </div>
  );
}
