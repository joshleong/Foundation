/**
 * Talk to the agent from anywhere: the mic pill beside search, or V. What you
 * say shows as you say it; when you stop, it goes to the agent session on
 * screen (or a new one) and runs — "lay out all the images from Slack about
 * the Airform PTHP" builds the page while you watch. Esc drops it.
 */

import { useEffect, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { listen, type Listening } from "../lib/voice";
import { sayToAgent } from "../state/sessions";
import { toast } from "../state/ui";

let session: Listening | null = null;
let heard: string | null = null; // null: not listening
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function talking() {
  return heard !== null;
}

/** start listening, or (when already listening) finish and send */
export function toggleTalk() {
  if (session) return session.stop();
  heard = "";
  emit();
  session = listen({
    heard: (t) => {
      heard = t;
      emit();
    },
    done: (t) => {
      session = null;
      heard = null;
      emit();
      if (t) sayToAgent(t);
    },
    failed: (m) => {
      session = null;
      heard = null;
      emit();
      toast(m, "warn");
    },
  });
  if (!session) {
    heard = null;
    emit();
  }
}

export function cancelTalk() {
  session?.cancel();
  session = null;
  heard = null;
  emit();
}

function useHeard() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => heard,
  );
}

export function TalkButton() {
  const text = useHeard();
  const on = text !== null;
  useEffect(() => {
    if (!on) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (e.preventDefault(), cancelTalk());
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [on]);
  return (
    <>
      <button className={`hud-talk f-glass${on ? " is-on" : ""}`} onClick={toggleTalk} title={on ? "Send (V) · Esc drops it" : "Talk to the agent (V)"} aria-pressed={on}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <rect x="5.5" y="1.5" width="5" height="9" rx="2.5" />
          <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" strokeLinecap="round" />
        </svg>
        {!on && <span className="f-kbd">V</span>}
      </button>
      <AnimatePresence>
        {on && (
          <motion.div
            className="hud-heard f-glass"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            <span className="hud-heard-dot" />
            <span className="hud-heard-text">{text || "Listening… say what to do"}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
