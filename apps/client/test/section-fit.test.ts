/**
 * A section never scrolls (Josh, 2026-11-07): it fits its cards to its body,
 * choosing the flow width that shows them largest, stops at MIN_FIT and says
 * it's clipped; expanded, it is its own grid at full size and grows to hold
 * everything. Wires and drops read the same fitted geometry (objectWorldRect).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTENT_PAD,
  MIN_FIT,
  SECTION_HEADER,
  applyRemote,
  expandSection,
  getState,
  objectWorldRect,
  sectionBaseRect,
  sectionCardRect,
  sectionFlow,
  type NoteMeta,
} from "../src/state/store";

const note = (i: number): NoteMeta => ({ id: `n${i}`, sectionId: "S", name: `n${i}`, x: 0, y: 0, float: false, bornAt: i, w: 420, h: 300, text: "" });
const load = (count: number) =>
  applyRemote({
    grid: { cols: [1200], rows: [900] },
    sections: { S: { id: "S", name: "S", c0: 0, r0: 0, c1: 0, r1: 0 } },
    notes: Object.fromEntries(Array.from({ length: count }, (_, i) => [`n${i}`, note(i)])),
    tables: {},
    maps: {},
    media: {},
    panels: {},
  });

test("cards that fit show at full size", () => {
  load(2);
  const f = sectionFlow("S");
  assert.equal(f.fit, 1);
  assert.equal(f.clipped, false);
});

test("too many cards: a wider flow, scaled to fit the body, everything inside", () => {
  load(12);
  const f = sectionFlow("S");
  const body = sectionBaseRect(getState().grid, getState().sections.S);
  assert.ok(f.fit < 1 && f.fit >= MIN_FIT, `fit ${f.fit}`);
  assert.equal(f.clipped, false);
  assert.ok(f.availW > body.w - CONTENT_PAD * 2, "it chose a wider flow than the section");
  assert.ok(f.extent.w * f.fit <= body.w - 2 + 0.5 && f.extent.h * f.fit <= body.h - 2 - SECTION_HEADER + 0.5, "the fitted content is inside the body");
  // the world rect a wire lands on is the drawn (scaled) card
  const r = objectWorldRect(getState().notes.n0)!;
  assert.equal(r.s, f.fit);
  assert.ok(Math.abs(r.w - 420 * f.fit) < 1e-9);
});

test("far too many: it stops at MIN_FIT and says it's clipped", () => {
  load(80);
  const f = sectionFlow("S");
  assert.equal(f.fit, MIN_FIT);
  assert.equal(f.clipped, true);
});

test("expanded: its own width, full size, and the section grows to hold it all; closing gives the fit back", () => {
  load(80);
  const base = sectionBaseRect(getState().grid, getState().sections.S);
  expandSection("S");
  const f = sectionFlow("S");
  assert.equal(f.fit, 1);
  assert.equal(f.clipped, false);
  assert.equal(f.availW, base.w - CONTENT_PAD * 2);
  const open = sectionCardRect(getState().grid, getState().sections.S);
  assert.equal(open.x, base.x);
  assert.equal(open.y, base.y);
  assert.ok(open.h >= SECTION_HEADER + f.extent.h, "tall enough for every card");
  expandSection(null);
  assert.equal(sectionFlow("S").fit, MIN_FIT);
  assert.deepEqual(sectionCardRect(getState().grid, getState().sections.S), base);
});

test("an expanded section: wires between the sections that stepped back fade with them", async () => {
  const { wireBackstage, getState: st } = await import("../src/state/store");
  load(2);
  const base = st();
  assert.equal(wireBackstage(base, "A", "B"), false, "nothing is open");
  const open = { ...base, expandedSection: "S" };
  assert.equal(wireBackstage(open, "A", "B"), true, "neither end is in the open section");
  assert.equal(wireBackstage(open, "S", "B"), false, "a wire out of the open section stays");
  assert.equal(wireBackstage(open, "A", "S"), false, "a wire into it stays");
  assert.equal(wireBackstage({ ...base, expandedSection: "gone" }, "A", "B"), false, "a section that no longer exists opens nothing");
});
