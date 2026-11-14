/**
 * The server switch (SPEC §3 "The server switch"; Josh, 2026-11-13: "an option button at the bottom
 * right to start the local server or connect to the flowform server for local testing. have it expand
 * to show both options"). Collapsed, a glass pill bottom right: a dot for whether the server this app
 * uses answers, and its address. Pressed, it opens upward into both ways to have a server:
 *  - **This computer**: Start runs Foundation's server from a checkout here (the desktop app does it,
 *    src-tauri/src/local_server.rs); once it answers, the app uses it and reloads.
 *  - **Remote server**: an address (Flowform's server to begin with); Connect points the app there and
 *    reloads, to sign in on that server.
 * Shown where the app can point elsewhere (the desktop app, or a page on another site's server),
 * over everything, the sign-in page included. `ServerSwitchView` is presentational for `#/design`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { springs } from "@foundation/ui";
import { BEARER, SERVER, chooseServer } from "../lib/api";
import { inDesktop } from "../update/updater";
import { useUi } from "../state/ui";
import { answers, localStatus, startLocal, stopLocal } from "./desktop";
import { FOLDER_DEFAULT, LOCAL_PORT, LOCAL_SERVER, REMOTE_DEFAULT, isAbsoluteFolder, isLocalServer, pillState, serverOrigin, shortAddress, type LocalPhase, type Reach } from "./model";
import "./server.css";

const FOLDER_KEY = "foundation-server-folder";
const REMOTE_KEY = "foundation-server-remote";

export interface ServerSwitchViewProps {
  open: boolean;
  /** the server this app uses now (an origin) */
  current: string;
  reach: Reach;
  /** the desktop app: it can start a server here */
  desktop: boolean;
  local: LocalPhase;
  /** something answers on this computer's port */
  localListening: boolean;
  /** this app started that server */
  localOurs: boolean;
  folder: string;
  /** why starting failed, in the server's or the app's own words */
  message?: string | null;
  remote: string;
  remoteError?: string | null;
  /** a still for #/design: no glass motion */
  still?: boolean;
  onToggle?: () => void;
  onStart?: () => void;
  onStop?: () => void;
  onUseLocal?: () => void;
  onFolder?: (v: string) => void;
  onRemote?: (v: string) => void;
  onConnect?: () => void;
}

export function ServerSwitchView(p: ServerSwitchViewProps) {
  const currentIsLocal = isLocalServer(p.current);
  const pill = pillState(p.reach, p.local, currentIsLocal);
  const starting = p.local === "starting";
  const panel = (
    <section className="server-switch-panel f-glass" aria-label="Server" id="server-switch-panel">
      <header className="server-switch-head">
        <span className="f-eyebrow">Server</span>
        <span className="server-switch-now">
          <i className="server-switch-dot" data-tone={pill.tone} />
          <code>{shortAddress(p.current)}</code>
          <span>{pill.word}</span>
        </span>
      </header>

      <div className="server-switch-option" data-current={currentIsLocal || undefined}>
        <div className="server-switch-option-head">
          <strong>This computer</strong>
          {currentIsLocal && <span className="server-switch-tag">In use</span>}
        </div>
        <p className="server-switch-lede">
          Foundation’s own server on <code>localhost:{LOCAL_PORT}</code>
          {p.desktop ? ", started from this checkout:" : "."}
        </p>
        {p.desktop && (
          <input
            className="f-input server-switch-field server-switch-folder"
            value={p.folder}
            spellCheck={false}
            aria-label="Foundation checkout folder"
            disabled={starting || p.localOurs}
            onChange={(e) => p.onFolder?.(e.target.value)}
          />
        )}
        {p.local === "failed" && p.message && <p className="server-switch-error">{p.message}</p>}
        <div className="server-switch-actions">
          {p.localListening ? (
            <>
              <span className="server-switch-state">
                <i className="server-switch-dot" data-tone="ok" />
                {p.localOurs ? "Running · started here" : "Running"}
              </span>
              {!currentIsLocal && (
                <button type="button" className="f-pill is-accent" onClick={p.onUseLocal}>
                  Use this server
                </button>
              )}
              {p.localOurs && (
                <button type="button" className="f-pill" onClick={p.onStop}>
                  Stop
                </button>
              )}
            </>
          ) : p.desktop ? (
            <button type="button" className="f-pill is-accent" onClick={p.onStart} disabled={starting} aria-busy={starting || undefined}>
              {starting ? "Starting…" : p.local === "failed" ? "Try again" : "Start the server"}
            </button>
          ) : (
            <span className="server-switch-hint">
              Not running. Start it with <code>npm run dev</code>.
            </span>
          )}
        </div>
      </div>

      <form
        className="server-switch-option"
        data-current={!currentIsLocal || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          p.onConnect?.();
        }}
      >
        <div className="server-switch-option-head">
          <strong>Remote server</strong>
          {!currentIsLocal && <span className="server-switch-tag">In use</span>}
        </div>
        <div className="server-switch-row">
          <input
            className="f-input server-switch-field"
            value={p.remote}
            spellCheck={false}
            inputMode="url"
            aria-label="Remote server address"
            onChange={(e) => p.onRemote?.(e.target.value)}
          />
          <button type="submit" className="f-pill">
            Connect
          </button>
        </div>
        {p.remoteError ? <p className="server-switch-error">{p.remoteError}</p> : <p className="server-switch-hint">Foundation reloads and signs in on that server.</p>}
      </form>
    </section>
  );

  return (
    <div className="server-switch" data-open={p.open || undefined} data-still={p.still || undefined}>
      {p.still ? (
        p.open && panel
      ) : (
        <AnimatePresence>
          {p.open && (
            <motion.div
              key="panel"
              className="server-switch-lift"
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.14 } }}
              transition={{ type: "spring", ...springs.pop }}
            >
              {panel}
            </motion.div>
          )}
        </AnimatePresence>
      )}
      <button
        type="button"
        className="server-switch-pill f-glass"
        aria-expanded={p.open}
        aria-controls="server-switch-panel"
        data-tip={p.open ? undefined : "The server this app uses: start one here, or connect to another"}
        onClick={p.onToggle}
      >
        <i className="server-switch-dot" data-tone={pill.tone} />
        <span className="server-switch-addr">{shortAddress(p.current)}</span>
        <span className="server-switch-caret" aria-hidden>
          {p.open ? "▾" : "▴"}
        </span>
      </button>
    </div>
  );
}

