import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, explainError, mayCheckOnLaunch, noteLines, parsePrefs, progressLabel, settleOnLaunch, shortDate, shouldOffer } from "../src/update/policy.ts";

test("only an installed desktop build checks by itself, and only online", () => {
  assert.equal(mayCheckOnLaunch({ desktop: true, dev: false, online: true }), true);
  assert.equal(mayCheckOnLaunch({ desktop: true, dev: true, online: true }), false);
  assert.equal(mayCheckOnLaunch({ desktop: false, dev: false, online: true }), false);
  assert.equal(mayCheckOnLaunch({ desktop: true, dev: false, online: false }), false);
});

test("Later hides the card this launch; Skip hides that version only; a manual check always shows", () => {
  assert.equal(shouldOffer("0.3.0", {}, { manual: false, laterThisLaunch: false }), true);
  assert.equal(shouldOffer("0.3.0", {}, { manual: false, laterThisLaunch: true }), false);
  assert.equal(shouldOffer("0.3.0", { skipped: "0.3.0" }, { manual: false, laterThisLaunch: false }), false);
  assert.equal(shouldOffer("0.3.1", { skipped: "0.3.0" }, { manual: false, laterThisLaunch: false }), true);
  assert.equal(shouldOffer("0.3.0", { skipped: "0.3.0" }, { manual: true, laterThisLaunch: true }), true);
});

test("the first launch of a new version says what changed once; stale notes and skips are dropped", () => {
  const pending = { version: "0.3.0", from: "0.2.0", notes: "- a", date: null };
  const a = settleOnLaunch("0.3.0", { pending, skipped: "0.3.0" });
  assert.deepEqual(a.whatsNew, pending);
  assert.deepEqual(a.prefs, {});
  const b = settleOnLaunch("0.2.0", { pending, skipped: "0.4.0" });
  assert.equal(b.whatsNew, null, "an install that didn't happen says nothing");
  assert.deepEqual(b.prefs, { skipped: "0.4.0" }, "a skip of a newer version stands");
});

test("stored prefs that don't parse never block an update", () => {
  assert.deepEqual(parsePrefs(null), {});
  assert.deepEqual(parsePrefs("{"), {});
  assert.deepEqual(parsePrefs("[1]"), {});
  assert.deepEqual(parsePrefs(JSON.stringify({ skipped: 3 })), {});
  assert.deepEqual(parsePrefs(JSON.stringify({ pending: { version: "1" } })), {});
  assert.deepEqual(parsePrefs(JSON.stringify({ skipped: "0.3.0" })), { skipped: "0.3.0" });
});

test("versions order as semver, pre-releases first", () => {
  assert.equal(compareVersions("0.3.0", "0.2.9"), 1);
  assert.equal(compareVersions("v0.3.0", "0.3.0"), 0);
  assert.equal(compareVersions("0.3.0-rc.1", "0.3.0"), -1);
  assert.equal(compareVersions("0.3.0-rc.10", "0.3.0-rc.2"), 1);
  assert.equal(compareVersions("0.10.0", "0.9.0"), 1);
});

test("errors read as something a person can act on", () => {
  assert.match(explainError(new Error("Could not fetch a valid release JSON from the remote"), "check"), /No version has been published/);
  assert.match(explainError(new Error("signature verification failed"), "install"), /signature didn't match/);
  assert.match(explainError(new Error("error sending request for url"), "check"), /offline/);
  assert.match(explainError("", "install"), /Nothing was installed/);
});

test("the card's words: note lines, progress, dates", () => {
  assert.deepEqual(noteLines("## Foundation 0.3.0\n\n- **Updates**: [the card](x)\n---\n1. `icon`", 5), ["Updates: the card", "icon"]);
  assert.equal(progressLabel(4.2 * 1048576, 9.6 * 1048576), "4.2 of 9.6 MB");
  assert.equal(progressLabel(20 * 1048576, null), "20 MB");
  assert.equal(shortDate("2026-11-09T08:00:00Z"), "9 Nov");
  assert.equal(shortDate("nope"), null);
});
