/**
 * Port layout — one answer for where a panel's ports sit and where each wire
 * lands on them, read by the card (pills) and by the wire layer (endpoints),
 * so they can never disagree. Inputs stack on the left edge, outputs on the
 * right; a port with several wires grows into a pill with one landing per wire,
 * ordered by where the other end sits so the wires don't cross at the port.
 */

import type { LinkDoc } from "@foundation/protocol";
import { allObjects, getState, objectWorldRect, type PanelMeta } from "../state/store";
import type { Rect } from "./wireGeometry";
import { pipeIntake, pipeMetrics } from "./wireGeometry";

export const PORT_TOP = 52;
export const PORT_SPACING = 26;

export interface PortSlotLayout {
  id: string;
  dir: "in" | "out";
  /** centre, from the card's top */
  y: number;
  height: number;
  /** linkId → offset from the centre */
  slots: Map<string, number>;
}

/** Ports carry a type; the type picks the wire's tone (DESIGN.md → Wires). */
export const TYPE_TONE: Record<string, string> = {
  json: "var(--color-pulse)",
  text: "var(--viz-7)",
  number: "var(--viz-5)",
  image: "var(--viz-6)",
  cad: "var(--viz-2)",
  data: "var(--viz-3)",
  bom: "var(--viz-4)",
  decision: "var(--color-ok)",
};

export function toneOf(type?: string) {
  return TYPE_TONE[type ?? "json"] ?? "var(--color-pulse)";
}

function otherEndY(l: LinkDoc, dir: "in" | "out") {
  const st = getState();
  const other = st.panels[dir === "in" ? l.from.panel : l.to.panel];
  const r = other && objectWorldRect(other);
  return r ? r.y : 0;
}

export function portLayout(panel: PanelMeta, links: LinkDoc[]): Map<string, PortSlotLayout> {
  const out = new Map<string, PortSlotLayout>();
  for (const dir of ["in", "out"] as const) {
    let cursor = PORT_TOP - PORT_SPACING / 2;
    for (const port of panel.ports.filter((p) => p.dir === dir)) {
      const attached = links
        .filter((l) => (dir === "in" ? l.to.panel === panel.id && l.to.port === port.id : l.from.panel === panel.id && l.from.port === port.id))
        .sort((a, b) => otherEndY(a, dir) - otherEndY(b, dir) || a.id.localeCompare(b.id));
      const intake = pipeIntake(attached.map((l) => l.id));
      const height = Math.max(PORT_SPACING, intake.height + pipeMetrics.rowGap);
      out.set(port.id, { id: port.id, dir, y: cursor + height / 2, height: intake.height, slots: intake.slots });
      cursor += height;
    }
  }
  return out;
}

/** World position of a wire's end on a port (its own landing when it shares the port). */
export function portPoint(panel: PanelMeta, portId: string, linkId?: string, links?: LinkDoc[]) {
  const r = objectWorldRect(panel);
  if (!r) return null;
  const layout = portLayout(panel, links ?? Object.values(getState().links)).get(portId);
  if (!layout) return null;
  const offset = linkId ? (layout.slots.get(linkId) ?? 0) : 0;
  return { x: layout.dir === "out" ? r.x + r.w : r.x, y: r.y + layout.y + offset };
}

export function describeValue(v: unknown): string {
  if (v === undefined) return "no value yet";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.name === "string") return `${o.name}${typeof o.note === "string" ? ` · ${o.note}` : ""}`;
    if (typeof o.decision === "string") return `${o.decision}`;
  }
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 64 ? `${s.slice(0, 61)}…` : s;
}

/** every card's world rect this frame — what wires route around */
export function cardRects(): Map<string, Rect> {
  const out = new Map<string, Rect>();
  for (const o of allObjects()) {
    const r = objectWorldRect(o);
    if (r) out.set(o.id, r);
  }
  return out;
}

/** the cards a wire between `from` and `to` must avoid */
export function obstaclesFor(rects: Map<string, Rect>, from: string, to: string): Rect[] {
  const out: Rect[] = [];
  for (const [id, r] of rects) if (id !== from && id !== to) out.push(r);
  return out;
}
