/**
 * Live company data — the apps Form Industries runs on, read where they live:
 *
 * - FactoryForm (Express + SQLite, :3001): ERP summary, stations, work orders,
 *   and an SSE refresh stream. No CORS there, so Foundation reads it server-side.
 * - BomForm (remote MCP, stateless JSON-RPC over HTTP, bearer + private CA):
 *   projects, certification progress, critical components, BOM costs.
 * - Vision (desktop): no HTTP API yet — the connector reports what's reachable
 *   (Vision Code/T3 on :3783, the Archive on :63727).
 * - Airform Data Room: public site, linked.
 *
 * Every connector answers { ok, summary, metrics, flows } so the company
 * view can draw any of them the same way, and says plainly when it's offline.
 */

import { EventEmitter } from "node:events";
import { config } from "./config.ts";
import { callMcpTool } from "./mcpclient.ts";
import { one } from "./db.ts";

export interface ConnectorState {
  id: string;
  name: string;
  ok: boolean;
  url: string;
  summary: string;
  metrics: Array<{ label: string; value: string | number; tone?: "ok" | "warn" | "bad" }>;
  /** small visual strips: one dot per thing (stations by status, cert items …) */
  strips?: Array<{ label: string; dots: Array<{ name: string; tone: "ok" | "warn" | "bad" | "idle" }> }>;
  /** short lists worth reading: open alerts, overdue POs … */
  lists?: Array<{ title: string; items: Array<{ text: string; tone?: "ok" | "warn" | "bad" }> }>;
  /** where the numbers come from, when it isn't the live system of record */
  provenance?: string;
  /** the badge: "prototype", "demo data" … */
  provenanceLabel?: string;
  /** pushed live (event stream) rather than polled */
  live?: boolean;
  detail?: unknown;
  checkedAt: number;
}

/** The company map: which app feeds which, and with what. */
export const COMPANY_FLOWS: Array<{ from: string; to: string; carries: string }> = [
  { from: "vision", to: "bomform", carries: "designs → parts & BOM lines" },
  { from: "bomform", to: "factoryform", carries: "BOMs & critical parts (packs, shared SKU NNNNN-NNNNN)" },
  { from: "bomform", to: "dataroom", carries: "cert progress & costs (daily sync)" },
  { from: "factoryform", to: "dataroom", carries: "builds, inventory value" },
  { from: "factoryform", to: "foundation", carries: "stations, work orders, alerts (live SSE)" },
  { from: "creation", to: "vision", carries: "brand & merchandise designs" },
  { from: "foundation", to: "vision", carries: "design briefs from agents" },
];

export const CONNECTORS = [
  { id: "vision", name: "Vision", role: "Design, simulation, CAD (ModelForm, ElectroForm, Lab)" },
  { id: "bomform", name: "BomForm", role: "BOMs, certification, critical components" },
  { id: "factoryform", name: "FactoryForm", role: "Inventory, stations, work orders, builds" },
  { id: "dataroom", name: "Airform Data Room", role: "Programs, economics, investors" },
  { id: "creation", name: "Creation", role: "Brand, merchandise, studio" },
  { id: "foundation", name: "Foundation", role: "This grid — people, apps and agents" },
];

const cache = new Map<string, ConnectorState>();
const TTL = 20_000;

