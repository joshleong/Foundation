/**
 * The side pane, drawn on the floor (the paper and its dots run underneath;
 * the cards fade out at its edge). Folded by the top bar's first button or
 * ⌘\, resized by its right edge.
 *
 * Top to bottom: Sessions — this board's agent sessions and Vision Code's
 * threads, each opening a tab — then Boards, Activity, Release & plan (the
 * app's floorplan and the plan board in Settings), Tools, and you.
 */

import { keys } from "../lib/keys";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { UserInfo } from "@foundation/protocol";
import { isNight, setNight } from "@foundation/ui";
import { appendSectionLocal, requestSnap } from "../state/store";
import { WIDTHS, newSession, openTab, setUi, useUi } from "../state/ui";
import { refreshLists, useLists } from "../state/sessions";
import { api, logout } from "../lib/api";
import { NightOrb } from "./NightOrb";
import { initials, useBoardTick } from "./Presence";
import { copyMcpCommand } from "./CommandBar";
import { FloorEdge } from "./FloorEdge";
import type { BoardRow } from "./Shell";

interface Props {
  user: UserInfo;
  boards: BoardRow[];
  current: string;
  onSwitch(id: string): void;
  onNew(): void;
  onUpload(): void;
}

const paneSpring = { type: "spring", stiffness: 340, damping: 34 } as const;

