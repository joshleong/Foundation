/**
 * The meta layer above the grid: app-to-app wires between ports (always
 * drawn, faint; bright with the agent layer on), drag-to-connect from an
 * output port, and the rings agents leave on the cards they're working on.
 *
 * Geometry runs imperatively per frame and only writes the DOM when a path
 * actually changed, so a still board costs nothing.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { LinkDoc } from "@foundation/protocol";
import { addLink, getState, gridSize, objectWorldRect, uid, updatePanel, useAppState, type PanelMeta } from "../state/store";
import { useUi } from "../state/ui";
import { useBoardTick } from "./Presence";
import { toWorld, camera } from "../state/camera";

const PORT_GAP = 26;
const PORT_TOP = 52;

/** world position of a port on a panel: outputs on the right edge, inputs on the left */
export function portPoint(p: PanelMeta, portId: string) {
  const r = objectWorldRect(p);
  if (!r) return null;
  const port = p.ports.find((x) => x.id === portId);
  if (!port) return null;
  const same = p.ports.filter((x) => x.dir === port.dir);
  const i = same.indexOf(port);
  return { x: port.dir === "out" ? r.x + r.w : r.x, y: r.y + PORT_TOP + i * PORT_GAP };
}

/**
 * A wire from an output (right edge) to an input (left edge). Forward wires
 * are one smooth S; backward wires (the target sits left of the source) loop
 * out, around through a lane between the cards, and back in, instead of
 * cutting straight across the board.
 */
type Rect = { x: number; y: number; w: number; h: number };

