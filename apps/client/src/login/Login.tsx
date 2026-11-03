/**
 * Sign-in, set in the ASCII wind's own character grid. There is no card: the
 * title, the buttons and the inputs are characters on the field's grid (one
 * page cell = 2×2 wind cells), and the wind keeps out of the cells they use
 * (`asciiWind.holes`). Always in day colours (`.f-day`), whatever the room.
 *
 * The field answers: letters decode in on arrival, typing stirs the wind at
 * the cursor, a press sends a ripple, an error ripples where it is written,
 * and signing in dissolves everything outward from the press, a burning front
 * of glyphs, into the board underneath (App keeps this page over the shell
 * until `onGone`).
 *
 * Google is flowform-server's sign-in, the flowform client's own, with the
 * same server and Google client. In the browser the page goes to flowform and
 * comes back with ?arrive, and this page dissolves on arrival. In the desktop
 * app Google refuses the embedded webview, so the system browser signs in and
 * this window polls, then dissolves when you come back to it. Dev sign-in
 * (name + allowlisted email) is for this machine.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { UserInfo } from "@foundation/protocol";
import { openUrl } from "@tauri-apps/plugin-opener";
import { initAsciiWind2 } from "./asciiWind2";
import { authConfig, devLogin, flowformBegin, flowformPoll, serverUrl } from "../lib/api";

const inDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const GRID_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
/** what a cell shows while it decodes, from the wind's own looks */
const NOISE = "ab0cAde1fEgh2iGjk3lHmn4oKpq5rMst6uRvw7xSyz8nT9eW#%&*+=?";
const SPIN = "|/-\\";

/** the sign-in's width in page cells, where inputs start, and row by row */
const W = 36;
const FIELD = 8;
const FIELD_W = W - FIELD;
const ROW = { eyebrow: 0, title: 1, sub: 2, google: 4, via: 5, or: 7, name: 8, email: 9, enter: 11, status: 12 };
const H = 13;
/** an error or notice wraps onto this many rows from ROW.status */
const STATUS_ROWS = 3;

const INTRO_MS = 1100;
const LEAVE_MS = 1300;
/** how ragged the dissolve front is, css px */
const BAND = 150;

type Grid = {
  width: number;
  height: number;
  /** wind cell origin and size (css px) */
  left: number;
  top: number;
  cw: number;
  ch: number;
  /** page cell */
  uw: number;
  uh: number;
  /** where the sign-in sits, in page cells */
  col0: number;
  row0: number;
  font: number;
  ls: number;
  titleFont: number;
  titleLs: number;
};

/** the grid the wind lays out (asciiWind2 resize), so page cells sit on wind cells */
function measureGrid(el: HTMLElement): Grid {
  const { width, height } = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cellDev = Math.max(5, Math.round(6.5 * dpr));
  const devW = Math.round(width * dpr);
  const devH = Math.round(height * dpr);
  const cols = Math.ceil(devW / cellDev);
  const rows = Math.ceil(devH / (cellDev * 2));
  const cw = cellDev / dpr;
  const ch = cw * 2;
  const left = Math.round((devW - cols * cellDev) / 2) / dpr;
  const top = Math.round((devH - rows * cellDev * 2) / 2) / dpr;
  const uw = cw * 2;
  const uh = ch * 2;
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = `400 100px ${GRID_FONT}`;
  const ratio = ctx.measureText("0").width / 100 || 0.6;
  const font = Math.round((uw * 0.7) / ratio);
  const titleFont = Math.round((uw * 2 * 0.62) / ratio);
  return {
    width,
    height,
    left,
    top,
    cw,
    ch,
    uw,
    uh,
    col0: Math.round((width / 2 - left) / uw - W / 2),
    row0: Math.max(1, Math.round((height * 0.45 - top) / uh - H / 2)),
    font,
    ls: uw - ratio * font,
    titleFont,
    titleLs: uw * 2 - ratio * titleFont,
  };
}

