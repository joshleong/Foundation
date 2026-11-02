/**
 * Wire geometry — Vision's flow-diagram rules, shared across Form Industries'
 * tools (ported from Vision `apps/vision/src/components/wireGeometry.ts` and
 * `@pacific/ui/data-pipes.ts`; DESIGN.md → Wires).
 *
 *  1. Roads, not strings: only horizontal, vertical and 45° segments.
 *  2. Every wire leaves an output and enters an input on a straight lead.
 *  3. Turns are 45° chamfers, never curves; joins are bevelled.
 *  4. A wire going back (target behind its source) crosses through the gap
 *     between the two cards, or just clear of both — never through a card.
 *  5. Wires sharing a port run in parallel lanes, equally spaced at bends.
 *  6. Where two wires cross, the one ordered first goes *under*: it is cut for
 *     the crossing, with portal marks either side and a faint trace through.
 *     The order is stable (by id), so crossings never flicker. Crossings near a
 *     port never tunnel; a wire's own lanes never cross themselves.
 */

export type P = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const LEAD = 48; // straight run out of / into a port
export const LANE = 4; // pitch between parallel wires sharing a run
const CHAMFER = 14; // the 45° step that turns a run through 90°
const CLEAR = 28; // how far a crossing keeps from a card edge

export function polyline(pts: P[]): string {
  return pts.map((p, i) => (i ? "L" : "M") + " " + p.x.toFixed(1) + " " + p.y.toFixed(1)).join(" ");
}

/** Offset a route sideways, intersecting parallel segments so lanes stay evenly spaced through bends. */
export function offsetRoute(pts: P[], offset: number): P[] {
  if (pts.length < 2 || offset === 0) return pts;
  const normals = pts.slice(1).map((p, i) => {
    const dx = p.x - pts[i].x;
    const dy = p.y - pts[i].y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  });
  return pts.map((p, i) => {
    const before = normals[Math.max(0, i - 1)];
    const after = normals[Math.min(i, normals.length - 1)];
    const divisor = 1 + before.x * after.x + before.y * after.y || 1;
    return { x: p.x + (offset * (before.x + after.x)) / divisor, y: p.y + (offset * (before.y + after.y)) / divisor };
  });
}

/** Drop duplicate and collinear vertices. */
function dedupe(pts: P[]): P[] {
  const unique = pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 1e-6 || Math.abs(p.y - pts[i - 1].y) > 1e-6);
  return unique.filter((p, i) => {
    if (i === 0 || i === unique.length - 1) return true;
    const a = unique[i - 1];
    const b = unique[i + 1];
    return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-6;
  });
}

/** Where a backward wire crosses: the middle of the gap between stacked cards, else just above or below both. */
function crossingY(src: Rect, dst: Rect, ay: number, by: number): number {
  const srcBelow = src.y >= dst.y + dst.h;
  const srcAbove = src.y + src.h <= dst.y;
  if (srcBelow || srcAbove) {
    const gapTop = srcBelow ? dst.y + dst.h : src.y + src.h;
    const gapBottom = srcBelow ? src.y : dst.y;
    if (gapBottom - gapTop >= 2 * CHAMFER + 8) return (gapTop + gapBottom) / 2;
  }
  const above = Math.min(src.y, dst.y) - CLEAR;
  const below = Math.max(src.y + src.h, dst.y + dst.h) + CLEAR;
  const costAbove = Math.abs(ay - above) + Math.abs(by - above);
  const costBelow = Math.abs(ay - below) + Math.abs(by - below);
  return costAbove <= costBelow ? above : below;
}

export interface RouteOpts {
  leadIn?: number;
  leadOut?: number;
  /** lane among wires sharing the run into the target (centred, in lanes) */
  lane?: number;
  /** lane among wires sharing the run out of the source */
  srcLane?: number;
  src?: Rect | null;
  dst?: Rect | null;
}

