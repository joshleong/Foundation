#!/usr/bin/env node
// Foundation's desktop release, in three steps (SPEC §3 "Desktop updates"):
//
//   npm run release -- bump 0.3.0     every version string to 0.3.0, one commit and the tag v0.3.0 (never pushes)
//   npm run release -- build          signed installers and latest.json for the version in tauri.conf.json
//   npm run release -- publish        the GitHub release v<version>: notes, installers, .sig files, latest.json
//
// The release notes are docs/blog/<version>.md (front-matter, then markdown); `build` refuses without it,
// because the notes are what every installed copy shows on its update card.
//
// Signing: the updater's private key never enters a checkout. `build` reads it from
// TAURI_SIGNING_PRIVATE_KEY(_PASSWORD) if set, else from ~/.tauri/foundation-updater.key and
// ~/.tauri/foundation-updater.password. Losing that key strands every installed copy (they'd need a
// manual reinstall once), so it needs a backup outside this computer.
//
// The feed lives at https://github.com/<repo>/releases/latest/download/latest.json, which works while the
// repository is public. If it goes private, the feed has to move somewhere public (Vision uses a Supabase
// bucket, its ADR-055); change `plugins.updater.endpoints` in tauri.conf.json and `assetUrl` below.
//
// Publishing is the approval: once the release is up, every installed Foundation offers it within a
// launch (or six hours). `publish` refuses a release that already exists unless --replace is given.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = process.env.FOUNDATION_RELEASE_REPO ?? "joshleong/Foundation";
const TAURI = join(root, "apps/client/src-tauri");
const BUNDLE = join(TAURI, "target/release/bundle");
const OUT = join(root, "dist/release");
const win = process.platform === "win32";

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const args = rest.filter((a) => !a.startsWith("--"));

function die(msg) {
  console.error(`\n  release: ${msg}\n`);
  process.exit(1);
}
function run(bin, argv, opts = {}) {
  const r = spawnSync(bin, argv, { cwd: root, stdio: "inherit", shell: win && /^(npm|npx)$/.test(bin), ...opts });
  if (r.status !== 0) die(`${bin} ${argv.join(" ")} failed (${r.status ?? r.signal})`);
}
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const writeJson = (p, v) => writeFileSync(join(root, p), JSON.stringify(v, null, 2) + "\n");
const currentVersion = () => readJson("apps/client/src-tauri/tauri.conf.json").version;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

/** docs/blog/<version>.md → { title, date, body }; body is everything after the front-matter */
export function readNotes(version) {
  const p = join(root, "docs/blog", `${version}.md`);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  if (m) for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  if (meta.version && meta.version !== version) die(`docs/blog/${version}.md says version ${meta.version}`);
  return { title: meta.title ?? `Foundation ${version}`, date: meta.date ?? null, body: (m ? m[2] : raw).trim() };
}

/** the release asset's public URL */
const assetUrl = (version, file) => `https://github.com/${REPO}/releases/download/v${version}/${encodeURIComponent(file)}`;