/** words onto rows of at most `width` cells (a word longer than a row is cut) */
function wrap(text: string, width: number, rows: number) {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  const kept = out.slice(0, rows).map((l) => (l.length > width ? `${l.slice(0, width - 3)}...` : l));
  if (out.length > rows) kept[rows - 1] = `${kept[rows - 1].slice(0, width - 3)}...`;
  return kept;
}

/** a stable pseudo-random 0..1 per cell */
function rnd(a: number, b: number) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
const noise = (frame: number, a: number, b: number) => NOISE[Math.floor(rnd(a + frame * 31, b) * NOISE.length)];

/** where the page is in its life: decoding in, at rest, or dissolving out from (ox, oy) */
type Phase = { kind: "intro" | "idle" | "leave"; t: number; frame: number; ox: number; oy: number; radius: number };

export function Login({
  onSignedIn,
  onGone,
  arriving = false,
}: {
  onSignedIn(u: UserInfo): void;
  /** the dissolve has finished; the page can go */
  onGone?(): void;
  /** already signed in (back from flowform): show the page and dissolve at once */
  arriving?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [g, setGrid] = useState<Grid | null>(null);
  const [cfg, setCfg] = useState<{ google: boolean; devLogin: boolean; flowform?: { url: string } } | null>(null);
  const [email, setEmail] = useState(() => localStorage.getItem("foundation-last-email") ?? "");
  const [name, setName] = useState(() => localStorage.getItem("foundation-last-name") ?? "");
  const [status, setStatus] = useState<{ text: string; tone: "bad" | "dim"; at: number } | null>(null);
  const [busy, setBusy] = useState(false);
  /** desktop: waiting on the system browser */
  const [waiting, setWaiting] = useState(false);
  const [focus, setFocus] = useState<"name" | "email" | null>(null);
  const [carets, setCarets] = useState({ name: 0, email: 0, nameScroll: 0, emailScroll: 0 });
  const [pressed, setPressed] = useState<{ which: string; at: number } | null>(null);
  const [phase, setPhase] = useState<Phase>(() => ({ kind: arriving ? "idle" : "intro", t: 0, frame: 0, ox: 0, oy: 0, radius: 0 }));
  const cancelWait = useRef<() => void>(() => {});
  const lastPress = useRef<{ x: number; y: number } | null>(null);
  const leaving = useRef(false);
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  useEffect(() => initAsciiWind2(root.current!, "wind"), []);
  useLayoutEffect(() => {
    const el = root.current!;
    const measure = () => setGrid(measureGrid(el));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => cancelWait.current(), []);

  const hooks = () => root.current?.asciiWind;
  /** page cell → css px (the centre of the cell) */
  const at = useCallback(
    (row: number, col: number) => (g ? { x: g.left + (g.col0 + col + 0.5) * g.uw, y: g.top + (g.row0 + row + 0.5) * g.uh } : { x: 0, y: 0 }),
    [g],
  );

  const say = useCallback(
    (text: string, tone: "bad" | "dim" = "bad") => {
      setStatus({ text, tone, at: performance.now() });
      if (tone === "bad") {
        const p = at(ROW.status, Math.min(W, text.length) / 2);
        root.current?.asciiWind?.tap(p.x, p.y, 0.45);
      }
    },
    [at],
  );

  useEffect(() => {
    authConfig()
      .then(setCfg)
      .catch(() => say("can't reach the server -- npm run dev"));
  }, [say]);

  function press(which: string, row: number) {
    const p = at(row, W / 2);
    lastPress.current = p;
    setPressed({ which, at: performance.now() });
    hooks()?.tap(p.x, p.y, 1);
  }

  // ---------- the clock: one frame loop while anything moves ----------
  const now = performance.now();
  const animating = phase.kind === "intro" || waiting || busy || (status && now - status.at < 700) || (pressed && now - pressed.at < 260);
  useEffect(() => {
    if (!animating || reduced) return;
    let raf = 0;
    const start = performance.now() - (phase.kind === "intro" ? phase.t : 0);
    const loop = () => {
      const t = performance.now() - start;
      setPhase((p) => {
        if (p.kind === "leave") return p; // leave() drives its own frames
        if (p.kind === "intro" && t > INTRO_MS) return { ...p, kind: "idle", t: 0, frame: p.frame + 1 };
        return { ...p, t: p.kind === "intro" ? t : 0, frame: p.frame + 1 };
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animating, reduced]);

  // ---------- the wind keeps out of the cells the page uses ----------
  const lines = useMemo(() => {
    const out: Array<{ row: number; col: number; len: number }> = [
      { row: ROW.eyebrow, col: 0, len: 15 },
      { row: ROW.title, col: 0, len: 20 },
      { row: ROW.sub, col: 0, len: 26 },
    ];
    if (cfg?.flowform || cfg?.google || waiting) out.push({ row: ROW.google, col: 0, len: W }, { row: ROW.via, col: 0, len: 26 });
    if (cfg?.devLogin && !waiting)
      out.push({ row: ROW.or, col: 0, len: W }, { row: ROW.name, col: 0, len: W }, { row: ROW.email, col: 0, len: W }, { row: ROW.enter, col: 0, len: W });
    if (status) wrap(status.text, W, STATUS_ROWS).forEach((l, k) => out.push({ row: ROW.status + k, col: 0, len: l.length }));
    return out;
  }, [cfg, waiting, status]);
  useEffect(() => {
    if (!g) return;
    const send = () =>
      root.current?.asciiWind?.holes(
        lines.map((l) => ({
          x: g.left + (g.col0 + l.col) * g.uw - g.cw,
          y: g.top + (g.row0 + l.row) * g.uh - g.ch / 2,
          width: l.len * g.uw + g.cw * 2,
          height: g.uh + g.ch,
        })),
      );
    send();
    const el = root.current!;
    el.addEventListener("ascii-wind:ready", send);
    return () => el.removeEventListener("ascii-wind:ready", send);
  }, [g, lines]);

  // ---------- signing in: dissolve outward into the board ----------
  const leave = useCallback(
    async (origin?: { x: number; y: number }) => {
      if (leaving.current || !g) return;
      leaving.current = true;
      // back from the system browser: dissolve when the person is looking
      if (!document.hasFocus()) {
        await new Promise<void>((ok) => {
          const t = window.setTimeout(ok, 30_000);
          window.addEventListener("focus", () => (window.clearTimeout(t), ok()), { once: true });
        });
        await new Promise((ok) => setTimeout(ok, 350));
      }
      const o = origin ?? lastPress.current ?? at(H / 2, W / 2);
      const far =
        Math.max(...[[0, 0], [g.width, 0], [0, g.height], [g.width, g.height]].map(([x, y]) => Math.hypot(x - o.x, y - o.y))) + BAND;
      const duration = reduced ? 350 : LEAVE_MS;
      const start = performance.now();
      await new Promise<void>((done) => {
        const step = () => {
          const k = Math.min(1, (performance.now() - start) / duration);
          // slow out of the press, then it runs
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2.2) / 2;
          const radius = e * far;
          root.current?.asciiWind?.dissolve(o.x, o.y, Math.max(1, radius), BAND);
          setPhase((p) => ({ kind: "leave", t: performance.now() - start, frame: p.frame + 1, ox: o.x, oy: o.y, radius }));
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      onGone?.();
    },
    [g, at, reduced, onGone],
  );

  const signedIn = (u: UserInfo, origin?: { x: number; y: number }) => {
    onSignedIn(u);
    void leave(origin);
  };

  // back from flowform in the browser: already in, so go straight through
  useEffect(() => {
    if (!arriving || !g) return;
    const t = setTimeout(() => void leave(at(ROW.title, 10)), 450);
    return () => clearTimeout(t);
  }, [arriving, g, leave, at]);

  const googleDesktop = async () => {
    press("google", ROW.google);
    setStatus(null);
    try {
      const { url, poll, expiresIn } = await flowformBegin();
      await openUrl(url);
      setWaiting(true);
      let live = true;
      cancelWait.current = () => {
        live = false;
        setWaiting(false);
      };
      const until = Date.now() + expiresIn * 1000;
      while (live && Date.now() < until) {
        await new Promise((ok) => setTimeout(ok, 1500));
        if (!live) return;
        const r = await flowformPoll(poll);
        if (r.status === "ok" && r.user) {
          setWaiting(false);
          return signedIn(r.user, at(ROW.google, W / 2));
        }
        if (r.status === "error") throw new Error(r.error ?? "Sign-in didn't finish");
      }
      if (live) throw new Error("sign-in timed out -- try again.");
    } catch (err) {
      say((err as Error).message);
    } finally {
      setWaiting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    press("enter", ROW.enter);
    setBusy(true);
    setStatus(null);
    try {
      const { user } = await devLogin(email.trim(), name.trim());
      localStorage.setItem("foundation-last-email", email.trim());
      localStorage.setItem("foundation-last-name", name.trim());
      signedIn(user, at(ROW.enter, W / 2));
    } catch (err) {
      say((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---------- typing stirs the wind at the cursor ----------
  const track = (which: "name" | "email", el: HTMLInputElement, before?: string) => {
    const caret = el.selectionStart ?? el.value.length;
    const scroll = Math.round(el.scrollLeft / (g?.uw || 1));
    setCarets((c) => ({ ...c, [which]: caret, [`${which}Scroll`]: scroll }));
    if (before === undefined || !g) return;
    const row = which === "name" ? ROW.name : ROW.email;
    const p = at(row, FIELD + Math.min(FIELD_W - 1, caret - scroll));
    const grew = el.value.length >= before.length;
    hooks()?.stir(p.x, p.y, (grew ? 2 : -2) * g.uw, (rnd(caret, row) - 0.5) * g.uh, grew ? 0.55 : 0.4);
  };
  const focusField = (which: "name" | "email", el: HTMLInputElement) => {
    setFocus(which);
    track(which, el);
    if (!g) return;
    const p = at(which === "name" ? ROW.name : ROW.email, FIELD);
    hooks()?.stir(p.x, p.y, FIELD_W * g.uw * 0.5, 0, 0.7);
  };

  if (!g)
    return (
      <div className="login ascii-wind f-day" ref={root} data-ascii-wind>
        <div className="ag-paper" />
      </div>
    );

  const style = {
    "--ag-uw": `${g.uw}px`,
    "--ag-uh": `${g.uh}px`,
    "--ag-fs": `${g.font}px`,
    "--ag-ls": `${g.ls}px`,
    "--ag-title-fs": `${g.titleFont}px`,
    "--ag-title-ls": `${g.titleLs}px`,
  } as React.CSSProperties;
  const pos = (row: number, col: number, len: number) => ({
    left: g.left + (g.col0 + col) * g.uw,
    top: g.top + (g.row0 + row) * g.uh,
    width: len * g.uw,
  });
  const leavingNow = phase.kind === "leave";
  const typesetting = leavingNow || phase.kind === "intro";
  const mask = leavingNow
    ? `radial-gradient(circle at ${phase.ox}px ${phase.oy}px, transparent ${Math.max(0, phase.radius - BAND)}px, #000 ${phase.radius}px)`
    : undefined;

  /** a run of characters at (row, col): decoding in, scrambling on a press, dissolving out */
  const cells = (text: string, row: number, col: number, opts: { pitch?: number; scrambleAt?: number; decodeAt?: number } = {}) => {
    const pitch = opts.pitch ?? 1;
    return [...text]
      .map((c, i) => {
        if (c === " " || reduced) return c;
        const cellCol = col + i * pitch;
        if (phase.kind === "intro") {
          const reveal = 120 + cellCol * 16 + row * 45 + rnd(row, cellCol) * 260;
          if (phase.t < reveal - 200) return " ";
          if (phase.t < reveal) return noise(phase.frame, row, cellCol);
        }
        if (leavingNow) {
          const x = g.left + (g.col0 + cellCol + pitch / 2) * g.uw;
          const y = g.top + (g.row0 + row + 0.5) * g.uh;
          const d = Math.hypot(x - phase.ox, y - phase.oy);
          if (d < phase.radius - BAND * rnd(cellCol, row + 7)) return " ";
          if (d < phase.radius + BAND * 0.2) return noise(phase.frame, row, cellCol);
        }
        if (opts.decodeAt !== undefined) {
          const age = now - opts.decodeAt - i * 14;
          if (age < 0) return " ";
          if (age < 160) return noise(phase.frame, row, cellCol);
        }
        if (opts.scrambleAt !== undefined && now - opts.scrambleAt < 220 && rnd(cellCol, phase.frame) < 0.5) return noise(phase.frame, row, cellCol);
        return c;
      })
      .join("");
  };

  /** `[ label ........ -> ]`, exactly W cells */
  const bracket = (label: string, tail = "->") => {
    const inner = W - 5 - tail.length;
    return `[ ${label.slice(0, inner).padEnd(inner)} ${tail} ]`;
  };
  const scrambleOf = (which: string) => (pressed?.which === which ? pressed.at : undefined);
  const spin = SPIN[Math.floor(phase.frame / 6) % SPIN.length];

  const field = (which: "name" | "email", label: string, value: string, set: (v: string) => void, autoComplete: string, type = "text") => {
    const row = which === "name" ? ROW.name : ROW.email;
    const scroll = carets[`${which}Scroll` as const];
    const caret = carets[which];
    const shown = value.slice(scroll, scroll + FIELD_W);
    const dots = " ".repeat(Math.min(FIELD_W, shown.length)) + ".".repeat(Math.max(0, FIELD_W - shown.length));
    const on = focus === which;
    const cursorCol = Math.min(FIELD_W - 1, Math.max(0, caret - scroll));
    return (
      <>
        <div className={`ag-line ag-label${on ? " is-on" : ""}`} style={pos(row, 0, FIELD)} aria-hidden>
          {cells(`${label.padEnd(6)}> `, row, 0)}
        </div>
        <div className="ag-line ag-faint" style={pos(row, FIELD, FIELD_W)} aria-hidden>
          {cells(dots, row, FIELD)}
        </div>
        {typesetting && (
          <div className="ag-line" style={pos(row, FIELD, FIELD_W)} aria-hidden>
            {cells(shown, row, FIELD)}
          </div>
        )}
        <input
          className="ag-line ag-input"
          style={{ ...pos(row, FIELD, FIELD_W), opacity: typesetting ? 0 : 1 }}
          aria-label={label}
          name={which}
          type={type}
          value={value}
          autoComplete={autoComplete}
          spellCheck={false}
          autoFocus={which === "email" && !arriving}
          required={which === "email"}
          onChange={(e) => {
            const before = value;
            set(e.target.value);
            track(which, e.target, before);
          }}
          onKeyUp={(e) => track(which, e.currentTarget)}
          onSelect={(e) => track(which, e.currentTarget)}
          onFocus={(e) => focusField(which, e.currentTarget)}
          onBlur={() => setFocus((f) => (f === which ? null : f))}
          onKeyDown={(e) => {
            if (which === "name" && e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget.form?.elements.namedItem("email") as HTMLInputElement | null)?.focus();
            }
          }}
        />
        {on && !typesetting && (
          <div className="ag-line ag-cursor" style={pos(row, FIELD + cursorCol, 1)} aria-hidden>
            {value[caret] ?? " "}
          </div>
        )}
      </>
    );
  };

  const google = cfg?.flowform || cfg?.google;
  const googleHref = cfg?.flowform ? serverUrl(`/auth/flowform/start?return=${encodeURIComponent("/?arrive")}`) : serverUrl("/auth/google/start");
  const googleLabel = cells(bracket("continue with google"), ROW.google, 0, { scrambleAt: scrambleOf("google") });

  return (
    <div className={`login ascii-wind f-day${leavingNow ? " is-leaving" : ""}`} ref={root} data-ascii-wind style={style}>
      <div className="ag-paper" style={mask ? { WebkitMaskImage: mask, maskImage: mask } : undefined} />

      <div className="ag-line ag-eyebrow" style={pos(ROW.eyebrow, 0, 15)}>
        {cells("form industries", ROW.eyebrow, 0)}
      </div>
      <h1 className="ag-line ag-title" style={pos(ROW.title, 0, 20)} aria-label="Foundation">
        {cells("FOUNDATION", ROW.title, 0, { pitch: 2 })}
      </h1>
      <div className="ag-line ag-dim" style={pos(ROW.sub, 0, 26)}>
        {cells("the company's shared grid.", ROW.sub, 0)}
      </div>

      {waiting ? (
        <>
          <div className="ag-line" style={pos(ROW.google, 0, W)} role="status">
            {cells(bracket("finish signing in, in your browser", spin), ROW.google, 0)}
          </div>
          <button className="ag-line ag-button" style={pos(ROW.via, 0, 10)} onClick={() => cancelWait.current()}>
            {cells("[ cancel ]", ROW.via, 0)}
          </button>
        </>
      ) : (
        google && (
          <>
            {inDesktop && cfg?.flowform ? (
              <button className="ag-line ag-button" style={pos(ROW.google, 0, W)} onClick={googleDesktop}>
                {googleLabel}
              </button>
            ) : (
              <a className="ag-line ag-button" style={pos(ROW.google, 0, W)} href={googleHref} onClick={() => press("google", ROW.google)}>
                {googleLabel}
              </a>
            )}
            <div className="ag-line ag-dim" style={pos(ROW.via, 0, 26)}>
              {cells("  same sign-in as flowform", ROW.via, 0)}
            </div>
          </>
        )
      )}

      {cfg?.devLogin && !waiting && (
        <form onSubmit={submit}>
          <div className="ag-line ag-faint" style={pos(ROW.or, 0, W)} aria-hidden>
            {cells(`-- ${google ? "or, on this machine" : "on this machine"} `.padEnd(W, "-"), ROW.or, 0)}
          </div>
          {field("name", "name", name, setName, "name")}
          {field("email", "email", email, setEmail, "email", "email")}
          <button className="ag-line ag-button" style={pos(ROW.enter, 0, W)} disabled={busy || !email}>
            {cells(bracket(busy ? "entering" : "enter foundation", busy ? `${spin} ` : "->"), ROW.enter, 0, { scrambleAt: scrambleOf("enter") })}
          </button>
        </form>
      )}

      {status && (
        <div role="alert" aria-label={status.text}>
          {wrap(status.text, W, STATUS_ROWS).map((l, k) => (
            <div key={k} className={`ag-line ag-${status.tone}`} style={pos(ROW.status + k, 0, W)} aria-hidden>
              {cells(l, ROW.status + k, 0, { decodeAt: status.at + k * 120 })}
            </div>
          ))}
        </div>
      )}

      <div className="ag-foot">move the cursor -- it's the wind.</div>
    </div>
  );
}

export function Mark({ size = 30 }: { size?: number }) {
  // the Foundation mark: a grid cell lifting off the paper
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="4" y="4" width="10" height="10" rx="2" fill="currentColor" opacity=".9" />
      <rect x="18" y="4" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" opacity=".55" />
      <rect x="4" y="18" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" opacity=".55" />
      <rect x="18" y="18" width="10" height="10" rx="2" fill="var(--color-pulse)" />
    </svg>
  );
}
