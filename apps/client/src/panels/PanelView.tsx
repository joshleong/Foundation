/**
 * Panels — everything on the grid that isn't a spreadsheet primitive: live
 * apps and web pages, machines, uploaded files, company connectors, agent
 * jobs and Hermes asks. One frame (ObjectFrame), one header vocabulary, ports
 * on the edges for wiring.
 *
 * Performance: a live <iframe> is the most expensive thing on the board, so a
 * frame only mounts while its card is on screen and big enough to read
 * (≥ 0.3 zoom); otherwise a poster stands in. Frames take pointer input only
 * once engaged (click), so panning the grid over them stays smooth.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { MINI_HEADER, emitPort, getState, inputValue, movePanel, removePanel, resizePanel, sectionBodyRect, updatePanel, type PanelMeta } from "../state/store";
import { ObjectFrame } from "../components/ObjectFrame";
import { beginConnect, beginDetach, usePortLayout } from "../shell/AgentLayer";
import { describeValue, landingsOf, toneOf } from "../shell/ports";
import { api, serverUrl, uploadFile } from "../lib/api";
import { askAgent, setUi, toast, useUi } from "../state/ui";
import { onCamera } from "../state/camera";
import { activeBoard } from "../sync/board";
import { StageBody } from "./StageView";
import { onConnectorChange } from "../lib/connectorEvents";

interface Props {
  panel: PanelMeta;
  pos: { x: number; y: number };
  isActive: boolean;
  getScale(): number;
  /** the section hosts this app: it fills the section, ports on the section's edges, no frame of its own */
  hosted?: boolean;
}


const GLYPH: Record<PanelMeta["panel"], string> = {
  app: "◳",
  link: "↗",
  file: "▣",
  machine: "▤",
  agent: "✦",
  connector: "◉",
  ask: "✉",
  stage: "◆",
};

