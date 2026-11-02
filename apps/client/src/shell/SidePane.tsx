/**
 * The side pane: everything the capsule used to carry, folded away until
 * called. Boards, tools, the activity feed and settings (night, people, you).
 * Folded, it is one small glass button in the corner. ⌘\ toggles it.
 */

import { AnimatePresence, motion } from "motion/react";
import type { UserInfo } from "@foundation/protocol";
import { isNight, setNight } from "@foundation/ui";
import { appendSectionLocal, requestSnap } from "../state/store";
import { setUi, useUi } from "../state/ui";
import { logout } from "../lib/api";
import { NightOrb } from "./NightOrb";
import { PresenceStack, initials, useBoardTick } from "./Presence";
import { copyMcpCommand } from "./CommandBar";

interface Props {
  user: UserInfo;
  boards: Array<{ id: string; name: string }>;
  current: string;
  onSwitch(id: string): void;
  onNew(): void;
  onUpload(): void;
}

const paneSpring = { type: "spring", stiffness: 320, damping: 32 } as const;

export function SidePane({ user, boards, current, onSwitch, onNew, onUpload }: Props) {
  const ui = useUi();
  const board = useBoardTick();
  const status = board?.status ?? "connecting";
  const name = boards.find((b) => b.id === current)?.name ?? current;

  return (
    <>
      <AnimatePresence initial={false}>
        {!ui.pane && (
          <motion.button
            key="pane-open"
            className="pane-toggle f-glass"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={paneSpring}
            onClick={() => setUi({ pane: true })}
            title="Boards, tools and settings (⌘\)"
          >
            <PaneGlyph />
            <span className={`f-dot ${status === "live" ? "is-ok" : status === "offline" ? "is-warn" : "is-live"}`} />
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {ui.pane && (
          <motion.aside
            key="pane"
            className="side-pane f-glass"
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={paneSpring}
          >
            <header className="pane-head">
              <div className="pane-board">
                <span className="f-eyebrow">Board</span>
                <span className="pane-board-name">{name || "…"}</span>
              </div>
              <span className={`f-dot ${status === "live" ? "is-ok" : status === "offline" ? "is-warn" : "is-live"}`} title={status === "live" ? "Live" : status === "offline" ? "Offline — edits will sync when back" : "Connecting…"} />
              <button className="icon-btn pane-close" onClick={() => setUi({ pane: false })} title="Fold the pane (⌘\)">
                <PaneGlyph />
              </button>
            </header>

            <div className="pane-scroll">
              <section className="pane-group">
                <div className="f-eyebrow">Boards</div>
                {boards.map((b) => (
                  <button key={b.id} className={`pane-row${b.id === current ? " is-current" : ""}`} onClick={() => onSwitch(b.id)}>
                    <span className="pane-glyph">{b.id === "company" ? "◉" : "▦"}</span>
                    <span className="pane-label">{b.name}</span>
                  </button>
                ))}
                <button className="pane-row is-new" onClick={onNew}>
                  <span className="pane-glyph">＋</span>
                  <span className="pane-label">New board</span>
                </button>
              </section>

              <section className="pane-group">
                <div className="f-eyebrow">Tools</div>
                <PaneRow glyph="⌕" label="Search, open, ask" kbd="⌘K" onClick={() => setUi({ command: true })} />
                <PaneRow glyph="✦" label="Agent" kbd="⌘J" agent active={ui.dock} onClick={() => setUi({ dock: !ui.dock })} />
                <PaneRow glyph="◇" label="Agent layer" kbd="A" agent active={ui.agentLayer} onClick={() => setUi({ agentLayer: !ui.agentLayer })} />
                <PaneRow glyph="◳" label="Open an app" kbd="⌘L" onClick={() => setUi({ command: true })} />
                <PaneRow glyph="⇪" label="Upload files" kbd="⌘U" onClick={onUpload} />
                <PaneRow glyph="▥" label="New section" onClick={() => appendSectionLocal("New section")} />
                <PaneRow glyph="⊡" label="Fit the board" kbd="0" onClick={() => requestSnap({ kind: "all" })} />
                <PaneRow glyph="▶" label="Present" kbd="P" onClick={() => setUi({ presenting: true })} />
              </section>

              <Activity />

              <section className="pane-group">
                <div className="f-eyebrow">Settings</div>
                <PaneRow glyph="⌁" label="Connect Claude Code" onClick={() => void copyMcpCommand()} />
                <PaneRow glyph="◐" label="Design language" onClick={() => (window.location.hash = "#/design")} />
              </section>
            </div>

            <footer className="pane-foot">
              <span className="me-avatar" style={{ background: user.color }} title={user.email}>
                {initials(user.name)}
              </span>
              <span className="pane-me">
                <b>{user.name}</b>
                <button
                  className="pane-signout"
                  onClick={async () => {
                    await logout();
                    window.location.reload();
                  }}
                >
                  Sign out
                </button>
              </span>
              <PresenceStack />
              <NightOrb onToggle={() => setNight(!isNight())} />
            </footer>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function PaneRow({ glyph, label, kbd, agent, active, onClick }: { glyph: string; label: string; kbd?: string; agent?: boolean; active?: boolean; onClick(): void }) {
  return (
    <button className={`pane-row${agent ? " is-agent" : ""}${active ? " is-on" : ""}`} onClick={onClick}>
      <span className="pane-glyph">{glyph}</span>
      <span className="pane-label">{label}</span>
      {kbd && <span className="f-kbd">{kbd}</span>}
    </button>
  );
}

function Activity() {
  const board = useBoardTick();
  const items = (board?.activity() ?? []).slice(-6).reverse();
  return (
    <section className="pane-group">
      <div className="f-eyebrow pane-activity-eyebrow">Activity</div>
      {items.length === 0 && <div className="activity-empty">Quiet so far. Agents and people show up here as they work.</div>}
      {items.map((a, i) => (
        <button key={a.at + ":" + i} className={`activity-row role-${a.role}`} onClick={() => a.objectId && requestSnap({ kind: "object", id: a.objectId })}>
          <span className={`f-dot ${a.role === "agent" ? "is-agent" : a.role === "human" ? "is-ok" : ""}`} />
          <span className="activity-who">{a.who}</span>
          <span className="activity-text">{a.text}</span>
          <span className="activity-when">{ago(a.at)}</span>
        </button>
      ))}
    </section>
  );
}

function ago(at: number) {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function PaneGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" />
      <path d="M6 2.5v11" />
    </svg>
  );
}
