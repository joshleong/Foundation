/**
 * Finding Vision Code (T3) on macOS, Windows and Linux: where its CLI and its
 * home are looked for, that T3_CLI / T3CODE_HOME / T3_URL win, how a CLI is
 * started without a shell, and what a person is told when nothing is found.
 * Pure functions over a given platform, env and home: nothing here touches
 * this computer's Vision Code or its address.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findT3Cli, findT3Home, notFoundMessage, t3CliCandidates, t3Command, t3HomeCandidates, t3Url, ON_PATH, type Where } from "../src/t3paths.ts";

const mac: Where = { platform: "darwin", arch: "arm64", env: {}, home: "/Users/ada" };
const win: Where = {
  platform: "win32",
  arch: "x64",
  env: { APPDATA: "C:\\Users\\Ada\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local", SystemDrive: "C:", ProgramFiles: "C:\\Program Files", Path: "C:\\bin;C:\\npm" },
  home: "C:\\Users\\Ada",
};
const linux: Where = { platform: "linux", arch: "x64", env: { PATH: "/usr/local/bin:/usr/bin" }, home: "/home/ada" };
const nothing = () => false;

test("Vision's T3 home, per platform", () => {
  assert.deepEqual(t3HomeCandidates(mac), ["/Users/ada/Library/Application Support/co.normallab.vision/code"]);
  assert.deepEqual(t3HomeCandidates(win), ["C:\\Users\\Ada\\AppData\\Roaming\\co.normallab.vision\\code"]);
  assert.deepEqual(t3HomeCandidates({ ...win, env: {} }), ["C:\\Users\\Ada\\AppData\\Roaming\\co.normallab.vision\\code"], "no APPDATA: the usual Roaming");
  assert.deepEqual(t3HomeCandidates(linux), ["/home/ada/.local/share/co.normallab.vision/code"]);
  assert.deepEqual(t3HomeCandidates({ ...linux, env: { XDG_DATA_HOME: "/data" } }), ["/data/co.normallab.vision/code"]);
  // Vision's own override comes before the platform's place
  assert.deepEqual(t3HomeCandidates({ ...mac, env: { VISION_CODE_HOME: "/vc" } }), ["/vc", "/Users/ada/Library/Application Support/co.normallab.vision/code"]);
  // a home counts once it holds T3's store
  const store = "C:\\Users\\Ada\\AppData\\Roaming\\co.normallab.vision\\code\\userdata\\state.sqlite";
  assert.equal(findT3Home(win, (f) => f === store).found, "C:\\Users\\Ada\\AppData\\Roaming\\co.normallab.vision\\code");
  assert.equal(findT3Home(win, nothing).found, null);
});

test("Vision Code's CLI, per platform: checkouts, the installed app, then PATH", () => {
  assert.deepEqual(t3CliCandidates(mac), [
    "/Users/ada/Development/Vision/.tools/code-server/t3",
    "/Users/ada/Development/Vision/.tools/t3-server/node_modules/@t3code/t3-darwin-arm64/t3",
    "/Users/ada/Dev/Vision/.tools/code-server/t3",
    "/Users/ada/Dev/Vision/.tools/t3-server/node_modules/@t3code/t3-darwin-arm64/t3",
    "/Applications/Vision.app/Contents/Resources/code-server/t3",
    "/Users/ada/Applications/Vision.app/Contents/Resources/code-server/t3",
  ]);
  assert.deepEqual(t3CliCandidates(win), [
    "C:\\Users\\Ada\\Development\\Vision\\.tools\\code-server\\t3.exe",
    "C:\\Users\\Ada\\Development\\Vision\\.tools\\t3-server\\node_modules\\@t3code\\t3-win32-x64\\t3.exe",
    "C:\\Users\\Ada\\Dev\\Vision\\.tools\\code-server\\t3.exe",
    "C:\\Users\\Ada\\Dev\\Vision\\.tools\\t3-server\\node_modules\\@t3code\\t3-win32-x64\\t3.exe",
    "C:\\Dev\\Vision\\.tools\\code-server\\t3.exe",
    "C:\\Dev\\Vision\\.tools\\t3-server\\node_modules\\@t3code\\t3-win32-x64\\t3.exe",
    "C:\\Users\\Ada\\AppData\\Local\\Vision\\code-server\\t3.exe",
    "C:\\Program Files\\Vision\\code-server\\t3.exe",
  ]);
  assert.deepEqual(t3CliCandidates(linux), [
    "/home/ada/Development/Vision/.tools/code-server/t3",
    "/home/ada/Development/Vision/.tools/t3-server/node_modules/@t3code/t3-linux-x64/t3",
    "/home/ada/Dev/Vision/.tools/code-server/t3",
    "/home/ada/Dev/Vision/.tools/t3-server/node_modules/@t3code/t3-linux-x64/t3",
    "/usr/lib/Vision/code-server/t3",
  ]);

  // the first that exists wins; the installed app when there's no checkout
  assert.equal(findT3Cli(win, (f) => f.endsWith("Local\\Vision\\code-server\\t3.exe") || f.startsWith("C:\\Dev\\Vision")).found, "C:\\Dev\\Vision\\.tools\\code-server\\t3.exe");
  assert.equal(findT3Cli(win, (f) => f.endsWith("Local\\Vision\\code-server\\t3.exe")).found, "C:\\Users\\Ada\\AppData\\Local\\Vision\\code-server\\t3.exe");
  // then PATH: t3.exe, or npm's t3.cmd, on Windows; t3 elsewhere
  assert.equal(findT3Cli(win, (f) => f === "C:\\npm\\t3.cmd").found, "C:\\npm\\t3.cmd");
  assert.equal(findT3Cli(linux, (f) => f === "/usr/bin/t3").found, "/usr/bin/t3");
  const none = findT3Cli(win, nothing);
  assert.equal(none.found, null);
  assert.equal(none.tried.at(-1), ON_PATH);
});

test("T3_CLI, T3CODE_HOME and T3_URL win, and are taken as given", () => {
  const set: Where = { ...win, env: { ...win.env, T3_CLI: "D:\\tools\\t3.exe", T3CODE_HOME: "D:\\t3home", VISION_CODE_HOME: "E:\\vc" } };
  assert.deepEqual(t3CliCandidates(set), ["D:\\tools\\t3.exe"]);
  assert.deepEqual(t3HomeCandidates(set), ["D:\\t3home"], "no fallback to the real home once T3CODE_HOME is set");
  // even where nothing exists: the override is what's used (and what fails, loudly)
  assert.equal(findT3Cli(set, nothing).found, "D:\\tools\\t3.exe");
  assert.equal(findT3Home(set, nothing).found, "D:\\t3home");
  assert.equal(t3Url({}), "http://localhost:3783");
  assert.equal(t3Url({ T3_URL: "http://127.0.0.1:4999/" }), "http://127.0.0.1:4999");
});

test("the CLI starts without a shell: scripts under Node, npm's .cmd through the script it wraps", () => {
  assert.deepEqual(t3Command("C:\\x\\t3.exe", win), { cmd: "C:\\x\\t3.exe", pre: [] });
  assert.deepEqual(t3Command("/opt/t3", linux), { cmd: "/opt/t3", pre: [] });
  assert.deepEqual(t3Command("C:\\x\\t3.cjs", win), { cmd: process.execPath, pre: ["C:\\x\\t3.cjs"] });
  assert.deepEqual(t3Command("/x/bin.mjs", mac), { cmd: process.execPath, pre: ["/x/bin.mjs"] });
  // the shim npm writes for a global `t3` (its bin is dist/bin.mjs)
  const shim = `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\t3\\dist\\bin.mjs" %*\r\n`;
  assert.deepEqual(t3Command("C:\\npm\\t3.cmd", win, () => shim), { cmd: process.execPath, pre: ["C:\\npm\\node_modules\\t3\\dist\\bin.mjs"] });
  // a .cmd that isn't npm's is refused, not run through cmd.exe
  assert.throws(() => t3Command("C:\\x\\t3.cmd", win, () => "@echo off\r\nt3.exe %*\r\n"), /won't run through a shell.*T3_CLI/);
});

test("nothing found: the message lists every place looked and what to set", () => {
  const msg = notFoundMessage(findT3Cli(win, nothing), findT3Home(win, nothing));
  for (const p of [...t3CliCandidates(win), ...t3HomeCandidates(win), ON_PATH]) assert.ok(msg.includes(p), `names ${p}`);
  assert.match(msg, /Vision Code's CLI isn't on this computer/);
  assert.match(msg, /T3_CLI/);
  assert.match(msg, /T3CODE_HOME/);
  assert.match(msg, /T3_URL/);
  // only what's missing is asked for
  const homeOnly = notFoundMessage(findT3Cli(win, () => true), findT3Home(win, nothing));
  assert.doesNotMatch(homeOnly, /CLI isn't|T3_CLI/);
  assert.match(homeOnly, /T3CODE_HOME/);
});

test("the side pane's list says where it looked when the threads can't be read", async () => {
  const empty = mkdtempSync(join(tmpdir(), "t3-none-"));
  const keep = { T3CODE_HOME: process.env.T3CODE_HOME, T3_URL: process.env.T3_URL };
  process.env.T3CODE_HOME = empty;
  process.env.T3_URL = "http://127.0.0.1:9"; // never the real Vision Code
  try {
    const { t3Threads } = await import("../src/t3.ts");
    const r = await t3Threads();
    assert.equal(r.available, false);
    assert.ok(r.missing?.includes(empty), r.missing);
    assert.match(r.missing!, /T3CODE_HOME/);
  } finally {
    for (const [k, v] of Object.entries(keep)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    rmSync(empty, { recursive: true, force: true });
  }
});
