/**
 * An empty section shouldn't be a void: it offers the three ways work arrives
 * (open an app, drop files, ask the agent) and a shelf of the company's
 * registered apps, one click from being live in this section.
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { askAgent, setUi } from "../state/ui";
import { openUrlAsPanel } from "../shell/CommandBar";

interface AppRow {
  id: string;
  name: string;
  url: string | null;
  repo: string | null;
  mcp: string | null;
  description: string | null;
}

let shelfCache: AppRow[] | null = null;
let shelfPromise: Promise<AppRow[]> | null = null;
function loadShelf() {
  shelfPromise ??= api<{ apps: AppRow[] }>("/api/apps")
    .then((r) => (shelfCache = r.apps.filter((a) => a.url)))
    .catch(() => (shelfCache = []));
  return shelfPromise;
}

export function SectionEmpty({ name, onUpload, onNote, onFocus }: { name: string; onUpload(): void; onNote(): void; onFocus(): void }) {
  const [apps, setApps] = useState<AppRow[]>(shelfCache ?? []);
  useEffect(() => {
    if (!shelfCache) void loadShelf().then(setApps);
  }, []);

  return (
    <div className="section-empty" onPointerDown={(e) => e.stopPropagation()}>
      <div className="empty-card">
        <div className="f-eyebrow">{name}</div>
        <div className="empty-title">Bring work here</div>
        <div className="empty-actions">
          <button
            className="empty-action"
            onClick={() => {
              onFocus();
              setUi({ command: true });
            }}
          >
            <span className="empty-glyph">◳</span>
            <span>
              <b>Open an app or link</b>
              <small>Paste a URL — it finds the repo, MCP and ports</small>
            </span>
            <span className="f-kbd">⌘L</span>
          </button>
          <button className="empty-action" onClick={onUpload}>
            <span className="empty-glyph">⇪</span>
            <span>
              <b>Drop files</b>
              <small>Designs, CAD, PDFs, video — or drag them here</small>
            </span>
            <span className="f-kbd">⌘U</span>
          </button>
          <button className="empty-action is-agent" onClick={() => askAgent(`Set up the “${name}” section: `)}>
            <span className="empty-glyph">✦</span>
            <span>
              <b>Ask the agent to build it</b>
              <small>It can organize, open apps and chase people for CAD</small>
            </span>
            <span className="f-kbd">⌘J</span>
          </button>
          <button className="empty-action" onClick={onNote}>
            <span className="empty-glyph">▤</span>
            <span>
              <b>Write a note</b>
              <small>Markdown, searchable by everyone</small>
            </span>
          </button>
        </div>
        {apps.length > 0 && (
          <>
            <div className="f-eyebrow empty-shelf-label">Company apps</div>
            <div className="empty-shelf">
              {apps.slice(0, 8).map((a) => (
                <button
                  key={a.id}
                  className="shelf-app"
                  title={a.description ?? a.url ?? ""}
                  onClick={() => {
                    onFocus();
                    void openUrlAsPanel(a.url!, "app", a);
                  }}
                >
                  <span className="shelf-mark">{a.name.slice(0, 1)}</span>
                  {a.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
