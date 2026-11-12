/**
 * Today in a real browser: signing in lands on Today (not the board), the
 * Shiba's room draws, what's asked of you shows and opens its place on the
 * board, a goal added on the page sticks, the apps are in reach, and Boards
 * and back work. No agent runtime here, so asking the Shiba must say so
 * plainly rather than hang.
 */
import { expect, test } from "@playwright/test";
import { CLIENT, settle } from "./helpers";

test("Today is home: focus, goals, apps, the Shiba, and the way to the boards", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const res = await context.request.post(`${CLIENT}/auth/dev`, { data: { name: "Tess Today", email: "tess@normal.dev" } });
  expect(res.ok()).toBeTruthy();
  // something asked of Tess on the company board
  const ask = await context.request.post(`${CLIENT}/api/asks`, { data: { board: "company", assignee: "tess@normal.dev", prompt: "Upload the e2e stator STEP", kind: "cad_upload" } });
  expect(ask.ok()).toBeTruthy();
  await context.addInitScript(() => localStorage.setItem("foundation-floor", JSON.stringify({ pane: false, tabs: [], tab: null, search: false })));
  const page = await context.newPage();

  await page.goto("/?rafshim");
  await expect(page.locator(".today")).toBeVisible();
  await expect(page.locator(".today-line")).toContainText("Tess");
  await expect(page.locator(".shiba-room")).toBeVisible();

  // the ask, linking to its card on the board
  const row = page.locator(".today-row", { hasText: "Upload the e2e stator STEP" });
  await expect(row).toBeVisible();
  expect(await row.getAttribute("href")).toMatch(/^\/\?board=company&focus=/);

  // the company's apps, always in the top bar; HyperForm says it isn't linked
  for (const name of ["BomForm", "FactoryForm", "HyperForm", "Vision"]) await expect(page.locator(".today-chip", { hasText: name })).toBeVisible();
  await expect(page.locator(".today-chip[data-unlinked]", { hasText: "HyperForm" })).toBeVisible();

  // a goal added here is kept
  await page.getByLabel("Add a goal").fill("Ship Today to the team");
  await page.getByLabel("Add a goal").press("Enter");
  await expect(page.locator(".today-goal", { hasText: "Ship Today to the team" })).toBeVisible();
  await page.reload();
  const goal = page.locator(".today-goal", { hasText: "Ship Today to the team" });
  await expect(goal).toBeVisible();
  await goal.getByRole("button").click();
  await expect(goal).toHaveAttribute("data-done", "true");
  await settle(page);
  await page.screenshot({ path: "../../docs/evidence/2026-11-11_today-shiba/e2e-today.png" });

  // the Shiba, with no runtime on this server: an honest answer, not a hang
  await page.getByLabel("Ask the Shiba").fill("What's first today?");
  await page.getByLabel("Ask the Shiba").press("Enter");
  await expect(page.locator(".today-eyebrow")).toHaveText("I couldn't answer", { timeout: 15_000 });
  await expect(page.locator(".today-line")).toContainText("No agent runtime");

  // to the boards and back
  await page.getByRole("link", { name: /Boards/ }).click();
  await expect(page).toHaveURL(/#\/board$/);
  await expect(page.locator(".today")).toHaveCount(0);
  await page.locator('.top-bar [data-tip="Today and the Shiba"]').click();
  await expect(page.locator(".today")).toBeVisible();

  // a link into the board goes straight there, not to Today
  await page.goto("/?board=company");
  await expect(page.locator(".today")).toHaveCount(0);
  await context.close();
});
