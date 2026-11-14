/**
 * The desktop app's server commands (src-tauri/src/local_server.rs). Only in the desktop app; the
 * page's other code never imports Tauri at load, so this is loaded on first use.
 */

export interface LocalStatus {
  /** something answers on :4410 (this app's server, or one started another way) */
  listening: boolean;
  /** this app started it and it's still running */
  ours: boolean;
  folder: string | null;
  /** the one this app started stopped by itself: its exit and the end of its log */
  exited: string | null;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const localStatus = () => call<LocalStatus>("local_server_status");
export const startLocal = (folder: string) => call<LocalStatus>("start_local_server", { folder });
export const stopLocal = () => call<LocalStatus>("stop_local_server");

/** whether a Foundation server answers at an origin (its public /auth/config), within a few seconds */
export async function answers(origin: string, ms = 3000): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${origin}/auth/config`, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { devLogin?: unknown } | null;
    // a Foundation server says how it signs people in; anything else at that address isn't one
    return !!body && typeof body.devLogin === "boolean";
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
