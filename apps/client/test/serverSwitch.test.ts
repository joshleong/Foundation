import { test } from "node:test";
import assert from "node:assert/strict";
import { isAbsoluteFolder, isLocalServer, pillState, serverOrigin, shortAddress } from "../src/server/model";

test("this computer is loopback, by name or number, at any port", () => {
  assert.ok(isLocalServer("http://localhost:4410"));
  assert.ok(isLocalServer("http://127.0.0.1:4410"));
  assert.ok(isLocalServer("http://[::1]:4410"));
  assert.ok(isLocalServer("http://app.localhost:9000"));
  assert.ok(!isLocalServer("https://server.formresearch.ai"));
  assert.ok(!isLocalServer("not a url"));
});

test("an address as typed becomes a server origin", () => {
  assert.deepEqual(serverOrigin("server.formresearch.ai"), { ok: true, origin: "https://server.formresearch.ai" }, "a bare host is https");
  assert.deepEqual(serverOrigin("  https://server.formresearch.ai/some/path/ "), { ok: true, origin: "https://server.formresearch.ai" }, "only the origin");
  assert.deepEqual(serverOrigin("localhost:4410"), { ok: true, origin: "http://localhost:4410" }, "this computer is http");
  assert.deepEqual(serverOrigin("http://10.0.0.5:4410"), { ok: true, origin: "http://10.0.0.5:4410" });
  assert.equal(serverOrigin("").ok, false);
  assert.equal(serverOrigin("ftp://files.example.com").ok, false, "only http(s)");
  assert.equal(serverOrigin("javascript:alert(1)").ok, false);
  assert.equal(serverOrigin("https://").ok, false);
});

test("addresses read without their scheme", () => {
  assert.equal(shortAddress("http://localhost:4410"), "localhost:4410");
  assert.equal(shortAddress("https://server.formresearch.ai/"), "server.formresearch.ai");
});

test("only an absolute folder is offered to the desktop app", () => {
  assert.ok(isAbsoluteFolder("C:\\Dev\\Foundation"));
  assert.ok(isAbsoluteFolder("D:/work/Foundation"));
  assert.ok(isAbsoluteFolder("/Users/josh/Foundation"));
  assert.ok(!isAbsoluteFolder("Foundation"));
  assert.ok(!isAbsoluteFolder("..\\Foundation"));
});

test("the collapsed switch: a dot and a word", () => {
  assert.deepEqual(pillState("up", "running", true), { tone: "ok", word: "Connected" });
  assert.deepEqual(pillState("down", "stopped", true), { tone: "bad", word: "Not running" });
  assert.deepEqual(pillState("down", "unknown", false), { tone: "bad", word: "Can't reach" });
  assert.deepEqual(pillState("checking", "unknown", false), { tone: "warn", word: "Checking…" });
  assert.deepEqual(pillState("down", "starting", true), { tone: "warn", word: "Starting…" }, "starting wins over a failed check");
});
