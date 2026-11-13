/**
 * The agent group of a section, and the agents pane (2026-11-12), checked by
 * a second person. Ada asks aloud for a section with two helpers; the agents
 * run on the server's script runtime (the real board tools, no model).
 *
 * Kai, in his own browser:
 * - nothing stands above a section nobody works in;
 * - the agents that come into “Depot” join its group, one face each, and the
 *   group is up while his pointer is on the section and gone when it leaves;
 * - pinned, it stays up with the pointer elsewhere;
 * - a lead and its helpers read as one team (“working together”);
 * - the group opens into the agents pane on the right: the section first, its
 *   team in one block, lead first, and search gives way to it;
 * - when the work is done the agents leave the group, and the pinned tab says
 *   nobody's here.
 * - #/design, day and night.
 */

import { test, expect, type Page } from "@playwright/test";
import { CLIENT, person, settle } from "./helpers";

const SHOTS = "../../docs/evidence/2026-11-12_section-agents";
let ada: Page;
let kai: Page;
let board = "";

test.describe.configure({ mode: "serial" });

const sectionId = (p: Page, name: string) =>
  p.evaluate((n) => {
    const st = (window as unknown as { __foundation: { getState(): { sections: Record<string, { id: string; name: string }> } } }).__foundation.getState();
    return Object.values(st.sections).find((s) => s.name === n)?.id ?? null;
  }, name);

const frame = (p: Page, id: string | null) => p.evaluate((sid) => (window as unknown as { __foundation: { setState(p: object): void } }).__foundation.setState({ snapRequest: { kind: "section", id: sid, nonce: Math.random() } }), id);