async function timed<T>(p: Promise<T>, ms = 3000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timed out")), ms))]);
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await timed(fetch(url, { headers }));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

interface FfBootstrap {
  stations?: Array<{ id: string; name: string; shortName?: string; status: string; wip?: number; provenance?: string }>;
  units?: Array<{ id: string; serial: string; status: string; stationId?: string | null; provenance?: string }>;
  alerts?: Array<{ id: string; title: string; severity: string; status: string; provenance?: string }>;
  purchaseOrders?: Array<{ id: string; status?: string; provenance?: string }>;
  bom?: unknown[];
  deployments?: unknown[];
  meta?: { mode?: string; demoData?: boolean; sourceSnapshotDate?: string };
}

async function factoryform(): Promise<ConnectorState> {
  const base = config.connectors.factoryform.replace(/\/$/, "");
  const [s, boot] = await Promise.all([
    getJson<{ items: number; inventoryValue: number; negativeStock: number; belowReorderPoint: number; openPurchaseOrders: number; overduePurchaseOrders: number; buildsThisMonth: number }>(`${base}/api/erp/summary`),
    getJson<FfBootstrap>(`${base}/api/bootstrap`).catch(() => ({}) as FfBootstrap),
  ]);
  const stations = boot.stations ?? [];
  const units = boot.units ?? [];
  const alerts = (boot.alerts ?? []).filter((a) => a.status !== "resolved" && a.status !== "closed");
  const inProgress = units.filter((u) => u.status !== "completed" && u.status !== "shipped").length;
  const completed = units.filter((u) => u.status === "completed" || u.status === "shipped").length;
  const attention = stations.filter((st) => st.status === "attention").length;
  // FactoryForm's rule: provenance is shown, never hidden — say exactly what's demo and what's imported
  const count = (xs: Array<{ provenance?: string }>, p: string) => xs.filter((x) => x.provenance === p).length;
  const parts: string[] = [];
  if (count(stations, "demo")) parts.push(`stations demo`);
  if (count(units, "imported")) parts.push(`${count(units, "imported")} units imported${boot.meta?.sourceSnapshotDate ? ` (snapshot ${boot.meta.sourceSnapshotDate})` : ""}`);
  if (count(boot.alerts ?? [], "demo")) parts.push(`${count(boot.alerts ?? [], "demo")} demo alerts`);
  const provenance = boot.meta?.demoData || boot.meta?.mode === "prototype" ? `${boot.meta?.mode ?? "demo"}: ${parts.join(" · ")}` : undefined;
  const provenanceLabel = boot.meta?.mode === "prototype" ? "prototype" : provenance ? "demo data" : undefined;
  const erp = s.items > 0;
  const tone = (st: string) => (st === "running" ? "ok" : st === "attention" ? "warn" : st === "down" || st === "blocked" ? "bad" : "idle") as "ok" | "warn" | "bad" | "idle";
  return {
    id: "factoryform",
    name: "FactoryForm",
    ok: true,
    url: base,
    live: watching.has("factoryform"),
    provenance,
    provenanceLabel,
    summary: `${stations.length} stations · ${inProgress} units in progress · ${completed} completed${erp ? ` · $${Math.round(s.inventoryValue).toLocaleString()} on hand` : ""}`,
    metrics: [
      { label: "Units in progress", value: inProgress },
      { label: "Stations needing attention", value: attention, tone: attention ? "warn" : "ok" },
      { label: "Open alerts", value: alerts.length, tone: alerts.length ? "warn" : "ok" },
      ...(erp
        ? [
            { label: "Inventory value", value: `$${Math.round(s.inventoryValue).toLocaleString()}` },
            { label: "Below reorder", value: s.belowReorderPoint, tone: s.belowReorderPoint ? ("warn" as const) : ("ok" as const) },
            { label: "Overdue POs", value: s.overduePurchaseOrders, tone: s.overduePurchaseOrders ? ("warn" as const) : ("ok" as const) },
          ]
        : [
            { label: "Purchase orders", value: (boot.purchaseOrders ?? []).length },
            { label: "BOM lines", value: (boot.bom ?? []).length },
            { label: "Inventory (ERP)", value: "not imported" },
          ]),
    ],
    strips: stations.length ? [{ label: "Stations", dots: stations.map((st) => ({ name: `${st.shortName ?? st.name} · ${st.status}${st.wip ? ` · ${st.wip} WIP` : ""}`, tone: tone(st.status) })) }] : undefined,
    lists: alerts.length ? [{ title: "Open alerts", items: alerts.slice(0, 3).map((a) => ({ text: a.title, tone: a.severity === "critical" ? ("bad" as const) : ("warn" as const) })) }] : undefined,
    detail: { summary: s, stations, alerts },
    checkedAt: Date.now(),
  };
}

// ---------- live: FactoryForm's event stream ----------

/** emits "change" with a connector id whenever a pushed update lands */
export const connectorEvents = new EventEmitter();
connectorEvents.setMaxListeners(200);
const watching = new Set<string>();

/**
 * Follow FactoryForm's SSE stream (/api/events): every `refresh` drops the
 * cached state and tells every open Foundation client to refetch — the floor
 * updates on the board within a second instead of the 20 s poll.
 */
export function watchFactoryForm() {
  const base = config.connectors.factoryform.replace(/\/$/, "");
  let backoff = 1000;
  const connect = async () => {
    try {
      const res = await fetch(`${base}/api/events`, { headers: { accept: "text/event-stream" } });
      if (!res.ok || !res.body) throw new Error(`${res.status}`);
      watching.add("factoryform");
      backoff = 1000;
      cache.delete("factoryform");
      connectorEvents.emit("change", "factoryform");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (/^event:\s*refresh/m.test(chunk)) {
            cache.delete("factoryform");
            connectorEvents.emit("change", "factoryform");
          }
        }
      }
      throw new Error("stream ended");
    } catch {
      if (watching.delete("factoryform")) {
        cache.delete("factoryform");
        connectorEvents.emit("change", "factoryform");
      }
      setTimeout(connect, backoff);
      backoff = Math.min(30_000, backoff * 2);
    }
  };
  void connect();
}