/** The shortest road from an output (leaving right) to an input (arriving from the left). */
export function route(a: P, b: P, opts: RouteOpts = {}): P[] {
  const { leadIn = LEAD, leadOut = LEAD, lane = 0, srcLane = 0 } = opts;
  const approach = b.x > a.x ? (b.x - a.x) / 4 : Infinity;
  const x1 = a.x + Math.min(leadIn, approach);
  const x2 = b.x - Math.min(leadOut, approach);
  const dx = x2 - x1;
  const dy = b.y - a.y;
  const ady = Math.abs(dy);
  const sy = Math.sign(dy) || 1;

  if (dx >= ady) {
    // room ahead: lead, run, one 45° diagonal, run along the port's line, lead
    const middle = x1 + (dx - ady) / 2 + lane * LANE;
    const pts: P[] = [a, { x: Math.max(x1, Math.min(middle, x2 - ady)), y: a.y }];
    if (ady > 0) pts.push({ x: Math.max(x1, Math.min(middle, x2 - ady)) + ady, y: b.y });
    pts.push({ x: x2, y: b.y }, b);
    return dedupe(pts);
  }

  if (dx >= 2 * CHAMFER) {
    // too steep for one diagonal: a vertical mid-run with a 45° step at each end
    const c = Math.max(0, Math.min(CHAMFER, dx / 2, ady / 3));
    const xm = Math.min(Math.max(x1 + dx / 2 + lane * LANE, x1 + c), x2 - c);
    return dedupe([a, { x: x1, y: a.y }, { x: xm - c, y: a.y }, { x: xm, y: a.y + sy * c }, { x: xm, y: b.y - sy * c }, { x: xm + c, y: b.y }, { x: x2, y: b.y }, b]);
  }

  // target behind: out and round beside the source, across clear of both cards, round beside the target, in
  const c = CHAMFER;
  const src = opts.src ?? { x: a.x, y: a.y, w: 0, h: 0 };
  const dst = opts.dst ?? { x: b.x, y: b.y, w: 0, h: 0 };
  let yc = crossingY(src, dst, a.y, b.y) + lane * LANE;
  if (Math.abs(yc - a.y) < 2 * c + 16 || Math.abs(yc - b.y) < 2 * c + 16) {
    yc = Math.min(src.y, dst.y, a.y, b.y) - CLEAR - 2 * c - Math.abs(lane * LANE);
  }
  const xr = Math.max(x1, x2) + 2 * c + Math.abs(srcLane * LANE);
  const xl = Math.min(x1, x2) - 2 * c - Math.abs(lane * LANE);
  const s1 = Math.sign(yc - a.y) || 1;
  const s2 = Math.sign(b.y - yc) || 1;
  return dedupe([
    a,
    { x: x1, y: a.y },
    { x: xr - c, y: a.y },
    { x: xr, y: a.y + s1 * c },
    { x: xr, y: yc - s1 * c },
    { x: xr - c, y: yc },
    { x: xl + c, y: yc },
    { x: xl, y: yc + s2 * c },
    { x: xl, y: b.y - s2 * c },
    { x: xl + c, y: b.y },
    { x: x2, y: b.y },
    b,
  ]);
}

// ---------- over / under ----------

export type Crossing = P & { direction: P };

/**
 * Where routes cross, and which one goes under. Stable order by id: the
 * earlier id tunnels under the later one. Crossings within 36 px of either
 * route's ends (junction approaches) never tunnel; near-duplicates merge.
 */
