/**
 * The flow-diagram rules (DESIGN.md → Wires), checked on the real router.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { offsetRoute, pipeCrossings, route, tunnelGeometry, typesCompatible, type P } from "../src/shell/wireGeometry.ts";

function angles(pts: P[]) {
  return pts.slice(1).map((p, i) => {
    const a = (Math.atan2(p.y - pts[i].y, p.x - pts[i].x) * 180) / Math.PI;
    return ((Math.round(a) % 360) + 360) % 360;
  });
}

const cases: Array<[P, P]> = [
  [{ x: 0, y: 0 }, { x: 400, y: 0 }],
  [{ x: 0, y: 0 }, { x: 400, y: 120 }],
  [{ x: 0, y: 0 }, { x: 160, y: 300 }],
  [{ x: 0, y: 0 }, { x: 400, y: -260 }],
  [{ x: 500, y: 100 }, { x: 0, y: 600 }],
  [{ x: 500, y: 100 }, { x: 0, y: 110 }],
];

test("roads only: every segment is horizontal, vertical or 45°", () => {
  for (const [a, b] of cases) {
    for (const ang of angles(route(a, b))) assert.ok(ang % 45 === 0, `angle ${ang} in ${JSON.stringify([a, b])}`);
  }
});

test("wires leave and arrive on a straight horizontal lead", () => {
  for (const [a, b] of cases) {
    const pts = route(a, b);
    assert.equal(pts[1].y, a.y, "leaves level");
    assert.ok(pts[1].x > a.x, "leaves to the right");
    assert.equal(pts[pts.length - 2].y, b.y, "arrives level");
    assert.ok(pts[pts.length - 2].x < b.x, "arrives from the left");
  }
});

test("a backward wire between stacked cards crosses in the gap, never through a card", () => {
  const src = { x: 600, y: 0, w: 400, h: 300 };
  const dst = { x: 0, y: 500, w: 400, h: 300 };
  const pts = route({ x: 1000, y: 100 }, { x: 0, y: 600 }, { src, dst });
  const lane = pts.find((p, i) => i > 0 && p.y === pts[i - 1].y && p.y > 300 && p.y < 500);
  assert.ok(lane, "has a horizontal run in the gap between the cards");
  const inside = (p: P, r: typeof src) => p.x > r.x + 1 && p.x < r.x + r.w - 1 && p.y > r.y + 1 && p.y < r.y + r.h - 1;
  for (let i = 1; i < pts.length; i++) {
    const mid = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 };
    assert.ok(!inside(mid, src) && !inside(mid, dst), "no segment runs through a card");
  }
});

test("over/under is stable: the earlier id tunnels; crossings near ports don't", () => {
  const h = [{ x: 0, y: 100 }, { x: 400, y: 100 }];
  const v = [{ x: 200, y: 0 }, { x: 200, y: 300 }];
  const c = pipeCrossings([
    { id: "b", points: v },
    { id: "a", points: h },
  ]);
  assert.equal(c.get("a")?.length, 1, "a goes under");
  assert.equal(c.get("b"), undefined, "b stays on top");
  const t = tunnelGeometry(h, c.get("a")!, 13);
  assert.match(t.cut, /^M .* Z$/, "the under-wire is cut at the crossing");
  assert.equal(t.terminals.split("M").length - 1, 2, "two portal marks");
  const nearPort = pipeCrossings([
    { id: "a", points: [{ x: 0, y: 0 }, { x: 400, y: 0 }] },
    { id: "b", points: [{ x: 20, y: -100 }, { x: 20, y: 100 }] },
  ]);
  assert.equal(nearPort.size, 0, "no tunnel within 36 px of a port");
});

test("parallel lanes stay evenly spaced through a 45° bend", () => {
  const base = route({ x: 0, y: 0 }, { x: 400, y: 120 });
  const lane = offsetRoute(base, 4);
  assert.equal(lane.length, base.length);
  assert.ok(Math.abs(lane[0].y - base[0].y - 4) < 1e-6 || Math.abs(lane[0].y - base[0].y + 4) < 1e-6);
});

test("types: same type, or json on either side", () => {
  assert.ok(typesCompatible("cad", "cad"));
  assert.ok(typesCompatible("cad", "json"));
  assert.ok(!typesCompatible("cad", "image"));
});
