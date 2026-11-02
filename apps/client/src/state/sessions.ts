/**
 * Agent sessions — the conversations behind the top bar's tabs. A run keeps
 * streaming when its tab isn't showing (switch away and come back), and a
 * session the page doesn't hold yet is replayed from the server's transcript.
 *
 * Also the side pane's lists: this board's sessions and Vision Code's threads.
 */

import { useSyncExternalStore } from "react";
import type { AgentEvent } from "@foundation/protocol";
import { api, streamAgent } from "../lib/api";
import { activeBoard } from "../sync/board";
import { getState } from "./store";
import { renameTab } from "./ui";

export interface Turn {
  prompt: string;
  events: AgentEvent[];
  status: "running" | "done" | "error" | "stopped";
  runtime?: string;
  at: number;
}

export interface SessionRun {
  turns: Turn[];
  busy: boolean;
  loaded: boolean;
}

const runs = new Map<string, SessionRun>();
const ctrls = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let version = 0;
const EMPTY: SessionRun = { turns: [], busy: false, loaded: false };

function emit() {
  version++;
  for (const fn of listeners) fn();
}
function patch(id: string, fn: (r: SessionRun) => SessionRun) {
  runs.set(id, fn(runs.get(id) ?? EMPTY));
  emit();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSession(id: string | null): SessionRun {
  useSyncExternalStore(subscribe, () => version);
  return (id && runs.get(id)) || EMPTY;
}

/** replay a session from the server, once, unless this page is already running it */
export async function loadSession(id: string) {
  const r = runs.get(id);
  if (r?.loaded || r?.busy) return;
  patch(id, (x) => ({ ...x, loaded: true }));
  try {
    const { turns } = await api<{ turns: Array<{ prompt: string; status: string; runtime: string; at: number; events: AgentEvent[] }> }>(`/api/agent/sessions/${encodeURIComponent(id)}`);
    if (runs.get(id)?.busy) return;
    patch(id, (x) => ({
      ...x,
      turns: turns.map((t) => ({ prompt: t.prompt, events: t.events, runtime: t.runtime, at: t.at, status: t.status === "running" ? "running" : t.status === "error" ? "error" : "done" })),
    }));
  } catch {
    /* a new session: nothing to replay */
  }
}

export async function sendToSession(id: string, prompt: string, runtime?: string) {
  const text = prompt.trim();
  const r = runs.get(id) ?? EMPTY;
  if (!text || r.busy) return;
  if (r.turns.length === 0) renameTab(id, titleOf(text));
  patch(id, (x) => ({ ...x, loaded: true, busy: true, turns: [...x.turns, { prompt: text, events: [], status: "running", at: Date.now() }] }));
  const last = (fn: (t: Turn) => Turn) => patch(id, (x) => ({ ...x, turns: [...x.turns.slice(0, -1), fn(x.turns[x.turns.length - 1])] }));
  const ctrl = new AbortController();
  ctrls.set(id, ctrl);
  try {
    await streamAgent(
      { board: activeBoard()?.boardId ?? "company", prompt: text, runtime, session: id },
      (e) =>
        last((t) => {
          const prev = t.events[t.events.length - 1];
          // streamed text joins the text before it
          const events = e.type === "text" && prev?.type === "text" ? [...t.events.slice(0, -1), { type: "text" as const, text: prev.text + e.text }] : [...t.events, e];
          return { ...t, events, runtime: e.type === "done" ? e.runtime : t.runtime, status: e.type === "error" ? "error" : t.status };
        }),
      ctrl.signal,
    );
    last((t) => ({ ...t, status: t.status === "running" ? "done" : t.status }));
  } catch (err) {
    const aborted = (err as Error).name === "AbortError";
    last((t) => ({ ...t, status: aborted ? "stopped" : "error", events: aborted ? t.events : [...t.events, { type: "error", message: (err as Error).message }] }));
  } finally {
    ctrls.delete(id);
    patch(id, (x) => ({ ...x, busy: false }));
    void refreshLists();
  }
}

export function stopSession(id: string) {
  ctrls.get(id)?.abort();
}

export function titleOf(prompt: string) {
  const line = prompt.split("\n")[0].trim();
  return line.length > 48 ? `${line.slice(0, 45)}…` : line;
}

// ---------- what a session shows ----------

export interface Plan {
  goal: string;
  steps: Array<{ text: string; status: "pending" | "active" | "done" }>;
}

/** the latest plan the agent set (set_plan), across every turn */
export function planOf(turns: Turn[]): Plan | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const ev = turns[i].events;
    for (let j = ev.length - 1; j >= 0; j--) {
      const e = ev[j];
      if (e.type === "tool" && e.name === "set_plan") {
        const p = e.input as Partial<Plan> | undefined;
        if (p && Array.isArray(p.steps)) return { goal: String(p.goal ?? ""), steps: p.steps.filter((s) => s && typeof s.text === "string") };
      }
    }
  }
  return null;
}

