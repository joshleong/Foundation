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

import { queueHandoff } from "./vision.ts";
import { findImages, layOut } from "./construct.ts";
import { READ_TOOLS, canWrite } from "./roles.ts";
import { HttpError } from "./http.ts";
import { z } from "zod";
import * as Y from "yjs";
import {
  appendSection,
  boardMaps,
  describeBoard,
  findSection,
  isHostable,
  logActivity,
  MACHINE_DISTROS,
  uid,
  type LinkDoc,
  type NoteDoc,
  putNote,
  setNoteText,
  setTableCells,
  type TableDoc,
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
import { huddleArchive, transcriptText } from "./huddles.ts";
import { channelHistory, channelInfo, listChannels } from "./slack.ts";
import { describeMachines, proposeMachine, validImage } from "./machines.ts";
import { aim, canCallHelp, crewMember, describeStep, guide, resolveTarget, setDoing, stepTarget, travel, type CrewMember } from "./crew.ts";

export interface ToolCtx {
  boardId: string;
  actor: string; // display name of the agent or person acting
  userId: string;
  /** the crew member (a visible agent) acting, when it's one of Foundation's own runs */
  crew?: string;
}

export interface BoardTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  write?: boolean;
  run: (ctx: ToolCtx, input: z.infer<S>) => Promise<unknown> | unknown;
}

/** the crew agent making a card, when one is (people's cards leave createdBy unset) */
const madeBy = (ctx: ToolCtx) => (ctx.crew && crewMember(ctx.crew) ? ctx.actor : undefined);

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
  huddle: [560, 420],
  slack: [420, 520],
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

/**
 * The section a new card goes into. A hosted app fills its section, so a card
 * added there would be hidden under it: the app becomes a card in the flow
 * instead (what "Show as a card" does). A real crew turn hooked a connector up
 * first, then added a table and two notes that nobody could see (2026-11-07).
 */
function cardSection(doc: Y.Doc, section?: string) {
  const sec = sectionOrCreate(doc, section);
  if (!sec.host) return sec;
  const { host: _hosted, ...rest } = sec;
  boardMaps(doc).sections.set(sec.id, rest);
  return rest;
}

/**
 * Starts a helper run for call_in_help. agent.ts registers it (tools can't
 * import the runtime without a cycle).
 */
let helperStarter: ((lead: CrewMember, task: string) => { name: string; runId: string }) | null = null;
export function setHelperStarter(fn: typeof helperStarter) {
  helperStarter = fn;
}

