#!/usr/bin/env node
/**
 * The plan as a kanban, kept in step between docs/plan.json (the local copy
 * the app shows in Settings → Plan) and GitHub issues (where the team moves
 * cards). Uses the `gh` login; nothing else to install.
 *
 *   node scripts/plan.mjs push      write every card to its issue (makes missing ones), labels and milestones included
 *   node scripts/plan.mjs pull      read the issues back: column, title, body; issues made on GitHub with the `plan` label join the board
 *   node scripts/plan.mjs project   make (or refresh) a GitHub Projects board with a Column field (needs `gh auth refresh -s project`)
 *   node scripts/plan.mjs check     validate the file (also run by the tests)
 *
 * A card's column is its `status:` label on GitHub; a closed issue is Done.
 * Each issue carries `<!-- plan:<id> -->` so a card finds its issue again.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "plan.json");
const KINDS = { bug: "d73a4a", plan: "325bb4", hookup: "a16207" };
const STATUS_COLOR = { "needs-you": "a16207", next: "325bb4", doing: "6b5bd6", review: "2e5d43", backlog: "8a8577", done: "2e7d54" };

export function readPlan(file = FILE) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Problems with the plan file, as sentences; empty when it's sound. */
export function checkPlan(plan) {
  const problems = [];
  const columns = new Set(plan.columns.map((c) => c.id));
  const milestones = new Set(plan.milestones.map((m) => m.id));
  const seen = new Set();
  for (const card of plan.cards) {
    if (!/^[a-z0-9-]+$/.test(card.id)) problems.push(`${card.id}: ids are lower-case words joined by hyphens`);
    if (seen.has(card.id)) problems.push(`${card.id}: used twice`);
    seen.add(card.id);
    if (!columns.has(card.status)) problems.push(`${card.id}: no column "${card.status}"`);
    if (!milestones.has(card.milestone)) problems.push(`${card.id}: no milestone "${card.milestone}"`);
    if (!KINDS[card.kind]) problems.push(`${card.id}: kind is bug, plan or hookup`);
    if (!card.title?.trim() || !card.body?.trim()) problems.push(`${card.id}: needs a title and a body`);
    if (card.issue != null && !Number.isInteger(card.issue)) problems.push(`${card.id}: issue is a number`);
  }
  return problems;
}

function gh(args, input) {
  return execFileSync("gh", args, { input: input === undefined ? undefined : JSON.stringify(input), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 << 20 });
}
function api(method, path, body) {
  const out = gh(["api", "-X", method, path, ...(body ? ["--input", "-"] : [])], body);
  return out.trim() ? JSON.parse(out) : null;
}
function apiAll(path) {
  const out = gh(["api", "--paginate", "--slurp", path]);
  return JSON.parse(out).flat();
}

const marker = (id) => `<!-- plan:${id} -->`;
const FOOT = "\n\n---\n_Kept in step with `docs/plan.json` (`npm run plan:push` / `plan:pull`); shown in Foundation under Settings → Plan._\n";

function issueBody(plan, card) {
  const ms = plan.milestones.find((m) => m.id === card.milestone);
  return `${card.body}\n\n**Milestone:** ${ms?.name ?? card.milestone} · **Area:** ${card.area}${FOOT}${marker(card.id)}\n`;
}
function bodyFromIssue(body) {
  const text = (body ?? "").replace(/\r\n/g, "\n");
  const cut = text.indexOf("\n\n**Milestone:**");
  const end = cut >= 0 ? cut : text.indexOf(FOOT) >= 0 ? text.indexOf(FOOT) : text.length;
  return text.slice(0, end).replace(/<!-- plan:[a-z0-9-]+ -->/g, "").trim();
}
function labelsFor(card) {
  return ["plan", `kind: ${card.kind}`, `status: ${card.status}`, `area: ${card.area}`];
}
function statusOf(issue, fallback) {
  if (issue.state === "closed") return "done";
  const label = issue.labels.map((l) => (typeof l === "string" ? l : l.name)).find((n) => n.startsWith("status: "));
  const s = label?.slice("status: ".length);
  return s && s !== "done" ? s : fallback === "done" ? "next" : fallback;
}

function ensureLabels(repo, plan) {
  const have = new Set(apiAll(`repos/${repo}/labels?per_page=100`).map((l) => l.name));
  const want = [
    ["plan", "6b5bd6", "On Foundation's plan board (docs/plan.json)"],
    ...Object.entries(KINDS).map(([k, c]) => [`kind: ${k}`, c, ""]),
    ...plan.columns.map((col) => [`status: ${col.id}`, STATUS_COLOR[col.id] ?? "8a8577", col.hint]),
    ...[...new Set(plan.cards.map((c) => c.area))].map((a) => [`area: ${a}`, "efece3", ""]),
  ];
  for (const [name, color, description] of want) {
    if (have.has(name)) continue;
    api("POST", `repos/${repo}/labels`, { name, color, description });
    console.log(`label   ${name}`);
  }
}

function ensureMilestones(repo, plan) {
  const have = new Map(apiAll(`repos/${repo}/milestones?state=all&per_page=100`).map((m) => [m.title, m.number]));
  const out = {};
  for (const ms of plan.milestones) {
    if (!have.has(ms.name)) {
      const made = api("POST", `repos/${repo}/milestones`, { title: ms.name, description: ms.about });
      have.set(ms.name, made.number);
      console.log(`milestone ${ms.name}`);
    }
    out[ms.id] = have.get(ms.name);
  }
  return out;
}

function planIssues(repo) {
  return apiAll(`repos/${repo}/issues?state=all&labels=plan&per_page=100`).filter((i) => !i.pull_request);
}

