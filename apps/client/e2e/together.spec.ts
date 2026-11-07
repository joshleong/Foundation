/**
 * Two people on one board, in two browsers (Phase 1): typing in one note at
 * once, writing cells of one table at once, renaming a section — and both
 * end up looking at the same board. Then (2026-11-07) each sees where the
 * other is: pointer cursors on the board, named carets in a note, and ⌘Z
 * takes back only your own words.
 */

import { test, expect, type Page } from "@playwright/test";
import { CLIENT, person, settle } from "./helpers";

const SHOTS = "../../docs/evidence/2026-11-03_together";
const SHOTS2 = "../../docs/evidence/2026-11-07_together-notes";
let ada: Page;
let kai: Page;
let board = "";

test.describe.configure({ mode: "serial" });

const state = (p: Page) =>
  p.evaluate(() => {
    const st = (window as unknown as { __foundation: { getState(): { sections: Record<string, { name: string }>; notes: Record<string, { name: string; text: string }> } } }).__foundation.getState();
    return { sections: Object.values(st.sections).map((s) => s.name).sort(), notes: Object.values(st.notes).map((n) => [n.name, n.text]) };
  });

test.beforeAll(async ({ browser }) => {
  // a fresh board, made by Ada; the server lays its first section
  const a = await person(browser, "Ada Test", "ada@normal.dev");
  const made = await a.context.request.post(`${CLIENT}/api/boards`, { data: { name: `Together ${Date.now().toString(36)}` } });
  board = ((await made.json()) as { id: string }).id;
  ada = a.page;
  await ada.goto(`/?board=${board}`);
  kai = (await person(browser, "Kai Test", "kai@normal.dev", board)).page;
  await ada.waitForFunction(() => (window as unknown as { __foundationBoard: () => { status: string } }).__foundationBoard().status === "live");
  // one note to share, made through the board tools (as an agent or a person's script would)
  await a.context.request.post(`${CLIENT}/api/boards/${board}/tools/add_note`, { data: { title: "Shared", markdown: "Goals:\n\nRisks:\n" } });
  await settle(ada, 800);
});

/** frame the shared note, open it for writing, and put the caret after "Goals:" or at the end */
async function openShared(p: Page, at: "goals" | "end") {
  const id = await p.evaluate(() => Object.values((window as unknown as { __foundation: { getState(): { notes: Record<string, { id: string; name: string }> } } }).__foundation.getState().notes).find((n) => n.name === "Shared")!.id);
  await p.evaluate((i) => (window as unknown as { __foundation: { setState(x: object): void } }).__foundation.setState({ snapRequest: { kind: "object", id: i, nonce: Math.random() } }), id);
  await settle(p, 1200);
  await p.locator(`[data-obj-id="${id}"] .note-rendered`).dblclick();
  const ed = p.locator(`[data-obj-id="${id}"] textarea`);
  await ed.waitFor();
  // the caret: after "Goals:\n" for Ada, at the end for Kai
  await ed.evaluate((el: HTMLTextAreaElement, where) => {
    const at = where === "goals" ? el.value.indexOf("\n") + 1 : el.value.length;
    el.setSelectionRange(at, at);
  }, at);
  return ed;
}

test("both see one board, with one first section", async () => {
  const [a, k] = [await state(ada), await state(kai)];
  expect(a.sections).toEqual(["Section 1"]);
  expect(k).toEqual(a);
});

test("two people typing in one note at once both keep their words", async () => {
  const [ea, ek] = [await openShared(ada, "goals"), await openShared(kai, "end")];
  // interleaved keystrokes, as two people typing at the same time
  const a = "- ship the fan\n";
  const k = "- supplier slip\n";
  for (let i = 0; i < Math.max(a.length, k.length); i++) {
    if (a[i]) await ada.keyboard.type(a[i]);
    if (k[i]) await kai.keyboard.type(k[i]);
  }
  await settle(ada, 800);
  const want = "Goals:\n- ship the fan\n\nRisks:\n- supplier slip\n";
  expect(await ea.inputValue()).toBe(want);
  expect(await ek.inputValue()).toBe(want);
  await ada.screenshot({ path: `${SHOTS}/01_ada-note.png` });
  await kai.screenshot({ path: `${SHOTS}/02_kai-note.png` });
  await ada.keyboard.press("Escape");
  await kai.keyboard.press("Escape");
});

