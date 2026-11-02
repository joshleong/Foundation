/**
 * Presence: who's on the board (avatar stack in the bar) and where they are
 * (cursors in world space, counter-scaled so they read the same at any zoom).
 * Agents appear the same way, in the agent violet, ringing what they touch.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { activeBoard, onBoardChange, type PeerState } from "../sync/board";
import { onCamera, onPointer } from "../state/camera";

function useActiveBoard() {
  return useSyncExternalStore(onBoardChange, activeBoard);
}

/** re-render on awareness/status changes of the active board */
export function useBoardTick() {
  const board = useActiveBoard();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!board) return;
    return board.subscribe(() => setTick((t) => t + 1));
  }, [board]);
  return board;
}

export function usePeers(): PeerState[] {
  const board = useBoardTick();
  return board?.peers() ?? [];
}

export function PeerCursors() {
  const board = useBoardTick();
  const layer = useRef<HTMLDivElement>(null);

  // publish my pointer (world coords) to awareness
  useEffect(() => {
    if (!board) return;
    return onPointer((p) => board.setCursor(p));
  }, [board]);

  // counter-scale cursors so they stay screen-sized
  useEffect(
    () =>
      onCamera((c) => {
        layer.current?.style.setProperty("--inv-scale", String(1 / c.scale));
      }),
    [],
  );

  const peers = board?.peers().filter((p) => p.cursor) ?? [];
  return (
    <div ref={layer} className="peer-cursors" aria-hidden>
      {peers.map((p) => (
        <div
          key={p.clientId}
          className={`peer-cursor${p.user.agent ? " is-agent" : ""}`}
          style={{ transform: `translate3d(${p.cursor!.x}px, ${p.cursor!.y}px, 0) scale(var(--inv-scale, 1))`, ["--peer" as string]: p.user.color }}
        >
          <svg width="18" height="20" viewBox="0 0 18 20">
            <path d="M1.5 1.5 L16 9.5 L9.2 11.2 L6 18 Z" fill="var(--peer)" stroke="var(--color-raise)" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <span className="peer-name">{p.user.name}</span>
        </div>
      ))}
    </div>
  );
}

export function PresenceStack({ me }: { me: { name: string; color: string } }) {
  const peers = usePeers();
  const people = [{ clientId: -1, user: { ...me, agent: false } }, ...peers];
  const shown = people.slice(0, 5);
  return (
    <div className="presence-stack" title={people.map((p) => p.user.name).join(", ")}>
      {shown.map((p, i) => (
        <span
          key={p.clientId}
          className={`presence-avatar${p.user.agent ? " is-agent" : ""}`}
          style={{ background: p.user.agent ? undefined : p.user.color, zIndex: 10 - i }}
        >
          {p.user.agent ? "✦" : initials(p.user.name)}
        </span>
      ))}
      {people.length > shown.length && <span className="presence-more">+{people.length - shown.length}</span>}
    </div>
  );
}

export function initials(name: string) {
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
