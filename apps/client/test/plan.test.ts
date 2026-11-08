/**
 * The plan board (docs/plan.json) stays sound: every card in a real column and
 * milestone, ids unique, and the board the Settings page draws holds every card once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error a plain .mjs script with no types
import { checkPlan, readPlan } from "../../../scripts/plan.mjs";
import { boardColumns, PLAN } from "../src/settings/plan";

test("docs/plan.json is sound", () => {
  assert.deepEqual(checkPlan(readPlan()), []);
});

test("the board shows every card once, in its column", () => {
  const cols = boardColumns(PLAN, {});
  const shown = cols.flatMap((c) => c.cards.map((card) => card.id));
  assert.equal(shown.length, PLAN.cards.length);
  assert.equal(new Set(shown).size, shown.length);
  for (const col of cols) for (const card of col.cards) assert.equal(card.status, col.id);
});

test("filters narrow by kind and milestone", () => {
  const bugs = boardColumns(PLAN, { kind: "bug" }).flatMap((c) => c.cards);
  assert.ok(bugs.length > 0 && bugs.every((c) => c.kind === "bug"));
  const crew = boardColumns(PLAN, { milestone: "crew" }).flatMap((c) => c.cards);
  assert.ok(crew.length > 0 && crew.every((c) => c.milestone === "crew"));
});