test("two people writing cells of one table at once both land", async () => {
  // Ada adds a table from the section's own tools
  const sec = await ada.evaluate(() => Object.keys((window as unknown as { __foundation: { getState(): { sections: object } } }).__foundation.getState().sections)[0]);
  const card = ada.locator(`.section-card[data-section-id="${sec}"]`);
  await ada.evaluate(() => (window as unknown as { __foundation: { setState(x: object): void } }).__foundation.setState({ snapRequest: { kind: "all", nonce: Math.random() } }));
  await settle(ada, 1200);
  const box = (await card.boundingBox())!;
  await ada.mouse.move(box.x + 40, box.y + 8); // the pointer on the section calls its tools
  await card.locator('[aria-label="Add a table"]').click();
  await settle(ada, 1000);
  const id = await ada.evaluate(() => Object.keys((window as unknown as { __foundation: { getState(): { tables: object } } }).__foundation.getState().tables)[0]);
  expect(id, "a table to write in").toBeTruthy();
  await kai.waitForFunction((t) => !!(window as unknown as { __foundation: { workbook: { getTable(id: string): unknown } } }).__foundation.workbook.getTable(t), id);
  // both write without having seen the other's cells
  const write = (p: Page, col: number, vals: string[]) =>
    p.evaluate(([t, c, v]) => {
      const wb = (window as unknown as { __foundation: { workbook: { setCell(t: string, c: number, r: number, raw: string): void } } }).__foundation.workbook;
      (v as string[]).forEach((raw, r) => wb.setCell(t as string, c as number, r, raw));
    }, [id, col, vals] as const);
  await Promise.all([write(ada, 0, ["Part", "Shroud", "Hub"]), write(kai, 1, ["Qty", "2", "=B2*3"])]);
  await settle(ada, 1000);
  const cells = (p: Page) =>
    p.evaluate((t) => {
      const tb = (window as unknown as { __foundation: { workbook: { getTable(id: string): { cells: Map<string, { raw: string }> } } } }).__foundation.workbook.getTable(t);
      return Object.fromEntries([...tb.cells].filter(([, c]) => c.raw).map(([k, c]) => [k, c.raw]).sort());
    }, id);
  const want = { "0,0": "Part", "0,1": "Shroud", "0,2": "Hub", "1,0": "Qty", "1,1": "2", "1,2": "=B2*3" };
  expect(await cells(ada)).toEqual(want);
  expect(await cells(kai)).toEqual(want);
});

test("a rename by one is seen by the other, and both boards match", async () => {
  await ada.evaluate(() => {
    const f = (window as unknown as { __foundation: { getState(): { sections: Record<string, { id: string; name: string }> }; setState(x: object): void } }).__foundation;
    const st = f.getState();
    const s = Object.values(st.sections)[0];
    f.setState({ sections: { ...st.sections, [s.id]: { ...s, name: "Fan programme" } } });
  });
  await kai.waitForFunction(() => Object.values((window as unknown as { __foundation: { getState(): { sections: Record<string, { name: string }> } } }).__foundation.getState().sections).some((s) => s.name === "Fan programme"));
  expect(await state(kai)).toEqual(await state(ada));
});

test("each sees the other's pointer on the board", async () => {
  await ada.mouse.move(700, 420);
  await ada.mouse.move(720, 440, { steps: 4 });
  await kai.waitForFunction(() => [...document.querySelectorAll(".peer-cursor .peer-name")].some((n) => n.textContent === "Ada Test"));
  await kai.mouse.move(500, 300);
  await kai.mouse.move(520, 320, { steps: 4 });
  await ada.waitForFunction(() => [...document.querySelectorAll(".peer-cursor .peer-name")].some((n) => n.textContent === "Kai Test"));
});

test("each sees where the other is writing; ⌘Z takes back only your own words", async () => {
  const before = "Goals:\n- ship the fan\n\nRisks:\n- supplier slip\n";
  const [ea, ek] = [await openShared(ada, "goals"), await openShared(kai, "end")];
  expect(await ea.inputValue()).toBe(before);
  // a named caret for the other person, in both editors
  await ada.locator(".note-caret-name", { hasText: "Kai Test" }).waitFor();
  await kai.locator(".note-caret-name", { hasText: "Ada Test" }).waitFor();
  await ada.keyboard.type("- tooling\n");
  await kai.keyboard.type("- late resin\n");
  await settle(ada, 700);
  const both = "Goals:\n- tooling\n- ship the fan\n\nRisks:\n- supplier slip\n- late resin\n";
  expect(await ea.inputValue()).toBe(both);
  expect(await ek.inputValue()).toBe(both);
  await ada.screenshot({ path: `${SHOTS2}/01_ada-sees-kai-writing.png` });
  await kai.screenshot({ path: `${SHOTS2}/02_kai-sees-ada-writing.png` });
  // Ada's undo takes back her line; Kai's stays, in both editors
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await ada.keyboard.press(`${mod}+z`);
  await settle(ada, 700);
  const undone = "Goals:\n- ship the fan\n\nRisks:\n- supplier slip\n- late resin\n";
  expect(await ea.inputValue()).toBe(undone);
  expect(await ek.inputValue()).toBe(undone);
  // and redo puts it back
  await ada.keyboard.press(`${mod}+Shift+z`);
  await settle(ada, 700);
  expect(await ek.inputValue()).toBe(both);
  // Ada closes the note: a chip names whoever is still writing in it, until they stop
  await ada.keyboard.press("Escape");
  await ada.locator(".note-writer", { hasText: "Kai Test" }).waitFor();
  await ada.screenshot({ path: `${SHOTS2}/03_ada-sees-kai-in-the-note.png` });
  await kai.keyboard.press("Escape");
  await expect(ada.locator(".note-writer")).toHaveCount(0);
});