function push() {
  const plan = readPlan();
  const problems = checkPlan(plan);
  if (problems.length) throw new Error(problems.join("\n"));
  const repo = plan.repo;
  ensureLabels(repo, plan);
  const milestones = ensureMilestones(repo, plan);
  const byId = new Map();
  for (const issue of planIssues(repo)) {
    const id = /<!-- plan:([a-z0-9-]+) -->/.exec(issue.body ?? "")?.[1];
    if (id) byId.set(id, issue);
  }
  for (const card of plan.cards) {
    const existing = card.issue ? null : byId.get(card.id);
    const number = card.issue ?? existing?.number;
    const payload = {
      title: card.title,
      body: issueBody(plan, card),
      labels: labelsFor(card),
      milestone: milestones[card.milestone],
      state: card.status === "done" ? "closed" : "open",
    };
    if (number) {
      api("PATCH", `repos/${repo}/issues/${number}`, payload);
      card.issue = number;
      delete card.moved;
      console.log(`updated #${number} ${card.id}`);
    } else {
      const { state: _state, ...create } = payload;
      const made = api("POST", `repos/${repo}/issues`, create);
      card.issue = made.number;
      delete card.moved;
      if (payload.state === "closed") api("PATCH", `repos/${repo}/issues/${made.number}`, { state: "closed" });
      console.log(`created #${made.number} ${card.id}`);
    }
  }
  plan.syncedAt = new Date().toISOString();
  save(plan);
}

function pull() {
  const plan = readPlan();
  const issues = planIssues(plan.repo);
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const milestoneByName = new Map(plan.milestones.map((m) => [m.name, m.id]));
  const known = new Set(plan.cards.map((c) => c.issue).filter(Boolean));
  for (const card of plan.cards) {
    const issue = card.issue && byNumber.get(card.issue);
    if (!issue) continue;
    card.title = issue.title;
    card.body = bodyFromIssue(issue.body) || card.body;
    // a card moved in the app and not yet pushed keeps the app's column
    if (!card.moved) card.status = statusOf(issue, card.status);
    const ms = issue.milestone && milestoneByName.get(issue.milestone.title);
    if (ms) card.milestone = ms;
  }
  // issues made on GitHub with the plan label join the board
  for (const issue of issues) {
    if (known.has(issue.number)) continue;
    const names = issue.labels.map((l) => (typeof l === "string" ? l : l.name));
    const kind = names.find((n) => n.startsWith("kind: "))?.slice(6) ?? "plan";
    plan.cards.push({
      id: /<!-- plan:([a-z0-9-]+) -->/.exec(issue.body ?? "")?.[1] ?? `gh-${issue.number}`,
      title: issue.title,
      kind: KINDS[kind] ? kind : "plan",
      milestone: (issue.milestone && milestoneByName.get(issue.milestone.title)) ?? "polish",
      area: names.find((n) => n.startsWith("area: "))?.slice(6) ?? "general",
      status: statusOf(issue, "backlog"),
      body: bodyFromIssue(issue.body) || "(no description on GitHub)",
      issue: issue.number,
    });
    console.log(`joined #${issue.number} ${issue.title}`);
  }
  plan.syncedAt = new Date().toISOString();
  save(plan);
  console.log(`pulled ${issues.length} issues`);
}

function project() {
  const plan = readPlan();
  const owner = plan.repo.split("/")[0];
  const title = "Foundation plan";
  const list = JSON.parse(gh(["project", "list", "--owner", owner, "--format", "json"]));
  let proj = list.projects.find((p) => p.title === title);
  if (!proj) proj = JSON.parse(gh(["project", "create", "--owner", owner, "--title", title, "--format", "json"]));
  const fields = JSON.parse(gh(["project", "field-list", String(proj.number), "--owner", owner, "--format", "json"])).fields;
  let column = fields.find((f) => f.name === "Column");
  if (!column) {
    gh(["project", "field-create", String(proj.number), "--owner", owner, "--name", "Column", "--data-type", "SINGLE_SELECT", "--single-select-options", plan.columns.map((c) => c.name).join(",")]);
    column = JSON.parse(gh(["project", "field-list", String(proj.number), "--owner", owner, "--format", "json"])).fields.find((f) => f.name === "Column");
  }
  for (const card of plan.cards) {
    if (!card.issue) continue;
    const item = JSON.parse(gh(["project", "item-add", String(proj.number), "--owner", owner, "--url", `https://github.com/${plan.repo}/issues/${card.issue}`, "--format", "json"]));
    const option = column.options.find((o) => o.name === plan.columns.find((c) => c.id === card.status)?.name);
    if (option) gh(["project", "item-edit", "--id", item.id, "--project-id", proj.id, "--field-id", column.id, "--single-select-option-id", option.id]);
    console.log(`#${card.issue} → ${option?.name ?? card.status}`);
  }
  console.log(`project: ${proj.url}`);
}

function save(plan) {
  writeFileSync(FILE, JSON.stringify(plan, null, 2) + "\n");
}

const command = process.argv[2];
if (command && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/").replace(/^(?=[A-Za-z]:)/, "/")}`) {
  try {
    if (command === "push") push();
    else if (command === "pull") pull();
    else if (command === "project") project();
    else if (command === "check") {
      const problems = checkPlan(readPlan());
      if (problems.length) {
        console.error(problems.join("\n"));
        process.exit(1);
      }
      console.log("plan ok");
    } else {
      console.error("usage: node scripts/plan.mjs push | pull | project | check");
      process.exit(2);
    }
  } catch (err) {
    console.error(String(err.stderr || err.message || err));
    process.exit(1);
  }
}