function wireGeometry(a: { x: number; y: number }, b: { x: number; y: number }, ra?: Rect | null, rb?: Rect | null) {
  if (b.x >= a.x + 40) {
    const k = Math.max(60, (b.x - a.x) * 0.5);
    return { d: `M ${a.x} ${a.y} C ${a.x + k} ${a.y}, ${b.x - k} ${b.y}, ${b.x} ${b.y}`, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }
  const k = 90;
  // the lane runs through the gap between the two cards' rows, or under both
  let lane = Math.max(a.y, b.y) + 150;
  if (ra && rb) {
    const [top, bottom] = ra.y < rb.y ? [ra, rb] : [rb, ra];
    lane = top.y + top.h < bottom.y ? (top.y + top.h + bottom.y) / 2 : Math.max(ra.y + ra.h, rb.y + rb.h) + 44;
  }
  const mx = (a.x + b.x) / 2;
  return {
    d: `M ${a.x} ${a.y} C ${a.x + k} ${a.y}, ${a.x + k} ${lane}, ${mx} ${lane} C ${b.x - k} ${lane}, ${b.x - k} ${b.y}, ${b.x} ${b.y}`,
    mx,
    my: lane,
  };
}

function pathFor(a: { x: number; y: number }, b: { x: number; y: number }) {
  return wireGeometry(a, b).d;
}

// ---------- drag to connect ----------

type Drag = { from: { panel: string; port: string }; x: number; y: number; over: string | null };
let drag: Drag | null = null;
const dragListeners = new Set<() => void>();
const notifyDrag = () => dragListeners.forEach((f) => f());

/** start a connection from an output port (called by the port dot's pointerdown) */
export function beginConnect(e: React.PointerEvent, panel: string, port: string) {
  e.stopPropagation();
  e.preventDefault();
  const at = () => toWorld(e.clientX - camera.left, e.clientY - camera.top);
  drag = { from: { panel, port }, ...at(), over: null };
  notifyDrag();
  const move = (ev: PointerEvent) => {
    if (!drag) return;
    const w = toWorld(ev.clientX - camera.left, ev.clientY - camera.top);
    const hit = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-panel-id]");
    drag = { ...drag, x: w.x, y: w.y, over: hit?.dataset.panelId && hit.dataset.panelId !== panel ? hit.dataset.panelId : null };
    notifyDrag();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    const d = drag;
    drag = null;
    notifyDrag();
    if (!d?.over) return;
    const st = getState();
    const src = st.panels[d.from.panel];
    const dst = st.panels[d.over];
    if (!src || !dst) return;
    const outPort = src.ports.find((p) => p.id === d.from.port);
    let inPort = dst.ports.find((p) => p.dir === "in" && (p.name === outPort?.name || p.type === outPort?.type));
    if (!inPort) inPort = dst.ports.find((p) => p.dir === "in");
    if (!inPort) {
      inPort = { id: uid("port"), name: outPort?.name ?? "in", dir: "in", type: outPort?.type };
      updatePanel(dst.id, { ports: [...dst.ports, inPort] });
    }
    const exists = Object.values(st.links).some((l) => l.from.port === d.from.port && l.to.port === inPort!.id);
    if (!exists) addLink({ from: d.from, to: { panel: dst.id, port: inPort.id }, label: outPort?.name });
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function useDrag() {
  const [, set] = useState(0);
  useEffect(() => {
    const fn = () => set((n) => n + 1);
    dragListeners.add(fn);
    return () => {
      dragListeners.delete(fn);
    };
  }, []);
  return drag;
}

// ---------- the layer ----------

export function PortWires() {
  const state = useAppState();
  const ui = useUi();
  const board = useBoardTick();
  const d = useDrag();
  const groups = useRef(new Map<string, SVGGElement>());
  const ghost = useRef<SVGPathElement>(null);
  const rings = useRef(new Map<string, SVGRectElement>());

  const links: LinkDoc[] = useMemo(() => Object.values(state.links), [state.links]);
  const agentFocus = useMemo(() => {
    const out = new Map<string, { name: string }>();
    for (const p of board?.peers() ?? []) if (p.focus) out.set(p.focus, { name: p.user.name });
    // agents working right now: cards with status running
    for (const p of Object.values(state.panels)) if (p.status === "running") out.set(p.id, { name: p.createdBy ?? "agent" });
    return out;
  }, [board, state.panels, board?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let raf = 0;
    const last = new Map<string, string>();
    const tick = () => {
      const st = getState();
      for (const l of links) {
        const g = groups.current.get(l.id);
        const a = st.panels[l.from.panel];
        const b = st.panels[l.to.panel];
        const pa = a && portPoint(a, l.from.port);
        const pb = b && portPoint(b, l.to.port);
        if (!g) continue;
        if (!pa || !pb) {
          g.style.display = "none";
          continue;
        }
        g.style.display = "";
        const geo = wireGeometry(pa, pb, objectWorldRect(a), objectWorldRect(b));
        const dStr = geo.d;
        if (last.get(l.id) !== dStr) {
          last.set(l.id, dStr);
          g.querySelectorAll("path").forEach((p) => p.setAttribute("d", dStr));
          const [c1, c2] = g.querySelectorAll("circle");
          c1?.setAttribute("cx", String(pa.x));
          c1?.setAttribute("cy", String(pa.y));
          c2?.setAttribute("cx", String(pb.x));
          c2?.setAttribute("cy", String(pb.y));
          const label = g.querySelector("text");
          if (label) {
            label.setAttribute("x", String(geo.mx));
            label.setAttribute("y", String(geo.my - 8));
          }
        }
      }
      if (ghost.current && drag) {
        const a = st.panels[drag.from.panel];
        const pa = a && portPoint(a, drag.from.port);
        if (pa) ghost.current.setAttribute("d", pathFor(pa, { x: drag.x, y: drag.y }));
      }
      for (const [id, rect] of rings.current) {
        const o = st.panels[id] ?? st.notes[id] ?? st.tables[id] ?? st.media[id] ?? st.maps[id];
        const r = o && objectWorldRect(o);
        if (!r) continue;
        const key = `${r.x},${r.y},${r.w},${r.h}`;
        if (last.get(`ring:${id}`) === key) continue;
        last.set(`ring:${id}`, key);
        rect.setAttribute("x", String(r.x - 8));
        rect.setAttribute("y", String(r.y - 8));
        rect.setAttribute("width", String(r.w + 16));
        rect.setAttribute("height", String(r.h + 16));
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [links, agentFocus, d !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const size = gridSize(state.grid);
  if (links.length === 0 && !d && agentFocus.size === 0) return null;

  return (
    <svg className={`port-layer${ui.agentLayer ? " is-on" : ""}`} width={size.w} height={size.h} style={{ overflow: "visible" }}>
      {[...agentFocus.entries()].map(([id, a]) => (
        <g key={`ring-${id}`} className="agent-ring">
          <rect
            rx={14}
            ref={(el) => {
              if (el) rings.current.set(id, el);
              else rings.current.delete(id);
            }}
          />
          <title>{a.name} is working here</title>
        </g>
      ))}
      {links.map((l) => {
        const live = state.panels[l.from.panel]?.outputs?.[l.from.port] !== undefined;
        return (
          <g
            key={l.id}
            className={`port-wire${live ? " is-live" : ""}`}
            ref={(el) => {
              if (el) groups.current.set(l.id, el);
              else groups.current.delete(l.id);
            }}
          >
            <path className="port-wire-glow" />
            <path className="port-wire-line" />
            <circle r={4.5} className="port-wire-end" />
            <circle r={4.5} className="port-wire-end" />
            {l.label && <text className="port-wire-label">{l.label}</text>}
          </g>
        );
      })}
      {d && <path ref={ghost} className="port-wire-ghost" />}
    </svg>
  );
}
