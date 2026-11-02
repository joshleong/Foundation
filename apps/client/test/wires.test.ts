/**
 * The flow-diagram rules (DESIGN.md → Wires), checked on the real router.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { offsetRoute, pipeCrossings, road, route, segmentOverlap, tunnelGeometry, typesCompatible, type P } from "../src/shell/wireGeometry.ts";

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

import { routeAvoiding, segmentHitsRect, chamfer } from "../src/shell/wireGeometry.ts";

const crossesCard = (pts: P[], r: { x: number; y: number; w: number; h: number }) =>
  pts.slice(1).some((q, i) => segmentHitsRect(pts[i], q, r));

test("a wire runs round a card that sits in its way", () => {
  const src = { x: 0, y: 0, w: 300, h: 200 };
  const dst = { x: 1000, y: 400, w: 300, h: 200 };
  const mapCard = { x: 420, y: 60, w: 360, h: 420 }; // squarely between them
  const a = { x: 300, y: 26 };
  const b = { x: 1000, y: 426 };
  assert.ok(crossesCard(route(a, b, { src, dst }), mapCard), "the plain road would run through it");
  const pts = routeAvoiding(a, b, { src, dst, obstacles: [mapCard] });
  assert.ok(!crossesCard(pts, mapCard), "the avoiding road doesn't");
  for (const ang of angles(pts)) assert.ok(ang % 45 === 0, `still roads only (${ang}°)`);
  assert.equal(pts[0].x, a.x);
  assert.equal(pts[pts.length - 1].x, b.x);
});

test("when the way is clear the plain road wins", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 600, y: 200 };
  const far = { x: 2000, y: 2000, w: 100, h: 100 };
  assert.deepEqual(routeAvoiding(a, b, { obstacles: [far] }), route(a, b));
});

test("avoiding stays fast with a crowded board", () => {
  const obstacles = Array.from({ length: 24 }, (_, i) => ({ x: 200 + (i % 6) * 180, y: -300 + Math.floor(i / 6) * 220, w: 140, h: 160 }));
  const t = performance.now();
  for (let k = 0; k < 20; k++) routeAvoiding({ x: 0, y: k * 7 }, { x: 1400, y: 300 + k }, { obstacles });
  assert.ok(performance.now() - t < 400, `20 cold routes past 24 cards in ${Math.round(performance.now() - t)} ms`);
});

test("chamfer turns 90° corners into 45° steps", () => {
  const pts = chamfer([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }]);
  for (const ang of angles(pts)) assert.ok(ang % 45 === 0);
  assert.ok(angles(pts).includes(45));
});

test("a card right beside the port: the lead shortens and the road takes the narrow gap", () => {
  const src = { x: 0, y: 0, w: 400, h: 300 };
  const mapCard = { x: 415, y: 0, w: 360, h: 280 }; // 15 px from the source port
  const dst = { x: 560, y: 500, w: 400, h: 300 };
  const a = { x: 400, y: 26 };
  const b = { x: 560, y: 526 };
  const pts = routeAvoiding(a, b, { src, dst, obstacles: [mapCard] });
  assert.ok(!crossesCard(pts, mapCard), JSON.stringify(pts));
  for (const ang of angles(pts)) assert.ok(ang % 45 === 0, `roads only (${ang}°)`);
});

test("a change of height is one long 45° run, not a stair of short steps", () => {
  const pts = route({ x: 0, y: 0 }, { x: 900, y: 260 });
  const diag = pts.slice(1).map((p, i) => ({ dx: p.x - pts[i].x, dy: p.y - pts[i].y })).filter((d) => Math.abs(d.dy) > 0.5);
  assert.equal(diag.length, 1, "the whole climb is one segment");
  assert.ok(Math.abs(Math.abs(diag[0].dx) - Math.abs(diag[0].dy)) < 1e-6, "at 45°");
  assert.ok(Math.abs(diag[0].dy - 260) < 1e-6, "covering all 260 px");
  // too steep for one diagonal: the turns still take all the room ahead (not 14 px chamfers)
  const steep = route({ x: 0, y: 0 }, { x: 400, y: 700 });
  const firstTurn = steep.slice(1).map((p, i) => ({ dx: p.x - steep[i].x, dy: p.y - steep[i].y })).find((d) => Math.abs(d.dx) > 0.5 && Math.abs(d.dy) > 0.5)!;
  assert.ok(Math.abs(firstTurn.dx) > 100, `turn runs ${Math.abs(firstTurn.dx).toFixed(0)} px`);
});

test("a long turn shortens rather than cut through a card", () => {
  const card = { x: 120, y: 60, w: 200, h: 200 };
  const pts = road([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 800, y: 400 }], [card]);
  for (let i = 1; i < pts.length; i++) assert.ok(segmentOverlap(pts[i - 1], pts[i], card) < 0.5, "no segment enters the card");
  for (const ang of angles(pts)) assert.ok(ang % 45 === 0);
});