export function pipeCrossings(routes: { id: string; points: P[] }[]): Map<string, Crossing[]> {
  const result = new Map<string, Crossing[]>();
  const sorted = [...routes].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length; i++) {
    const under = sorted[i];
    for (const over of sorted.slice(i + 1)) {
      if (under.id === over.id) continue;
      for (let a = 1; a < under.points.length; a++) {
        const p = under.points[a - 1];
        const q = under.points[a];
        for (let b = 1; b < over.points.length; b++) {
          const r = over.points[b - 1];
          const s = over.points[b];
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const ex = s.x - r.x;
          const ey = s.y - r.y;
          const det = dx * ey - dy * ex;
          if (Math.abs(det) < 1e-6) continue;
          const t = ((r.x - p.x) * ey - (r.y - p.y) * ex) / det;
          const u = ((r.x - p.x) * dy - (r.y - p.y) * dx) / det;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const point = { x: p.x + t * dx, y: p.y + t * dy, direction: { x: ex, y: ey } };
          const ends = [under.points[0], under.points[under.points.length - 1], over.points[0], over.points[over.points.length - 1]];
          if (ends.some((end) => Math.hypot(end.x - point.x, end.y - point.y) < 36)) continue;
          const list = result.get(under.id) ?? [];
          if (!list.some((c) => Math.hypot(c.x - point.x, c.y - point.y) < 8)) list.push(point);
          result.set(under.id, list);
        }
      }
    }
  }
  return result;
}

/**
 * The tunnel for an under-route: merged spans around its crossings, returned as
 * a mask path (quads cut out of the wire), and portal strokes at each mouth.
 */
export function tunnelGeometry(points: P[], crossings: Crossing[], width = 12) {
  let distance = 0;
  const segments = points.slice(1).flatMap((end, i) => {
    const start = points[i];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!length) return [];
    const seg = { start, length, at: distance, dx: (end.x - start.x) / length, dy: (end.y - start.y) / length };
    distance += length;
    return [seg];
  });
  const spans: [number, number][] = [];
  for (const seg of segments)
    for (const c of crossings) {
      const x = c.x - seg.start.x;
      const y = c.y - seg.start.y;
      const along = x * seg.dx + y * seg.dy;
      const across = x * seg.dy - y * seg.dx;
      if (Math.abs(across) >= 18) continue;
      const reach = Math.sqrt(18 ** 2 - across ** 2) / 2 + 3;
      const from = Math.max(0, along - reach);
      const to = Math.min(seg.length, along + reach);
      if (from < to) spans.push([seg.at + from, seg.at + to]);
    }
  const merged: [number, number][] = [];
  for (const span of spans.sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1] + 1) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  const at = (d: number) => {
    const seg = segments.find((s) => d <= s.at + s.length) ?? segments[segments.length - 1];
    return { seg, x: seg.start.x + seg.dx * (d - seg.at), y: seg.start.y + seg.dy * (d - seg.at) };
  };
  const pt = (p: P) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  const mouths = merged.map((span) =>
    span.map((d) => {
      const { seg, x, y } = at(d);
      const nearest = [...crossings].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
      const dir = nearest?.direction ?? { x: -seg.dy, y: seg.dx };
      const len = Math.hypot(dir.x, dir.y) || 1;
      const tx = dir.x / len;
      const ty = dir.y / len;
      const half = width / (2 * Math.max(0.25, Math.abs(seg.dx * ty - seg.dy * tx)));
      return [
        { x: x + tx * half, y: y + ty * half },
        { x: x - tx * half, y: y - ty * half },
      ];
    }),
  );
  return {
    terminals: mouths.flatMap((pair) => pair.map(([a, b]) => `M ${pt(a)} L ${pt(b)}`)).join(" "),
    cut: mouths.map(([entry, exit]) => `M ${pt(entry[0])} L ${pt(entry[1])} L ${pt(exit[1])} L ${pt(exit[0])} Z`).join(" "),
  };
}

// ---------- port intakes ----------

export const pipeMetrics = { sourcePitch: 18, junction: 14, rowGap: 10 } as const;

/** Each wire into (or out of) a port owns its own landing; returns slot offsets centred on the port. */
export function pipeIntake(ids: string[]) {
  const span = Math.max(0, (ids.length - 1) * pipeMetrics.sourcePitch);
  return {
    height: pipeMetrics.junction + span,
    slots: new Map(ids.map((id, i) => [id, i * pipeMetrics.sourcePitch - span / 2])),
  };
}

/** Port types that may connect: same type, or either side is generic json/any. */
export function typesCompatible(out?: string, input?: string) {
  if (!out || !input) return true;
  if (out === input) return true;
  return out === "json" || input === "json" || out === "any" || input === "any";
}