export const PanelView = memo(function PanelView({ panel, pos, isActive, getScale, hosted }: Props) {
  const ui = useUi();
  const layout = usePortLayout(panel);
  const ports = (
    <>
      {panel.ports.map((p) => {
        const l = layout.get(p.id);
        if (!l) return null;
        const connected = l.slots.size > 0;
        const value = p.dir === "out" ? panel.outputs?.[p.id] : inputValue(panel.id, p.id);
        return (
          <div
            key={p.id}
            className={`port port-${p.dir}${connected ? " is-connected" : ""}${value !== undefined ? " has-value" : ""}`}
            data-panel={panel.id}
            data-port-id={p.id}
            data-type={p.type ?? "json"}
            style={{ top: l.y, height: l.height, ["--wire-tone" as string]: toneOf(p.type) }}
            onPointerDown={(e) => (p.dir === "out" ? beginConnect(e, panel.id, p.id) : connected ? beginDetach(e, panel.id, p.id) : undefined)}
          >
            <span className="port-label">
              <b>{p.name}</b>
              <i>{p.type ?? "json"}</i>
              <span className="port-value">{describeValue(value)}</span>
              <span className="port-hint">{p.dir === "out" ? "drag to connect" : connected ? "drag to re-route" : "drop a wire here"}</span>
            </span>
          </div>
        );
      })}
    </>
  );

  const extras = <PanelActions panel={panel} />;

  const body =
    panel.panel === "app" || panel.panel === "link" || panel.panel === "machine" ? (
      <LiveFrame panel={panel} />
    ) : panel.panel === "file" ? (
      <FilePreview panel={panel} />
    ) : panel.panel === "connector" ? (
      <ConnectorBody panel={panel} />
    ) : panel.panel === "ask" ? (
      <AskBody panel={panel} />
    ) : panel.panel === "stage" ? (
      <StageBody panel={panel} />
    ) : (
      <AgentBody panel={panel} />
    );

  if (hosted) {
    // an app section: each wire lands on the edge facing its other end; unwired ports wait on the sides
    const st = getState();
    const sec = st.sections[panel.sectionId];
    const bodyRect = sec ? sectionBodyRect(st.grid, sec) : null;
    const landings = landingsOf(panel.id);
    const hostedPorts = panel.ports.map((p) => {
      const mine = landings.filter((l) => l.port === p.id);
      const value = p.dir === "out" ? panel.outputs?.[p.id] : inputValue(panel.id, p.id);
      const label = (
        <span className="port-label">
          <b>{p.name}</b>
          <i>{p.type ?? "json"}</i>
          <span className="port-value">{describeValue(value)}</span>
          <span className="port-hint">{p.dir === "out" ? "drag to connect" : "drag to re-route"}</span>
        </span>
      );
      if (!mine.length || !bodyRect) {
        const l = layout.get(p.id);
        if (!l) return null;
        return (
          <div
            key={p.id}
            className={`port port-${p.dir}${value !== undefined ? " has-value" : ""}`}
            data-panel={panel.id}
            data-port-id={p.id}
            data-type={p.type ?? "json"}
            style={{ top: l.y, height: l.height, ["--wire-tone" as string]: toneOf(p.type) }}
            onPointerDown={(e) => (p.dir === "out" ? beginConnect(e, panel.id, p.id) : undefined)}
          >
            {label}
          </div>
        );
      }
      return mine.map((l) => (
        <div
          key={l.link}
          className={`port port-${p.dir} port-at-${l.side} is-connected${value !== undefined ? " has-value" : ""}`}
          data-panel={panel.id}
          data-port-id={p.id}
          data-type={p.type ?? "json"}
          style={{ left: l.x - bodyRect.x - 7, right: "auto", top: l.y - bodyRect.y, height: 14, ["--wire-tone" as string]: toneOf(p.type) }}
          onPointerDown={(e) => (p.dir === "out" ? beginConnect(e, panel.id, p.id) : beginDetach(e, panel.id, p.id))}
        >
          {label}
        </div>
      ));
    });
    return (
      <div
        className={`hosted-app panel-card kind-${panel.panel}${panel.status ? ` status-${panel.status}` : ""}${ui.agentLayer ? " show-ports" : ""}`}
        data-panel-id={panel.id}
        data-obj-id={panel.id}
      >
        <div className={`panel-body panel-${panel.panel}`}>
          <div className="panel-inner">{body}</div>
        </div>
        {panel.ports.length > 0 && <div className="port-rail">{hostedPorts}</div>}
      </div>
    );
  }

  return (
    <ObjectFrame
      id={panel.id}
      title={`${GLYPH[panel.panel]}  ${panel.name}`}
      pos={pos}
      width={panel.w}
      float={panel.float}
      isActive={isActive}
      getScale={getScale}
      onMove={(x, y) => movePanel(panel.id, x, y)}
      onResize={(dw, dh) => resizePanel(panel.id, panel.w + dw, panel.h + dh)}
      onRemove={() => removePanel(panel.id)}
      headerExtras={extras}
      bodyClass={`panel-body panel-${panel.panel}`}
      cardClass={`panel-card kind-${panel.panel}${panel.status ? ` status-${panel.status}` : ""}${ui.agentLayer ? " show-ports" : ""}`}
      data={{ "panel-id": panel.id }}
      overlay={panel.ports.length ? <div className="port-rail">{ports}</div> : null}
    >
      <div style={{ height: panel.h }} className="panel-inner">
        {body}
      </div>
    </ObjectFrame>
  );
});

