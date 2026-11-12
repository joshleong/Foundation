/**
 * The floor keeps the grid at least MIN_PAPER wide. Opening the side pane by
 * hand beside a session on a narrow window keeps the pane (it was asked for)
 * and narrows the session instead, then closes search, then narrows the pane.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const win = { innerWidth: 1100, addEventListener() {}, removeEventListener() {} };
(globalThis as unknown as { window: typeof win }).window = win;

const { setUi, getUi, floorInsets, MIN_PAPER, WIDTHS } = await import("../src/state/ui");
const paper = () => win.innerWidth - floorInsets().left - floorInsets().right;

test("the pane opened by hand beside a session: the session narrows, the grid keeps its paper", () => {
  win.innerWidth = 1100;
  setUi({ pane: false, tab: "s1", tabs: [{ id: "s1", kind: "agent", title: "x" }], sessionW: 460, paneW: 272, search: false });
  assert.ok(paper() >= MIN_PAPER);
  setUi({ pane: true });
  assert.equal(getUi().pane, true, "the pane opened");
  assert.ok(paper() >= MIN_PAPER, `paper ${paper()}`);
  assert.ok(getUi().sessionW < 460 && getUi().sessionW >= WIDTHS.session.min);
});

test("not enough even with the session at its narrowest: search closes, then the pane narrows", () => {
  win.innerWidth = 1000;
  setUi({ pane: false, tab: "s1", tabs: [{ id: "s1", kind: "agent", title: "x" }], sessionW: 460, paneW: 272, search: true, searchW: 380 });
  setUi({ pane: true });
  assert.equal(getUi().pane, true);
  assert.equal(getUi().search, false);
  assert.equal(getUi().sessionW, WIDTHS.session.min);
  assert.ok(paper() >= MIN_PAPER - 1 || getUi().paneW === WIDTHS.pane.min, `paper ${paper()}, pane ${getUi().paneW}`);
});

test("on a wide window nothing narrows", () => {
  win.innerWidth = 1920;
  setUi({ pane: false, tab: "s1", tabs: [{ id: "s1", kind: "agent", title: "x" }], sessionW: 460, paneW: 272, search: true, searchW: 380 });
  setUi({ pane: true });
  assert.equal(getUi().sessionW, 460);
  assert.equal(getUi().search, true);
  assert.equal(getUi().paneW, 272);
});
