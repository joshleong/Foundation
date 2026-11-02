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
  isHostable,
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
import { attachToStage, chooseArtifact, completeStage, describePipeline, setChecklist, startPipeline, updateStageSettings } from "./pipeline.ts";
import { stageDef } from "@foundation/protocol";

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
/** Vision briefs land in the pipeline's fourth column, level with the stage that wrote them */
const BRIEF_X = 1560;

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
  stage: [460, 440],
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
    const m = boardMaps(doc);
    // an app opened into an empty section becomes that section's app
    const empty = ![...m.objects.values()].some((o) => o.sectionId === sec.id);
    m.objects.set(panel.id, panel);
    if (empty && isHostable(panel.panel)) m.sections.set(sec.id, { ...sec, host: panel.id });
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
  // ---------- design pipelines: design → CAD → simulation → release ----------
  def({
    name: "start_design_pipeline",
    description:
      "Start a design pipeline for a new part or product: a section with six wired stage panels — Brief → Concept → CAD → Simulate → Review → Release. Each stage collects artifacts and hands its output to the next when completed.",
    schema: z.object({
      name: z.string().describe("short product/part name, e.g. 'Rim-drive fan v3'"),
      goal: z.string().describe("the brief: what it is, for whom, and how we know it's right"),
      owner: z.string().optional(),
      cad_owner: z.string().optional().describe("who models it (Hermes will ask them for the STEP)"),
      reviewers: z.array(z.string()).optional(),
      analysis: z.string().optional().describe("what to simulate: CFD, FEA, thermal, RF, motion …"),
      request_id: z.string().optional(),
    }),
    write: true,
    run: (ctx, i) => {
      const r = startPipeline(ctx.boardId, ctx.actor, { name: i.name, goal: i.goal, owner: i.owner, cadOwner: i.cad_owner, reviewers: i.reviewers, analysis: i.analysis });
      touch(ctx, r.stages[0].id, `started the design pipeline “${i.name}”`);
      return r;
    },
  }),
  def({
    name: "pipeline_status",
    description: "Read a design pipeline: each stage, its status (idle = waiting, open = active, done), owner and artifacts (CAD with its measured size). Pass the pipeline id, its section, or the product's name.",
    schema: z.object({ pipeline: z.string().describe("pipeline id, section id/name, or product name") }),
    run: (ctx, { pipeline }) => describePipeline(ctx.boardId, pipeline) || "no such pipeline",
  }),
  def({
    name: "stage_attach",
    description: "Attach an uploaded file (by file_id) or a link to a pipeline stage. STEP files are measured (units, bounding box, faces) and the stage checklist ticks itself where the evidence is clear.",
    schema: z.object({ stage_panel: z.string(), file_id: z.string().optional(), url: z.string().optional(), name: z.string().optional(), note: z.string().optional() }),
    write: true,
    run: async (ctx, i) => {
      if (!i.file_id && !i.url) throw new Error("give a file_id or a url");
      const art = await attachToStage(ctx.boardId, i.stage_panel, { fileId: i.file_id, url: i.url, name: i.name, note: i.note }, ctx.actor);
      touch(ctx, i.stage_panel, `attached ${art.name}`);
      return art;
    },
  }),
  def({
    name: "stage_choose",
    description: "Star the artifact a stage takes forward (e.g. the chosen concept render).",
    schema: z.object({ stage_panel: z.string(), artifact_id: z.string() }),
    write: true,
    run: (ctx, i) => {
      chooseArtifact(ctx.boardId, i.stage_panel, i.artifact_id);
      return "chosen";
    },
  }),
  def({
    name: "stage_check",
    description: "Tick or untick a stage checklist item by its index.",
    schema: z.object({ stage_panel: z.string(), index: z.number().int(), done: z.boolean() }),
    write: true,
    run: (ctx, i) => {
      setChecklist(ctx.boardId, i.stage_panel, i.index, i.done);
      return "ok";
    },
  }),
  def({
    name: "stage_settings",
    description: "Set a stage's settings (e.g. simulate: analysis=CFD, loads='3 m/s inlet', target='< 45 dB') and/or its owner.",
    schema: z.object({ stage_panel: z.string(), settings: z.record(z.string()).default({}), owner: z.string().optional() }),
    write: true,
    run: (ctx, i) => {
      updateStageSettings(ctx.boardId, i.stage_panel, i.settings, i.owner);
      return "ok";
    },
  }),
  def({
    name: "complete_stage",
    description:
      "Complete a pipeline stage: its chosen (or latest) artifact goes out on its wire and the next stage opens. For the Review stage pass decision 'approved' or 'changes' (changes reopens CAD and Simulate). Only complete a stage when its work is really done — ask the person if unsure.",
    schema: z.object({ stage_panel: z.string(), decision: z.enum(["approved", "changes"]).optional() }),
    write: true,
    run: (ctx, i) => {
      const r = completeStage(ctx.boardId, i.stage_panel, ctx.actor, i.decision);
      touch(ctx, r.next ?? i.stage_panel, r.sentBack ? "sent the design back for changes" : "completed a stage");
      return r;
    },
  }),
  def({
    name: "stage_request",
    description:
      "Run a stage's hand-off to people and studios: for CAD, Hermes asks the CAD owner for the STEP and delivers it to the stage when it lands; for Concept or Simulate, writes a Vision brief from the stage (with the chosen concept or the CAD and the analysis settings) and opens Vision; for Review, asks every reviewer.",
    schema: z.object({ stage_panel: z.string(), who: z.string().optional().describe("override the person to ask") }),
    write: true,
    run: (ctx, { stage_panel, who }) => {
      const doc = getBoard(ctx.boardId).doc;
      const p = boardMaps(doc).objects.get(stage_panel);
      if (!p || p.kind !== "panel" || p.panel !== "stage") throw new Error("not a stage panel");
      const def = stageDef(p.stage)!;
      const section = boardMaps(doc).sections.get(p.sectionId)?.name;
      const product = (section ?? "the design").replace(/^Design · /, "");
      if (p.stage === "cad") {
        const assignee = who ?? p.assignee;
        if (!assignee) throw new Error("who models it? set the CAD owner (stage_settings owner) or pass who");
        const ask = createAsk(ctx, { assignee, prompt: `Upload the STEP for ${product} to its CAD stage.`, kind: "cad_upload", section, stagePanelId: p.id });
        touch(ctx, p.id, `asked ${assignee} for the ${product} CAD`);
        return { ask: ask.id, card: ask.panelId };
      }
      if (p.stage === "review") {
        const people = (who ?? p.assignee ?? "").split(",").map((x) => x.trim()).filter(Boolean);
        if (!people.length) throw new Error("who reviews it? set reviewers on the stage or pass who");
        const asks = people.map((r) => createAsk(ctx, { assignee: r, prompt: `Review ${product}: the CAD and the simulation results, then approve or request changes on the Review stage.`, kind: "review", section }));
        touch(ctx, p.id, `asked ${people.join(", ")} to review ${product}`);
        return { asks: asks.map((a) => a.id) };
      }
      if (p.stage === "concept" || p.stage === "simulate") {
        const stages = [...boardMaps(doc).objects.values()].filter((o): o is PanelDoc => o.kind === "panel" && o.panel === "stage" && o.pipeline === p.pipeline);
        const brief = stages.find((s) => s.stage === "brief");
        const cad = stages.find((s) => s.stage === "cad");
        const cadArt = cad?.artifacts?.filter((a) => a.kind === "cad").pop();
        const settings = Object.entries(p.settings ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ");
        const md =
          p.stage === "concept"
            ? `## Concepts for ${product}\n\n**Brief** ${brief?.text ?? ""}\n\nExplore at least two directions in Vision; drop renders on the Concept stage and star the one to take forward.`
            : `## Simulate ${product}\n\n**Model** ${cadArt ? `${cadArt.name}${cadArt.note ? ` — ${cadArt.note}` : ""}` : "(no CAD yet)"}\n\n**Analysis** ${settings || "set analysis and loads on the stage"}\n\nRun it in Vision and drop the results (plots, CSV, report) on the Simulate stage.`;
        const noteId = editBoard(ctx.boardId, "agent", (d) => {
          const n: NoteDoc = { id: uid("note"), kind: "note", sectionId: p.sectionId, name: `Vision brief · ${def.title}`, x: BRIEF_X, y: p.y, float: true, bornAt: Date.now(), w: 420, h: 260, text: md };
          boardMaps(d).objects.set(n.id, n);
          return n.id;
        });
        if (p.status === "idle") editBoard(ctx.boardId, "agent", (d) => boardMaps(d).objects.set(p.id, { ...p, status: "open" }));
        touch(ctx, p.id, `briefed Vision for ${def.title.toLowerCase()} of ${product}`);
        return { brief: noteId, vision: process.env.VISION_URL || "http://localhost:1420" };
      }
      throw new Error(`${def.title} has no hand-off — complete it when it's done`);
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
