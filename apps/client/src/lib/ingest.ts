/**
 * Every file that lands on Foundation goes to the server (shared, searchable,
 * archived). Images and videos show at once from a local blob while the
 * upload runs, then swap to the shared URL; other files become file panels
 * with an upload bar — CAD included.
 */

import { addMedia, addPanel, setMediaSrc, updatePanel } from "../state/store";
import { uploadFile } from "./api";
import { activeBoard } from "../sync/board";
import { toast } from "../state/ui";

/** read natural media dimensions so cards start with the right aspect */
function probeMedia(file: File): Promise<{ src: string; w: number; h: number }> {
  const src = URL.createObjectURL(file);
  return new Promise((resolve) => {
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => resolve({ src, w: v.videoWidth || 640, h: v.videoHeight || 360 });
      v.onerror = () => resolve({ src, w: 640, h: 360 });
      v.src = src;
    } else {
      const img = new Image();
      img.onload = () => resolve({ src, w: img.naturalWidth || 480, h: img.naturalHeight || 360 });
      img.onerror = () => resolve({ src, w: 480, h: 360 });
      img.src = src;
    }
  });
}

export async function ingest(sectionId: string, files: FileList | File[]) {
  const board = activeBoard()?.boardId ?? "company";
  await Promise.all(
    [...files].map(async (file) => {
      try {
        if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
          const kind = file.type.startsWith("video/") ? "video" : "image";
          const { src, w, h } = await probeMedia(file);
          const m = addMedia(sectionId, src, kind, file.name, w, h);
          const up = await uploadFile(file, board);
          setMediaSrc(m.id, up.url);
        } else {
          const p = addPanel(sectionId, { panel: "file", name: file.name, mime: file.type, status: "running", text: "0" });
          const up = await uploadFile(file, board, (f) => updatePanel(p.id, { text: f.toFixed(2) }));
          updatePanel(p.id, { fileId: up.id, mime: up.mime, status: undefined, text: undefined });
        }
      } catch (e) {
        toast(`${file.name}: ${(e as Error).message}`, "bad");
      }
    }),
  );
}
