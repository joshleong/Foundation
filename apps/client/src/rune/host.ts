/**
 * The client's half of the Rune renderer: loads the wasm module (built from
 * apps/rune by `npm run rune:build` into public/rune/), mounts it on a canvas,
 * keeps it fed with the board (scene.ts) and the camera, and turns what it
 * reports back into the store's own actions.
 *
 * The store stays the board's one writer: sync, viewers, undo and the
 * invariants all live behind it, and Rune never touches them.
 */

import { onNight } from "@foundation/ui";
import { workbook } from "../engine/workbook";
import { camera, onCamera } from "../state/camera";
import {
  CONTENT_PAD,
  SECTION_HEADER,
  addNote,
  createSectionAt,
  createTable,
  getState,
  moveMap,
  moveMedia,
  moveNote,
  movePanel,
  moveTable,
  sectionCardRect,
  sectionFit,
  setActiveObject,
  setActiveSection,
  setObjectFloat,
  subscribe,
  updateNoteText,
} from "../state/store";
import { floorInsets, getUi } from "../state/ui";
import { getRuneStatus, setRuneStatus, type RuneBuild } from "./engine";
import { runeImageSrc } from "./imageSrc";
import { SCENE_VERSION, TOKEN_VARS, buildScene, type Rgba, type SceneTokens } from "./scene";

const BASE = `${import.meta.env.BASE_URL}rune/`;

/** the wasm module's exports (apps/rune/src/lib.rs) */
interface RuneModule {
  default(input: { module_or_path: string }): Promise<unknown>;
  sceneVersion(): number;
  mount(canvasId: string, transparent: boolean, onEvent: (json: string) => void): void;
  setScene(json: string): void;
  setCamera(x: number, y: number, scale: number): void;
  beginEdit(id: string): void;
  endEdit(): void;
  unmount(): void;
}

type RuneEvent =
  | { t: "section"; id: string }
  | { t: "object"; id: string }
  | { t: "move"; id: string; x: number; y: number }
  | { t: "text"; id: string; text: string }
  | { t: "edit"; id: string | null }
  | { t: "create-section"; c: number; r: number };

/** dev and e2e builds keep the last events Rune reported, for checks */
const seen: RuneEvent[] | null = import.meta.env?.DEV || import.meta.env?.VITE_E2E_HOOKS ? [] : null;

let loading: Promise<RuneModule> | null = null;

/** fetch and start the module once; says plainly why it can't */
function load(): Promise<RuneModule> {
  loading ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) throw new Error("This browser has no WebGPU, which Rune draws with.");
    const adapter = await gpu.requestAdapter().catch(() => null);
    if (!adapter) throw new Error("WebGPU is here, but no GPU adapter answered (a blocked or software-only GPU).");
    // the dev server answers a missing file with the app's own page: ask for the build's stamp, which is JSON
    const stamp = await fetch(`${BASE}rune.json`).then((r) => (r.ok && /json/.test(r.headers.get("content-type") ?? "") ? (r.json() as Promise<RuneBuild>) : null)).catch(() => null);
    if (!stamp) throw new Error("The Rune renderer isn't built here: run `npm run rune:build`.");
    setRuneStatus({ state: "loading", build: stamp });
    const mod = (await import(/* @vite-ignore */ `${BASE}foundation_rune.js?v=${encodeURIComponent(stamp.builtAt)}`)) as RuneModule;
    await mod.default({ module_or_path: `${BASE}foundation_rune_bg.wasm?v=${encodeURIComponent(stamp.builtAt)}` });
    if (mod.sceneVersion() !== SCENE_VERSION) throw new Error(`The Rune build is out of date (scene ${mod.sceneVersion()}, the app speaks ${SCENE_VERSION}): run \`npm run rune:build\`.`);
    return mod;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

// ---------- tokens: the design language, resolved to what Rune can draw ----------

let probe: CanvasRenderingContext2D | null = null;
/** any CSS colour (a token, a color-mix, mid night-fade) as sRGB: painted, then read back */
function resolve(css: string): Rgba {
  probe ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  if (!probe) return [0, 0, 0, 1];
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  // straight alpha back out of the canvas's own
  return a === 0 ? [0, 0, 0, 0] : [r / 255, g / 255, b / 255, a / 255];
}

export function readTokens(el: Element = document.body): SceneTokens {
  const style = getComputedStyle(el);
  const out = {} as SceneTokens;
  for (const [name, v] of Object.entries(TOKEN_VARS) as Array<[keyof SceneTokens, string]>) out[name] = resolve(style.getPropertyValue(v).trim() || "transparent");
  return out;
}

// ---------- the mounted renderer ----------

export interface RuneHost {
  /** open a note for writing */
  beginEdit(id: string): void;
  /** the note Rune's field is open on, if any */
  editing(): string | null;
  /** something the scene reads outside the store changed (the floor's panes, my role): send the board again */
  refresh(): void;
  dispose(): void;
}

/**
 * Mount Rune on `canvas` and keep it in step until disposed. `transparent`:
 * the canvas is see-through and the WebGL paper under it shows (else Rune
 * paints the paper).
 */
