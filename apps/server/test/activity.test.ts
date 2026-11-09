/**
 * The activity log says who did what, as who they are: a person's own tool
 * calls are a person's (not an agent's), and the sections and cards a person
 * adds or removes on the grid are logged under their name, a burst at a time.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";

process.env.FOUNDATION_DATA_DIR = mkdtempSync(join(tmpdir(), "foundation-activity-"));
const { boardMaps } = await import("@foundation/protocol");
const { attachConnection, closeBoards, describeEdits, getBoard } = await import("../src/boards.ts");
const { runTool } = await import("../src/tools.ts");
const { upsertUser } = await import("../src/auth.ts");
const ada = upsertUser("ada@formindustries.com", "Ada");

after(() => closeBoards());

const activity = (board: string) => boardMaps(getBoard(board).doc).activity.toArray();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** a stand-in sync socket: enough of ws for attachConnection */
function fakeSocket() {
  const ws = new EventEmitter() as EventEmitter & { readyState: number; binaryType: string; send(d: unknown): void; close(): void };
  ws.readyState = 1;
  ws.binaryType = "";
  ws.send = () => {};
  ws.close = () => {};
  return ws;
}

/** what a person's client would send: an edit made on its own copy, applied as from their socket */
function fromPerson(board: string, ws: object, edit: (doc: Y.Doc) => void) {
  const doc = getBoard(board).doc;
  const mine = new Y.Doc();
  Y.applyUpdate(mine, Y.encodeStateAsUpdate(doc));
  const before = Y.encodeStateVector(mine);
  edit(mine);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(mine, before), ws);
}

test("the log's words for a burst of edits", () => {
  const t = (p: Partial<Parameters<typeof describeEdits>[0]>) => describeEdits({ sectionsAdded: [], sectionsRemoved: [], cardsAdded: [], cardsRemoved: 0, ...p });
  assert.equal(t({ sectionsAdded: ["Supply"] }), "added the section “Supply”");
  assert.equal(t({ cardsAdded: [{ kind: "note", name: "Parts", id: "n1" }] }), "added a note “Parts”");
  assert.equal(t({ cardsAdded: [{ kind: "media", id: "m1" }] }), "added a file");
  assert.equal(t({ sectionsAdded: ["Supply"], cardsAdded: [{ kind: "table", name: "BOM", id: "t" }] }), "added the section “Supply” and a table “BOM”");
  assert.equal(t({ cardsAdded: [{ kind: "note", id: "a" }, { kind: "note", id: "b" }], cardsRemoved: 2 }), "added 2 cards; removed 2 cards");
  assert.equal(t({ sectionsRemoved: ["Old"], cardsRemoved: 1 }), "removed the section “Old” and a card");
  assert.equal(t({}), "");
});

test("a person's tool call is logged as theirs; an agent's as an agent's", async () => {
  await runTool({ boardId: "act-tools", actor: "Ada", userId: ada.id, role: "human" }, "add_section", { name: "By hand" });
  await runTool({ boardId: "act-tools", actor: "Ada's agent", userId: ada.id }, "add_section", { name: "By agent" });
  const log = activity("act-tools");
  const byHand = log.find((e) => /By hand/.test(e.text))!;
  const byAgent = log.find((e) => /By agent/.test(e.text))!;
  assert.equal(byHand.who, "Ada");
  assert.equal(byHand.role, "human");
  assert.equal(byAgent.role, "agent");
});

test("sections and cards a person adds or removes on the grid are logged under their name", async () => {
  const board = "act-grid";
  getBoard(board);
  const ws = fakeSocket();
  attachConnection(board, ws as never, false, "u-kai", "Kai");
  const start = activity(board).length;
  fromPerson(board, ws, (doc) => {
    const m = boardMaps(doc);
    m.sections.set("sec_x", { id: "sec_x", name: "Supply", c0: 0, c1: 0, r0: 5, r1: 5 } as never);
    m.objects.set("obj_n", { id: "obj_n", kind: "note", name: "Parts", sectionId: "sec_x", x: 0, y: 0, w: 300, h: 200 } as never);
  });
  // a drag (an update to a card already there) is not news
  fromPerson(board, ws, (doc) => {
    const m = boardMaps(doc);
    m.objects.set("obj_n", { ...(m.objects.get("obj_n") as object), x: 40 } as never);
  });
  assert.equal(activity(board).length, start, "nothing until the burst settles");
  await wait(1700);
  const added = activity(board).slice(start);
  assert.equal(added.length, 1, "one line for the burst");
  assert.equal(added[0].who, "Kai");
  assert.equal(added[0].role, "human");
  assert.equal(added[0].text, "added the section “Supply” and a note “Parts”");
  assert.equal(added[0].objectId, "obj_n");

  fromPerson(board, ws, (doc) => {
    const m = boardMaps(doc);
    m.objects.delete("obj_n");
    m.sections.delete("sec_x");
  });
  await wait(1700);
  assert.equal(activity(board).at(-1)!.text, "removed the section “Supply” and a card");
});

test("the server's own edits and other boards' updates aren't a person's", async () => {
  const board = "act-quiet";
  const ws = fakeSocket();
  attachConnection(board, ws as never, false, "u-kai", "Kai");
  const start = activity(board).length;
  // an agent tool, through editBoard: logged by the tool itself, not as Kai
  await runTool({ boardId: board, actor: "Foundation Agent", userId: ada.id }, "add_section", { name: "Agent's" });
  await wait(1700);
  assert.ok(activity(board).slice(start).every((e) => e.who !== "Kai"));
});