// ------------------------------------------------------------------ bump
function bump(version) {
  if (!SEMVER.test(version ?? "")) die("usage: npm run release -- bump <x.y.z>");
  if (git("status", "--porcelain")) die("the working tree isn't clean; commit or set aside your changes first");
  const from = currentVersion();
  for (const p of ["apps/client/package.json", "apps/server/package.json", "packages/protocol/package.json", "packages/ui/package.json"]) {
    const j = readJson(p);
    j.version = version;
    writeJson(p, j);
  }
  const conf = readJson("apps/client/src-tauri/tauri.conf.json");
  conf.version = version;
  writeJson("apps/client/src-tauri/tauri.conf.json", conf);
  const cargo = join(TAURI, "Cargo.toml");
  writeFileSync(cargo, readFileSync(cargo, "utf8").replace(/^version = "[^"]+"/m, `version = "${version}"`));
  const lock = join(TAURI, "Cargo.lock");
  writeFileSync(lock, readFileSync(lock, "utf8").replace(/(name = "tauri-app"\r?\nversion = ")[^"]+"/, `$1${version}"`));
  run("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"]);
  git("add", "-A", "apps/client/package.json", "apps/server/package.json", "packages/protocol/package.json", "packages/ui/package.json", "apps/client/src-tauri/tauri.conf.json", "apps/client/src-tauri/Cargo.toml", "apps/client/src-tauri/Cargo.lock", "package-lock.json");
  git("commit", "-q", "-m", `Foundation ${version}\n\nVersions bump ${from} → ${version} (npm run release -- bump).`);
  git("tag", "-a", `v${version}`, "-m", `Foundation ${version}`);
  console.log(`\n  ${from} → ${version}, committed and tagged v${version}. Nothing was pushed.\n  Next: npm run release -- build\n`);
}

// ------------------------------------------------------------------ build
function signingEnv() {
  if (process.env.TAURI_SIGNING_PRIVATE_KEY) return {};
  const dir = join(homedir(), ".tauri");
  const key = join(dir, "foundation-updater.key");
  const pw = join(dir, "foundation-updater.password");
  if (!existsSync(key)) die(`no signing key: set TAURI_SIGNING_PRIVATE_KEY or put it at ${key}`);
  return {
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(key, "utf8").trim(),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: existsSync(pw) ? readFileSync(pw, "utf8").trim() : "",
  };
}

/** the installers `tauri build` made for this version, with their signatures */
function artifacts(version) {
  const find = (sub, test) => {
    const d = join(BUNDLE, sub);
    if (!existsSync(d)) return null;
    const f = readdirSync(d).find((n) => test(n) && n.includes(`_${version}_`));
    if (!f) return null;
    const sig = join(d, `${f}.sig`);
    return { file: f, path: join(d, f), sig: existsSync(sig) ? readFileSync(sig, "utf8").trim() : null, sigPath: sig };
  };
  return {
    nsis: find("nsis", (n) => n.endsWith("-setup.exe")),
    msi: find("msi", (n) => n.endsWith(".msi")),
    appTar: find("macos", (n) => n.endsWith(".app.tar.gz")),
    appimage: find("appimage", (n) => n.endsWith(".AppImage")),
  };
}

/** latest.json in the shape tauri-plugin-updater reads */
export function feed(version, notes, a, now = new Date()) {
  const platforms = {};
  const add = (keys, art) => {
    if (!art?.sig) return;
    for (const k of keys) platforms[k] = { signature: art.sig, url: assetUrl(version, art.file) };
  };
  add(["windows-x86_64", "windows-x86_64-nsis"], a.nsis);
  add(["windows-x86_64-msi"], a.msi);
  add(["darwin-aarch64", "darwin-x86_64", "darwin-aarch64-app", "darwin-x86_64-app"], a.appTar);
  add(["linux-x86_64", "linux-x86_64-appimage"], a.appimage);
  return { version, notes: notes.body, pub_date: now.toISOString().replace(/\.\d{3}Z$/, "Z"), platforms };
}

function build() {
  const version = currentVersion();
  const notes = readNotes(version);
  if (!notes) die(`docs/blog/${version}.md is missing: the release notes are what the update card shows`);
  run("npm", ["run", "tauri", "-w", "@foundation/client", "--", "build", "--config", "src-tauri/tauri.release.conf.json"], {
    env: { ...process.env, ...signingEnv() },
  });
  const a = artifacts(version);
  if (!a.nsis?.sig && !a.appTar?.sig && !a.appimage?.sig) die("the build made no signed installer (is createUpdaterArtifacts on?)");
  mkdirSync(OUT, { recursive: true });
  const latest = feed(version, notes, a);
  writeFileSync(join(OUT, "latest.json"), JSON.stringify(latest, null, 2) + "\n");
  writeFileSync(join(OUT, "notes.md"), notes.body + "\n");
  console.log(`\n  Built Foundation ${version}:`);
  for (const [k, v] of Object.entries(a)) if (v) console.log(`    ${k.padEnd(9)} ${v.file}${v.sig ? " (signed)" : " (no .sig)"}`);
  console.log(`    feed      dist/release/latest.json (${Object.keys(latest.platforms).join(", ")})\n  Next: npm run release -- publish\n`);
}

// ------------------------------------------------------------------ publish
function publish() {
  const version = currentVersion();
  const tag = `v${version}`;
  const notes = readNotes(version);
  if (!notes) die(`docs/blog/${version}.md is missing`);
  const latestPath = join(OUT, "latest.json");
  if (!existsSync(latestPath)) die("no dist/release/latest.json: run npm run release -- build first");
  const latest = JSON.parse(readFileSync(latestPath, "utf8"));
  if (latest.version !== version) die(`dist/release/latest.json is for ${latest.version}, not ${version}: build again`);
  const a = artifacts(version);
  const files = [];
  for (const art of Object.values(a)) if (art?.sig) files.push(art.path, art.sigPath);
  files.push(latestPath);
  // the tag must be on GitHub, at the commit that was built
  const tagged = spawnSync("git", ["ls-remote", "--tags", "origin", tag], { cwd: root, encoding: "utf8" }).stdout.trim();
  if (!tagged) die(`the tag ${tag} isn't on origin yet: push main and the tag first (git push origin main ${tag})`);
  const exists = spawnSync("gh", ["release", "view", tag, "-R", REPO], { cwd: root, encoding: "utf8" }).status === 0;
  const notesFile = join(OUT, "notes.md");
  writeFileSync(notesFile, notes.body + "\n");
  if (exists) {
    if (!flags.has("--replace")) die(`the release ${tag} already exists: --replace uploads these assets over its own (and its notes)`);
    run("gh", ["release", "edit", tag, "-R", REPO, "--title", `Foundation ${version}: ${notes.title}`, "--notes-file", notesFile, "--draft=false", "--latest"]);
    run("gh", ["release", "upload", tag, "-R", REPO, "--clobber", ...files]);
  } else {
    run("gh", ["release", "create", tag, "-R", REPO, "--verify-tag", "--latest", "--title", `Foundation ${version}: ${notes.title}`, "--notes-file", notesFile, ...files]);
  }
  console.log(`\n  Published ${tag}. The feed: https://github.com/${REPO}/releases/latest/download/latest.json\n`);
}

// run as a script (tests import feed() and readNotes() without running anything)
if (/release\.mjs$/.test(process.argv[1] ?? "")) {
  if (cmd === "bump") bump(args[0]);
  else if (cmd === "build") build();
  else if (cmd === "publish") publish();
  else if (cmd === "notes") console.log(JSON.stringify(readNotes(args[0] ?? currentVersion()), null, 2));
  else die("usage: npm run release -- bump <x.y.z> | build | publish [--replace] | notes [version]");
}
