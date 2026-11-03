/**
 * Jobs: long-running work a person starts from a card — reverse engineering
 * with REA today. Agents may queue a job; only a person presses Run (nothing
 * that executes third-party tooling or spends money runs implicitly).
 *
 * REA (github.com/morluto/rea, npm `rea-agents`, MIT) analyses websites,
 * JavaScript/Electron apps, binaries, APKs and more through MCP. Foundation
 * runs it in one of two ways:
 *  - a local directory or .asar → `rea-agents analyze-javascript-application <path> --json`
 *  - anything else (a URL, a binary, a repo) → a Claude Code session on this
 *    machine with REA's MCP server, told the goal and to report findings
 *    with evidence. Run `npx rea-agents setup` once to register REA with
 *    Claude Code.
 */

import { startHandoff } from "./vision.ts";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { boardMaps, logActivity } from "@foundation/protocol";
import { all, one, run } from "./db.ts";
import { editBoard } from "./boards.ts";
import { config } from "./config.ts";
import type { ToolCtx } from "./tools.ts";

export interface JobRow {
  id: string;
  kind: string;
  target: string;
  goal: string;
  board_id: string | null;
  status: "queued" | "running" | "done" | "error";
  output: string;
  created_by: string | null;
  created_at: number;
  finished_at: number | null;
}

export function queueJob(ctx: ToolCtx, kind: string, target: string, goal: string): JobRow {
  const id = `job_${randomBytes(6).toString("hex")}`;
  run("insert into jobs (id, kind, target, goal, board_id, status, created_by, created_at) values (?, ?, ?, ?, ?, 'queued', ?, ?)", id, kind, target, goal, ctx.boardId, ctx.actor, Date.now());
  return one<JobRow>("select * from jobs where id = ?", id)!;
}

export function getJob(id: string) {
  return one<JobRow>("select * from jobs where id = ?", id);
}

export function listJobs() {
  return all<JobRow>("select * from jobs order by created_at desc limit 100");
}

export function setCard(boardId: string, jobId: string, status: "running" | "done" | "error" | "idle", text?: string, who = "REA", what = "reverse-engineering") {
  editBoard(boardId, "jobs", (doc) => {
    const m = boardMaps(doc);
    for (const o of m.objects.values()) {
      if (o.kind === "panel" && o.sessionId === jobId) {
        m.objects.set(o.id, { ...o, status, ...(text ? { text } : {}) });
        if (status === "done" || status === "error") logActivity(doc, { who, role: "agent", text: `${what} ${status === "done" ? "finished" : "failed"}`, objectId: o.id });
      }
    }
  });
}

export function startJob(id: string, boardId: string, by: string) {
  const job = getJob(id);
  if (!job) throw new Error("no such job");
  if (job.status === "running") return job;
  if (job.kind === "vision") return startVisionJob(job, boardId, by);
  const goal = job.goal || "Map how it works: structure, data flow, APIs, and anything we can reuse.";
  const local = existsSync(job.target);
  const args = local && (statSync(job.target).isDirectory() || job.target.endsWith(".asar"))
    ? { cmd: "npx", argv: ["-y", "rea-agents@latest", "analyze-javascript-application", job.target, "--json"] }
    : {
        cmd: config.claudeCli,
        argv: [
          "-p",
          `Reverse-engineer ${job.target} for Form Industries (we own it or are authorized to examine it). Goal: ${goal}\nUse the REA MCP tools (rea) if available. Report findings with evidence as concise markdown: architecture, key modules, data flow, APIs/IPC, and what we could reuse.`,
          "--output-format",
          "text",
        ],
      };
  run("update jobs set status = 'running', output = '' where id = ?", id);
  setCard(boardId, id, "running");
  editBoard(boardId, "jobs", (doc) => logActivity(doc, { who: by, role: "human", text: `started reverse-engineering ${job.target}` }));

  const child = spawn(args.cmd, args.argv, { cwd: config.dataDir, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const append = (b: Buffer) => {
    out += b.toString("utf8");
    if (out.length > 400_000) out = out.slice(-400_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const flush = setInterval(() => run("update jobs set output = ? where id = ?", out, id), 1500);
  child.on("error", (e) => {
    out += `\n${e.message}`;
  });
  child.on("close", (code) => {
    clearInterval(flush);
    const ok = code === 0;
    run("update jobs set status = ?, output = ?, finished_at = ? where id = ?", ok ? "done" : "error", out, Date.now(), id);
    setCard(boardId, id, ok ? "done" : "error", ok ? out.slice(0, 4000) : `failed (${code}): ${out.slice(-800)}`);
  });
  return getJob(id)!;
}

/** a Vision hand-off: a person pressed Run, so the Supervised Vision Code thread starts (vision.ts) */
function startVisionJob(job: JobRow, boardId: string, by: string) {
  run("update jobs set status = 'running' where id = ?", job.id);
  setCard(boardId, job.id, "running", "Starting a Vision Code thread…", "Vision Code", "the hand-off");
  editBoard(boardId, "jobs", (doc) => logActivity(doc, { who: by, role: "human", text: `started Vision on ${job.target}` }));
  void startHandoff(job.id)
    .then((h) => {
      run("update jobs set output = ? where id = ?", h.thread_url ?? h.thread_id ?? "", job.id);
      setCard(boardId, job.id, "running", `Running in Vision Code (Supervised: changes wait for approval there).${h.thread_url ? ` Open the thread: ${h.thread_url}` : ""} What it puts in exports/ comes back here.`, "Vision Code", "the hand-off");
    })
    .catch((e: Error) => {
      run("update jobs set status = 'error', output = ?, finished_at = ? where id = ?", e.message, Date.now(), job.id);
      setCard(boardId, job.id, "error", `Couldn't start Vision Code: ${e.message}`, "Vision Code", "the hand-off");
    });
  return getJob(job.id)!;
}