function touch(ctx: ToolCtx, objectId: string | undefined, text: string) {
  const board = getBoard(ctx.boardId);
  const member = crewMember(ctx.crew);
  if (member) {
    // a crew member: its own cursor lands on what it touched, and the board says who
    aim(member, objectId ? resolveTarget(ctx.boardId, objectId) : null);
    editBoard(ctx.boardId, "agent", (doc) => logActivity(doc, { who: member.name, role: "agent", text, objectId }));
    return;
  }
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
  p: { section?: string; panel: PanelKind; name: string; channel?: string; url?: string; repo?: string; mcp?: string; text?: string; ports?: Array<Omit<Port, "id">>; connector?: string; fileId?: string; mime?: string; assignee?: string; status?: PanelDoc["status"]; w?: number; h?: number },
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
      channel: p.channel,
      fileId: p.fileId,
      mime: p.mime,
      assignee: p.assignee,
      status: p.status,
      createdBy: ctx.actor,
    };
    for (const k of Object.keys(panel) as Array<keyof PanelDoc>) if (panel[k] === undefined) delete panel[k];
    const m = boardMaps(doc);
    // an app opened into an empty section becomes that section's app; anything else joins the flow
    const empty = ![...m.objects.values()].some((o) => o.sectionId === sec.id);
    m.objects.set(panel.id, panel);
    if (empty && isHostable(panel.panel)) m.sections.set(sec.id, { ...sec, host: panel.id });
    else if (sec.host) cardSection(doc, sec.id);
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
      const member = crewMember(ctx.crew);
      if (member) aim(member, resolveTarget(ctx.boardId, object_id), note ?? "pointing");
      return "ok";
    },
  }),
  def({
    name: "set_plan",
    description:
      "Show the person the plan for this session: the goal and the steps, each pending, active or done. Call it before work with more than one step, and again whenever a step starts or finishes. The session tab draws it as a checklist.",
    schema: z.object({
      goal: z.string().describe("one sentence: what done looks like"),
      steps: z.array(z.object({ text: z.string(), status: z.enum(["pending", "active", "done"]) })).max(12),
    }),
    run: (_ctx, { steps }) => `plan set: ${steps.filter((x) => x.status === "done").length}/${steps.length} done`,
  }),
  def({
    name: "find_images",
    description:
      "Find images about something: in Foundation's archive (uploaded files, full text and where they came from), on this board, and in Slack (when connected). Returns refs to pass to lay_out, with titles, where each came from and when. Notes say what couldn't be searched.",
    schema: z.object({
      query: z.string().describe("what the images are about, e.g. \"Airform PTHP\""),
      sources: z.array(z.enum(["files", "slack", "board"])).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    run: async (ctx, { query, sources, limit }) => findImages(getBoard(ctx.boardId).doc, ctx.boardId, query, sources, limit),
  }),
  def({
    name: "lay_out",
    description:
      "Build a page on the board: a new section (or an existing one) with the items placed as a grid (masonry), a board (mood board, some images wide), a document (one readable column: heading, intro, each image with its caption) or a timeline (left to right by date). Items are image refs from find_images (Slack images are copied into the archive), markdown notes, or links. Use it for 'lay out', 'make a page/board/document of', 'put together'.",
    schema: z.object({
      title: z.string(),
      style: z.enum(["grid", "board", "document", "timeline"]).optional(),
      section: z.string().optional().describe("an existing section's name or id; omit for a new section named after the title"),
      intro: z.string().optional().describe("markdown shown first: what this is and why"),
      columns: z.number().int().min(1).max(6).optional(),
      items: z.array(z.object({ ref: z.string().optional(), markdown: z.string().optional(), url: z.string().optional(), title: z.string().optional(), caption: z.string().optional() })).min(1).max(120),
      request_id: z.string().optional(),
    }),
    write: true,
    run: async (ctx, i) => {
      const out = await layOut(ctx, i);
      touch(ctx, out.section, `laid out “${i.title}” (${out.cards} cards)`);
      return out;
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
        const sec = cardSection(doc, section);
        const n: NoteDoc & { text: string } = { id: uid("note"), kind: "note", sectionId: sec.id, name: title, x: 0, y: 0, float: false, bornAt: Date.now(), w: 420, h: 300, text: markdown, ...(madeBy(ctx) ? { createdBy: madeBy(ctx) } : {}) };
        putNote(doc, n);
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
          const sec = cardSection(doc, section);
          next.sectionId = sec.id;
          next.float = false;
        }
        if (markdown !== undefined && o.kind === "note") {
          setNoteText(doc, id, markdown); // the smallest edit: someone typing in it keeps their words
          delete next.text;
        }
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
        m.noteText.delete(id);
        m.huddles.delete(id);
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
      "Hand a design to Vision: writes a design brief card (goal, constraints, what to simulate, who reviews) and a hand-off card. A person presses Run on it to start a Supervised Vision Code thread on the brief; what the thread puts in its exports/ folder comes back to the board beside the brief, and the reviewers are asked then.",
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
      const md = `## ${i.title}\n\n**Goal** ${i.goal}\n\n${i.constraints ? `**Constraints** ${i.constraints}\n\n` : ""}${i.simulate ? `**Simulate** ${i.simulate}\n\n` : ""}**Reviewers** ${i.reviewers.join(", ") || "—"}\n\n*Brief written by ${ctx.actor} for Vision.*`;
      const noteId = editBoard(ctx.boardId, "agent", (doc) => {
        const sec = cardSection(doc, i.section);
        const n: NoteDoc & { text: string } = { id: uid("note"), kind: "note", sectionId: sec.id, name: `Brief · ${i.title}`, x: 0, y: 0, float: false, bornAt: Date.now(), w: 440, h: 320, text: md };
        putNote(doc, n);
        return n.id;
      });
      // the hand-off waits on its card for a person to press Run (a thread runs a model on their plan)
      const job = queueJob(ctx, "vision", i.title, md);
      const card = addPanel(ctx, { section: i.section, panel: "agent", name: `Vision Code · ${i.title}`, text: "Press Run to start a Supervised Vision Code thread on this brief. What it makes comes back here, and the reviewers are asked then.", status: "idle" });
      const sectionId = editBoard(ctx.boardId, "agent", (doc) => {
        const cur = getPanel(doc, card.id);
        boardMaps(doc).objects.set(card.id, { ...cur, sessionId: job.id });
        return cur.sectionId;
      });
      queueHandoff({ jobId: job.id, boardId: ctx.boardId, sectionId, briefNote: noteId, title: i.title, brief: md, reviewers: i.reviewers, by: ctx.userId });
      touch(ctx, noteId, `briefed Vision: ${i.title}`);
      return { brief: noteId, handoff: card.id, note: "A person starts the Vision Code thread from the hand-off card (Run). Reviewers are asked when results come back." };
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
  // ---------- machines: Linux machines and containers on Kiri or Docker (machines.ts) ----------
  def({
    name: "propose_machine",
    description:
      "Propose a Linux machine or container for a section: a machine card that runs on this computer's container engine (Kiri or Docker) once a person presses Start on it. Agents can't start, stop or remove machines — that runs third-party code, so a person does it. Distros: ubuntu, debian, alpine, fedora, arch, rocky, opensuse (or any image name, e.g. 'postgres:17', 'nginx:1.27'). Ports are container ports to publish on 127.0.0.1.",
    schema: z.object({
      name: z.string().describe("short machine name, e.g. 'build box'"),
      image: z.string().optional().describe("a distro id (ubuntu…) or an image ref; omit to let the person pick on the card"),
      ports: z.array(z.number().int().min(1).max(65535)).max(8).optional(),
      why: z.string().optional().describe("what it's for, in a sentence: shown on the card"),
      section: z.string().optional(),
      request_id: z.string().optional(),
    }),
    write: true,
    run: (ctx, input) => {
      const distro = MACHINE_DISTROS.find((d) => d.id === input.image?.toLowerCase());
      const image = distro?.image ?? input.image?.trim();
      if (image && !validImage(image)) throw new Error(`“${image}” isn't an image name an engine will take`);
      const p = addPanel(ctx, { section: input.section, panel: "machine", name: input.name, text: input.why });
      editBoard(ctx.boardId, "agent", (doc) => {
        const cur = getPanel(doc, p.id);
        boardMaps(doc).objects.set(p.id, proposeMachine(cur, image, ctx.actor, input.ports));
      });
      touch(ctx, p.id, `proposed a machine “${input.name}”${image ? ` (${image})` : ""}`);
      return { card: p.id, image: image ?? null, note: "waiting for a person to press Start on the card" };
    },
  }),
  def({
    name: "machines",
    description:
      "Read the machine cards on this board: which engines (Kiri, Docker) answer here, each machine's image, state (absent, pulling, starting, running, stopped, error), published ports as URLs, and the last screen of its shared terminal (what people ran and saw).",
    schema: z.object({}),
    run: (ctx) => describeMachines(ctx.boardId),
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
      "Run a stage's hand-off to people and studios: for CAD, Hermes asks the CAD owner for the STEP and delivers it to the stage when it lands; for Concept or Simulate, writes a Vision brief from the stage (with the chosen concept or the CAD and the analysis settings) and a hand-off card a person presses Run on to start the Vision Code thread; for Review, asks every reviewer.",
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
          const n: NoteDoc & { text: string } = { id: uid("note"), kind: "note", sectionId: p.sectionId, name: `Vision brief · ${def.title}`, x: BRIEF_X, y: p.y, float: true, bornAt: Date.now(), w: 420, h: 260, text: md };
          putNote(d, n);
          return n.id;
        });
        if (p.status === "idle") editBoard(ctx.boardId, "agent", (d) => boardMaps(d).objects.set(p.id, { ...p, status: "open" }));
        // a hand-off card under the brief: a person presses Run to start the Vision Code thread; what it makes lands in this section
        const job = queueJob(ctx, "vision", `${def.title} · ${product}`, md);
        const card = editBoard(ctx.boardId, "agent", (d) => {
          const c: PanelDoc = { id: uid("pnl"), kind: "panel", panel: "agent", sectionId: p.sectionId, name: `Vision Code · ${def.title.toLowerCase()} of ${product}`, x: BRIEF_X, y: p.y + 280, float: true, bornAt: Date.now(), w: 420, h: 260, ports: [], status: "idle", sessionId: job.id, text: "Press Run to start a Supervised Vision Code thread on this brief. What it makes comes back to this pipeline." };
          boardMaps(d).objects.set(c.id, c);
          return c.id;
        });
        queueHandoff({ jobId: job.id, boardId: ctx.boardId, sectionId: p.sectionId, briefNote: noteId, title: `${def.title} of ${product}`, brief: md, reviewers: [], by: ctx.userId });
        touch(ctx, p.id, `briefed Vision for ${def.title.toLowerCase()} of ${product}`);
        return { brief: noteId, handoff: card, note: "A person starts the Vision Code thread from the hand-off card (Run)." };
      }
      throw new Error(`${def.title} has no hand-off — complete it when it's done`);
    },
  }),
  // ---------- huddles and Slack ----------
  def({
    name: "open_huddle",
    description:
      "Put a huddle (a video portal) on the board, optionally for a Slack channel. People join it with their camera; nothing is streamed or recorded until a person joins. Returns the huddle id.",
    schema: z.object({
      section: z.string().optional(),
      name: z.string().optional(),
      channel: z.string().optional().describe("Slack channel id the huddle belongs to"),
      request_id: z.string().optional(),
    }),
    write: true,
    run: (ctx, i) => {
      const p = addPanel(ctx, { section: i.section, panel: "huddle", name: i.name ?? "Huddle", channel: i.channel, text: "Join with your camera — everyone on the board can see who's here." });
      touch(ctx, p.id, `opened a huddle “${p.name}”`);
      return { id: p.id };
    },
  }),
  def({
    name: "huddle_transcript",
    description: "Read what was said in a huddle: each session's people, speaker-attributed transcript with times, and recordings. Newest session first.",
    schema: z.object({ huddle: z.string().describe("the huddle panel id"), sessions: z.number().int().min(1).max(10).optional() }),
    run: (ctx, i) => {
      const s = huddleArchive(ctx.boardId, i.huddle, i.sessions ?? 1);
      return s.length ? s.map(transcriptText).join("\n\n---\n\n") : "This huddle hasn't met yet.";
    },
  }),
  def({
    name: "add_slack_channel",
    description: "Put a Slack channel on the board as a card: its recent messages, live, with a field to post. Give the channel's name (without #) or id.",
    schema: z.object({ channel: z.string(), section: z.string().optional(), request_id: z.string().optional() }),
    write: true,
    run: async (ctx, i) => {
      const want = i.channel.replace(/^#/, "").toLowerCase();
      const ch = /^[CG][A-Z0-9]{6,}$/.test(i.channel) ? await channelInfo(i.channel) : (await listChannels()).find((c) => c.name.toLowerCase() === want);
      if (!ch) throw new Error(`no Slack channel “${i.channel}” the Foundation app can see`);
      const p = addPanel(ctx, { section: i.section, panel: "slack", name: `#${ch.name}`, channel: ch.id, text: ch.topic });
      touch(ctx, p.id, `put #${ch.name} on the board`);
      return { id: p.id, channel: ch.id };
    },
  }),
  def({
    name: "slack_read",
    description: "Read a Slack channel's recent messages (oldest first). Agents read Slack; posting is left to people on the card.",
    schema: z.object({ channel: z.string().describe("channel id (a slack card's channel)"), limit: z.number().int().min(1).max(100).optional() }),
    run: async (_ctx, i) => {
      const msgs = await channelHistory(i.channel, i.limit ?? 30);
      return msgs.map((m) => `[${new Date(m.at).toISOString().slice(0, 16).replace("T", " ")}] ${m.name}: ${m.text}`).join("\n") || "(no messages)";
    },
  }),
  def({
    name: "add_table",
    description:
      "Make a table (a spreadsheet card) in a section, filled with data: a header row of column names, then rows. Cells take numbers, text or formulas as typed (=SUM(B2:B9)). Use it to put data on the board people can read, sort and chart.",
    schema: z.object({
      section: z.string().optional(),
      name: z.string(),
      columns: z.array(z.string()).min(1).max(26),
      rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(500).optional(),
      request_id: z.string().optional(),
    }),
    write: true,
    run: (ctx, { section, name, columns, rows = [] }) => {
      const table = editBoard(ctx.boardId, "agent", (doc) => {
        const sec = cardSection(doc, section);
        const cols = Math.max(columns.length, ...rows.map((r) => r.length), 3);
        const t: TableDoc = { id: uid("tbl"), kind: "table", sectionId: sec.id, name, x: 0, y: 0, float: false, bornAt: Date.now(), cols, rows: Math.max(rows.length + 1, 6), ...(madeBy(ctx) ? { createdBy: madeBy(ctx) } : {}) };
        const raw: Record<string, string> = {};
        columns.forEach((c, i) => c && (raw[`${i},0`] = c));
        rows.forEach((r, ri) => r.forEach((v, ci) => v !== null && v !== "" && (raw[`${ci},${ri + 1}`] = String(v))));
        boardMaps(doc).objects.set(t.id, t);
        setTableCells(doc, t.id, raw); // made with the table, in the same change (schema 5)
        return t;
      });
      touch(ctx, table.id, `made table “${name}” (${rows.length} rows)`);
      return { id: table.id, cols: table.cols, rows: table.rows };
    },
  }),
  def({
    name: "rename_section",
    description: "Rename a section (by its name or id).",
    schema: z.object({ section: z.string(), name: z.string().min(1).max(80), request_id: z.string().optional() }),
    write: true,
    run: (ctx, { section, name }) => {
      const sec = editBoard(ctx.boardId, "agent", (doc) => {
        const found = findSection(doc, section);
        if (!found) throw new Error(`no section “${section}”`);
        const next = { ...found, name };
        boardMaps(doc).sections.set(found.id, next);
        return next;
      });
      touch(ctx, undefined, `renamed a section to “${name}”`);
      const member = crewMember(ctx.crew);
      if (member) aim(member, { id: sec.id, kind: "section" });
      return { id: sec.id, name };
    },
  }),
  def({
    name: "arrange_section",
    description:
      "Organize a section: its cards flow left to right, top to bottom, in the order given (ids; cards not named keep their order after them). Floating cards are docked into the flow. Use it to tidy a section after adding to it, or to put related cards side by side.",
    schema: z.object({ section: z.string(), order: z.array(z.string()).optional(), request_id: z.string().optional() }),
    write: true,
    run: (ctx, { section, order = [] }) => {
      const n = editBoard(ctx.boardId, "agent", (doc) => {
        const sec = findSection(doc, section);
        if (!sec) throw new Error(`no section “${section}”`);
        const m = boardMaps(doc);
        const cards = [...m.objects.values()].filter((o) => o.sectionId === sec.id && o.id !== sec.host);
        // the flow is ordered by bornAt: hand the same times out again in the new order (no new times, so nothing re-arrives)
        const times = cards.map((o) => o.bornAt).sort((a, b) => a - b);
        const rank = (id: string) => (order.indexOf(id) >= 0 ? order.indexOf(id) : order.length);
        const sorted = [...cards].sort((a, b) => rank(a.id) - rank(b.id) || a.bornAt - b.bornAt);
        sorted.forEach((o, i) => {
          if (o.bornAt !== times[i] || o.float) m.objects.set(o.id, { ...o, bornAt: times[i], float: false } as never);
        });
        return sorted.length;
      });
      touch(ctx, undefined, `arranged ${n} cards in “${findSection(getBoard(ctx.boardId).doc, section)?.name ?? section}”`);
      const member = crewMember(ctx.crew);
      if (member) aim(member, resolveTarget(ctx.boardId, section));
      return `arranged ${n} cards`;
    },
  }),
  def({
    name: "bring_view",
    description:
      "Bring the person who asked to a section or card: their view glides there (if they're busy moving around, they're asked first, and they can always go back). Use it when what you made or found is somewhere they aren't looking, once it's ready to see. Other people just see you go there.",
    schema: z.object({ target: z.string().describe("a section name or id, or a card id"), note: z.string().optional().describe("a few words on why: “the parts table is ready”") }),
    run: (ctx, { target, note }) => {
      const t = resolveTarget(ctx.boardId, target);
      if (!t) throw new Error(`nothing called “${target}” on this board`);
      const member = crewMember(ctx.crew);
      if (!member) return "only Foundation's own agents can move a person's view; use focus to point instead";
      const m = boardMaps(getBoard(ctx.boardId).doc);
      const name = t.kind === "section" ? (m.sections.get(t.id)?.name ?? target) : (m.objects.get(t.id)?.name ?? target);
      guide(member, t, name, note);
      return `bringing ${member.userName} to ${name}`;
    },
  }),
  def({
    name: "point_at",
    description:
      "Point your cursor at something precise while you explain it: a table cell (\"B3\") or a panel's port, or just a card or section. Everyone on the board sees your cursor there with a laser ring on the spot. It changes nothing on the board.",
    schema: z.object({
      target: z.string().describe("a card id, or a section name or id"),
      cell: z.string().regex(/^[A-Za-z]{1,3}[1-9][0-9]{0,4}$/).optional().describe("a table cell, A1-style"),
      port: z.string().optional().describe("a panel's port, by name or id"),
      note: z.string().max(80).optional().describe("what you're pointing out, in a few words"),
    }),
    run: (ctx, { target, cell, port, note }) => {
      const t = resolveTarget(ctx.boardId, target);
      if (!t) throw new Error(`nothing called “${target}” on this board`);
      const o = t.kind === "object" ? boardMaps(getBoard(ctx.boardId).doc).objects.get(t.id) : undefined;
      if (cell && o?.kind !== "table") throw new Error("cells are on tables; point at a table's id with cell");
      if (port && (o?.kind !== "panel" || !(o as PanelDoc).ports.some((p) => p.id === port || p.name === port))) throw new Error(`no port “${port}” on that card`);
      const member = crewMember(ctx.crew);
      if (!member) return "only Foundation's own agents have a cursor to point with";
      const spot = cell ? `cell ${cell.toUpperCase()}` : port ? `port “${port}”` : (o?.name ?? target);
      aim(member, { ...t, ...(cell ? { cell: cell.toUpperCase() } : {}), ...(port ? { port } : {}) }, note ?? `pointing at ${spot}`);
      return `pointing at ${spot}`;
    },
  }),
  def({
    name: "call_in_help",
    description: `Call in a helper agent for a separate part of this ask that can run at the same time as yours (a different section, a different data source). It gets its own name and cursor, works through the same tools and finishes on its own; say exactly what it should do and where. At most two per ask; helpers can't call helpers. Don't use it for small or dependent steps.`,
    schema: z.object({ task: z.string().min(8).max(2000), section: z.string().optional() }),
    write: true,
    run: (ctx, { task, section }) => {
      const member = crewMember(ctx.crew);
      if (!member) return "help can only be called in by one of Foundation's own agents";
      const why = canCallHelp(member);
      if (why) throw new Error(`can't call in help: ${why}`);
      if (!helperStarter) throw new Error("no agent runtime to start a helper");
      member.helpers++;
      const h = helperStarter(member, section ? `${task}\n\n(Work in the section “${section}”.)` : task);
      touch(ctx, undefined, `called in ${h.name}: ${task.slice(0, 120)}`);
      return `${h.name} is on it`;
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
  // viewers read: every other tool is a write (or acts for the board) and is refused
  if (!READ_TOOLS.has(name) && !canWrite(ctx.userId, ctx.boardId)) {
    throw new HttpError(403, `View only: this person can read the board “${ctx.boardId}” but not change it, so ${name} can't run. Say what you would change instead.`);
  }
  const rid = (parsed.data as { request_id?: string }).request_id;
  const key = rid ? `${ctx.boardId}:${ctx.userId}:${rid}` : null;
  if (key && seenRequests.has(key)) return seenRequests.get(key);
  // a visible agent says what it's doing, and goes to what it's about to change before changing it
  const member = crewMember(ctx.crew);
  if (member && member.boardId === ctx.boardId) {
    const input = parsed.data as Record<string, unknown>;
    const doing = describeStep(name, input, ctx.boardId);
    if (tool.write) await travel(member, stepTarget(ctx.boardId, name, input), doing);
    else setDoing(member, doing);
  }
  const out = await tool.run(ctx, parsed.data);
  if (key) {
    seenRequests.set(key, out);
    if (seenRequests.size > 2000) seenRequests.delete(seenRequests.keys().next().value!);
  }
  return out;
}
