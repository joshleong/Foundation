/**
 * The plan board: everyone signed in reads it; only an admin, as a person,
 * moves a card; a move writes the file and marks the card until it's pushed,
 * and moving it back clears the mark.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "foundation-plan-"));
process.env.FOUNDATION_DATA_DIR = dir;
process.env.FOUNDATION_ADMIN_EMAILS = "boss@formindustries.com";
process.env.FOUNDATION_PLAN_FILE = join(dir, "plan.json");
copyFileSync(new URL("../../../docs/plan.json", import.meta.url), process.env.FOUNDATION_PLAN_FILE);

const { upsertUser } = await import("../src/auth.ts");
const { movePlanCard, readPlan } = await import("../src/plan.ts");

const boss = upsertUser("boss@formindustries.com", "Boss");
const ada = upsertUser("ada@formindustries.com", "Ada");

test("the plan reads from the file", () => {
  const plan = readPlan()!;
  assert.ok(plan.cards.length > 10);
  assert.ok(plan.columns.some((c) => c.id === "next"));
});

// any card not in Next/Doing/Review: it's moved into Next first, so the test doesn't hang on the board's own state
const pick = () => readPlan()!.cards.find((c) => c.status === "backlog")!;

test("only an admin moves a card; a column must exist", () => {
  const card = pick();
  assert.throws(() => movePlanCard(ada, card.id, "doing"), /Only an admin/);
  assert.throws(() => movePlanCard(boss, card.id, "someday"), /No column/);
  assert.throws(() => movePlanCard(boss, "no-such-card", "doing"), /No card/);
});

test("a move writes the file and marks the card; moving back clears the mark", () => {
  const card = pick();
  const moved = movePlanCard(boss, card.id, "doing");
  assert.equal(moved.status, "doing");
  assert.equal(moved.moved?.from, "backlog");
  assert.equal(moved.moved?.by, "Boss");
  const onDisk = JSON.parse(readFileSync(process.env.FOUNDATION_PLAN_FILE!, "utf8"));
  assert.equal(onDisk.cards.find((c: { id: string }) => c.id === card.id).status, "doing");
  movePlanCard(boss, card.id, "review");
  assert.equal(readPlan()!.cards.find((c) => c.id === card.id)!.moved?.from, "backlog");
  const back = movePlanCard(boss, card.id, "backlog");
  assert.equal(back.moved, undefined);
});
