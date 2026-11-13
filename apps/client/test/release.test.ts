import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error: a plain .mjs script, imported for its pure parts
import { feed } from "../../../scripts/release.mjs";

test("latest.json names a signed installer per platform, at its release URL", () => {
  const art = (file: string, sig: string | null) => ({ file, path: file, sig, sigPath: `${file}.sig` });
  const f = feed(
    "0.3.0",
    { body: "- Desktop updates", title: "t", date: null },
    { nsis: art("Foundation_0.3.0_x64-setup.exe", "SIG-NSIS"), msi: art("Foundation_0.3.0_x64_en-US.msi", "SIG-MSI"), appTar: null, appimage: art("x.AppImage", null) },
    new Date("2026-11-09T08:00:00.123Z"),
  );
  assert.equal(f.version, "0.3.0");
  assert.equal(f.notes, "- Desktop updates");
  assert.equal(f.pub_date, "2026-11-09T08:00:00Z");
  assert.deepEqual(Object.keys(f.platforms).sort(), ["windows-x86_64", "windows-x86_64-msi", "windows-x86_64-nsis"], "unsigned artifacts are left out");
  assert.equal(f.platforms["windows-x86_64"].url, "https://github.com/Normal-AI-Vibe-Code/Foundation/releases/download/v0.3.0/Foundation_0.3.0_x64-setup.exe");
  assert.equal(f.platforms["windows-x86_64-msi"].signature, "SIG-MSI");
});