export function mountRune(canvas: HTMLCanvasElement, opts: { transparent: boolean }): RuneHost {
  let mod: RuneModule | null = null;
  let disposed = false;
  let editing: string | null = null;
  let frame = 0;
  let last = "";
  const offs: Array<() => void> = [];

  const push = () => {
    frame = 0;
    if (!mod || disposed) return;
    const ui = getUi();
    const f = floorInsets(ui);
    const scene = buildScene(getState(), {
      insets: { left: f.left, top: f.top, right: f.right },
      readOnly: ui.role === "viewer",
      tokens: readTokens(canvas.parentElement ?? document.body),
      paper: !opts.transparent,
      imageSrc: runeImageSrc,
    });
    const json = JSON.stringify(scene);
    if (json === last) return;
    last = json;
    try {
      mod.setScene(json);
    } catch (e) {
      console.error("rune: scene refused", e);
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(push);
  };

  const onEvent = (json: string) => {
    let e: RuneEvent;
    try {
      e = JSON.parse(json) as RuneEvent;
    } catch {
      return;
    }
    if (seen) seen.push(e), seen.length > 50 && seen.shift();
    const st = getState();
    if (e.t === "section") setActiveSection(e.id);
    else if (e.t === "object") setActiveObject(e.id);
    else if (e.t === "text") updateNoteText(e.id, e.text);
    else if (e.t === "edit") {
      editing = e.id;
      // Rune's field types through its own hidden <textarea> (IME, autocorrect, the clipboard) once that has
      // the keyboard. A field opened from here, not by a tap on it, is handed the keyboard the same way, so
      // the app's own keys (Space to talk, A, P, 0, F…) see someone typing, as they do in any field.
      if (e.id) requestAnimationFrame(() => requestAnimationFrame(() => {
        const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text input"]');
        if (editing && field && (document.activeElement === canvas || document.activeElement === document.body)) field.focus({ preventScroll: true });
      }));
    }
    else if (e.t === "create-section") createSectionAt(e.c, e.r);
    else if (e.t === "move") {
      // let go at a world point: floating there in its own section (carrying between sections is the ledger's)
      const key = (["notes", "media", "tables", "maps", "panels"] as const).find((k) => st[k][e.id]);
      const obj = key && st[key][e.id];
      const sec = obj && st.sections[obj.sectionId];
      if (!key || !obj || !sec || sec.host === e.id) return schedule();
      const card = sectionCardRect(st.grid, sec);
      const fit = sectionFit(sec.id);
      const x = Math.max(0, Math.round((e.x - card.x - 1) / fit - CONTENT_PAD));
      const y = Math.max(0, Math.round((e.y - card.y - 1 - SECTION_HEADER) / fit - CONTENT_PAD));
      setObjectFloat(e.id, true);
      ({ notes: moveNote, media: moveMedia, tables: moveTable, maps: moveMap, panels: movePanel })[key](e.id, x, y);
      // the store may answer with the same board (a viewer's move snaps back): send it again so the card lets go
      last = "";
      schedule();
    }
  };

  setRuneStatus({ state: "loading" });
  load()
    .then((m) => {
      if (disposed) return;
      m.mount(canvas.id, opts.transparent, onEvent);
      mod = m;
      m.setCamera(camera.x, camera.y, camera.scale);
      offs.push(
        onCamera((c) => m.setCamera(c.x, c.y, c.scale)),
        subscribe(schedule),
        // a table at rest is Rune's: its cells are the workbook's, which recalculates apart from the store
        workbook.subscribeAll(schedule),
        // the night fade mixes every token over 1.4 s: Rune springs between what it's handed
        onNight(() => [0, 500, 1500].forEach((ms) => setTimeout(schedule, ms))),
      );
      const ro = new ResizeObserver(schedule);
      ro.observe(canvas);
      offs.push(() => ro.disconnect());
      push();
      setRuneStatus({ state: "ready" });
    })
    .catch((err: unknown) => {
      if (disposed) return;
      console.warn("rune:", err);
      setRuneStatus({ state: "failed", reason: err instanceof Error ? err.message : String(err) });
    });

  return {
    beginEdit: (id) => mod?.beginEdit(id),
    editing: () => editing,
    refresh: schedule,
    dispose() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      offs.forEach((off) => off());
      try {
        mod?.unmount();
      } catch (e) {
        console.warn("rune: unmount", e);
      }
      mod = null;
    },
  };
}

// dev and e2e builds: what Rune is handed and where the camera is, for checks that press on what it drew
if ((import.meta.env?.DEV || import.meta.env?.VITE_E2E_HOOKS) && typeof window !== "undefined") {
  (window as unknown as { __foundationRune: unknown }).__foundationRune = {
    camera,
    status: getRuneStatus,
    scene: () => buildScene(getState(), { insets: floorInsets(getUi()), readOnly: getUi().role === "viewer", tokens: readTokens(), paper: false, imageSrc: runeImageSrc }),
    addNote,
    createTable,
    events: () => seen,
  };
}

let current: RuneHost | null = null;
/** the renderer that's mounted now (the grid asks it to open a note) */
export const runeHost = () => current;
export const setRuneHost = (h: RuneHost | null) => (current = h);
