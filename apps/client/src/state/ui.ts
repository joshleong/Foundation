/**
 * Shell UI state — what's open, which layer is showing. Tiny external store;
 * nothing here is shared with other people (that's the board doc).
 */

import { useSyncExternalStore } from "react";

export interface UiState {
  /** the meta layer: agents, presence rings, app port wires */
  agentLayer: boolean;
  command: boolean;
  /** the agent dock's open state, and text queued into it */
  dock: boolean;
  dockDraft: string;
  presenting: boolean;
  view: "grid" | "company";
  /** a card whose app frame is "engaged" (live input); others show a still */
  engaged: string | null;
  toast: { text: string; tone?: "ok" | "warn" | "bad" | "agent"; at: number } | null;
}

let ui: UiState = {
  agentLayer: false,
  command: false,
  dock: false,
  dockDraft: "",
  presenting: false,
  view: "grid",
  engaged: null,
  toast: null,
};
const listeners = new Set<() => void>();

export function getUi() {
  return ui;
}
export function setUi(patch: Partial<UiState>) {
  ui = { ...ui, ...patch };
  for (const fn of listeners) fn();
}
export function useUi(): UiState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => ui,
  );
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(text: string, tone?: NonNullable<UiState["toast"]>["tone"]) {
  setUi({ toast: { text, tone, at: Date.now() } });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setUi({ toast: null }), 3600);
}

export function askAgent(text: string) {
  setUi({ dock: true, dockDraft: text, command: false });
}
