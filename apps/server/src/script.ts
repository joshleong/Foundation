/**
 * The "script" runtime: a fixed playbook through the real board tools, with
 * no model. For tests and the browser checks only (FOUNDATION_AGENT_SCRIPT=1),
 * so the crew can be checked end to end (names, cursors, aim-then-act,
 * helpers, bring_view, attribution) without a subscription or credits, and
 * the same way every time. It never runs in a real deployment.
 *
 * The lead's playbook, for an ask like “make a section called “Supply” with
 * the parts and hook up FactoryForm, and get help”:
 *   plan → read the board → section → table of parts → (connector) →
 *   (a helper writes a note) → a note → arrange → bring the person there.
 * A helper writes one note in the section it was given.
 */

import type { AgentEvent } from "@foundation/protocol";
import { runTool, type ToolCtx } from "./tools.ts";

function stepMs() {
  const v = Number(process.env.FOUNDATION_SCRIPT_STEP_MS ?? "300");
  return Number.isFinite(v) && v >= 0 ? v : 300;
}

const quoted = (s: string) => /[“"]([^”"]{1,60})[”"]/.exec(s)?.[1]?.trim();

export async function runScript(opts: { prompt: string; signal: AbortSignal }, emit: (e: AgentEvent) => void, ctx: ToolCtx) {
  const wait = () => new Promise((r) => setTimeout(r, stepMs()));
  const step = async (name: string, input: Record<string, unknown>) => {
    if (opts.signal.aborted) throw new Error("stopped");
    emit({ type: "status", status: "working" });
    emit({ type: "tool", name, input });
    try {
      const out = await runTool(ctx, name, input);
      const text = typeof out === "string" ? out : JSON.stringify(out);
      emit({ type: "tool_result", name, ok: true, summary: text.slice(0, 200) });
      await wait();
      return out as Record<string, unknown> | string;
    } catch (e) {
      emit({ type: "tool_result", name, ok: false, summary: (e as Error).message });
      throw e;
    }
  };
  emit({ type: "status", status: "thinking" });

  // a helper: one note where it was sent
  const helperSection = /\(Work in the section “([^”]+)”\.\)/.exec(opts.prompt)?.[1];
  if (/^You were called in by /.test(opts.prompt)) {
    const section = helperSection ?? "Workspace";
    const note = (await step("add_note", { section, title: "Suppliers to call", markdown: "- Kapaʻa Metals: lead time 3 weeks\n- Pacific Fasteners: on stock\n\n_Written by a helper the lead called in._" })) as { id: string };
    await step("focus", { object_id: note.id, note: "the supplier list" });
    emit({ type: "text", text: "Wrote the supplier list." });
    emit({ type: "done", runtime: "script" });
    return;
  }

  const section = quoted(opts.prompt) ?? "Supply chain";
  await step("set_plan", {
    goal: `${section}: the parts on the board, with their data`,
    steps: [
      { text: "Make the section", status: "active" },
      { text: "Put the parts in a table", status: "pending" },
      { text: "Show you", status: "pending" },
    ],
  });
  await step("read_board", {});
  await step("add_section", { name: section });
  const table = (await step("add_table", {
    section,
    name: "Parts",
    columns: ["Part", "Qty", "Supplier", "Unit $"],
    rows: [
      ["Vane, 6061", 12, "Kapaʻa Metals", 38.5],
      ["Hub bearing", 2, "Pacific Fasteners", 14],
      ["M4 cap screw", 48, "Pacific Fasteners", 0.12],
      ["Total", "", "", "=SUM(D2:D4)"],
    ],
  })) as { id: string };
  // asked to point things out: the cursor shows the total, then the cheapest part
  if (/\bpoint|\btotal\b/i.test(opts.prompt)) {
    await step("point_at", { target: table.id, cell: "D5", note: "the total, 52.62" });
    await step("point_at", { target: table.id, cell: "A4", note: "the cheapest part" });
  }
  if (/factory|data source|hook/i.test(opts.prompt)) {
    await step("add_panel", { section, panel: "connector", name: "FactoryForm", connector: "factoryform", text: "the floor, live" });
  }
  if (/\bhelp|crew|together\b/i.test(opts.prompt)) {
    await step("call_in_help", { task: "Write the list of suppliers to call for these parts.", section });
  }
  await step("add_note", { section, title: "What's here", markdown: `## ${section}\n\nThe parts and what they cost, made by the crew.` });
  await step("set_plan", {
    goal: `${section}: the parts on the board, with their data`,
    steps: [
      { text: "Make the section", status: "done" },
      { text: "Put the parts in a table", status: "done" },
      { text: "Show you", status: "active" },
    ],
  });
  await step("arrange_section", { section });
  await step("bring_view", { target: section, note: "the parts table is ready" });
  emit({ type: "text", text: `Made “${section}” with a parts table${/factory|hook/i.test(opts.prompt) ? " and FactoryForm hooked up" : ""}, and brought you there.` });
  emit({ type: "done", runtime: "script" });
}