test.beforeAll(async ({ browser }) => {
  const a = await person(browser, "Ada Test", "ada@normal.dev");
  const made = await a.context.request.post(`${CLIENT}/api/boards`, { data: { name: `Section agents ${Date.now().toString(36)}` } });
  board = ((await made.json()) as { id: string }).id;
  // a microphone stand-in that says whatever the test set in __say
  await a.context.addInitScript(() => {
    class FakeRecognition {
      lang = "en-GB";
      interimResults = true;
      continuous = false;
      onresult: (e: unknown) => void = () => {};
      onend: () => void = () => {};
      onerror: (e: unknown) => void = () => {};
      private timers: number[] = [];
      private ended = false;
      start() {
        const words = (window as unknown as { __say?: string[] }).__say ?? [];
        words.forEach((w, i) => this.timers.push(window.setTimeout(() => this.onresult({ results: [[{ transcript: w }]] }), 500 + i * 300)));
      }
      stop() {
        if (this.ended) return;
        this.ended = true;
        window.setTimeout(() => this.onend(), 30);
      }
      abort() {
        this.timers.forEach(clearTimeout);
      }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  });
  ada = a.page;
  await ada.goto(`/?board=${board}`);
  kai = (await person(browser, "Kai Test", "kai@normal.dev", board)).page;
  for (const p of [ada, kai]) await p.waitForFunction(() => (window as unknown as { __foundationBoard: () => { status: string } }).__foundationBoard()?.status === "live");
  await settle(ada, 800);
});

test("agents that come into a section join its group; hover shows it, a pin keeps it, and it opens into the pane", async () => {
  // nobody at work: no section has a group
  await expect(kai.locator(".sec-crew")).toHaveCount(0);

  await ada.evaluate(() => ((window as unknown as { __say: string[] }).__say = ["make a section called “Depot” with the parts, and get two helpers"]));
  await ada.mouse.move(700, 500);
  await ada.keyboard.down("Space");
  await expect(ada.locator(".talk-heard")).toContainText("two helpers", { timeout: 4000 });
  await ada.keyboard.up("Space");

  const depot = await expect.poll(() => sectionId(kai, "Depot"), { timeout: 10_000 }).not.toBeNull().then(() => sectionId(kai, "Depot"));
  await frame(kai, depot);
  const card = kai.locator(`.section-card[data-section-id="${depot}"]`);
  const group = card.locator("> .sec-crew");

  // the lead is in Depot: its face is in the group
  await expect(group.locator(".crew-face")).toHaveCount(1, { timeout: 8000 });
  const lead = await group.locator(".crew-face").first().getAttribute("data-crew-face");
  expect(lead, "the lead has a name").toBeTruthy();

  // the pointer elsewhere: the group waits, unseen
  await kai.mouse.move(8, 880);
  await expect(group).toHaveCSS("opacity", "0", { timeout: 3000 });
  // on the section: it shows. Depot fills the view (its top edge is at the top bar), so the tab has come
  // down with the view: it's on the paper, under the bar, inside the section
  await card.hover({ position: { x: 200, y: 300 } });
  await expect(group).toHaveCSS("opacity", "1", { timeout: 3000 });
  await expect(group).toHaveClass(/is-stuck/);
  const stuck = (await group.boundingBox())!;
  expect(stuck.y, "under the top bar").toBeGreaterThanOrEqual(44);
  expect(stuck.x > 0 && stuck.x + stuck.width < 1440, "on screen").toBeTruthy();
  await kai.screenshot({ path: `${SHOTS}/00_kai-depot-fills-the-view.png` });
  // the whole board in view: the tab stands above the section's top edge
  await kai.keyboard.press("0");
  await settle(kai, 1100);
  await card.hover({ position: { x: 60, y: 60 } });
  await expect(group).not.toHaveClass(/is-stuck/);
  // at screen size, whatever the zoom: the tab is as tall on screen as it's drawn
  const [g, c] = [await group.boundingBox(), await card.boundingBox()];
  expect(Math.abs((g?.height ?? 0) - 30), `the tab's height on screen: ${g?.height}`).toBeLessThan(1.5);
  expect(g && c && g.y + g.height <= c.y + 1, `the tab is above the section (tab bottom ${g && g.y + g.height}, section top ${c?.y})`).toBeTruthy();

  // pinned: it stays with the pointer gone
  await group.locator(".sec-crew-btn").first().click();
  await expect(group).toHaveClass(/is-pinned/);
  await kai.mouse.move(8, 880);
  await settle(kai, 500);
  await expect(group).toHaveCSS("opacity", "1");

  // a helper comes in: it joins the group, and the lead and its helper are one team
  await expect.poll(() => group.locator(".crew-face").count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  await expect(group.locator(".sec-crew-team.is-together .crew-face").first()).toHaveAttribute("data-crew-face", lead!);
  await expect(group.locator(".sec-crew-words")).toHaveText("working together");
  await kai.screenshot({ path: `${SHOTS}/01_kai-depot-group-pinned.png` });

  // opened large, on the right: Depot first, its team in one block with the lead first
  await group.locator(".sec-crew-btn").nth(1).click();
  const pane = kai.locator(".agents-pane");
  await expect(pane).toBeVisible();
  const place = pane.locator(".agents-place").first();
  await expect(place).toHaveAttribute("data-agents-place", "Depot");
  await expect(place).toHaveClass(/is-at/);
  await expect(place.locator(".agents-team.is-together .agent-row").first()).toHaveAttribute("data-agent-row", lead!, { timeout: 8000 });
  await expect(place.locator(".agents-team.is-together .agents-team-label")).toContainText("Working together");
  await expect(place.locator(".agents-team.is-together .agent-row-role").first()).toHaveText("lead");
  await expect(place.locator(".agents-team.is-together .agent-row-role").nth(1)).toHaveText("helper");
  // Kai didn't ask: he can follow, but there's nothing of his to open or stop
  await expect(place.locator(".crew-row-btn.is-stop")).toHaveCount(0);
  await settle(kai, 700); // the grid's cards slide out from under the pane
  await kai.screenshot({ path: `${SHOTS}/02_kai-agents-pane.png` });

  // Ada asked: her pane has Open and Stop on her lead
  await ada.locator(".top-btn[aria-label='Agents']").click();
  await expect(ada.locator(".agents-pane .agent-row").first().locator(".crew-row-btn", { hasText: "Open" })).toBeVisible({ timeout: 8000 });
  await settle(ada, 700);
  await ada.screenshot({ path: `${SHOTS}/03_ada-agents-pane.png` });

  // search takes the pane's place, and gives it back
  await kai.locator(".top-btn", { hasText: "⌕" }).click();
  await expect(kai.locator(".search-pane")).toBeVisible();
  await expect(pane).toHaveCount(0);
  await kai.locator(".top-btn[aria-label='Agents']").click();
  await expect(pane).toBeVisible();
  await expect(kai.locator(".search-pane")).toHaveCount(0);

  // the work ends: the agents leave the group; pinned, the tab says nobody's here
  await expect(kai.locator(".crew-cursor")).toHaveCount(0, { timeout: 40_000 });
  await expect(group.locator(".crew-face")).toHaveCount(0, { timeout: 8000 });
  await expect(group).toHaveText(/No agents here/);
  await expect(pane.locator(".agents-head-n")).toHaveText("none at work");
  await kai.screenshot({ path: `${SHOTS}/04_kai-after-the-work.png` });

  // unpinned and empty: nothing stands above the section
  await group.locator(".sec-crew-btn").first().click();
  await expect(card.locator("> .sec-crew")).toHaveCount(0);
});

test("a section doesn't render because someone moved a pointer", async () => {
  const renders = () => kai.evaluate(() => (window as unknown as { __renders?: Record<string, number> }).__renders?.SectionView ?? -1);
  const before = await renders();
  test.skip(before < 0, "render counts aren't on in this build");
  for (let i = 0; i < 30; i++) await ada.mouse.move(300 + i * 12, 300 + (i % 5) * 20);
  await settle(kai, 400);
  expect(await renders(), "SectionView renders while Ada's pointer moved").toBe(before);
});

test("agents in a section on #/design, day and night", async ({ browser }) => {
  for (const scheme of ["dark", "light"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    await ctx.request.post(`${CLIENT}/auth/dev`, { data: { name: "Ada Test", email: "ada@normal.dev" } });
    const p = await ctx.newPage();
    await p.goto("/#/design");
    const demo = p.locator(".sec-crew-demo").first();
    await demo.scrollIntoViewIfNeeded();
    await settle(p, 900);
    await demo.screenshot({ path: `${SHOTS}/05_design-${scheme === "dark" ? "night" : "day"}.png` });
    await ctx.close();
  }
});
