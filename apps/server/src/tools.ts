/**
 * The board's tool surface — one definition, three doors:
 *   1. the Foundation agent (Anthropic API tool use),
 *   2. Foundation's own MCP endpoint (/mcp) for Claude Code, Vision, Codex …
 *   3. REST (/api/boards/:id/tools/:name) for scripts and apps.
 *
 * Rules carried over from flowform-server's agent canvas: every write names
 * its board explicitly, writes are idempotent by request_id, deletes need
 * confirm: true, and the acting agent shows up as a live presence on the
 * board so people can see what it is touching.
 */

import { z } from "zod";
import * as Y from "yjs";
import {
  appendSection,
  boardMaps,
  describeBoard,
  findSection,
  logActivity,
  uid,
  type LinkDoc,
  type NoteDoc,
  type PanelDoc,
  type PanelKind,
  type Port,
} from "@foundation/protocol";
import { editBoard, getBoard } from "./boards.ts";
import { searchAll } from "./search.ts";
import { discoverRepo, parseRepo, repoCommits, repoInfo, repoReadme } from "./github.ts";
import { callMcpTool, listMcpTools } from "./mcpclient.ts";
import { companySnapshot, readConnector } from "./connectors.ts";
import { createAsk } from "./hermes.ts";
import { queueJob } from "./jobs.ts";
import { readFileText } from "./files.ts";

export interface ToolCtx {
  boardId: string;
  actor: string; // display name of the agent or person acting
  userId: string;
}

export interface BoardTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  write?: boolean;
  run: (ctx: ToolCtx, input: z.infer<S>) => Promise<unknown> | unknown;
}

const seenRequests = new Map<string, unknown>();

/** typed at the definition, erased in the list */
function def<S extends z.ZodTypeAny>(t: BoardTool<S>): BoardTool {
  return t as unknown as BoardTool;
}

const portSchema = z.object({
  name: z.string(),
  dir: z.enum(["in", "out"]),
  type: z.string().optional().describe("json | text | number | image | cad | bom"),
});

const PANEL_SIZES: Record<PanelKind, [number, number]> = {
  app: [720, 520],
  link: [640, 460],
  file: [420, 340],
  machine: [760, 520],
  agent: [420, 360],
  connector: [460, 320],
  ask: [380, 220],
};

function sectionOrCreate(doc: Y.Doc, section?: string) {
  if (section) {
    const found = findSection(doc, section);
    if (found) return found;
    return appendSection(doc, section);
  }
  const first = [...boardMaps(doc).sections.values()][0];
  return first ?? appendSection(doc, "Workspace");
}

function touch(ctx: ToolCtx, objectId: string | undefined, text: string) {
  const board = getBoard(ctx.boardId);
  // the agent's presence: a ring on whatever it's touching
  board.awareness.setLocalState({
    user: { name: `${ctx.actor}`, color: "#6b5bd6", agent: true },
    focus: objectId ?? null,
    at: Date.now(),
  });
  editBoard(ctx.boardId, "agent", (doc) => logActivity(doc, { who: ctx.actor, role: "agent", text, objectId }));
}

export function addPanel(
  ctx: ToolCtx,
  p: { section?: string; panel: PanelKind; name: string; url?: string; repo?: string; mcp?: string; text?: string; ports?: Array<Omit<Port, "id">>; connector?: string; fileId?: string; mime?: string; assignee?: string; status?: PanelDoc["status"]; w?: number; h?: number },
): PanelDoc {
  return editBoard(ctx.boardId, "agent", (doc) => {
    const sec = sectionOrCreate(doc, p.section);
    const [w, h] = PANEL_SIZES[p.panel];
    const panel: PanelDoc = {
      id: uid("pnl"),
      kind: "panel",
      panel: p.panel,
      sectionId: sec.id,
      name: p.name,
      x: 0,
      y: 0,
      float: false,
      bornAt: Date.now(),
      w: p.w ?? w,
      h: p.h ?? h,
      url: p.url,
      repo: p.repo ? (parseRepo(p.repo) ?? p.repo) : undefined,
      mcp: p.mcp,
      text: p.text,
      ports: (p.ports ?? []).map((pt) => ({ ...pt, id: uid("port") })),
      connector: p.connector,
      fileId: p.fileId,
      mime: p.mime,
      assignee: p.assignee,
      status: p.status,
      createdBy: ctx.actor,
    };
    for (const k of Object.keys(panel) as Array<keyof PanelDoc>) if (panel[k] === undefined) delete panel[k];
    boardMaps(doc).objects.set(panel.id, panel);
    return panel;
  });
}

