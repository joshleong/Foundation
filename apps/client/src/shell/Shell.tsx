/**
 * The Foundation shell: a glass capsule floating over the grid, the grid
 * itself, and the layers above it — the agent layer, ⌘K, the agent dock,
 * presentation mode, the repo drawer and toasts.
 *
 * Keys: ⌘K everything · ⌘J agent · A agent layer · P present · ⌘U upload ·
 * Esc releases an engaged app (then steps up the grid's levels).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { UserInfo } from "@foundation/protocol";
import { isNight, setNight } from "@foundation/ui";
import { GridViewport } from "../components/GridViewport";
import { ContextMenuView } from "../components/ContextMenu";
import { CommandBar } from "./CommandBar";
import { AgentDock } from "./AgentDock";
import { Present } from "./Present";
import { NightOrb } from "./NightOrb";
import { PresenceStack, initials, useBoardTick } from "./Presence";
import { RepoDrawer } from "./RepoDrawer";
import { Mark } from "../login/Login";
import { api } from "../lib/api";
import { ingest } from "../lib/ingest";
import { getState, requestSnap } from "../state/store";
import { getUi, setUi, useUi } from "../state/ui";
import { activeBoard, joinBoard, onBoardChange } from "../sync/board";

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export function Shell({ user }: { user: UserInfo }) {
  const ui = useUi();
  const board = useSyncExternalStore(onBoardChange, activeBoard);
  const [boards, setBoards] = useState<Array<{ id: string; name: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // join the board named in the URL, or the company board
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("board") || localStorage.getItem("foundation-board") || "company";
    joinBoard(id, user);
    const onSwitch = (e: Event) => switchBoard((e as CustomEvent<string>).detail);
    const onUpload = () => fileRef.current?.click();
    window.addEventListener("foundation:board", onSwitch);
    window.addEventListener("foundation:upload", onUpload);
    return () => {
      window.removeEventListener("foundation:board", onSwitch);
      window.removeEventListener("foundation:upload", onUpload);
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api<{ boards: Array<{ id: string; name: string }> }>("/api/boards")
      .then((r) => setBoards(r.boards))
      .catch(() => {});
  }, [board?.boardId]);

  const switchBoard = (id: string) => {
    localStorage.setItem("foundation-board", id);
    const url = new URL(window.location.href);
    url.searchParams.set("board", id);
    window.history.replaceState(null, "", url);
    joinBoard(id, user);
    requestSnap({ kind: "all" });
  };

  const newBoard = async () => {
    const name = window.prompt("Name the new board");
    if (!name) return;
    const { id } = await api<{ id: string }>("/api/boards", { method: "POST", json: { name } });
    setBoards((b) => [{ id, name }, ...b]);
    switchBoard(id);
  };

  // global keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setUi({ command: !getUi().command });
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setUi({ dock: !getUi().dock });
      } else if (mod && e.key.toLowerCase() === "u") {
        e.preventDefault();
        fileRef.current?.click();
      } else if (mod && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setUi({ command: true });
      } else if (e.key === "Escape" && getUi().engaged) {
        e.stopPropagation();
        setUi({ engaged: null });
      } else if (!mod && !typing(e) && !getUi().command && !getUi().presenting) {
        if (e.key === "a" || e.key === "A") setUi({ agentLayer: !getUi().agentLayer });
        else if (e.key === "p" || e.key === "P") setUi({ presenting: true });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // clicking anywhere on the grid releases an engaged app
  useEffect(() => {
    if (!ui.engaged) return;
    const off = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(`[data-panel-id="${ui.engaged}"]`)) setUi({ engaged: null });
    };
    window.addEventListener("pointerdown", off, true);
    return () => window.removeEventListener("pointerdown", off, true);
  }, [ui.engaged]);

  return (
    <div className={`app shell${ui.agentLayer ? " agent-layer-on" : ""}${ui.presenting ? " presenting" : ""}`} onContextMenu={(e) => e.preventDefault()}>
      <motion.header
        className="capsule f-glass"
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 190, damping: 24 }}
      >
        <div className="capsule-brand">
          <Mark size={22} />
          <span className="capsule-name">Foundation</span>
        </div>
        <BoardSwitcher boards={boards} current={board?.boardId ?? ""} onSwitch={switchBoard} onNew={newBoard} />
        <SyncDot />
        <div className="capsule-spacer" />
        <button className="capsule-search" onClick={() => setUi({ command: true })}>
          <span>⌕</span> Search, open, ask… <span className="f-kbd">⌘K</span>
        </button>
        <div className="capsule-spacer" />
        <button className={`f-pill${ui.agentLayer ? " is-agent" : ""}`} onClick={() => setUi({ agentLayer: !ui.agentLayer })} title="The agent layer: who's working where, and how apps are wired (A)">
          ◇ Layer
        </button>
        <button className="f-pill" onClick={() => setUi({ presenting: true })} title="Present (P)">
          ▶ Present
        </button>
        <button className={`f-pill${ui.dock ? " is-agent" : ""}`} onClick={() => setUi({ dock: !ui.dock })} title="Agent (⌘J)">
          ✦ Agent
        </button>
        <PresenceStack />
        <NightOrb onToggle={() => setNight(!isNight())} />
        <span className="me-avatar" style={{ background: user.color }} title={`${user.name} · ${user.email}`}>
          {initials(user.name)}
        </span>
      </motion.header>

      <GridViewport />
      <ActivityFeed />
      <ContextMenuView />
      <CommandBar />
      <AgentDock />
      <Present />
      <RepoDrawer />
      <Toast />

      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) void ingest(getState().activeSectionId, e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function BoardSwitcher({ boards, current, onSwitch, onNew }: { boards: Array<{ id: string; name: string }>; current: string; onSwitch(id: string): void; onNew(): void }) {
  const [open, setOpen] = useState(false);
  const name = boards.find((b) => b.id === current)?.name ?? current;
  return (
    <div className="board-switch">
      <button className="board-switch-btn" onClick={() => setOpen((o) => !o)}>
        {name || "…"} <span className="caret">▾</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="board-menu f-glass"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            onMouseLeave={() => setOpen(false)}
          >
            {boards.map((b) => (
              <button
                key={b.id}
                className={`board-menu-row${b.id === current ? " is-current" : ""}`}
                onClick={() => {
                  setOpen(false);
                  onSwitch(b.id);
                }}
              >
                {b.id === "company" ? "◉ " : ""}
                {b.name}
              </button>
            ))}
            <button
              className="board-menu-row is-new"
              onClick={() => {
                setOpen(false);
                onNew();
              }}
            >
              ＋ New board
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SyncDot() {
  const board = useBoardTick();
  const s = board?.status ?? "connecting";
  const label = s === "live" ? "Live" : s === "offline" ? "Offline — edits will sync when back" : "Connecting…";
  return (
    <span className={`sync-dot sync-${s}`} title={label}>
      <span className={`f-dot ${s === "live" ? "is-ok" : s === "offline" ? "is-warn" : "is-live"}`} />
      {s !== "live" && <span className="sync-label">{s === "offline" ? "Offline" : "Connecting"}</span>}
    </span>
  );
}

function ActivityFeed() {
  const ui = useUi();
  const board = useBoardTick();
  const items = (board?.activity() ?? []).slice(-7).reverse();
  return (
    <AnimatePresence>
      {ui.agentLayer && (
        <motion.div className="activity f-glass" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ type: "spring", stiffness: 260, damping: 28 }}>
          <div className="f-eyebrow">Activity</div>
          {items.length === 0 && <div className="activity-empty">Quiet so far. Agents and people show up here as they work.</div>}
          {items.map((a, i) => (
            <button key={a.at + ":" + i} className={`activity-row role-${a.role}`} onClick={() => a.objectId && requestSnap({ kind: "object", id: a.objectId })}>
              <span className={`f-dot ${a.role === "agent" ? "is-agent" : a.role === "human" ? "is-ok" : ""}`} />
              <span className="activity-who">{a.who}</span>
              <span className="activity-text">{a.text}</span>
              <span className="activity-when">{ago(a.at)}</span>
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ago(at: number) {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function Toast() {
  const ui = useUi();
  return (
    <AnimatePresence>
      {ui.toast && (
        <motion.div
          key={ui.toast.at}
          className={`toast f-glass tone-${ui.toast.tone ?? "plain"}`}
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
        >
          {ui.toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
