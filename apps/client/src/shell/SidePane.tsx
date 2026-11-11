/**
 * The spaces pane, drawn on the floor (the paper and its dots run underneath;
 * the cards stop at its hairline). Folded by the top bar's first button or
 * ⌘\, resized by its right edge.
 *
 * It is where every space is found, whatever its canvas: **Recent** lists them
 * by when this device last opened each, **Folders** files them in project
 * folders (a folder is a path a space carries, "Fans/Rim drive", so a folder
 * exists while something is in it; one made here waits on this device until
 * then). A press opens the space in a tab. Below: the app's own things
 * (release & plan, tools) and you.
 *
 * What belongs to the open space (its people, its activity) is the other pane
 * (SpaceInfo.tsx), opened from the space's tab. Sessions with the agent open
 * from the bottom bar.
 */

import { keys } from "../lib/keys";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { UserInfo } from "@foundation/protocol";
import { appendSectionLocal, requestSnap } from "../state/store";
import { WIDTHS, setUi, spaceOpenedAt, useUi } from "../state/ui";
import { logout } from "../lib/api";
import { initials } from "./Presence";
import { copyMcpCommand } from "./CommandBar";
import { FloorEdge } from "./FloorEdge";
import { KIND_GLYPH, KIND_NAME, type BoardRow, type SpaceKind } from "./Shell";

interface Props {
  user: UserInfo;
  boards: BoardRow[];
  current: string;
  onSwitch(id: string): void;
  onNew(kind?: SpaceKind, folder?: string | null): void;
  onUpdate(id: string, patch: { name?: string; folder?: string | null }): void;
  onUpload(): void;
}

export const paneSpring = { type: "spring", stiffness: 340, damping: 34 } as const;

const EMPTY_FOLDERS = "foundation-folders";
/** folders made on this device that nothing is in yet */
function emptyFolders(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(EMPTY_FOLDERS) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** every folder path there is, parents included, sorted: from the spaces and from the ones waiting on this device */
export function folderPaths(boards: BoardRow[], extra: string[] = []): string[] {
  const all = new Set<string>();
  for (const f of [...boards.map((b) => b.folder), ...extra]) {
    if (!f) continue;
    const parts = f.split("/");
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join("/"));
  }
  return [...all].sort((a, b) => a.localeCompare(b));
}

