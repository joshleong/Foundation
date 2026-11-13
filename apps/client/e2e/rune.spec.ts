/**
 * The Rune renderer beside the web renderer (Settings → Renderer; src/rune,
 * apps/rune). Rune draws through WebGPU, so this runs headed on the machine's
 * GPU, in Edge (the desktop app's engine on Windows), and needs the build:
 *
 *   npm run rune:build
 *   PERF_GPU=1 E2E_CLIENT_PORT=15450 npm run e2e -w @foundation/client -- rune
 *
 * It checks that the default is untouched, that Rune draws the board the store
 * has (and says so), that presses, a drag, the wheel and writing a note reach
 * the board, that a browser without WebGPU falls back and says why, and takes
 * the two engines' pictures of one board, day and night, into docs/evidence.
 */

import { test, expect, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { CLIENT, settle, waitLive } from "./helpers";

const GPU = !!process.env.PERF_GPU;
const OUT = `../../docs/evidence/${process.env.RUNE_OUT ?? "2026-11-12_rune"}`;

test.skip(!GPU, "PERF_GPU=1 runs this headed, on the machine's GPU (Rune needs WebGPU)");
test.skip(!existsSync("public/rune/rune.json"), "the Rune renderer isn't built: npm run rune:build");
test.use({
  headless: false,
  channel: process.env.PERF_CHANNEL ?? "msedge",
  launchOptions: { args: ["--ignore-gpu-blocklist", "--enable-unsafe-webgpu", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"] },
});

type Scene = {
  sections: Array<{ id: string; name: string; x: number; y: number; w: number; h: number; active: boolean }>;
  cards: Array<{ id: string; kind: string; x: number; y: number; w: number; h: number; s: number; text: string }>;
};
type Camera = { x: number; y: number; scale: number; left: number; top: number };
type Hook = { camera: Camera; status(): { state: string; reason?: string }; scene(): Scene; addNote(section: string, text: string): { id: string }; createTable(section: string): { id: string } };
type Note = { id: string; x: number; y: number; float: boolean; text: string };
type Store = { workbook: { setCell(t: string, c: number, r: number, raw: string): void; getCell(t: string, c: number, r: number): { value: unknown } | undefined }; getState(): { activeSectionId: string; activeObjectId: string | null; notes: Record<string, Note> } };

async function open(page: Page, engine: "rune" | "web", night = true) {
  const res = await page.context().request.post(`${CLIENT}/auth/dev`, { data: { name: "Ada", email: "ada@normal.dev" } });
  expect(res.ok()).toBe(true);
  await page.addInitScript(
    ([n]) => {
      localStorage.setItem("foundation-floor", JSON.stringify({ pane: false, tabs: [], tab: null, search: false }));
      localStorage.setItem("foundation-night", n ? "1" : "0");
    },
    [night],
  );
  await page.goto(`/?board=company&engine=${engine}`);
  await waitLive(page);
  if (engine === "rune") await page.waitForSelector(".rune-mark.is-ready", { timeout: 30_000 });
  await settle(page, 1200);
}

const camera = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __foundationRune: Hook }).__foundationRune.camera }));
const scene = (page: Page) => page.evaluate(() => (window as unknown as { __foundationRune: Hook }).__foundationRune.scene());
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __foundation: Store }).__foundation.getState();
    return { activeSectionId: s.activeSectionId, activeObjectId: s.activeObjectId, notes: Object.values(s.notes) };
  });
/** the middle of a card on screen, through the one camera both engines share */
async function cardPoint(page: Page, id: string) {
  const card = (await scene(page)).cards.find((c) => c.id === id)!;
  const c = await camera(page);
  return { x: c.left + c.x + (card.x + (card.w * card.s) / 2) * c.scale, y: c.top + c.y + (card.y + (card.h * card.s) / 2) * c.scale, k: c.scale * card.s };
}

test("the web renderer is the default, and nothing of Rune loads", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => {
    if (/\/rune\/(foundation_rune|rune\.json|snippets)/.test(r.url())) asked.push(r.url());
  });
  await open(page, "web");
  expect(await page.locator(".section-card").count()).toBeGreaterThan(0);
  expect(await page.locator("#foundation-rune").count()).toBe(0);
  expect(await page.locator(".rune-mark").count()).toBe(0);
  expect(asked).toEqual([]);
});

test("Rune draws the board, marked as Rune's, and its pictures sit beside the web renderer's", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  for (const night of [true, false]) {
    await open(page, "web", night);
    await page.keyboard.press("0");
    await settle(page, 1400);
    await page.screenshot({ path: `${OUT}/board-web-${night ? "night" : "day"}.png` });
    await open(page, "rune", night);
    // the web renderer's sections are gone: Rune's canvas is the board
    expect(await page.locator(".section-card:not(.is-rune-shell)").count()).toBe(0);
    expect(await page.locator("#foundation-rune").count()).toBe(1);
    await expect(page.locator(".rune-mark")).toHaveText("Rune");
    await page.keyboard.press("0");
    await settle(page, 1400);
    await page.screenshot({ path: `${OUT}/board-rune-${night ? "night" : "day"}.png` });
  }
  expect(errors.filter((e) => /rune|wgpu|webgpu|panicked/i.test(e))).toEqual([]);
});

