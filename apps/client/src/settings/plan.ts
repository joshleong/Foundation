/**
 * The plan board's model: docs/plan.json, bundled into the app as the local
 * copy (so Settings → Plan opens even offline), then refreshed from the
 * server's file, which is where a move made in the app lands (SettingsPage).
 */

import planJson from "../../../../docs/plan.json";

export type CardKind = "bug" | "plan" | "hookup";
export interface PlanCard {
  id: string;
  title: string;
  kind: CardKind;
  milestone: string;
  area: string;
  status: string;
  body: string;
  issue?: number | null;
  moved?: { by: string; at: number; from: string } | null;
}
export interface PlanColumn {
  id: string;
  name: string;
  hint: string;
}
export interface Plan {
  about: string;
  repo: string;
  syncedAt: string | null;
  columns: PlanColumn[];
  milestones: Array<{ id: string; name: string; about: string }>;
  cards: PlanCard[];
}

export const PLAN = planJson as Plan;

export interface PlanFilter {
  kind?: CardKind;
  milestone?: string;
  query?: string;
}

/** The columns in board order, each with its cards (filtered), in the file's order. */
export function boardColumns(plan: Plan, filter: PlanFilter): Array<PlanColumn & { cards: PlanCard[] }> {
  const q = filter.query?.trim().toLowerCase();
  const keep = (c: PlanCard) =>
    (!filter.kind || c.kind === filter.kind) &&
    (!filter.milestone || c.milestone === filter.milestone) &&
    (!q || c.title.toLowerCase().includes(q) || c.body.toLowerCase().includes(q) || c.area.includes(q) || String(c.issue ?? "") === q.replace(/^#/, ""));
  return plan.columns.map((col) => ({ ...col, cards: plan.cards.filter((c) => c.status === col.id && keep(c)) }));
}

export function counts(plan: Plan) {
  const by = (k: CardKind) => plan.cards.filter((c) => c.kind === k && c.status !== "done").length;
  return { bug: by("bug"), plan: by("plan"), hookup: by("hookup"), open: plan.cards.filter((c) => c.status !== "done").length };
}

export const issueUrl = (plan: Plan, n: number) => `https://github.com/${plan.repo}/issues/${n}`;