async function bomform(): Promise<ConnectorState> {
  const url = process.env.BOMFORM_MCP_URL;
  const key = process.env.BOMFORM_API_KEY;
  if (!url || !key) throw new Error("BOMFORM_MCP_URL / BOMFORM_API_KEY not set (private CA: point NODE_EXTRA_CA_CERTS at BomForm's CA)");
  const headers = { authorization: `Bearer ${key}` };
  const certs = await timed(callMcpTool(url, "list_cert_projects", {}, headers), 6000);
  const critical = await timed(callMcpTool(url, "list_critical_components", {}, headers), 6000).catch(() => null);
  let certRows: Array<{ code: string; name: string; itemsTotal: number; itemsResolved: number }> = [];
  try {
    const parsed = JSON.parse(certs.text);
    certRows = Array.isArray(parsed) ? parsed : (parsed.certProjects ?? []);
  } catch {
    /* text answer */
  }
  const total = certRows.reduce((a, c) => a + (c.itemsTotal ?? 0), 0);
  const resolved = certRows.reduce((a, c) => a + (c.itemsResolved ?? 0), 0);
  return {
    id: "bomform",
    name: "BomForm",
    ok: true,
    url,
    summary: certRows.length ? `${certRows.length} certification programs · ${resolved}/${total} items resolved` : certs.text.slice(0, 160),
    metrics: [
      { label: "Cert programs", value: certRows.length },
      { label: "Cert items resolved", value: total ? `${Math.round((resolved / total) * 100)}%` : "unknown" },
      { label: "Critical components", value: critical ? critical.text.split("\n").length : "unknown" },
    ],
    detail: { certRows },
    checkedAt: Date.now(),
  };
}

async function probe(id: string, name: string, url: string, path = "/"): Promise<ConnectorState> {
  const res = await timed(fetch(url.replace(/\/$/, "") + path, { method: "GET" }), 2500);
  return { id, name, ok: res.ok, url, summary: res.ok ? "reachable" : `answered ${res.status}`, metrics: [], checkedAt: Date.now() };
}

function foundation(): ConnectorState {
  const n = (sql: string, ...p: unknown[]) => (one<{ n: number }>(sql, ...p)?.n ?? 0);
  const day = Date.now() - 864e5;
  const boards = n("select count(*) n from boards");
  const files = n("select count(*) n from files where archived_at is null");
  const asks = n("select count(*) n from asks where status = 'open'");
  const runs = n("select count(*) n from agent_runs where created_at > ?", day);
  const people = n("select count(*) n from users");
  return {
    id: "foundation",
    name: "Foundation",
    ok: true,
    url: config.publicUrl,
    summary: `${people} people · ${boards} boards · ${files} files`,
    metrics: [
      { label: "Boards", value: boards },
      { label: "Files", value: files },
      { label: "Open asks", value: asks, tone: asks ? "warn" : "ok" },
      { label: "Agent runs today", value: runs },
      { label: "People", value: people },
    ],
    checkedAt: Date.now(),
  };
}