test("presses, the wheel, a drag and writing a note reach the board", async ({ page }) => {
  await open(page, "rune");
  await page.keyboard.press("0"); // the whole board in view
  await settle(page, 1400);
  const sc = await scene(page);
  expect(sc.sections.length).toBeGreaterThan(1);

  // a press on another section's paper (its header strip) selects it
  const other = sc.sections.find((s) => !s.active)!;
  const c0 = await camera(page);
  await page.mouse.click(c0.left + c0.x + (other.x + other.w - 60) * c0.scale, c0.top + c0.y + (other.y + 20) * c0.scale);
  await expect.poll(async () => (await state(page)).activeSectionId).toBe(other.id);

  // the wheel pans and Ctrl+wheel zooms: the one camera, drawn by Rune
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 120);
  await settle(page, 400);
  const c1 = await camera(page);
  // (a headed browser scales the wheel's delta by the display's: the grid moves by what the event says)
  expect(c1.y).toBeLessThan(c0.y - 100);
  expect(Math.abs(c1.x - c0.x)).toBeLessThan(1);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await settle(page, 900);
  expect((await camera(page)).scale).toBeGreaterThan(c1.scale);

  // a note, made through the store as any card is; a new card is brought into view
  const id = await page.evaluate((sec) => (window as unknown as { __foundationRune: Hook }).__foundationRune.addNote(sec, "Drawn by Rune").id, other.id);
  await settle(page, 1500);
  // a press on it selects it
  let at = await cardPoint(page, id);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await state(page)).activeObjectId).toBe(id);

  // drag it 90 × 60 px: it floats where it was let go
  const sceneBefore = (await scene(page)).cards.find((c) => c.id === id)!;
  at = await cardPoint(page, id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 40, at.y + 30, { steps: 6 });
  await page.mouse.move(at.x + 90, at.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).notes.find((n) => n.id === id)?.float).toBe(true);
  await settle(page, 500);
  const sceneAfter = (await scene(page)).cards.find((c) => c.id === id)!;
  const cam = await camera(page);
  expect(Math.abs((sceneAfter.x - sceneBefore.x) * cam.scale - 90)).toBeLessThan(3);
  expect(Math.abs((sceneAfter.y - sceneBefore.y) * cam.scale - 60)).toBeLessThan(3);

  // a double-click on a note that's framed opens it for writing in Rune's own field, and typing reaches the board
  at = await cardPoint(page, id);
  await page.mouse.dblclick(at.x, at.y);
  await settle(page, 800);
  await page.keyboard.press("Control+End");
  await page.keyboard.type(", typed in its own field");
  await expect.poll(async () => (await state(page)).notes.find((n) => n.id === id)?.text).toBe("Drawn by Rune, typed in its own field");
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/note-writing-rune.png` });
  await page.keyboard.press("Escape");
});

test("without WebGPU the board falls back to the web renderer and says why", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true }));
  const res = await page.context().request.post(`${CLIENT}/auth/dev`, { data: { name: "Ada", email: "ada@normal.dev" } });
  expect(res.ok()).toBe(true);
  await page.goto("/?board=company&engine=rune");
  await waitLive(page);
  await page.waitForSelector(".rune-mark.is-failed");
  await expect(page.locator(".rune-mark")).toHaveText("Rune off");
  expect(await page.locator(".section-card").count()).toBeGreaterThan(0);
  expect(await page.locator("#foundation-rune").count()).toBe(0);
});

test("Settings → Renderer switches engines on this device and shows where Rune stands", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await open(page, "web");
  for (const night of [true, false]) {
    await page.evaluate((n) => document.documentElement.classList.toggle("is-night", n), night);
    await page.goto("/?board=company#/settings/renderer");
    await page.waitForSelector(".rune-option");
    await settle(page, 1600);
    await page.screenshot({ path: `${OUT}/settings-renderer-${night ? "night" : "day"}.png`, fullPage: true });
  }
  await expect(page.locator(".rune-option.is-current .rune-option-name")).toContainText("Web renderer");
  expect(await page.locator(".rune-row").count()).toBeGreaterThan(20);
  await page.locator(".rune-option", { hasText: "Experimental" }).click();
  await expect(page.locator(".rune-option.is-current .rune-option-name")).toContainText("Rune");
  expect(await page.evaluate(() => localStorage.getItem("foundation-engine"))).toBe("rune");
  // back on the board (no ?engine in the address): Rune is drawing, and says so
  await page.goto("/?board=company");
  await waitLive(page);
  await page.waitForSelector(".rune-mark.is-ready", { timeout: 30_000 });
  expect(await page.locator(".section-card:not(.is-rune-shell)").count()).toBe(0);
  // and back again: the web renderer, with nothing of Rune left on the page
  await page.locator(".rune-mark").click();
  await page.locator(".rune-option", { hasText: "Default" }).click();
  await page.goto("/?board=company");
  await waitLive(page);
  await settle(page, 600);
  expect(await page.locator(".section-card").count()).toBeGreaterThan(0);
  expect(await page.locator("#foundation-rune").count()).toBe(0);
  expect(await page.locator(".rune-mark").count()).toBe(0);
});

test("the design page shows the mark and the ledger, day and night", async ({ page }) => {
  await open(page, "web");
  for (const night of [true, false]) {
    await page.goto("/#/design");
    await page.evaluate((n) => document.documentElement.classList.toggle("is-night", n), night);
    const section = page.locator(".design-section", { hasText: "Rune renderer" });
    await section.scrollIntoViewIfNeeded();
    await settle(page, 1600);
    await section.screenshot({ path: `${OUT}/design-rune-${night ? "night" : "day"}.png` });
  }
});

test("web content stays live as islands over Rune; a table is Rune's at rest and the web's in hand", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await open(page, "rune");
  await page.keyboard.press("0");
  await settle(page, 1400);
  // the seeded board's apps and connectors are the web's own components, in the sections Rune drew
  const panels = await page.evaluate(() => Object.keys((window as unknown as { __foundation: { getState(): { panels: object } } }).__foundation.getState().panels).length);
  expect(panels).toBeGreaterThan(0);
  expect(await page.locator(".is-rune-shell .panel-card").count()).toBe(panels);
  // and Rune is handed none of them: each card is drawn by exactly one engine
  const drawn = (await scene(page)).cards.map((c) => c.kind);
  expect(drawn.every((k) => k === "note" || k === "table" || k === "image")).toBe(true);
  // an island sits where the store says: its box on screen is the rect the wires land on
  const off = await page.evaluate(() => {
    const st = (window as unknown as { __foundation: { getState(): { sections: Record<string, { id: string }> }; sectionCardRect(g: unknown, s: unknown): { x: number; y: number; w: number; h: number } } }).__foundation;
    const cam = (window as unknown as { __foundationRune: { camera: { x: number; y: number; scale: number; left: number; top: number } } }).__foundationRune.camera;
    const s = st.getState() as unknown as { grid: unknown; sections: Record<string, { id: string }> };
    let worst = 0;
    for (const el of document.querySelectorAll<HTMLElement>(".section-card.is-rune-shell")) {
      const r = el.getBoundingClientRect();
      const want = st.sectionCardRect(s.grid, s.sections[el.dataset.sectionId!]);
      worst = Math.max(worst, Math.abs(r.left - (cam.left + cam.x + want.x * cam.scale)), Math.abs(r.top - (cam.top + cam.y + want.y * cam.scale)), Math.abs(r.width - want.w * cam.scale));
    }
    return worst;
  });
  expect(off).toBeLessThan(1);
  await page.screenshot({ path: `${OUT}/islands-rune-night.png` });

  // a table: Rune draws it at rest, with what its cells show
  const sec = (await scene(page)).sections.find((s) => s.name === "Apps")!;
  const id = await page.evaluate((s) => (window as unknown as { __foundationRune: Hook }).__foundationRune.createTable(s).id, sec.id);
  await page.evaluate((t) => {
    const wb = (window as unknown as { __foundation: Store }).__foundation.workbook;
    wb.setCell(t, 0, 0, "Part");
    wb.setCell(t, 1, 0, "Qty");
    wb.setCell(t, 0, 1, "Rim drive");
    wb.setCell(t, 1, 1, "12");
    wb.setCell(t, 1, 2, "=B2*2");
  }, id);
  await settle(page, 1600);
  const card = (await scene(page)).cards.find((c) => c.id === id)!;
  expect(card.kind).toBe("table");
  expect(await page.locator(`.obj-slot[data-obj-id="${id}"]`).count()).toBe(0);
  await page.screenshot({ path: `${OUT}/table-rune-at-rest.png` });

  // pressed, it's the card in hand: the web's live sheet takes its place, and a cell takes typing
  const at = await cardPoint(page, id);
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector(`.obj-slot[data-obj-id="${id}"] .cell`);
  expect((await scene(page)).cards.some((c) => c.id === id)).toBe(false);
  const cell = page.locator(`.obj-slot[data-obj-id="${id}"] .cell`).nth(4 * 3 + 2); // C4
  await cell.click();
  await page.keyboard.type("=B3+1");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate((t) => (window as unknown as { __foundation: Store }).__foundation.workbook.getCell(t, 2, 3)?.value, id)).toBe(25);
  await settle(page, 400);
  await page.screenshot({ path: `${OUT}/table-web-in-hand.png` });

  // a press on the section's paper lets go of it: Rune draws it again, with the new cell
  const box = (await page.locator(`.obj-slot[data-obj-id="${id}"] .sheet`).boundingBox())!;
  await page.mouse.click(box.x + box.width + 120, box.y + 40);
  await expect.poll(() => page.locator(`.obj-slot[data-obj-id="${id}"]`).count()).toBe(0);
  const back = (await scene(page)).cards.find((c) => c.id === id) as unknown as { cells: Array<{ c: number; r: number; t: string }> };
  expect(back.cells.find((x) => x.c === 2 && x.r === 3)?.t).toBe("25");
});
