/**
 * ⌘J — the agent, docked at the right. Type or hold Space (in the dock) /
 * click the mic to talk. Every step streams in: what it's thinking, which
 * tools it calls, what changed on the board (which everyone sees live).
 *
 * Runtime: "Subscription" runs Claude Code on this machine (your plan, the
 * T3-style session — conversation carries over); "API" spends workspace
 * credits. Auto picks the subscription when Claude Code is installed.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AgentEvent } from "@foundation/protocol";
import { api, streamAgent } from "../lib/api";
import { setUi, useUi } from "../state/ui";
import { activeBoard } from "../sync/board";
import { renderMarkdown } from "../utils/markdown";

interface Turn {
  role: "you" | "agent";
  text: string;
  steps: Array<{ name: string; ok?: boolean; summary?: string }>;
  status?: string;
  error?: string;
  runtime?: string;
}

const TOOL_WORDS: Record<string, string> = {
  read_board: "Reading the board",
  search: "Searching",
  add_section: "Adding a section",
  add_note: "Writing a note",
  add_panel: "Opening a panel",
  update_card: "Updating a card",
  delete_card: "Removing a card",
  connect: "Wiring apps",
  send_to_port: "Sending a value",
  find_repo: "Finding the repo",
  read_repo: "Reading the repo",
  app_tools: "Listing app tools",
  call_app_tool: "Calling an app",
  company: "Reading company systems",
  read_file: "Reading a file",
  ask_person: "Asking a teammate (Hermes)",
  vision_brief: "Briefing Vision",
  reverse_engineer: "Queuing reverse-engineering",
  focus: "Pointing",
  start_design_pipeline: "Starting a design pipeline",
  pipeline_status: "Reading the pipeline",
  stage_attach: "Attaching to a stage",
  stage_choose: "Choosing what goes forward",
  stage_check: "Ticking the checklist",
  stage_settings: "Setting up the stage",
  stage_request: "Handing off the stage",
  complete_stage: "Completing a stage",
};

const SUGGESTIONS = [
  "What's going on across the company right now?",
  "Organize this board into sections by project",
  "Find the repo behind each app on the board and pin it",
  "Ask Noa for the latest fan shroud CAD",
  "Brief Vision on a quieter rim-drive fan and ask Josh to review",
];

type SpeechCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  start(): void;
  stop(): void;
};

export function AgentDock() {
  const ui = useUi();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [runtime, setRuntime] = useState<"auto" | "subscription" | "api">(() => (localStorage.getItem("foundation-runtime") as "auto") ?? "auto");
  const [avail, setAvail] = useState<{ subscription: boolean; api: boolean; model: string } | null>(null);
  const [listening, setListening] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const rec = useRef<InstanceType<SpeechCtor> | null>(null);

  useEffect(() => {
    if (ui.dock && !avail) api<{ subscription: boolean; api: boolean; model: string }>("/api/agent/runtimes").then(setAvail).catch(() => {});
    if (ui.dock) requestAnimationFrame(() => field.current?.focus());
  }, [ui.dock, avail]);

  useEffect(() => {
    if (ui.dockDraft) {
      setDraft(ui.dockDraft);
      setUi({ dockDraft: "" });
      requestAnimationFrame(() => {
        const f = field.current;
        if (f) {
          f.focus();
          f.setSelectionRange(f.value.length, f.value.length);
        }
      });
    }
  }, [ui.dockDraft]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setDraft("");
    setBusy(true);
    setTurns((t) => [...t, { role: "you", text: prompt, steps: [] }, { role: "agent", text: "", steps: [], status: "thinking" }]);
    const patch = (fn: (t: Turn) => Turn) => setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
    ctrl.current = new AbortController();
    try {
      await streamAgent(
        { board: activeBoard()?.boardId ?? "company", prompt, runtime: runtime === "auto" ? undefined : runtime },
        (e: AgentEvent) => {
          if (e.type === "text") patch((t) => ({ ...t, text: t.text + e.text }));
          else if (e.type === "status") patch((t) => ({ ...t, status: e.status }));
          else if (e.type === "tool") patch((t) => ({ ...t, steps: [...t.steps, { name: e.name }] }));
          else if (e.type === "tool_result")
            patch((t) => {
              const steps = [...t.steps];
              const i = steps.map((s) => s.ok === undefined).lastIndexOf(true);
              if (i >= 0) steps[i] = { ...steps[i], ok: e.ok, summary: e.summary };
              return { ...t, steps };
            });
          else if (e.type === "error") patch((t) => ({ ...t, error: e.message }));
          else if (e.type === "done") patch((t) => ({ ...t, status: undefined, runtime: e.runtime }));
        },
        ctrl.current.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") patch((t) => ({ ...t, error: (err as Error).message }));
    } finally {
      patch((t) => ({ ...t, status: undefined }));
      setBusy(false);
    }
  };

  const listen = () => {
    const W = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) {
      setTurns((t) => [...t, { role: "agent", text: "", steps: [], error: "Voice needs a browser with speech recognition (Chrome, Edge, Safari)." }]);
      return;
    }
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    let final = "";
    r.onresult = (e) => {
      final = Array.from(e.results as ArrayLike<ArrayLike<{ transcript: string }>>)
        .map((x) => x[0].transcript)
        .join("");
      setDraft(final);
    };
    r.onend = () => {
      setListening(false);
      if (final.trim()) void send(final);
    };
    rec.current = r;
    setListening(true);
    r.start();
  };

  return (
    <AnimatePresence>
      {ui.dock && (
        <motion.aside
          className="dock f-glass"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
        >
          <header className="dock-head">
            <span className="dock-mark">✦</span>
            <span className="dock-title">Agent</span>
            <select className="dock-runtime" value={runtime} onChange={(e) => (localStorage.setItem("foundation-runtime", e.target.value), setRuntime(e.target.value as "auto"))} title="Where the agent runs">
              <option value="auto">Auto</option>
              <option value="subscription" disabled={avail ? !avail.subscription : false}>
                Subscription (Claude Code)
              </option>
              <option value="api" disabled={avail ? !avail.api : false}>
                API credits{avail?.model ? ` · ${avail.model}` : ""}
              </option>
            </select>
            <button className="icon-btn" title="Close (⌘J)" onClick={() => setUi({ dock: false })}>
              ✕
            </button>
          </header>

          <div className="dock-list" ref={list}>
            {turns.length === 0 && (
              <div className="dock-empty">
                <div className="f-eyebrow">The company brain</div>
                <p>I can run this board with you: organize it, open and wire apps, find repos, read BomForm and FactoryForm, brief Vision, and chase people for CAD.</p>
                {avail && !avail.subscription && !avail.api && (
                  <p className="dock-warn">No runtime yet — install Claude Code (subscription) or set ANTHROPIC_API_KEY on the server (credits).</p>
                )}
                <div className="dock-suggest">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="f-pill" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`turn turn-${t.role}`}>
                {t.steps.length > 0 && (
                  <div className="turn-steps">
                    {t.steps.map((s, j) => (
                      <div key={j} className={`step${s.ok === false ? " is-bad" : s.ok ? " is-ok" : " is-run"}`} title={s.summary}>
                        <span className="step-dot" />
                        {TOOL_WORDS[s.name] ?? s.name}
                      </div>
                    ))}
                  </div>
                )}
                {t.text &&
                  (t.role === "agent" ? (
                    <div className="turn-text note-rendered" dangerouslySetInnerHTML={{ __html: renderMarkdown(t.text) }} />
                  ) : (
                    <div className="turn-text">{t.text}</div>
                  ))}
                {t.status && (
                  <div className="turn-status">
                    <span className="thinking-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    {t.status}
                  </div>
                )}
                {t.error && <div className="turn-error">{t.error}</div>}
                {t.runtime && <div className="turn-runtime">{t.runtime === "api" ? "API credits" : "Subscription"}</div>}
              </div>
            ))}
          </div>

          <form
            className="dock-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <textarea
              ref={field}
              value={draft}
              rows={2}
              placeholder={listening ? "Listening…" : "Ask, or tell it what to build…"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
                if (e.key === "Escape") setUi({ dock: false });
              }}
            />
            <div className="dock-actions">
              <button type="button" className={`f-pill${listening ? " is-agent" : ""}`} onClick={listen} title="Talk">
                {listening ? "● Listening" : "🎙"}
              </button>
              {busy ? (
                <button type="button" className="f-pill" onClick={() => ctrl.current?.abort()}>
                  Stop
                </button>
              ) : (
                <button className="f-pill is-primary" disabled={!draft.trim()}>
                  Send
                </button>
              )}
            </div>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
