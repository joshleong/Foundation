/**
 * The plan board (docs/plan.json): Foundation's own kanban, the local copy of
 * the cards on GitHub. Anyone signed in reads it (Settings → Plan); an admin,
 * pressing it themselves, can move a card to another column, which writes the
 * file and marks the card as moved here until `npm run plan:push` sends it to
 * GitHub. The board never talks to GitHub itself: publishing stays a person's
 * command (scripts/plan.mjs).
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { UserInfo } from "@foundation/protocol";
import { HttpError } from "./http.ts";

export interface PlanCard {
  id: string;
  title: string;
  kind: "bug" | "plan" | "hookup";
  milestone: string;
  area: string;
  status: string;
  body: string;
  issue?: number | null;
  /** moved in the app since the last push to GitHub */
  moved?: { by: string; at: number; from: string } | null;
}
export interface Plan {
  about: string;
  repo: string;
  syncedAt: string | null;
  columns: Array<{ id: string; name: string; hint: string }>;
  milestones: Array<{ id: string; name: string; about: string }>;
  cards: PlanCard[];
}

export function planFile(): string {
  return process.env.FOUNDATION_PLAN_FILE ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "plan.json");
}

export function readPlan(): Plan | null {
  const file = planFile();
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Plan;
}

/** Moves one card to another column. Admins only, and only a person (an agent can't reorder the company's plan). */
export function movePlanCard(by: UserInfo, id: string, status: string): PlanCard {
  if (by.role !== "admin") throw new HttpError(403, "Only an admin can move cards on the plan");
  const plan = readPlan();
  if (!plan) throw new HttpError(404, "There's no plan file on this server (docs/plan.json)");
  if (!plan.columns.some((c) => c.id === status)) throw new HttpError(400, `No column "${status}"`);
  const card = plan.cards.find((c) => c.id === id);
  if (!card) throw new HttpError(404, `No card "${id}" on the plan`);
  if (card.status !== status) {
    // the column it had on GitHub is kept, so moving it back clears the mark
    const from = card.moved?.from ?? card.status;
    card.status = status;
    card.moved = status === from ? null : { by: by.name, at: Date.now(), from };
    if (!card.moved) delete card.moved;
    const file = planFile();
    const tmp = join(dirname(file), `.plan.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(plan, null, 2) + "\n");
    renameSync(tmp, file);
  }
  return card;
}