export function SidePane({ user, boards, current, onSwitch, onNew, onUpdate, onUpload }: Props) {
  const ui = useUi();
  const viewer = user.role === "viewer";
  const [extra, setExtra] = useState(emptyFolders);
  const [shut, setShut] = useState<Set<string>>(() => new Set());
  const [moving, setMoving] = useState<string | null>(null);

  const recent = useMemo(() => {
    const at = spaceOpenedAt();
    return [...boards].sort((a, b) => (at[b.id] ?? b.updated_at ?? 0) - (at[a.id] ?? a.updated_at ?? 0));
    // re-sorted when the open space changes (it just became the most recent)
  }, [boards, current]); // eslint-disable-line react-hooks/exhaustive-deps
  const folders = folderPaths(boards, extra);
  const loose = boards.filter((b) => !b.folder).sort((a, b) => a.name.localeCompare(b.name));

  const addFolder = (parent: string | null) => {
    const name = window.prompt(parent ? `A folder inside ${parent.split("/").pop()}` : "Name the project folder")?.replace(/\//g, " ").trim();
    if (!name) return;
    const next = [...new Set([...extra, parent ? `${parent}/${name}` : name])];
    setExtra(next);
    try {
      localStorage.setItem(EMPTY_FOLDERS, JSON.stringify(next));
    } catch { /* private window */ }
    setUi({ spacesView: "folders" });
  };

  const row = (b: BoardRow, depth = 0) => (
    <div key={b.id} className={`space-row${b.id === current ? " is-current" : ""}`} style={{ paddingLeft: depth * 14 }} data-space-drop={b.id} data-space-name={b.name} data-space-kind={b.kind ?? "grid"}>
      <button className="pane-row space-open" onClick={() => onSwitch(b.id)} data-tip={`${KIND_NAME[b.kind ?? "grid"]}${b.folder ? ` · ${b.folder.replace(/\//g, " › ")}` : ""}`}>
        <span className="pane-glyph">{b.id === "company" ? "◉" : KIND_GLYPH[b.kind ?? "grid"]}</span>
        <span className="pane-label">{b.name}</span>
        {ui.spacesView === "recent" && b.folder && <span className="pane-when">{b.folder.split("/").pop()}</span>}
      </button>
      {!viewer && b.role !== "viewer" && (
        <button className={`space-move${moving === b.id ? " is-on" : ""}`} onClick={() => setMoving(moving === b.id ? null : b.id)} aria-label={`Move ${b.name} to a folder`} data-tip="Move to a folder">
          ▱
        </button>
      )}
      {moving === b.id && (
        <select
          className="space-move-pick"
          autoFocus
          defaultValue={b.folder ?? ""}
          aria-label={`Folder for ${b.name}`}
          onBlur={() => setMoving(null)}
          onChange={(e) => {
            onUpdate(b.id, { folder: e.target.value || null });
            setMoving(null);
            setUi({ spacesView: "folders" });
          }}
        >
          <option value="">No folder</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f.replace(/\//g, " › ")}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  // the tree: a folder row, then (unless shut) its spaces and its folders, one step in
  const tree = (path: string, depth: number): React.ReactNode => {
    const open = !shut.has(path);
    const kids = folders.filter((f) => f.startsWith(path + "/") && f.split("/").length === path.split("/").length + 1);
    const here = boards.filter((b) => b.folder === path).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <div key={path} className="folder">
        <div className="space-row is-folder" style={{ paddingLeft: depth * 14 }}>
          <button
            className="pane-row space-open"
            aria-expanded={open}
            onClick={() =>
              setShut((s) => {
                const n = new Set(s);
                if (n.has(path)) n.delete(path);
                else n.add(path);
                return n;
              })
            }
          >
            <span className={`pane-glyph folder-caret${open ? " is-open" : ""}`}>›</span>
            <span className="pane-label">{path.split("/").pop()}</span>
            <span className="pane-when">{boards.filter((b) => b.folder === path || b.folder?.startsWith(path + "/")).length || ""}</span>
          </button>
          {!viewer && (
            <>
              <button className="space-move" onClick={() => addFolder(path)} aria-label={`New folder in ${path}`} data-tip="New folder inside">
                ▱
              </button>
              <button className="space-move" onClick={() => onNew("grid", path)} aria-label={`New grid space in ${path}`} data-tip="New grid space here">
                ＋
              </button>
            </>
          )}
        </div>
        {open && (
          <>
            {kids.map((k) => tree(k, depth + 1))}
            {here.map((b) => row(b, depth + 1))}
            {kids.length === 0 && here.length === 0 && (
              <div className="pane-empty" style={{ paddingLeft: (depth + 1) * 14 + 8 }}>
                Empty. Move a space here, or ＋ a new one.
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <AnimatePresence initial={false}>
      {ui.pane && (
        <motion.aside key="pane" className="side-pane floor-pane" style={{ width: ui.paneW }} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={paneSpring}>
          <div className="pane-scroll">
            <section className="pane-group">
              <div className="pane-eyebrow">
                Spaces
                {!viewer && (
                  <span className="pane-eyebrow-acts">
                    <button className="pane-eyebrow-act" onClick={() => addFolder(null)} aria-label="New project folder" data-tip="New project folder">
                      ▱
                    </button>
                    <button className="pane-eyebrow-act" onClick={() => onNew("grid")} aria-label="New grid space" data-tip="New grid space">
                      ＋
                    </button>
                  </span>
                )}
              </div>
              <div className="pane-seg" role="tablist" aria-label="How spaces are listed">
                {(["recent", "folders"] as const).map((v) => (
                  <button key={v} role="tab" aria-selected={ui.spacesView === v} className={`pane-seg-btn${ui.spacesView === v ? " is-on" : ""}`} onClick={() => setUi({ spacesView: v })}>
                    {v === "recent" ? "Recent" : "Folders"}
                  </button>
                ))}
              </div>
              {ui.spacesView === "recent" ? (
                recent.map((b) => row(b))
              ) : (
                <>
                  {folders.filter((f) => !f.includes("/")).map((f) => tree(f, 0))}
                  {folders.length > 0 && loose.length > 0 && <div className="pane-sub">Not in a folder</div>}
                  {loose.map((b) => row(b))}
                  {folders.length === 0 && <div className="pane-empty">No project folders yet. ▱ above makes one; ▱ on a space files it.</div>}
                </>
              )}
            </section>

            <section className="pane-group">
              <div className="pane-eyebrow">Release & plan</div>
              <PaneRow glyph="⌗" label="App floorplan" onClick={openFloorplan} />
              <PaneRow glyph="◇" label="The plan" onClick={() => (window.location.hash = "#/settings/plan")} />
              <PaneRow glyph="¶" label="What's new" onClick={() => (window.location.hash = "#/settings/releases")} />
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
          </footer>

          <FloorEdge side="right" value={ui.paneW} {...WIDTHS.pane} onChange={(w) => setUi({ paneW: w })} label="Spaces pane" />
        </motion.aside>
      )}
    </AnimatePresence>
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

export function ago(at: number) {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
