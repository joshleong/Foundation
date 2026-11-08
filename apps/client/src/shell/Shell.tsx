/**
 * The Foundation shell: the grid edge to edge, and the floor drawn on its
 * paper — the top bar (fold, tabs, tools), the side pane (sessions, boards,
 * activity, settings), an open session beside the grid, and search at the
 * right — then the layers above: the agent layer, ⌘K, presentation mode, the
 * repo drawer and toasts.
 *
 * Keys (⌘ is Ctrl off a Mac, and lib/keys.ts labels it so): ⌘K commands · ⌘F search · ⌘\ side pane · ⌘J new agent session · ⌘1 the board ·
 * ⌘2…9 tabs · ⌘W close the tab · A agent layer · P present · ⌘U upload ·
 * Esc releases an engaged app (then steps up the grid's levels).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { UserInfo } from "@foundation/protocol";
import { GridViewport } from "../components/GridViewport";
import { ContextMenuView } from "../components/ContextMenu";
import { CommandBar } from "./CommandBar";
import { TopBar } from "./TopBar";
import { SessionView, TouchedRings } from "./SessionView";
import { SearchPane } from "./SearchPane";
import { toggleTalk } from "./Talk";
import { Present } from "./Present";
import { RepoDrawer } from "./RepoDrawer";
import { HuddlePip } from "./HuddlePip";
import { SidePane } from "./SidePane";
import { api } from "../lib/api";
import { ingest } from "../lib/ingest";
import { getState, requestSnap } from "../state/store";
import { closeTab, getUi, newSession, setUi, useUi } from "../state/ui";
import { activeBoard, joinBoard, onBoardChange } from "../sync/board";

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export interface BoardRow {
  id: string;
  name: string;
  role: "admin" | "member" | "viewer";
}

export function Shell({ user }: { user: UserInfo }) {
  const ui = useUi();
  const board = useSyncExternalStore(onBoardChange, activeBoard);
  // the board list is kept on the device too, so names (and roles) show offline
  const [boards, setBoards] = useState<BoardRow[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("foundation-boards") ?? "[]") as BoardRow[];
    } catch {
      return [];
    }
  });
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
    const load = () =>
      api<{ boards: BoardRow[] }>("/api/boards")
        .then((r) => {
          setBoards(r.boards);
          try {
            localStorage.setItem("foundation-boards", JSON.stringify(r.boards));
          } catch { /* private window */ }
        })
        .catch(() => {});
    void load();
    window.addEventListener("foundation:boards", load);
    return () => window.removeEventListener("foundation:boards", load);
  }, [board?.boardId]);

  // my role on this board: a viewer reads (the server drops their writes; edits snap back here)
  const role = boards.find((b) => b.id === board?.boardId)?.role ?? (user.role === "viewer" ? "viewer" : "member");
  useEffect(() => {
    board?.setReadOnly(role === "viewer");
    setUi({ role });
    document.body.classList.toggle("is-viewer", role === "viewer");
  }, [board, role]);

  // ?focus=<card or section> (links sent to Slack, Hermes nudges): frame it once it has synced
  useEffect(() => {
    const url = new URL(window.location.href);
    const focus = url.searchParams.get("focus");
    if (!focus || !board) return;
    const t0 = Date.now();
    const tick = setInterval(() => {
      const st = getState();
      const kind = st.sections[focus] ? "section" : st.panels[focus] || st.notes[focus] || st.tables[focus] || st.maps[focus] || st.media[focus] ? "object" : null;
      if (!kind && Date.now() - t0 < 15_000) return;
      clearInterval(tick);
      if (kind) requestSnap({ kind, id: focus });
      url.searchParams.delete("focus");
      window.history.replaceState(null, "", url);
    }, 250);
    return () => clearInterval(tick);
  }, [board?.boardId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setBoards((b) => [{ id, name, role: user.role === "admin" ? "admin" : "member" }, ...b]);
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
        newSession();
      } else if (mod && e.key.toLowerCase() === "f" && !e.shiftKey) {
        e.preventDefault();
        setUi({ search: !getUi().search });
      } else if (mod && e.key.toLowerCase() === "w" && getUi().tab) {
        e.preventDefault();
        closeTab(getUi().tab!);
      } else if (mod && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const n = Number(e.key);
        setUi({ tab: n === 1 ? null : (getUi().tabs[n - 2]?.id ?? getUi().tab) });
      } else if (mod && e.key.toLowerCase() === "u") {
        e.preventDefault();
        fileRef.current?.click();
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        setUi({ pane: !getUi().pane });
      } else if (mod && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setUi({ command: true });
      } else if (e.key === "Escape" && getUi().engaged) {
        e.stopPropagation();
        setUi({ engaged: null });
      } else if (!mod && !typing(e) && !getUi().command && !getUi().presenting) {
        if (e.key === "a" || e.key === "A") setUi({ agentLayer: !getUi().agentLayer });
        else if (e.key === "v" || e.key === "V") toggleTalk();
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
      <GridViewport />
      {!ui.presenting && <TopBar boardName={boards.find((b) => b.id === board?.boardId)?.name ?? board?.boardId ?? ""} />}
      {!ui.presenting && <SidePane user={user} boards={boards} current={board?.boardId ?? ""} onSwitch={switchBoard} onNew={newBoard} onUpload={() => fileRef.current?.click()} />}
      <SessionView />
      <SearchPane />
      <TouchedRings />
      <ContextMenuView />
      <CommandBar />
      <Present />
      <RepoDrawer />
      <HuddlePip />
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
