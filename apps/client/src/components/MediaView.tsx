import { memo, useEffect, useRef } from "react";
import {
  MediaMeta,
  moveMedia,
  removeMedia,
  resizeMedia,
  setMediaFlag,
} from "../state/store";
import { ObjectFrame } from "./ObjectFrame";
import { useFileSrc } from "../lib/fileSrc";

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
    item.media === "video" ? (
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
    >
      {item.media === "image" ? (
        <img
          src={src}
          alt={item.name}
          style={{ width: item.w, height: item.h }}
          draggable={false}
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

function SoundGlyph({ off }: { off?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 6h2.5l3.5-3v10l-3.5-3h-2.5z" />
      {off ? <path d="M11 6l3.5 4M14.5 6L11 10" /> : <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9" />}
    </svg>
  );
}
