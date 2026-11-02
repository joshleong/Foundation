/**
 * The draggable edge of a floor pane (side pane, session, search). Invisible
 * at rest; the pointer finds a hairline and a grab knob. Double-click resets.
 */

import { useRef } from "react";

interface Props {
  /** which edge of its pane the handle sits on */
  side: "left" | "right";
  value: number;
  min: number;
  max: number;
  initial: number;
  onChange(w: number): void;
  label: string;
}

export function FloorEdge({ side, value, min, max, initial, onChange, label }: Props) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      className={`floor-edge is-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label} — drag to resize, double-click to reset`}
      onPointerDown={(e) => {
        e.stopPropagation();
        drag.current = { x: e.clientX, w: value };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        document.body.classList.add("is-resizing-floor");
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = (e.clientX - d.x) * (side === "right" ? 1 : -1);
        onChange(Math.round(Math.max(min, Math.min(max, d.w + dx))));
      }}
      onPointerUp={() => {
        drag.current = null;
        document.body.classList.remove("is-resizing-floor");
      }}
      onPointerCancel={() => {
        drag.current = null;
        document.body.classList.remove("is-resizing-floor");
      }}
      onDoubleClick={() => onChange(initial)}
    >
      <span className="floor-edge-line" />
    </div>
  );
}