export function SidePane({ user, boards, current, onSwitch, onNew, onUpload }: Props) {
  const ui = useUi();

  // the lists refresh while the pane is open
  useEffect(() => {
    if (!ui.pane) return;
    void refreshLists();
    const t = setInterval(() => void refreshLists(), 12_000);
    return () => clearInterval(t);
  }, [ui.pane, current]);

  return (
    <AnimatePresence initial={false}>
      {ui.pane && (
        <motion.aside
          key="pane"
          className="side-pane floor-pane"
          style={{ width: ui.paneW }}
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={paneSpring}
        >
          <div className="pane-scroll">
            <Sessions />

            <section className="pane-group">
              <div className="pane-eyebrow">Boards</div>
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

            {user.role === "admin" && current && <People board={current} me={user.id} />}

            <Activity />

            <section className="pane-group">
              <div className="pane-eyebrow">Release & plan</div>
              <PaneRow glyph="⌗" label="App floorplan" onClick={openFloorplan} />
              <PaneRow glyph="◇" label="The plan" onClick={() => (window.location.hash = "#/settings/plan")} />
            </section>

            <section className="pane-group">
              <div className="pane-eyebrow">Tools</div>
              <PaneRow glyph="⇪" label="Upload files" kbd={keys("mod+U")} onClick={onUpload} />
              <PaneRow glyph="▥" label="New section" onClick={() => appendSectionLocal("New section")} />
              <PaneRow glyph="⊡" label="Fit the board" kbd="0" onClick={() => requestSnap({ kind: "all" })} />
              <PaneRow glyph="⌁" label="Connect Claude Code" onClick={() => void copyMcpCommand()} />
              <PaneRow glyph="◐" label="Design language" onClick={() => (window.location.hash = "#/design")} />
              <PaneRow glyph="⚙" label="Settings" onClick={() => (window.location.hash = "#/settings")} />
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
            <NightOrb onToggle={() => setNight(!isNight())} />
          </footer>

          <FloorEdge side="right" value={ui.paneW} {...WIDTHS.pane} onChange={(w) => setUi({ paneW: w })} label="Side pane" />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Sessions() {
  const ui = useUi();
  const lists = useLists();
  const [allT3, setAllT3] = useState(false);
  const t3 = allT3 ? lists.t3 : lists.t3.slice(0, 6);
  return (
    <>
      <section className="pane-group">
        <div className="pane-eyebrow is-agent">
          Sessions
          <button className="pane-eyebrow-act" onClick={() => newSession()} title={`New agent session (${keys("mod+J")})`}>
            ＋
          </button>
        </div>
        {lists.sessions.length === 0 && <div className="pane-empty">Agent sessions on this board show up here. Each one is a tab: its goal, its steps, and what it changed on the grid.</div>}
        {lists.sessions.slice(0, 8).map((s) => (
          <button
            key={s.id}
            className={`pane-row is-session${ui.tab === s.id ? " is-current" : ""}`}
            onClick={() => openTab({ id: s.id, kind: "agent", title: s.title })}
          >
            <span className={`f-dot ${s.status === "running" ? "is-agent is-pulse" : s.status === "error" ? "is-bad" : "is-agent-dim"}`} />
            <span className="pane-label">{s.title}</span>
            <span className="pane-when">{ago(s.updatedAt)}</span>
          </button>
        ))}
      </section>

      <section className="pane-group">
        <div className="pane-eyebrow">Vision Code</div>
        {lists.t3Available === false && (
          <div className="pane-empty is-paths">{lists.t3Missing ?? "Vision Code isn't on this computer (or its store moved). Set T3CODE_HOME on the server to point at it."}</div>
        )}
        {t3.map((t) => (
          <button
            key={t.id}
            className={`pane-row is-session${ui.tab === `t3:${t.id}` ? " is-current" : ""}`}
            onClick={() => openTab({ id: `t3:${t.id}`, kind: "t3", title: t.title })}
            title={`${t.project} · ${t.title}`}
          >
            <span className={`f-dot ${t.status === "running" ? "is-live is-pulse" : t.status === "waiting" ? "is-warn" : t.status === "error" ? "is-bad" : ""}`} />
            <span className="pane-label">{t.title}</span>
            <span className="pane-when">{t.pending > 0 ? `${t.pending} ask` : ago(t.updatedAt)}</span>
          </button>
        ))}
        {lists.t3.length > 6 && (
          <button className="pane-row is-more" onClick={() => setAllT3((v) => !v)}>
            <span className="pane-glyph">{allT3 ? "−" : "…"}</span>
            <span className="pane-label">{allT3 ? "Fewer" : `${lists.t3.length - 6} more`}</span>
          </button>
        )}
      </section>
    </>
  );
}

interface Person {
  id: string;
  name: string;
  email: string;
  color: string;
  role: "admin" | "member" | "viewer";
  account: "admin" | "member" | "viewer";
  onBoard: boolean;
}

/** admins: who may change this board. A role set here beats the person's account role; admins always can. */
function People({ board, me }: { board: string; me: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ people: Person[] }>(`/api/boards/${encodeURIComponent(board)}/people`).then((r) => setPeople(r.people)).catch(() => {});
  }, [board]);
  const set = async (userId: string, role: "member" | "viewer" | null) => {
    try {
      const r = await api<{ people: Person[] }>(`/api/boards/${encodeURIComponent(board)}/people`, { method: "POST", json: { userId, role } });
      setPeople(r.people);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <section className="pane-group">
      <div className="pane-eyebrow">People on this board</div>
      {people.map((p) => (
        <div key={p.id} className="pane-row is-person" title={p.email}>
          <span className="person-dot" style={{ background: p.color }}>
            {initials(p.name)}
          </span>
          <span className="pane-label">{p.name}</span>
          {p.account === "admin" ? (
            <span className="person-role">Admin</span>
          ) : (
            <select
              className={`person-role-pick${p.role === "viewer" ? " is-viewer" : ""}`}
              value={p.onBoard ? p.role : "default"}
              disabled={p.id === me}
              aria-label={`${p.name} on this board`}
              onChange={(e) => void set(p.id, e.target.value === "default" ? null : (e.target.value as "member" | "viewer"))}
            >
              <option value="default">{p.account === "viewer" ? "Viewer (account)" : "Member (account)"}</option>
              <option value="member">Can edit</option>
              <option value="viewer">View only</option>
            </select>
          )}
        </div>
      ))}
      {err && <div className="pane-empty is-bad">{err}</div>}
    </section>
  );
}

/**
 * Release & plan. The floorplan is a map of Foundation's own code (every part,
 * file and connection, in plain words), made with the floorplan plugin and
 * exported to `public/floorplan.html` — a static page the client serves.
 * Rebuild it after a release: see docs/floorplan.md.
 */
export const FLOORPLAN_URL = "/floorplan.html";

function openFloorplan() {
  window.open(FLOORPLAN_URL, "_blank", "noopener");
}

function PaneRow({ glyph, label, kbd, onClick }: { glyph: string; label: string; kbd?: string; onClick(): void }) {
  return (
    <button className="pane-row" onClick={onClick}>
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
      <div className="pane-eyebrow">Activity</div>
      {items.length === 0 && <div className="pane-empty">Quiet so far. Agents and people show up here as they work.</div>}
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

export function ago(at: number) {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
