/**
 * Sign-in: the ASCII wind behind a single glass card. Google when the server
 * has it configured; dev sign-in (name + allowlisted email) for local testing.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { UserInfo } from "@foundation/protocol";
import { isNight, setNight } from "@foundation/ui";
import { initAsciiWind2 } from "./asciiWind2";
import { authConfig, devLogin, serverUrl } from "../lib/api";
import { NightOrb } from "../shell/NightOrb";

export function Login({ onSignedIn }: { onSignedIn(u: UserInfo): void }) {
  const root = useRef<HTMLDivElement>(null);
  const [cfg, setCfg] = useState<{ google: boolean; devLogin: boolean } | null>(null);
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

        {cfg?.google && (
          <a className="f-pill is-primary login-google" href={serverUrl("/auth/google/start")}>
            Continue with Google
          </a>
        )}
        {cfg?.devLogin && (
          <form className="login-form" onSubmit={submit}>
            {cfg.google && <div className="login-or">or, on this machine</div>}
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
