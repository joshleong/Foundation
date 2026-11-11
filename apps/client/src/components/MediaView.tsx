import { memo, useEffect, useRef, useState } from "react";
import { isNight, onNight } from "@foundation/ui";
import {
  MediaMeta,
  moveMedia,
  removeMedia,
  resizeMedia,
  setMediaFlag,
} from "../state/store";
import { ObjectFrame } from "./ObjectFrame";
import { useFileSrc } from "../lib/fileSrc";
import { fetchFile } from "../lib/api";

interface Props {
  item: MediaMeta;
  pos: { x: number; y: number };
  isActive: boolean;
  getScale(): number;
}

export const MediaView = memo(function MediaView({ item, pos, isActive, getScale }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // shared media lives on the server (/files/…): loaded from the configured server, with this device's session
  const src = useFileSrc(item.src);
  const [loaded, setLoaded] = useState(false);
  // a drawing on a clear ground can be shown inverted on a dark one
  const clear = useHasAlpha(item.media === "image" ? item.src : null, item.name);
  const night = useNight();

  // keep the <video> element in line with the autoplay/mute flags
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = item.muted;
    if (item.autoplay) {
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [item.autoplay, item.muted]);

  // the chrome is a couple of round icons that slide out from behind the card on hover
  const icons =
    item.media === "image" ? (
      clear && (night || item.invert) ? (
        <button
          className={"frame-icon" + (item.invert ? " is-on" : "")}
          data-tip={item.invert ? "Show as it is on dark" : "Invert on dark"}
          aria-label={item.invert ? "Show as it is on dark" : "Invert on dark"}
          aria-pressed={!!item.invert}
          onClick={() => setMediaFlag(item.id, { invert: !item.invert })}
        >
          <InvertGlyph />
        </button>
      ) : null
    ) : item.media === "video" ? (
      <button
        className={"frame-icon" + (item.muted ? "" : " is-on")}
        data-tip={item.muted ? "Turn sound on" : "Mute"}
        aria-label={item.muted ? "Turn sound on" : "Mute"}
        onClick={() => setMediaFlag(item.id, { muted: !item.muted })}
      >
        {item.muted ? <SoundGlyph off /> : <SoundGlyph />}
      </button>
    ) : null;

  return (
    <ObjectFrame
      id={item.id}
      title={item.name}
      pos={pos}
      width={item.w}
      float={item.float}
      isActive={isActive}
      getScale={getScale}
      onMove={(x, y) => moveMedia(item.id, x, y)}
      onResize={(dw, dh) => resizeMedia(item.id, item.w + dw, item.h + dh)}
      onRemove={() => removeMedia(item.id)}
      chrome="icons"
      icons={icons}
      onTap={item.media === "video" ? () => setMediaFlag(item.id, { autoplay: !item.autoplay }) : undefined}
      bodyClass="media-body"
      cardClass={"media-card" + (clear ? " is-clear" : "")}
    >
      {item.media === "image" ? (
        <img
          src={src}
          alt={item.name}
          className={(loaded ? "is-loaded" : "") + (item.invert ? " is-inverted" : "")}
          style={{ width: item.w, height: item.h }}
          draggable={false}
          onLoad={() => setLoaded(true)}
        />
      ) : (
        <video
          ref={videoRef}
          src={src}
          style={{ width: item.w, height: item.h }}
          muted={item.muted}
          autoPlay={item.autoplay}
          loop
          playsInline
        />
      )}
    </ObjectFrame>
  );
});

/** the room is dark */
function useNight() {
  const [night, set] = useState(isNight);
  useEffect(() => {
    const off = onNight(set);
    return () => {
      off();
    };
  }, []);
  return night;
}

/**
 * Whether an image has see-through pixels (read once per file, from a 48 px
 * sample). Only formats that can be clear are read; an SVG is assumed clear.
 */
const alphaCache = new Map<string, Promise<boolean>>();
const CAN_BE_CLEAR = /\.(png|gif|webp|avif|svg)(\?|#|$)/i;
function useHasAlpha(src: string | null, name: string): boolean {
  const [clear, setClear] = useState(false);
  useEffect(() => {
    if (!src || !(CAN_BE_CLEAR.test(name) || CAN_BE_CLEAR.test(src) || src.startsWith("blob:") || src.startsWith("data:image/png"))) return;
    let alive = true;
    let p = alphaCache.get(src);
    if (!p) {
      p = readAlpha(src, name).catch(() => false);
      alphaCache.set(src, p);
    }
    void p.then((v) => alive && setClear(v));
    return () => {
      alive = false;
    };
  }, [src, name]);
  return clear;
}
async function readAlpha(src: string, name: string): Promise<boolean> {
  const res = src.startsWith("/files/") ? await fetchFile(src) : await fetch(src);
  if (!res.ok) return false;
  const blob = await res.blob();
  if (blob.type.includes("svg") || /\.svg$/i.test(name)) return true;
  const bmp = await createImageBitmap(blob);
  const n = 48;
  const c = new OffscreenCanvas(n, n);
  const ctx = c.getContext("2d");
  if (!ctx) return false;
  ctx.drawImage(bmp, 0, 0, n, n);
  bmp.close();
  const d = ctx.getImageData(0, 0, n, n).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

function InvertGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SoundGlyph({ off }: { off?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 6h2.5l3.5-3v10l-3.5-3h-2.5z" />
      {off ? <path d="M11 6l3.5 4M14.5 6L11 10" /> : <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9" />}
    </svg>
  );
}
