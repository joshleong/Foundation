// A stand-in Slack for checks (SLACK_API_BASE): search.files, files.info and
// downloads, serving real PNGs — a few about the Airform PTHP, one not.
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

const port = Number(process.argv[2] ?? 4440);
const base = `http://127.0.0.1:${port}`;

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
/** a w×h picture: a soft diagonal gradient between two colours, with a band — enough to tell them apart */
function png(w, h, a, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [0];
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      const band = Math.abs(y - h * 0.62) < h * 0.04 ? 0.35 : 0;
      for (let k = 0; k < 3; k++) row.push(Math.round(a[k] * (1 - t) + b[k] * t + 255 * band) & 255);
    }
    rows.push(Buffer.from(row));
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

const FILES = [
  { id: "F1", name: "pthp-stack-rev3.png", title: "Airform PTHP stack, rev 3", w: 480, h: 320, ts: 1_789_500_000, a: [50, 91, 180], b: [143, 118, 238], who: "noa" },
  { id: "F2", name: "pthp-thermal-map.png", title: "Airform PTHP thermal map", w: 320, h: 420, ts: 1_790_400_000, a: [200, 122, 28], b: [228, 87, 78], who: "kai" },
  { id: "F3", name: "pthp-manifold.png", title: "PTHP manifold, printed", w: 420, h: 420, ts: 1_791_100_000, a: [46, 125, 84], b: [42, 176, 190], who: "noa" },
  { id: "F4", name: "pthp-airflow.png", title: "Airform PTHP airflow test", w: 520, h: 300, ts: 1_791_900_000, a: [100, 116, 139], b: [84, 184, 238], who: "josh" },
  { id: "F5", name: "lunch.png", title: "Team lunch", w: 300, h: 300, ts: 1_789_000_000, a: [192, 122, 16], b: [46, 93, 67], who: "noa" },
];
const meta = (f) => ({ id: f.id, name: f.name, title: f.title, mimetype: "image/png", timestamp: f.ts, username: f.who, channels: ["airform-pthp"], permalink: `https://slack.example/${f.id}`, url_private_download: `${base}/download/${f.id}` });

createServer((req, res) => {
  const url = new URL(req.url ?? "/", base);
  if (!/^Bearer xox[bp]-/.test(req.headers.authorization ?? "")) return res.writeHead(401).end();
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/search.files") {
    const words = (url.searchParams.get("query") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const hits = FILES.filter((f) => words.every((w) => `${f.name} ${f.title}`.toLowerCase().includes(w)));
    return res.end(JSON.stringify({ ok: true, files: { matches: hits.map(meta) } }));
  }
  if (url.pathname === "/files.list") return res.end(JSON.stringify({ ok: true, files: FILES.map(meta) }));
  if (url.pathname === "/files.info") {
    const f = FILES.find((x) => x.id === url.searchParams.get("file"));
    return res.end(JSON.stringify(f ? { ok: true, file: meta(f) } : { ok: false, error: "file_not_found" }));
  }
  if (url.pathname === "/auth.test") return res.end(JSON.stringify({ ok: true, team: "Form Industries (stand-in)", user: "foundation" }));
  const d = /^\/download\/(\w+)$/.exec(url.pathname);
  if (d) {
    const f = FILES.find((x) => x.id === d[1]);
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(png(f.w, f.h, f.a, f.b));
  }
  res.writeHead(404).end(JSON.stringify({ ok: false, error: "unknown_method" }));
}).listen(port, "127.0.0.1", () => console.log(`stand-in Slack on ${base}`));