async function creation(): Promise<ConnectorState> {
  const app = process.env.CREATION_URL || "http://127.0.0.1:5173";
  const hubUrl = process.env.CREATION_HUB_URL || "http://127.0.0.1:4317";
  const [appUp, hub] = await Promise.all([
    timed(fetch(app), 1500).then((r) => r.ok).catch(() => false),
    timed(fetch(`${hubUrl}/v1/health`), 1500)
      .then((r) => (r.ok ? (r.json() as Promise<{ version?: string }>) : null))
      .catch(() => null),
  ]);
  if (!appUp && !hub) throw new Error("not running — `npm run services` starts it beside Foundation");
  return {
    id: "creation",
    name: "Creation",
    ok: true,
    url: app,
    summary: [appUp ? `studio at ${app.replace(/^https?:\/\//, "")}` : null, hub ? `Hub v${hub.version ?? "?"} (agents + key vault)` : null].filter(Boolean).join(" · "),
    metrics: [
      { label: "Studio", value: appUp ? "up" : "down", tone: appUp ? "ok" : "warn" },
      { label: "Creation Hub", value: hub ? "up" : "down", tone: hub ? "ok" : "warn" },
    ],
    checkedAt: Date.now(),
  };
}

async function vision(): Promise<ConnectorState> {
  const reach: string[] = [];
  const t3 = await timed(fetch("http://127.0.0.1:3783/.well-known/t3/environment"), 1200).then((r) => r.ok).catch(() => false);
  if (t3) reach.push("Vision Code (T3) on :3783");
  const archive = await timed(fetch("http://127.0.0.1:63727/api/health"), 1200).then((r) => r.ok).catch(() => false);
  if (archive) reach.push("Archive on :63727");
  const web = await timed(fetch(config.connectors.vision), 1200).then((r) => r.ok).catch(() => false);
  if (web) reach.push(`browser edition at ${config.connectors.vision}`);
  return {
    id: "vision",
    name: "Vision",
    ok: reach.length > 0,
    url: config.connectors.vision,
    summary: reach.length ? reach.join(" · ") : "not running on this machine — open Vision to connect",
    metrics: [
      { label: "Vision Code (T3)", value: t3 ? "up" : "down", tone: t3 ? "ok" : "warn" },
      { label: "Archive", value: archive ? "up" : "down", tone: archive ? "ok" : "warn" },
    ],
    checkedAt: Date.now(),
  };
}

export async function readConnector(id: string, fresh = false): Promise<ConnectorState> {
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.checkedAt < TTL) return hit;
  const meta = CONNECTORS.find((c) => c.id === id);
  let state: ConnectorState;
  try {
    if (id === "factoryform") state = await factoryform();
    else if (id === "bomform") state = await bomform();
    else if (id === "vision") state = await vision();
    else if (id === "dataroom") state = await probe(id, "Airform Data Room", config.connectors.dataroom);
    else if (id === "foundation") state = foundation();
    else if (id === "creation") state = await creation();
    else throw new Error("unknown connector");
  } catch (e) {
    state = {
      id,
      name: meta?.name ?? id,
      ok: false,
      url: "",
      summary: `offline — ${(e as Error).message}`,
      metrics: [],
      checkedAt: Date.now(),
    };
  }
  cache.set(id, state);
  return state;
}

export async function companySnapshot(fresh = false) {
  const states = await Promise.all(CONNECTORS.map((c) => readConnector(c.id, fresh)));
  return { connectors: CONNECTORS.map((c, i) => ({ ...c, state: states[i] })), flows: COMPANY_FLOWS };
}
