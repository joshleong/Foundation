/**
 * Server checks that need no network: CAD header extraction, repo parsing,
 * the allowlist, search prefix matching (the stemmer regression), and the
 * board tools' safety rules (confirm-to-delete, idempotent request_id).
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FOUNDATION_DATA_DIR = mkdtempSync(join(tmpdir(), "foundation-test-"));
process.env.FOUNDATION_ALLOWLIST = "@formindustries.com,josh.leong@gmail.com";

const { cadHeaderText } = await import("../src/files.ts");
const { parseRepo } = await import("../src/github.ts");
const { isAllowed } = await import("../src/auth.ts");
const { indexDoc } = await import("../src/db.ts");
const { searchLocal } = await import("../src/search.ts");
const { runTool } = await import("../src/tools.ts");
const { getBoard, closeBoards } = await import("../src/boards.ts");

after(() => closeBoards());
const { boardMaps, appendSection } = await import("@foundation/protocol");

test("STEP header names what people search for", () => {
  const head = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Airform Max fan shroud'),'2;1');\nFILE_NAME('shroud.step','2026',('Noa'),('Form'),'','','');\nENDSEC;\nDATA;\n#1=PRODUCT('FAN-SHROUD-A7','Fan shroud rev C','',(#2));";
  const text = cadHeaderText(head);
  assert.match(text, /Airform Max fan shroud/);
  assert.match(text, /FAN-SHROUD-A7/);
  assert.match(text, /Fan shroud rev C/);
});

test("repos parse from URLs and owner/name", () => {
  assert.equal(parseRepo("https://github.com/torotron/Vision"), "torotron/Vision");
  assert.equal(parseRepo("git@github.com:josh-normal/FactoryForm.git"), "josh-normal/FactoryForm");
  assert.equal(parseRepo("joshleong/Foundation"), "joshleong/Foundation");
  assert.equal(parseRepo("https://example.com/app"), null);
});

test("allowlist: domains and exact emails", () => {
  assert.ok(isAllowed("noa@formindustries.com"));
  assert.ok(isAllowed("Josh.Leong@gmail.com"));
  assert.ok(!isAllowed("someone@gmail.com"));
});

test("search matches prefixes of compound names and part numbers", () => {
  indexDoc("board", "x1", "t", "FactoryForm", "Inventory, stations 03304-10027");
  assert.ok(searchLocal("factory", "t").some((h) => h.title === "FactoryForm"));
  assert.ok(searchLocal("0330", "t").some((h) => h.title === "FactoryForm"));
});

test("deletes need confirm; request_id makes writes idempotent", async () => {
  const board = getBoard("test-board");
  board.doc.transact(() => appendSection(board.doc, "Work"));
  const ctx = { boardId: "test-board", actor: "test", userId: "u" };
  const a = (await runTool(ctx, "add_note", { title: "Hi", markdown: "x", request_id: "r1" })) as { id: string };
  const b = (await runTool(ctx, "add_note", { title: "Hi", markdown: "x", request_id: "r1" })) as { id: string };
  assert.equal(a.id, b.id);
  assert.equal([...boardMaps(board.doc).objects.values()].filter((o) => o.kind === "note").length, 1);
  assert.match(String(await runTool(ctx, "delete_card", { id: a.id, confirm: false })), /not deleted/);
  assert.ok(boardMaps(board.doc).objects.has(a.id));
  await runTool(ctx, "delete_card", { id: a.id, confirm: true });
  assert.ok(!boardMaps(board.doc).objects.has(a.id));
});