function getPanel(doc: Y.Doc, id: string): PanelDoc {
  const o = boardMaps(doc).objects.get(id);
  if (!o || o.kind !== "panel") throw new Error(`no panel ${id}`);
  return o;
}

export const TOOLS: BoardTool[] = [
  def({
    name: "read_board",
    description: "Read the whole board as an outline: sections, every card (notes, tables, apps, files, agents, asks) with ids, and the connections between app ports. Start here.",
    schema: z.object({}),
    run: (ctx) => describeBoard(getBoard(ctx.boardId).doc),
  }),
  def({
    name: "search",
    description: "Search everything Foundation can see: board cards, uploaded files (full text and CAD headers), Slack, GitHub repos and registered apps.",
    schema: z.object({ query: z.string() }),
    run: async (ctx, { query }) => {
      const { hits } = await searchAll(query, { boardId: ctx.boardId });
      return hits.slice(0, 15).map((h) => `[${h.source}] ${h.title}${h.objectId ? ` (card ${h.objectId})` : ""}${h.url ? ` ${h.url}` : ""} — ${h.snippet}`).join("\n") || "no results";
    },
  }),
  def({
    name: "focus",
    description: "Move everyone's attention to a card: shows the agent's ring on it. Use after creating or when pointing something out.",
    schema: z.object({ object_id: z.string(), note: z.string().optional() }),
    run: (ctx, { object_id, note }) => {
      touch(ctx, object_id, note ?? "pointed at a card");
      return "ok";
    },
  }),
  def({
    name: "add_section",
    description: "Add a new section (a column of the grid) with a name. Use sections to organize: one per project, team or flow.",
    schema: z.object({ name: z.string(), request_id: z.string().optional() }),
    write: true,
    run: (ctx, { name }) => {
      const sec = editBoard(ctx.boardId, "agent", (doc) => findSection(doc, name) ?? appendSection(doc, name));
      touch(ctx, undefined, `added section “${name}”`);
      return sec;
    },
  }),
  def({
    name: "add_note",
    description: "Add a markdown note card to a section (created if missing).",
    schema: z.object({ section: z.string().optional(), title: z.string(), markdown: z.string(), request_id: z.string().optional() }),
    write: true,
    run: (ctx, { section, title, markdown }) => {
      const note = editBoard(ctx.boardId, "agent", (doc) => {
        const sec = sectionOrCreate(doc, section);
        const n: NoteDoc = { id: uid("note"), kind: "note", sectionId: sec.id, name: title, x: 0, y: 0, float: false, bornAt: Date.now(), w: 420, h: 300, text: markdown };
        boardMaps(doc).objects.set(n.id, n);
        return n;
      });
      touch(ctx, note.id, `wrote “${title}”`);
      return { id: note.id };
    },
  }),
  def({
    name: "add_panel",
    description:
      "Put a live panel on the board: an app (any URL — vibe-coded apps, dashboards; with its GitHub repo and MCP endpoint), a web link, a machine (VM/container/remote desktop URL such as noVNC, ttyd or code-server), a connector (company data: factoryform, bomform, vision, dataroom, creation), or an agent card. Ports declare the app's inputs and outputs so it can be wired to others.",
    schema: z.object({
      section: z.string().optional(),
      panel: z.enum(["app", "link", "machine", "connector", "agent"]),
      name: z.string(),
      url: z.string().optional(),
      repo: z.string().optional().describe("owner/name or GitHub URL"),
      mcp: z.string().optional().describe("the app's MCP endpoint URL"),
      text: z.string().optional().describe("what this is, in a sentence"),
      connector: z.string().optional(),
      ports: z.array(portSchema).optional(),
      request_id: z.string().optional(),
    }),
    write: true,
    run: (ctx, input) => {
      const p = addPanel(ctx, input);
      touch(ctx, p.id, `opened ${input.panel} “${input.name}”`);
      return { id: p.id, ports: p.ports };
    },
  }),
  def({
    name: "update_card",
    description: "Change a card: rename, move to another section, edit a note's markdown, or a panel's url/repo/mcp/text/status.",
    schema: z.object({
      id: z.string(),
      name: z.string().optional(),
      section: z.string().optional(),
      markdown: z.string().optional(),
      url: z.string().optional(),
      repo: z.string().optional(),
      mcp: z.string().optional(),
      text: z.string().optional(),
      status: z.enum(["open", "done", "running", "idle", "error"]).optional(),
      add_ports: z.array(portSchema).optional(),
    }),
    write: true,
    run: (ctx, { id, section, markdown, add_ports, ...patch }) => {
      editBoard(ctx.boardId, "agent", (doc) => {
        const m = boardMaps(doc);
        const o = m.objects.get(id);
        if (!o) throw new Error(`no card ${id}`);
        const next = { ...o } as Record<string, unknown>;
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v;
        if (section) {
          const sec = sectionOrCreate(doc, section);
          next.sectionId = sec.id;
          next.float = false;
        }
        if (markdown !== undefined && o.kind === "note") next.text = markdown;
        if (add_ports && o.kind === "panel") next.ports = [...o.ports, ...add_ports.map((p) => ({ ...p, id: uid("port") }))];
        m.objects.set(id, next as never);
      });
      touch(ctx, id, `updated a card`);
      return "ok";
    },
  }),
  def({
    name: "delete_card",
    description: "Remove a card from the board. Requires confirm: true. Uploaded files stay archived and searchable.",
    schema: z.object({ id: z.string(), confirm: z.boolean() }),
    write: true,
    run: (ctx, { id, confirm }) => {
      if (!confirm) return "not deleted: pass confirm: true after checking with the person";
      editBoard(ctx.boardId, "agent", (doc) => {
        const m = boardMaps(doc);
        m.objects.delete(id);
        for (const [lid, l] of m.links.entries()) if (l.from.panel === id || l.to.panel === id) m.links.delete(lid);
      });
      touch(ctx, undefined, `removed a card`);
      return "deleted";
    },
  }),
  def({
    name: "connect",
    description: "Wire an app's output port to another app's input port. Values the source emits flow to the target (delivered to the running app via the Foundation bridge).",
    schema: z.object({ from_panel: z.string(), from_port: z.string(), to_panel: z.string(), to_port: z.string(), label: z.string().optional() }),
    write: true,
    run: (ctx, i) => {
      const link = editBoard(ctx.boardId, "agent", (doc) => {
        const from = getPanel(doc, i.from_panel);
        const to = getPanel(doc, i.to_panel);
        const ensurePort = (p: PanelDoc, name: string, dir: "in" | "out") => {
          let port = p.ports.find((x) => x.name === name || x.id === name);
          if (!port) {
            port = { id: uid("port"), name, dir };
            boardMaps(doc).objects.set(p.id, { ...p, ports: [...p.ports, port] });
          }
          return port;
        };
        const fp = ensurePort(from, i.from_port, "out");
        const tp = ensurePort(getPanel(doc, i.to_panel), i.to_port, "in");
        const l: LinkDoc = { id: uid("lnk"), from: { panel: from.id, port: fp.id }, to: { panel: to.id, port: tp.id }, label: i.label, createdBy: ctx.actor };
        boardMaps(doc).links.set(l.id, l);
        return l;
      });
      touch(ctx, i.to_panel, `connected ${i.from_port} → ${i.to_port}`);
      return link;
    },
  }),
  def({
    name: "send_to_port",
    description: "Emit a value on an app's output port (or set an input directly) — downstream apps receive it live.",
    schema: z.object({ panel: z.string(), port: z.string(), value: z.any() }),
    write: true,
    run: (ctx, { panel, port, value }) => {
      editBoard(ctx.boardId, "agent", (doc) => {
        const p = getPanel(doc, panel);
        const pt = p.ports.find((x) => x.name === port || x.id === port);
        const key = pt?.id ?? port;
        boardMaps(doc).objects.set(p.id, { ...p, outputs: { ...(p.outputs ?? {}), [key]: value } });
      });
      touch(ctx, panel, `sent a value on ${port}`);
      return "sent";
    },
  }),
  def({
    name: "find_repo",
    description: "Find the GitHub repository behind an app (from its URL or a name), with description, homepage and last push.",
    schema: z.object({ app_url_or_name: z.string() }),
    run: async (_ctx, { app_url_or_name }) => {
      const direct = parseRepo(app_url_or_name);
      if (direct) return repoInfo(direct);
      const viaUrl = /^https?:/.test(app_url_or_name) ? await discoverRepo(app_url_or_name) : null;
      if (viaUrl) return viaUrl;
      const { searchRepos } = await import("./github.ts");
      return searchRepos(app_url_or_name, 5);
    },
  }),
  def({
    name: "read_repo",
    description: "Read a GitHub repo's README and recent commits — to understand an app before wiring or changing it.",
    schema: z.object({ repo: z.string() }),
    run: async (_ctx, { repo }) => {
      const r = parseRepo(repo) ?? repo;
      const [readme, commits] = await Promise.all([repoReadme(r).catch(() => "(no README)"), repoCommits(r).catch(() => [])]);
      return { readme: readme.slice(0, 12_000), commits };
    },
  }),
  def({
    name: "app_tools",
    description: "List the MCP tools an app on the board exposes (its panel needs an mcp URL).",
    schema: z.object({ panel: z.string() }),
    run: async (ctx, { panel }) => {
      const p = getPanel(getBoard(ctx.boardId).doc, panel);
      if (!p.mcp) return "this app has no MCP endpoint on its card (set mcp)";
      return listMcpTools(p.mcp);
    },
  }),
  def({
    name: "call_app_tool",
    description: "Call one of an app's MCP tools and (optionally) put the result on one of its output ports.",
    schema: z.object({ panel: z.string(), tool: z.string(), args: z.record(z.any()).default({}), to_port: z.string().optional() }),
    write: true,
    run: async (ctx, { panel, tool, args, to_port }) => {
      const p = getPanel(getBoard(ctx.boardId).doc, panel);
      if (!p.mcp) throw new Error("this app has no MCP endpoint");
      const result = await callMcpTool(p.mcp, tool, args);
      if (to_port) {
        editBoard(ctx.boardId, "agent", (doc) => {
          const cur = getPanel(doc, panel);
          const pt = cur.ports.find((x) => x.name === to_port || x.id === to_port);
          boardMaps(doc).objects.set(cur.id, { ...cur, outputs: { ...(cur.outputs ?? {}), [pt?.id ?? to_port]: result.structured ?? result.text } });
        });
      }
      touch(ctx, panel, `called ${tool}`);
      return result.text.slice(0, 8000);
    },
  }),
  def({
    name: "company",
    description: "Read the company's live systems — Vision, BomForm, FactoryForm, the Data Room, Creation — their health, key numbers and how data flows between them.",
    schema: z.object({ connector: z.string().optional().describe("one id for detail: factoryform, bomform, vision, dataroom, creation") }),
    run: async (_ctx, { connector }) => (connector ? readConnector(connector, true) : companySnapshot()),
  }),
  def({
    name: "read_file",
    description: "Read the text of an uploaded file (text, markdown, CSV, JSON, code; STEP/IGES header).",
    schema: z.object({ file_id: z.string() }),
    run: (_ctx, { file_id }) => readFileText(file_id, 40_000),
  }),
  def({
    name: "ask_person",
    description:
      "Hermes: ask a teammate for something and keep following up — most often to upload the latest CAD, a drawing, a photo or a decision. Creates an ask card on the board and a tracked request; nudges until it's answered.",
    schema: z.object({
      assignee: z.string().describe("name or email"),
      request: z.string(),
      kind: z.enum(["cad_upload", "file_upload", "review", "decision", "info"]).default("cad_upload"),
      section: z.string().optional(),
      due_hours: z.number().optional(),
    }),
    write: true,
    run: (ctx, i) => {
      const ask = createAsk(ctx, { assignee: i.assignee, prompt: i.request, kind: i.kind, section: i.section, dueHours: i.due_hours });
      touch(ctx, ask.panelId, `asked ${i.assignee}: ${i.request}`);
      return ask;
    },
  }),
  def({
    name: "vision_brief",
    description:
      "Hand a design to Vision: writes a design brief card (goal, constraints, what to simulate, who reviews), opens Vision on the board, and asks the reviewers. Vision's own agent picks the brief up from the board.",
    schema: z.object({
      title: z.string(),
      goal: z.string(),
      constraints: z.string().optional(),
      simulate: z.string().optional().describe("what to test or simulate (CFD, FEA, RF, thermal …)"),
      reviewers: z.array(z.string()).default([]),
      section: z.string().default("Design"),
    }),
    write: true,
    run: (ctx, i) => {
      const md = `## ${i.title}\n\n**Goal** ${i.goal}\n\n${i.constraints ? `**Constraints** ${i.constraints}\n\n` : ""}${i.simulate ? `**Simulate** ${i.simulate}\n\n` : ""}**Reviewers** ${i.reviewers.join(", ") || "—"}\n\n_Brief written by ${ctx.actor} for Vision. Status: waiting for Vision._`;
      const noteId = editBoard(ctx.boardId, "agent", (doc) => {
        const sec = sectionOrCreate(doc, i.section);
        const n: NoteDoc = { id: uid("note"), kind: "note", sectionId: sec.id, name: `Brief · ${i.title}`, x: 0, y: 0, float: false, bornAt: Date.now(), w: 440, h: 320, text: md };
        boardMaps(doc).objects.set(n.id, n);
        return n.id;
      });
      const visionUrl = process.env.VISION_URL || "http://localhost:1420";
      const already = [...boardMaps(getBoard(ctx.boardId).doc).objects.values()].find((o) => o.kind === "panel" && o.connector === "vision");
      const vision = already ?? addPanel(ctx, { section: i.section, panel: "app", name: "Vision", url: visionUrl, connector: "vision", text: "Design, simulate and test — Pacific Futures Studio", ports: [{ name: "brief", dir: "in", type: "json" }, { name: "design", dir: "out", type: "cad" }] });
      for (const r of i.reviewers) createAsk(ctx, { assignee: r, prompt: `Review the Vision brief “${i.title}”`, kind: "review", section: i.section });
      touch(ctx, noteId, `briefed Vision: ${i.title}`);
      return { brief: noteId, vision: vision.id };
    },
  }),
  def({
    name: "reverse_engineer",
    description:
      "Queue a reverse-engineering job with REA (Reverse Engineer Anything, MCP-based; github.com/morluto/rea) against a website, JS/Electron app, binary or repo the company owns or is authorized to examine. A person starts the job from its card; findings land on the board.",
    schema: z.object({ target: z.string(), goal: z.string(), section: z.string().optional() }),
    write: true,
    run: (ctx, { target, goal, section }) => {
      const job = queueJob(ctx, "rea", target, goal);
      const p = addPanel(ctx, { section: section ?? "Research", panel: "agent", name: `Reverse-engineer · ${target.replace(/^https?:\/\//, "").slice(0, 40)}`, text: goal, status: "idle" });
      editBoard(ctx.boardId, "agent", (doc) => {
        const cur = getPanel(doc, p.id);
        boardMaps(doc).objects.set(p.id, { ...cur, sessionId: job.id });
      });
      touch(ctx, p.id, `queued reverse-engineering of ${target}`);
      return { job: job.id, card: p.id, note: "waiting for a person to press Run on the card" };
    },
  }),
];

export function toolByName(name: string) {
  return TOOLS.find((t) => t.name === name);
}

/** Run a tool with idempotency on request_id and input validation. */
export async function runTool(ctx: ToolCtx, name: string, rawInput: unknown): Promise<unknown> {
  const tool = toolByName(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new Error(`invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const rid = (parsed.data as { request_id?: string }).request_id;
  const key = rid ? `${ctx.boardId}:${ctx.userId}:${rid}` : null;
  if (key && seenRequests.has(key)) return seenRequests.get(key);
  const out = await tool.run(ctx, parsed.data);
  if (key) {
    seenRequests.set(key, out);
    if (seenRequests.size > 2000) seenRequests.delete(seenRequests.keys().next().value!);
  }
  return out;
}
