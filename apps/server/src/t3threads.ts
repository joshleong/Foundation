/**
 * A T3 thread as someone on the board: a person asks one of this computer's
 * agents (Claude, Codex, Kimi, DeepSeek, …) for something in a section, and
 * that agent joins the section's group under its own name, like any of the
 * crew, for as long as its thread works (crew.ts gives it the presence; the
 * section's tab and the agents pane draw it).
 *
 * The thread runs in Foundation's own T3 (t3host.ts), supervised, in a folder
 * of its board (`<data>/t3-work/<board>`). It runs a model on someone's plan
 * or key, so it starts only from a person's press (index.ts: requirePerson
 * and a writer of the board).
 *
 * What it can't do yet: write the board. A T3 thread has no Foundation tools,
 * so its work is in its folder and its transcript (Open in T3).
 */

import { join } from "node:path";
import { boardMaps, findSection, logActivity } from "@foundation/protocol";
import type { UserInfo } from "@foundation/protocol";
import { config } from "./config.ts";
import { editBoard, getBoard } from "./boards.ts";
import { aim, joinCrew, leaveCrew, setDoing, type CrewMember } from "./crew.ts";
import { HttpError } from "./http.ts";
import { interruptT3Thread, onT3Work, startT3Thread, t3Host, type T3Work } from "./t3host.ts";

interface Bound {
  threadId: string;
  boardId: string;
  sectionId: string;
  by: string;
  member: CrewMember;
  /** T3 has shown it at work: after that, at rest means done */
  worked: boolean;
  at: number;
}

const bound = new Map<string, Bound>();
/** a thread T3 never showed at work is let go after this long */
const NEVER_STARTED_MS = () => Number(process.env.FOUNDATION_T3_START_MS ?? "45000") || 45_000;

export function t3Bound(threadId: string) {
  const b = bound.get(threadId);
  return b ? { boardId: b.boardId, sectionId: b.sectionId, by: b.by, crew: b.member.id } : undefined;
}

const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** a person asks one of T3's agents for something in a section */
export async function askT3(user: UserInfo, input: { board: string; section: string; agent: string; model?: string; text: string }) {
  const text = (input.text ?? "").trim();
  if (!text) throw new HttpError(400, "Say what you need.");
  if (t3Host().state !== "running") throw new HttpError(409, "T3 isn't running. Start it from the agents pane.");
  const doc = getBoard(input.board).doc;
  const section = findSection(doc, input.section);
  if (!section) throw new HttpError(404, "no such section on this board");
  const agent = t3Host().agents.find((a) => a.id === input.agent);
  if (!agent) throw new HttpError(404, `T3 has no agent "${input.agent}"`);
  // its place on the board first: a board that's full says so before anything is spent
  let member: CrewMember;
  try {
    member = joinCrew({ boardId: input.board, userId: user.id, userName: user.name, runId: `t3:${Date.now()}:${Math.random()}`, task: text, name: agent.name });
  } catch (e) {
    throw new HttpError(409, (e as Error).message);
  }
  aim(member, { id: section.id, kind: "section" }, "starting");
  try {
    const started = await startT3Thread({ agent: agent.id, model: input.model, title: short(text.split("\n")[0], 80), text, folder: join(config.dataDir, "t3-work", input.board.replace(/[^a-zA-Z0-9_-]/g, "_")), projectTitle: `Foundation · ${input.board}` });
    const b: Bound = { threadId: started.threadId, boardId: input.board, sectionId: section.id, by: user.id, member, worked: false, at: Date.now() };
    bound.set(started.threadId, b);
    setDoing(member, `starting on ${started.model}`);
    // T3 may have shown the thread at work before the start call came back: catch up
    const now = t3Host().work.find((w) => w.id === started.threadId);
    if (now) followT3Work(started.threadId, now);
    editBoard(input.board, "t3", (d) => logActivity(d, { who: member.name, role: "agent", text: `took “${short(text)}” (${started.model}, through T3)`, objectId: section.id, for: user.name }));
    setTimeout(() => {
      const still = bound.get(started.threadId);
      if (still && !still.worked) release(still, "error");
    }, NEVER_STARTED_MS()).unref?.();
    return { threadId: started.threadId, crew: member.id, name: member.name, model: started.model };
  } catch (e) {
    leaveCrew(member, "error", 0);
    throw new HttpError(502, (e as Error).message);
  }
}

function release(b: Bound, how: "done" | "stopped" | "error") {
  bound.delete(b.threadId);
  leaveCrew(b.member, how);
}

/** a person stops a thread they asked for (an admin can stop anyone's) */
export async function stopT3Thread(user: UserInfo, threadId: string) {
  const b = bound.get(threadId);
  if (b && b.by !== user.id && user.role !== "admin") throw new HttpError(403, "Only the person who asked (or an admin) can stop it.");
  await interruptT3Thread(threadId).catch((e) => {
    throw new HttpError(502, (e as Error).message);
  });
  if (b) release(b, "stopped");
  return { stopped: true };
}

/** T3 says a thread changed: its agent's presence on the board follows */
export function followT3Work(threadId: string, work: T3Work | null) {
  const b = bound.get(threadId);
  if (!b) return;
  if (!work) return release(b, "stopped");
  if (work.state === "working") {
    b.worked = true;
    setDoing(b.member, "working");
  } else if (work.state === "waiting") {
    b.worked = true;
    setDoing(b.member, "waiting for a person in T3");
  } else if (work.state === "error") release(b, "error");
  else if (b.worked) release(b, "done");
}
onT3Work(followT3Work);

/** which of T3's threads belong to which section, for the pane (thread id → where and who) */
export function t3Bindings(boardId: string): Record<string, { section: string; sectionName: string; crew: string; by: string }> {
  const out: Record<string, { section: string; sectionName: string; crew: string; by: string }> = {};
  for (const b of bound.values()) {
    if (b.boardId !== boardId) continue;
    const s = boardMaps(getBoard(boardId).doc).sections.get(b.sectionId);
    out[b.threadId] = { section: b.sectionId, sectionName: (s as { name?: string } | undefined)?.name ?? "", crew: b.member.id, by: b.by };
  }
  return out;
}

export function _resetT3Threads() {
  for (const b of [...bound.values()]) release(b, "stopped");
}