/** cards and sections a session's tools named — ringed on the grid while it shows */
export function touchedBy(turns: Turn[]): string[] {
  const st = getState();
  const ids = [
    ...Object.keys(st.panels),
    ...Object.keys(st.notes),
    ...Object.keys(st.tables),
    ...Object.keys(st.maps),
    ...Object.keys(st.media),
    ...Object.keys(st.sections),
  ];
  const text = turns
    .flatMap((t) => t.events)
    .map((e) => (e.type === "tool" && e.name !== "read_board" && e.name !== "set_plan" ? JSON.stringify(e.input) : e.type === "tool_result" ? e.summary : ""))
    .join(" ");
  return text ? ids.filter((id) => text.includes(id)) : [];
}

/** the first board object a step names, so a step can be clicked to frame it */
export function objectIn(text: string): string | null {
  const st = getState();
  const m = text.match(/\b(pnl|note|table|map|media|sec)_[A-Za-z0-9_]+/g) ?? [];
  for (const id of m) if (st.panels[id] || st.notes[id] || st.tables[id] || st.maps[id] || st.media[id] || st.sections[id]) return id;
  return null;
}

export const TOOL_WORDS: Record<string, string> = {
  read_board: "Read the board",
  search: "Searched",
  set_plan: "Updated the plan",
  add_section: "Added a section",
  add_note: "Wrote a note",
  add_panel: "Opened a panel",
  update_card: "Updated a card",
  delete_card: "Removed a card",
  connect: "Wired apps",
  send_to_port: "Sent a value",
  find_repo: "Found the repo",
  read_repo: "Read the repo",
  app_tools: "Listed app tools",
  call_app_tool: "Called an app",
  company: "Read company systems",
  read_file: "Read a file",
  ask_person: "Asked a teammate (Hermes)",
  vision_brief: "Briefed Vision",
  reverse_engineer: "Queued reverse-engineering",
  focus: "Pointed at a card",
  start_design_pipeline: "Started a design pipeline",
  pipeline_status: "Read the pipeline",
  stage_attach: "Attached to a stage",
  stage_choose: "Chose what goes forward",
  stage_check: "Ticked the checklist",
  stage_settings: "Set up the stage",
  stage_request: "Handed off the stage",
  complete_stage: "Completed a stage",
};

// ---------- the side pane's lists ----------

export interface SessionSummary {
  id: string;
  title: string;
  runs: number;
  status: "running" | "done" | "error";
  updatedAt: number;
}
export interface T3Thread {
  id: string;
  title: string;
  project: string;
  status: "running" | "waiting" | "idle" | "error";
  pending: number;
  updatedAt: number;
  url: string | null;
}

let lists: { sessions: SessionSummary[]; t3: T3Thread[]; t3Available: boolean | null } = { sessions: [], t3: [], t3Available: null };
const listListeners = new Set<() => void>();

export async function refreshLists() {
  const board = activeBoard()?.boardId ?? "company";
  const [s, t] = await Promise.allSettled([
    api<{ sessions: SessionSummary[] }>(`/api/agent/sessions?board=${encodeURIComponent(board)}`),
    api<{ available: boolean; threads: T3Thread[] }>("/api/t3/threads"),
  ]);
  lists = {
    sessions: s.status === "fulfilled" ? s.value.sessions : lists.sessions,
    t3: t.status === "fulfilled" ? t.value.threads : lists.t3,
    t3Available: t.status === "fulfilled" ? t.value.available : false,
  };
  for (const fn of listListeners) fn();
}

export function useLists() {
  return useSyncExternalStore(
    (fn) => {
      listListeners.add(fn);
      return () => listListeners.delete(fn);
    },
    () => lists,
  );
}
