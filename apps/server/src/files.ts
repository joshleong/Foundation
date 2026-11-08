/**
 * Files: raw-body upload (the client streams the File as the request body),
 * content-addressed on disk under data/files, searchable, and archived —
 * never deleted (flowform-server's rule: "deleting a room archives its media
 * instead of deleting it").
 *
 * Text-bearing files are indexed: plain text, markdown, CSV, JSON, code, SVG,
 * and STEP/IGES CAD (both are ASCII — the product names, file description
 * and author in the header are what people search for).
 */

import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { rename, writeFile, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { ServerResponse } from "node:http";
import { config } from "./config.ts";
import { all, indexDoc, needsFileReindex, one, run } from "./db.ts";
import { readFileSync } from "node:fs";
import { HttpError, readBody, type Req } from "./http.ts";

export interface FileRow {
  id: string;
  board_id: string | null;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  uploaded_by: string | null;
  created_at: number;
  archived_at: number | null;
}

const TEXT_EXT = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml", ".toml", ".xml", ".html", ".css",
  ".js", ".ts", ".tsx", ".jsx", ".py", ".rs", ".go", ".rb", ".java", ".c", ".h", ".cpp", ".svg", ".log",
]);
const CAD_EXT = new Set([".step", ".stp", ".iges", ".igs"]);

export const CAD_FILE_EXT = [".step", ".stp", ".iges", ".igs", ".stl", ".obj", ".3mf", ".glb", ".gltf", ".f3d", ".sldprt", ".sldasm", ".x_t", ".dxf", ".dwg"];

export function isCad(name: string) {
  return CAD_FILE_EXT.includes(extname(name).toLowerCase());
}

function filePath(sha: string) {
  return join(config.dataDir, "files", sha);
}

export async function uploadFile(req: Req, userId: string): Promise<FileRow> {
  const name = (req.query.get("name") || "untitled").slice(0, 240);
  const boardId = req.query.get("board");
  const mime = (req.headers["content-type"] || "application/octet-stream").split(";")[0];
  const body = await readBody(req);
  if (!body.length) throw new HttpError(400, "empty file");
  return storeFile(body, { name, mime, boardId, userId });
}

/**
 * Keep bytes in the archive as a file (content-addressed; the same bytes on
 * the same board are one file, not two). `about` is extra searchable text —
 * where an imported image came from (a Slack channel, its message).
 */
export async function storeFile(body: Buffer, f: { name: string; mime: string; boardId: string | null; userId: string; about?: string }): Promise<FileRow> {
  const { name, mime, boardId, userId } = f;
  const sha = createHash("sha256").update(body).digest("hex");
  const same = one<FileRow>("select * from files where sha256 = ? and board_id is ? and archived_at is null", sha, boardId);
  if (same) return same;
  const dest = filePath(sha);
  if (!existsSync(dest)) {
    const tmp = `${dest}.${randomBytes(4).toString("hex")}.part`;
    await writeFile(tmp, body);
    await rename(tmp, dest);
  }
  const id = `f_${randomBytes(8).toString("hex")}`;
  run(
    "insert into files (id, board_id, name, mime, size, sha256, uploaded_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
    id, boardId, name, mime, body.length, sha, userId, Date.now(),
  );
  indexDoc("file", id, boardId, name, `${extractText(name, mime, body)}${f.about ? ` ${f.about}` : ""}`);
  return one<FileRow>("select * from files where id = ?", id)!;
}

/**
 * Store bytes that came from elsewhere (the flowform importer) under a known
 * id. Content-addressed like an upload; an id that already exists is left as
 * it is (its bytes never change), and an archived source stays archived.
 */
export async function storeImportedFile(f: {
  id: string;
  boardId: string | null;
  name: string;
  mime: string;
  body: Buffer;
  uploadedBy: string | null;
  createdAt: number;
  archivedAt: number | null;
}): Promise<{ created: boolean }> {
  if (one("select id from files where id = ?", f.id)) return { created: false };
  const sha = createHash("sha256").update(f.body).digest("hex");
  const dest = filePath(sha);
  if (!existsSync(dest)) {
    const tmp = `${dest}.${randomBytes(4).toString("hex")}.part`;
    await writeFile(tmp, f.body);
    await rename(tmp, dest);
  }
  run(
    "insert into files (id, board_id, name, mime, size, sha256, uploaded_by, created_at, archived_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    f.id, f.boardId, f.name.slice(0, 240), f.mime, f.body.length, sha, f.uploadedBy, f.createdAt, f.archivedAt,
  );
  if (!f.archivedAt) indexDoc("file", f.id, f.boardId, f.name, extractText(f.name, f.mime, f.body));
  return { created: true };
}

function extractText(name: string, mime: string, body: Buffer): string {
  const ext = extname(name).toLowerCase();
  if (CAD_EXT.has(ext)) return cadHeaderText(body.subarray(0, 64 * 1024).toString("latin1"));
  if (TEXT_EXT.has(ext) || mime.startsWith("text/") || mime === "application/json") {
    return body.subarray(0, 2 * 1024 * 1024).toString("utf8");
  }
  return `${name} ${mime}`;
}

/** STEP: FILE_DESCRIPTION / FILE_NAME / PRODUCT('name', ...) entries. IGES: the start section. */
export function cadHeaderText(head: string): string {
  const out: string[] = [];
  // statements end at ");" — values themselves may hold ";" (e.g. the '2;1' implementation level)
  for (const m of head.matchAll(/FILE_(?:NAME|DESCRIPTION)\s*\(([\s\S]*?)\);/g)) out.push(m[1]);
  for (const m of head.matchAll(/PRODUCT\s*\(\s*'([^']*)'\s*,\s*'([^']*)'/g)) out.push(m[1], m[2]);
  if (!out.length) out.push(head.split("\n").filter((l) => /S\s*\d+\s*$/.test(l)).join(" "));
  return out.join(" ").replace(/\s+/g, " ").slice(0, 4000);
}

export function listFiles(boardId?: string | null) {
  return boardId
    ? all<FileRow>("select * from files where board_id = ? and archived_at is null order by created_at desc limit 500", boardId)
    : all<FileRow>("select * from files where archived_at is null order by created_at desc limit 500");
}

export function archiveFile(id: string) {
  run("update files set archived_at = ? where id = ? and archived_at is null", Date.now(), id);
}

/** Stream a file with HTTP range support so video scrubs and big CAD files stream. */
export function serveFile(req: Req, res: ServerResponse, id: string) {
  const row = one<FileRow>("select * from files where id = ?", id);
  if (!row) throw new HttpError(404, "no such file");
  const path = filePath(row.sha256);
  const size = statSync(path).size;
  const headers: Record<string, string | number> = {
    "content-type": row.mime,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=31536000, immutable",
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
  };
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    createReadStream(path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, "content-length": size });
  if (req.method === "HEAD") return res.end();
  createReadStream(path).pipe(res);
}

export async function readFileText(id: string, max = 200_000): Promise<string> {
  const row = one<FileRow>("select * from files where id = ?", id);
  if (!row) throw new HttpError(404, "no such file");
  const buf = await readFile(filePath(row.sha256));
  return extractText(row.name, row.mime, buf).slice(0, max);
}

/** after an index rebuild, put every live file back into search */
export function reindexFilesIfNeeded() {
  if (!needsFileReindex) return;
  for (const f of all<FileRow>("select * from files where archived_at is null")) {
    try {
      indexDoc("file", f.id, f.board_id, f.name, extractText(f.name, f.mime, readFileSync(filePath(f.sha256))));
    } catch {
      /* missing bytes: leave it out of search */
    }
  }
}
