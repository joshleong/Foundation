/**
 * Notes render the markdown a real agent writes, tables included
 * (2026-11-07: a real crew turn wrote one and it showed as raw pipes).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/utils/markdown.ts";

test("a pipe table becomes a table, header and rows", () => {
  const html = renderMarkdown("For each part:\n| Part | Supplier | Phone |\n|---|:---:|---|\n| M3 bolt | **Acme** | 555 |\n| | | |\nAfter.");
  assert.match(html, /<p>For each part:<\/p>/);
  assert.match(html, /<thead><tr><th>Part<\/th><th>Supplier<\/th><th>Phone<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>M3 bolt<\/td><td><strong>Acme<\/strong><\/td><td>555<\/td>/);
  assert.equal((html.match(/<tr>/g) ?? []).length, 3, "header, a filled row and an empty row");
  assert.match(html, /<\/table><\/div>\n<p>After.<\/p>/);
});

test("pipes without a rule line stay text, and a rule alone is still a rule", () => {
  assert.doesNotMatch(renderMarkdown("| just | pipes |\nnext"), /<table>/);
  assert.equal(renderMarkdown("---"), "<hr>");
});

test("cells are escaped like everything else", () => {
  const html = renderMarkdown("| a |\n|---|\n| <script>x</script> |");
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
