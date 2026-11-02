/**
 * One shared stream of connector changes from the server (FactoryForm's live
 * events, relayed), so a connector card refetches the moment its system
 * changes instead of waiting for its 20 s poll.
 */

import { serverUrl } from "./api";

const listeners = new Map<string, Set<() => void>>();
let source: EventSource | null = null;

function ensure() {
  if (source) return;
  source = new EventSource(serverUrl("/api/connectors/events"), { withCredentials: true });
  source.onmessage = (e) => {
    try {
      const { id } = JSON.parse(e.data) as { id: string };
      listeners.get(id)?.forEach((fn) => fn());
    } catch {
      /* keep-alive */
    }
  };
}

export function onConnectorChange(id: string, fn: () => void) {
  ensure();
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(fn);
  return () => {
    listeners.get(id)?.delete(fn);
  };
}
