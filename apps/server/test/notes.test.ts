/**
 * Notes two people can type in (schema 3): a note's text is a Y.Text, writes
 * are the smallest edit, a keystroke is rebased past whatever arrived while it
 * was typed, and boards from before move their text over once.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";

process.env.FOUNDATION_DATA_DIR = mkdtempSync(join(tmpdir(), "foundation-test-"));

const { boardMaps, noteTextOf, putNote, rebaseEdit, setNoteText, textDiff, BOARD_SCHEMA } = await import("@foundation/protocol");
const { migrateBoard } = await import("../src/migrate.ts");
const { runTool } = await import("../src/tools.ts");
const { getBoard, editBoard, closeBoards } = await import("../src/boards.ts");

after(() => closeBoards());

/** two replicas of one board, exchanging updates both ways */
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const queue: Array<[Y.Doc, Uint8Array]> = [];
  a.on("update", (u: Uint8Array, origin: unknown) => origin !== "net" && queue.push([b, u]));
  b.on("update", (u: Uint8Array, origin: unknown) => origin !== "net" && queue.push([a, u]));
  const deliver = () => {
    while (queue.length) {
      const [to, u] = queue.shift()!;
      Y.applyUpdate(to, u, "net");
    }
  };
  return { a, b, deliver };
}

const apply = (doc: Y.Doc, id: string, base: string, next: string) => {
  const t = boardMaps(doc).noteText.get(id)!;
  const e = rebaseEdit(base, next, t.toString());
  if (!e) return;
  doc.transact(() => {
    if (e.remove) t.delete(e.at, e.remove);
    if (e.insert) t.insert(e.at, e.insert);
  });
};

test("textDiff is the one middle edit", () => {
  assert.deepEqual(textDiff("hello world", "hello brave world"), { at: 6, remove: 0, insert: "brave " });
  assert.deepEqual(textDiff("abc", "ac"), { at: 1, remove: 1, insert: "" });
  assert.equal(textDiff("same", "same"), null);
});

test("two people typing in one note at once both keep their words", () => {
  const { a, b, deliver } = pair();
  a.transact(() => putNote(a, { id: "note_1", kind: "note", sectionId: "s", name: "Plan", x: 0, y: 0, float: false, bornAt: 1, w: 400, h: 300, text: "Goals:\n\nRisks:\n" }));
  deliver();
  const base = noteTextOf(b, { id: "note_1" });
  // at the same moment: one writes under Goals, the other under Risks
  apply(a, "note_1", base, "Goals:\n- ship the fan\n\nRisks:\n");
  apply(b, "note_1", base, "Goals:\n\nRisks:\n- supplier slip\n");
  deliver();
  const want = "Goals:\n- ship the fan\n\nRisks:\n- supplier slip\n";
  assert.equal(noteTextOf(a, { id: "note_1" }), want);
  assert.equal(noteTextOf(b, { id: "note_1" }), want);
  // the card itself was never rewritten by typing
  assert.equal((boardMaps(a).objects.get("note_1") as { text?: string }).text, undefined);
});

test("a keystroke typed against a stale editor is moved past what arrived", () => {
  // the editor showed `base`; meanwhile someone inserted at the top
  const base = "one two three";
  const current = "zero one two three";
  // I typed "!" after "two"
  const e = rebaseEdit(base, "one two! three", current)!;
  const out = current.slice(0, e.at) + e.insert + current.slice(e.at + e.remove);
  assert.equal(out, "zero one two! three");
  // I deleted "two " while they replaced "two" with "2": theirs stands, my leftover delete still applies
  const e2 = rebaseEdit("one two four", "one four", "one 2 four")!;
  const out2 = "one 2 four".slice(0, e2.at) + e2.insert + "one 2 four".slice(e2.at + e2.remove);
  assert.equal(out2, "one 2four");
  // both typing at one spot: nobody's letter is lost
  const e3 = rebaseEdit("ab", "aXb", "aYb")!;
  assert.equal("aYb".slice(0, e3.at) + e3.insert + "aYb".slice(e3.at + e3.remove), "aYXb");
});

test("setNoteText writes the smallest edit, so a concurrent typist survives an agent's update", () => {
  const { a, b, deliver } = pair();
  a.transact(() => putNote(a, { id: "note_2", kind: "note", sectionId: "s", name: "N", x: 0, y: 0, float: false, bornAt: 1, w: 400, h: 300, text: "Status: draft\n\nNotes" }));
  deliver();
  // the agent flips the status line while a person types at the end
  a.transact(() => setNoteText(a, "note_2", "Status: approved\n\nNotes"));
  apply(b, "note_2", "Status: draft\n\nNotes", "Status: draft\n\nNotes from Noa");
  deliver();
  assert.equal(noteTextOf(a, { id: "note_2" }), "Status: approved\n\nNotes from Noa");
  assert.equal(noteTextOf(b, { id: "note_2" }), noteTextOf(a, { id: "note_2" }));
});

test("schema 3: an older board's note text moves into its Y.Text once; tools read and write through it", async () => {
  const id = "notes-mig";
  editBoard(id, "test", (doc) => {
    const m = boardMaps(doc);
    m.meta.set("schema", 2);
    m.sections.set("sec_a", { id: "sec_a", name: "A", c0: 0, r0: 0, c1: 0, r1: 0 });
    m.objects.set("note_old", { id: "note_old", kind: "note", sectionId: "sec_a", name: "Old", x: 0, y: 0, float: false, bornAt: 1, w: 400, h: 300, text: "legacy words" });
  });
  assert.equal(migrateBoard(id), true);
  const doc = getBoard(id).doc;
  const m = boardMaps(doc);
  assert.equal(m.meta.get("schema"), BOARD_SCHEMA);
  assert.equal((m.objects.get("note_old") as { text?: string }).text, undefined);
  assert.equal(noteTextOf(doc, { id: "note_old" }), "legacy words");
  assert.equal(migrateBoard(id), false);

  const ctx = { boardId: id, actor: "test", userId: "u1" };
  const made = (await runTool(ctx, "add_note", { section: "A", title: "Fresh", markdown: "first draft" })) as { id: string };
  assert.equal(noteTextOf(doc, { id: made.id }), "first draft");
  await runTool(ctx, "update_card", { id: made.id, markdown: "second draft" });
  assert.equal(noteTextOf(doc, { id: made.id }), "second draft");
  assert.match(String(await runTool(ctx, "read_board", {})), /second draft/);
  await runTool(ctx, "delete_card", { id: made.id, confirm: true });
  assert.equal(m.noteText.has(made.id), false);
});