/** a panel's own actions: repo, MCP, open, ask — in its hover bar, or in its host section's header */
export function PanelActions({ panel }: { panel: PanelMeta }) {
  return (
    <>
      {panel.repo && (
        <button className="icon-btn panel-chip" title={`Repository · ${panel.repo}`} onClick={() => openRepo(panel.repo!)}>
          <GithubGlyph />
        </button>
      )}
      {panel.mcp && (
        <button className="icon-btn panel-chip is-mcp" title={`MCP · ${panel.mcp}`} onClick={() => askAgent(`List the MCP tools of “${panel.name}” and tell me what it can do.`)}>
          MCP
        </button>
      )}
      {panel.url && (
        <button className="icon-btn" title="Open in a browser tab" onClick={() => window.open(panel.url, "_blank", "noopener")}>
          ↗
        </button>
      )}
      <button className="icon-btn is-agent" title="Ask the agent about this" onClick={() => askAgent(`About “${panel.name}”: `)}>
        ✦
      </button>
    </>
  );
}

export { GLYPH as PANEL_GLYPH };

// ---------- live frames (apps, links, machines) ----------

function useOnScreen(ref: React.RefObject<HTMLElement | null>, minScale = 0.3) {
  const [visible, setVisible] = useState(false);
  const [bigEnough, setBigEnough] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "200px" });
    io.observe(el);
    const off = onCamera((c) => setBigEnough(c.scale >= minScale));
    return () => {
      io.disconnect();
      off();
    };
  }, [ref, minScale]);
  return visible && bigEnough;
}

