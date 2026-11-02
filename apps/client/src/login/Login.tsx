/**
 * Sign-in: the ASCII wind behind a single glass card. Google through
 * flowform-server — the flowform client's own sign-in, same server, same Google
 * client; dev sign-in (name + allowlisted email) for local testing.
 *
 * In the browser the page goes to flowform and comes back signed in. In the
 * desktop app Google refuses the embedded webview, so the system browser does
 * the sign-in and this window polls until it's done.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { UserInfo } from "@foundation/protocol";
import { isNight, setNight } from "@foundation/ui";
import { initAsciiWind2 } from "./asciiWind2";
import { openUrl } from "@tauri-apps/plugin-opener";
import { authConfig, devLogin, flowformBegin, flowformPoll, serverUrl } from "../lib/api";
import { NightOrb } from "../shell/NightOrb";

const inDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function Login({ onSignedIn }: { onSignedIn(u: UserInfo): void }) {
  const root = useRef<HTMLDivElement>(null);
  const [cfg, setCfg] = useState<{ google: boolean; devLogin: boolean; flowform?: { url: string } } | null>(null);
  /** desktop: waiting on the system browser */
  const [waiting, setWaiting] = useState(false);
  const cancelWait = useRef<() => void>(() => {});
  const [email, setEmail] = useState(() => localStorage.getItem("foundation-last-email") ?? "");
  const [name, setName] = useState(() => localStorage.getItem("foundation-last-name") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // the wind follows night through the tokens on its own
  useEffect(() => initAsciiWind2(root.current!, "wind"), []);

  useEffect(() => {
    authConfig()
      .then(setCfg)
      .catch(() => setError("Can't reach the Foundation server. Start it with `npm run dev`."));
  }, []);

  useEffect(() => () => cancelWait.current(), []);

  const googleDesktop = async () => {
    setError(null);
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
        if (r.status === "ok" && r.user) return onSignedIn(r.user);
        if (r.status === "error") throw new Error(r.error ?? "Sign-in didn't finish");
      }
      if (live) throw new Error("Sign-in timed out — try again.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWaiting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await devLogin(email.trim(), name.trim());
      localStorage.setItem("foundation-last-email", email.trim());
      localStorage.setItem("foundation-last-name", name.trim());
      onSignedIn(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login ascii-wind" ref={root} data-ascii-wind>
      <div className="login-orb">
        <NightOrb onToggle={() => setNight(!isNight())} />
      </div>
      <motion.div
        className="login-card f-glass"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 170, damping: 26, delay: 0.25 }}
      >
        <div className="login-mark">
          <Mark />
        </div>
        <div className="f-eyebrow">Form Industries</div>
        <h1 className="login-title">Foundation</h1>
        <p className="login-sub">The company's shared grid — people, apps and agents, building together.</p>

        {waiting ? (
          <div className="login-waiting">
            <p>Finish signing in with Google in your browser.</p>
            <button className="f-pill login-google" onClick={() => cancelWait.current()}>
              Cancel
            </button>
          </div>
        ) : cfg?.flowform ? (
          inDesktop ? (
            <button className="f-pill is-primary login-google" onClick={googleDesktop}>
              Continue with Google
            </button>
          ) : (
            <a className="f-pill is-primary login-google" href={serverUrl("/auth/flowform/start")}>
              Continue with Google
            </a>
          )
        ) : (
          cfg?.google && (
            <a className="f-pill is-primary login-google" href={serverUrl("/auth/google/start")}>
              Continue with Google
            </a>
          )
        )}
        {(cfg?.flowform || cfg?.google) && !waiting && <div className="login-via">Same sign-in as Flowform</div>}
        {cfg?.devLogin && !waiting && (
          <form className="login-form" onSubmit={submit}>
            {(cfg.flowform || cfg.google) && <div className="login-or">or, on this machine</div>}
            <input className="f-input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            <input
              className="f-input"
              placeholder="Work email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
            />
            <button className="f-pill is-primary login-go" disabled={busy || !email}>
              {busy ? "Signing in…" : "Enter Foundation"}
            </button>
          </form>
        )}
        {error && <div className="login-error">{error}</div>}
        {!cfg && !error && <div className="login-wait" />}
      </motion.div>
      <div className="login-foot">Move the cursor — it's the wind.</div>
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
