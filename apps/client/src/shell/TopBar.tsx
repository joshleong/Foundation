/**
 * The top bar, drawn on the floor: the side pane's fold, the tabs (the board
 * first, then each open session), and the tools on the right — search, the
 * command bar, a new agent session, the agent layer, present — with the
 * people here and the sync dot, then the day/night orb at the far right. The
 * way Claude Code's desktop bar carries its sidebar toggle, sessions and panes.
 *
 * In the desktop app this is the window's title bar too: its open stretch
 * moves the window, and minimize, maximize and close sit past its right end
 * (shell/WindowControls.tsx), all on the one line.
 */

import { COMMANDS_GLYPH, keys } from "../lib/keys";
import { motion, AnimatePresence } from "motion/react";
import { closeTab, newSession, setUi, useUi } from "../state/ui";
import { useSession } from "../state/sessions";
import { isNight, setNight } from "@foundation/ui";
import { PresenceStack, useBoardTick } from "./Presence";
import { NightOrb } from "./NightOrb";

export function TopBar({ boardName }: { boardName: string }) {
  const ui = useUi();
  const board = useBoardTick();
  const status = board?.status ?? "connecting";

  return (
    <header className="top-bar">
      <button className={`top-btn pane-fold${ui.pane ? " is-on" : ""}`} onClick={() => setUi({ pane: !ui.pane })} data-tip={ui.pane ? `Fold the side pane (${keys("mod+\\")})` : `Sessions, boards and settings (${keys("mod+\\")})`}>
        <PaneGlyph />
      </button>

      <nav className="tabs" aria-label="Tabs">
        <button className={`tab is-board${ui.tab === null ? " is-current" : ""}`} onClick={() => setUi({ tab: null })} title={`The board (${keys("mod+1")})`}>
          <span className="tab-glyph">▦</span>
          <span className="tab-title">{boardName || "Board"}</span>
          <span className={`f-dot ${status === "live" ? "is-ok" : status === "offline" ? "is-warn" : "is-live"}`} title={status === "live" ? "Live" : status === "offline" ? "Offline — edits will sync when back" : "Connecting…"} />
          {status !== "live" && board && (board.pending || board.fromDevice) && (
            <span
              className="offline-pill"
              title={board.pending ? "Your changes are saved on this device and go to the server when it's back." : "Showing this device's copy until the server answers."}
            >
              {board.pending ? "Saved on this device" : "This device's copy"}
            </span>
          )}
          {ui.role === "viewer" && (
            <span className="view-only" title="You can read this board, ask the agent about it and present it. An admin can make you a member.">
              View only
            </span>
          )}
        </button>
        <AnimatePresence initial={false}>
          {ui.tabs.map((t, i) => (
            <motion.div
              key={t.id}
              className={`tab${ui.tab === t.id ? " is-current" : ""}${t.kind === "agent" ? " is-agent" : " is-t3"}`}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              layout="position"
            >
              <button className="tab-main" onClick={() => setUi({ tab: t.id })} title={`${t.title}${i < 8 ? ` (${keys(`mod+${i + 2}`)})` : ""}`}>
                <TabMark id={t.id} kind={t.kind} />
                <span className="tab-title">{t.title}</span>
              </button>
              <button className="tab-close" onClick={() => closeTab(t.id)} aria-label={`Close ${t.title}`} title={`Close (${keys("mod+W")})`}>
                ✕
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        <button className="top-btn tab-new" onClick={() => newSession()} data-tip={`New agent session (${keys("mod+J")})`}>
          ＋
        </button>
      </nav>

      <div className="top-tools">
        <PresenceStack />
        <button className={`top-btn${ui.search ? " is-on" : ""}`} onClick={() => setUi({ search: !ui.search })} data-tip={`Search, drag onto the grid (${keys("mod+F")})`}>
          ⌕
        </button>
        <button className="top-btn" onClick={() => setUi({ command: true })} data-tip={`Commands, open an app (${keys("mod+K")})`}>
          {COMMANDS_GLYPH}
        </button>
        <button className={`top-btn is-agent${ui.agentLayer ? " is-on" : ""}`} onClick={() => setUi({ agentLayer: !ui.agentLayer })} data-tip="Agent layer (A)">
          ◇
        </button>
        <button className="top-btn" onClick={() => setUi({ presenting: true })} data-tip="Present (P)">
          ▶
        </button>
        <NightOrb onToggle={() => setNight(!isNight())} />
      </div>
    </header>
  );
}

/** a session's state at a glance: violet pulse while it runs, a tick when done */
function TabMark({ id, kind }: { id: string; kind: "agent" | "t3" }) {
  const run = useSession(kind === "agent" ? id : null);
  if (kind === "t3") return <span className="tab-glyph is-t3">⌥</span>;
  return <span className={`tab-glyph${run.busy ? " is-running" : ""}`}>✦</span>;
}

export function PaneGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" />
      <path d="M6 2.5v11" />
    </svg>
  );
}