function LiveFrame({ panel }: { panel: PanelMeta }) {
  const ui = useUi();
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const live = useOnScreen(host);
  const [loaded, setLoaded] = useState(false);
  const [everLive, setEverLive] = useState(false);
  const engaged = ui.engaged === panel.id;
  useEffect(() => {
    if (live) setEverLive(true);
  }, [live]);

  // Foundation bridge: apps talk to the grid with postMessage
  //   app → grid  { type: "foundation:output", port, value }
  //   grid → app  { type: "foundation:input", port, value } and { type: "foundation:hello", panel, ports }
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { type?: string; port?: string; value?: unknown; ports?: Array<{ name: string; dir: "in" | "out"; type?: string }> };
      if (d?.type === "foundation:output" && d.port) {
        const cur = getState().panels[panel.id];
        let port = cur?.ports.find((p) => p.name === d.port || p.id === d.port);
        if (cur && !port) {
          port = { id: `port_${Math.random().toString(36).slice(2, 9)}`, name: d.port, dir: "out" };
          updatePanel(panel.id, { ports: [...cur.ports, port] });
        }
        if (port) emitPort(panel.id, port.id, d.value);
      } else if (d?.type === "foundation:ports" && Array.isArray(d.ports)) {
        const cur = getState().panels[panel.id];
        if (!cur) return;
        const known = new Set(cur.ports.map((p) => `${p.dir}:${p.name}`));
        const add = d.ports.filter((p) => !known.has(`${p.dir}:${p.name}`)).map((p) => ({ ...p, id: `port_${Math.random().toString(36).slice(2, 9)}` }));
        if (add.length) updatePanel(panel.id, { ports: [...cur.ports, ...add] });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [panel.id]);

  // deliver inputs whenever an upstream value changes
  const inputs = panel.ports.filter((p) => p.dir === "in").map((p) => [p, inputValue(panel.id, p.id)] as const);
  const inputKey = JSON.stringify(inputs.map(([p, v]) => [p.name, v]));
  useEffect(() => {
    const w = frame.current?.contentWindow;
    if (!w || !loaded) return;
    w.postMessage({ type: "foundation:hello", panel: panel.id, ports: panel.ports.map(({ name, dir, type }) => ({ name, dir, type })) }, "*");
    for (const [p, v] of inputs) if (v !== undefined) w.postMessage({ type: "foundation:input", port: p.name, value: v }, "*");
  }, [inputKey, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const [domain, favicon] = useMemo(() => {
    try {
      const u = new URL(panel.url ?? "");
      // the site's own icon — never a third-party favicon service (internal URLs stay internal)
      return [u.host, `${u.origin}/favicon.ico`];
    } catch {
      return [panel.url ?? "", ""];
    }
  }, [panel.url]);

  const mount = Boolean(panel.url) && (live || (everLive && loaded));
  return (
    <div ref={host} className={`live-frame${engaged ? " is-engaged" : ""}`}>
      {mount && (
        <iframe
          ref={frame}
          src={panel.url}
          title={panel.name}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          allow="clipboard-read; clipboard-write; fullscreen; camera; microphone"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
        />
      )}
      {(!mount || !loaded) && (
        <div className="frame-poster">
          {favicon && <img className="frame-favicon" alt="" src={favicon} onError={(e) => (e.currentTarget.style.visibility = "hidden")} />}
          <div className="frame-poster-name">{panel.name}</div>
          <div className="frame-poster-domain">{domain || "no address yet"}</div>
          {panel.text && <div className="frame-poster-text">{panel.text}</div>}
          {mount && !loaded && <div className="frame-poster-loading" />}
        </div>
      )}
      {!engaged && mount && (
        <button className="frame-engage" onClick={() => setUi({ engaged: panel.id })} title="Click to use this app (Esc to return to the grid)">
          <span className="f-pill">Use {panel.panel === "machine" ? "machine" : "app"}</span>
        </button>
      )}
    </div>
  );
}

// ---------- files ----------

const CAD = /\.(step|stp|iges|igs|stl|obj|3mf|glb|gltf|f3d|sldprt|sldasm|x_t|dxf|dwg)$/i;
const TEXTY = /\.(txt|md|markdown|csv|tsv|json|ya?ml|toml|xml|log|js|ts|tsx|py|rs|go)$/i;

function FilePreview({ panel }: { panel: PanelMeta }) {
  const url = panel.fileId ? serverUrl(`/files/${panel.fileId}`) : panel.url;
  const mime = panel.mime ?? "";
  const name = panel.name;
  const [text, setText] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const live = useOnScreen(host, 0.2);

  useEffect(() => {
    if (!live || text !== null || !url) return;
    if (TEXTY.test(name) || mime.startsWith("text/") || CAD.test(name)) {
      if (CAD.test(name) && panel.fileId) {
        api<{ result: string }>(`/api/boards/${activeBoard()?.boardId ?? "company"}/tools/read_file`, { method: "POST", json: { file_id: panel.fileId } })
          .then((r) => setText(r.result))
          .catch(() => setText(""));
      } else {
        fetch(url, { credentials: "include", headers: { range: "bytes=0-8191" } })
          .then((r) => r.text())
          .then(setText)
          .catch(() => setText(""));
      }
    }
  }, [live, url, name, mime, text, panel.fileId]);

  if (panel.status === "running") {
    return (
      <div className="file-uploading">
        <div className="upload-bar" style={{ ["--p" as string]: String(Number(panel.text ?? 0)) }} />
        <span>Uploading {name}…</span>
      </div>
    );
  }
  return (
    <div ref={host} className="file-preview">
      {mime.startsWith("image/") ? (
        <img src={url} alt={name} loading="lazy" decoding="async" />
      ) : mime.startsWith("video/") ? (
        <video src={url} muted loop playsInline controls preload="metadata" />
      ) : mime === "application/pdf" ? (
        live ? <iframe src={url} title={name} /> : <div className="file-card-glyph">PDF</div>
      ) : CAD.test(name) ? (
        <div className="cad-card">
          <div className="cad-glyph">
            <CubeGlyph />
          </div>
          <div className="cad-ext">{name.split(".").pop()?.toUpperCase()}</div>
          {text && <div className="cad-header">{text.slice(0, 220)}</div>}
          <div className="cad-actions">
            <a className="f-pill" href={url} download={name}>
              Download
            </a>
            <button className="f-pill is-agent" onClick={() => askAgent(`Brief Vision on “${name}”: review this CAD, simulate what matters, and ask the right people to review.`)}>
              Send to Vision
            </button>
          </div>
        </div>
      ) : text !== null ? (
        <pre className="file-text">{text.slice(0, 6000)}</pre>
      ) : (
        <div className="file-card-glyph">{name.split(".").pop()?.toUpperCase() ?? "FILE"}</div>
      )}
    </div>
  );
}

// ---------- company connectors ----------

interface ConnectorState {
  ok: boolean;
  summary: string;
  url: string;
  metrics: Array<{ label: string; value: string | number; tone?: "ok" | "warn" | "bad" }>;
  strips?: Array<{ label: string; dots: Array<{ name: string; tone: "ok" | "warn" | "bad" | "idle" }> }>;
  lists?: Array<{ title: string; items: Array<{ text: string; tone?: "ok" | "warn" | "bad" }> }>;
  provenance?: string;
  provenanceLabel?: string;
  live?: boolean;
  checkedAt: number;
}

function ConnectorBody({ panel }: { panel: PanelMeta }) {
  const host = useRef<HTMLDivElement>(null);
  const live = useOnScreen(host, 0.12);
  const [st, setSt] = useState<ConnectorState | null>(null);
  useEffect(() => {
    if (!live || !panel.connector) return;
    let stop = false;
    const load = () =>
      api<ConnectorState>(`/api/connectors/${panel.connector}`)
        .then((s) => !stop && setSt(s))
        .catch(() => {});
    void load();
    const t = setInterval(load, 20_000);
    // pushed changes (FactoryForm's event stream) refetch at once
    const off = onConnectorChange(panel.connector, () => void load());
    return () => {
      stop = true;
      clearInterval(t);
      off();
    };
  }, [live, panel.connector]);
  const offline = st && !st.ok;
  const reason = st?.summary.replace(/^offline — /, "") ?? "";
  return (
    <div ref={host} className={`connector-body${offline ? " is-offline" : ""}`}>
      <div className="connector-head">
        <span className={`connector-status ${!st ? "is-checking" : st.ok ? "is-live" : "is-off"}`}>
          <span className={`f-dot ${!st ? "is-live" : st.ok ? "is-ok is-live" : "is-warn"}`} />
          {!st ? "Checking" : st.ok ? "Live" : "Offline"}
        </span>
        <span className="connector-role">{panel.text}</span>
        {st?.live && (
          <span className="connector-live" title="Updates arrive live from the system's event stream">
            live
          </span>
        )}
        {st?.provenance && (
          <span className="connector-provenance" title={st.provenance}>
            {st.provenanceLabel ?? "demo data"}
          </span>
        )}
      </div>
      {offline ? (
        <div className="connector-offline">
          <div className="connector-offline-title">Not reachable from Foundation</div>
          <div className="connector-offline-reason">{reason}</div>
        </div>
      ) : st && st.metrics.length > 0 ? (
        <>
          <div className="connector-metrics">
            {st.metrics.slice(0, st.strips?.length || st.lists?.length ? 3 : 6).map((m) => (
              <div key={m.label} className={`metric${m.tone ? ` tone-${m.tone}` : ""}`}>
                <div className="metric-value">{m.value}</div>
                <div className="metric-label">{m.label}</div>
              </div>
            ))}
          </div>
          {st.strips?.map((strip) => (
            <div key={strip.label} className="connector-strip" title={strip.label}>
              <span className="connector-strip-label">{strip.label}</span>
              {strip.dots.map((d, i) => (
                <span key={i} className={`strip-dot tone-${d.tone}`} title={d.name} />
              ))}
            </div>
          ))}
          {st.lists?.map((list) => (
            <div key={list.title} className="connector-list">
              <span className="connector-strip-label">{list.title}</span>
              {list.items.map((it, i) => (
                <div key={i} className={`connector-list-item tone-${it.tone ?? "plain"}`}>
                  {it.text}
                </div>
              ))}
            </div>
          ))}
          <div className="connector-summary is-small">{st.summary}</div>
        </>
      ) : (
        <div className="connector-summary">{st ? st.summary : "Reaching the service…"}</div>
      )}
      <div className="connector-foot">
        <button className="f-pill is-agent" onClick={() => askAgent(offline ? `${panel.name} is offline (${reason}). How do we bring it back?` : `What's happening in ${panel.name} right now? Read it and tell me what needs attention.`)}>
          ✦ {offline ? "How do I connect it?" : "What's going on?"}
        </button>
        {st?.url && /^https?:/.test(st.url) && !offline && (
          <button className="f-pill" onClick={() => window.open(st.url, "_blank", "noopener")}>
            Open ↗
          </button>
        )}
        {st && <span className="connector-checked">checked {Math.max(1, Math.round((Date.now() - st.checkedAt) / 1000))}s ago</span>}
      </div>
    </div>
  );
}

// ---------- Hermes asks ----------

function AskBody({ panel }: { panel: PanelMeta }) {
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const done = panel.status === "done";
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (!file || !panel.sessionId) return;
    try {
      const up = await uploadFile(file, activeBoard()?.boardId ?? "company", setProgress);
      await api(`/api/asks/${panel.sessionId}/resolve`, { method: "POST", json: { fileId: up.id } });
      toast(`Thanks — ${file.name} is on the board`, "ok");
    } catch (err) {
      toast((err as Error).message, "bad");
    } finally {
      setProgress(null);
    }
  };
  return (
    <div
      className={`ask-body${over ? " is-over" : ""}${done ? " is-done" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="ask-who">
        <span className="f-eyebrow">{done ? "Answered" : "Waiting on"}</span>
        <span className="ask-assignee">{panel.assignee}</span>
      </div>
      <div className="ask-prompt">{panel.text}</div>
      {done ? (
        panel.fileId ? (
          <a className="f-pill" href={serverUrl(`/files/${panel.fileId}`)} target="_blank" rel="noreferrer">
            Open the file
          </a>
        ) : (
          <span className="ask-note">Resolved</span>
        )
      ) : progress !== null ? (
        <div className="upload-bar" style={{ ["--p" as string]: String(progress) }} />
      ) : (
        <div className="ask-drop">Drop the file here to answer</div>
      )}
    </div>
  );
}

// ---------- agent jobs ----------

function AgentBody({ panel }: { panel: PanelMeta }) {
  const [output, setOutput] = useState<string>("");
  useEffect(() => {
    if (!panel.sessionId || panel.status !== "running") return;
    const t = setInterval(() => {
      api<{ job: { output: string } }>(`/api/jobs/${panel.sessionId}`)
        .then((r) => setOutput(r.job.output))
        .catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, [panel.sessionId, panel.status]);
  const run = () =>
    api(`/api/jobs/${panel.sessionId}/run`, { method: "POST" })
      .then(() => toast("Started", "agent"))
      .catch((e) => toast((e as Error).message, "bad"));
  return (
    <div className="agent-body">
      <div className="agent-status">
        <span className={`f-dot ${panel.status === "running" ? "is-agent is-live" : panel.status === "done" ? "is-ok" : panel.status === "error" ? "is-bad" : ""}`} />
        <span>{panel.status ?? "idle"}</span>
        {panel.sessionId && panel.status !== "running" && panel.status !== "done" && (
          <button className="f-pill is-agent" onClick={run}>
            Run
          </button>
        )}
      </div>
      <pre className="agent-output">{panel.status === "running" ? output.slice(-4000) || "…" : panel.text}</pre>
    </div>
  );
}

// ---------- repo drawer ----------

function openRepo(repo: string) {
  window.dispatchEvent(new CustomEvent("foundation:repo", { detail: repo }));
}

function GithubGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

function CubeGlyph() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
      <path d="M28 6 48 17v22L28 50 8 39V17Z" />
      <path d="M8 17l20 11 20-11M28 28v22" />
    </svg>
  );
}

export const PANEL_HEADER = MINI_HEADER;