const read = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const keep = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private window */
  }
};

/** the switch itself, mounted once by the app. `day` pins day tokens over the sign-in page. */
export function ServerSwitch({ day = false }: { day?: boolean }) {
  const current = (SERVER || window.location.origin).replace(/\/$/, "");
  const shown = inDesktop || BEARER;
  const ui = useUi();
  const [open, setOpen] = useState(false);
  const [reach, setReach] = useState<Reach>("checking");
  const [local, setLocal] = useState<LocalPhase>("unknown");
  const [listening, setListening] = useState(false);
  const [ours, setOurs] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [folder, setFolder] = useState(() => read(FOLDER_KEY, FOLDER_DEFAULT));
  const [remote, setRemote] = useState(() => read(REMOTE_KEY, isLocalServer(current) ? REMOTE_DEFAULT : current));
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const startingRef = useRef(false);

  // the corner is shared: the call chip and the upload tray move up while the switch is there (server.css)
  useEffect(() => {
    if (!shown || ui.presenting) return;
    document.documentElement.setAttribute("data-server-switch", "");
    return () => document.documentElement.removeAttribute("data-server-switch");
  }, [shown, ui.presenting]);

  // does the server this app uses answer? now, then every 15 s (5 s while open)
  useEffect(() => {
    if (!shown) return;
    let alive = true;
    const check = () => void answers(current).then((ok) => alive && setReach(ok ? "up" : "down"));
    check();
    const t = setInterval(check, open ? 5000 : 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [shown, current, open]);

  // what's on this computer's port: the desktop app asks itself; a page elsewhere asks the port
  const refreshLocal = useCallback(async () => {
    if (inDesktop) {
      const s = await localStatus().catch(() => null);
      if (!s) return;
      setListening(s.listening);
      setOurs(s.ours);
      if (startingRef.current) return;
      if (s.exited) {
        setLocal("failed");
        setMessage(s.exited);
      } else setLocal(s.listening ? "running" : "stopped");
    } else {
      const ok = await answers(LOCAL_SERVER, 1500);
      setListening(ok);
      setLocal(ok ? "running" : "stopped");
    }
  }, []);
  useEffect(() => {
    if (!shown || !open) return;
    void refreshLocal();
    const t = setInterval(() => void refreshLocal(), 3000);
    return () => clearInterval(t);
  }, [shown, open, refreshLocal]);

  // Esc and a press outside put it away
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const down = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", down, true);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", down, true);
    };
  }, [open]);

  const goLocal = () => (isLocalServer(current) ? window.location.reload() : chooseServer(LOCAL_SERVER));

  const start = async () => {
    const f = folder.trim();
    if (!isAbsoluteFolder(f)) {
      setLocal("failed");
      setMessage("Give the checkout's full path, like C:\\Dev\\Foundation.");
      return;
    }
    keep(FOLDER_KEY, f);
    setMessage(null);
    setLocal("starting");
    startingRef.current = true;
    try {
      await startLocal(f);
      // up when it answers; a server stops by itself when it can't start (its log says why)
      const until = Date.now() + 45_000;
      while (Date.now() < until) {
        if (await answers(LOCAL_SERVER, 1500)) {
          startingRef.current = false;
          setLocal("running");
          setListening(true);
          goLocal();
          return;
        }
        const s = await localStatus().catch(() => null);
        if (s?.exited) throw new Error(s.exited);
        await new Promise((r) => setTimeout(r, 700));
      }
      throw new Error("The server didn't answer within 45 seconds. Its log is local-server.log in Foundation's log folder.");
    } catch (e) {
      startingRef.current = false;
      setLocal("failed");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const stop = async () => {
    await stopLocal().catch(() => null);
    setOurs(false);
    setListening(false);
    setLocal("stopped");
    if (isLocalServer(current)) setReach("down");
  };

  const connect = () => {
    const r = serverOrigin(remote);
    if (!r.ok) {
      setRemoteError(r.reason);
      return;
    }
    keep(REMOTE_KEY, r.origin);
    chooseServer(r.origin);
  };

  if (!shown || ui.presenting) return null;
  // beside the search pane when it's open, not over its clipboard
  const right = 16 + (!day && ui.search ? ui.searchW : 0);
  return (
    <div ref={root} className={`server-switch-place${day ? " f-day" : ""}`} style={{ right }}>
      <ServerSwitchView
        open={open}
        current={current}
        reach={reach}
        desktop={inDesktop}
        local={local}
        localListening={listening}
        localOurs={ours}
        folder={folder}
        message={message}
        remote={remote}
        remoteError={remoteError}
        onToggle={() => setOpen((o) => !o)}
        onStart={() => void start()}
        onStop={() => void stop()}
        onUseLocal={goLocal}
        onFolder={setFolder}
        onRemote={(v) => {
          setRemote(v);
          setRemoteError(null);
        }}
        onConnect={connect}
      />
    </div>
  );
}
