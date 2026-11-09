/**
 * Settings (#/settings). Two tabs:
 *
 *  - **Plan** — Foundation's own kanban (docs/plan.json): the local copy of the
 *    issues on GitHub, as columns from Needs you to Done. Filters by kind and
 *    milestone, and a search. An admin moves a card by dragging it to another
 *    column (or with Move to… on the opened card); the move writes the file
 *    and the card says so until it's pushed to GitHub.
 *  - **Services** — what this server is connected to (Slack, GitHub, Google,
 *    the agent's runtimes), so a missing key reads as a fact, not a mystery.
 *
 * The night orb sits in the head, as on #/design.
 */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { isNight, setNight, springs } from "@foundation/ui";
import { api } from "../lib/api";
import { NightOrb } from "../shell/NightOrb";
import { renderMarkdown } from "../utils/markdown";
import { ago, boardColumns, counts, issueUrl, PLAN, syncSentence, waitingWords, type CardKind, type Plan, type PlanCard, type PlanFilter } from "./plan";

type Tab = "plan" | "services";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "plan", label: "Plan" },
  { id: "services", label: "Services" },
];

export function SettingsPage({ route }: { route: string }) {
  const tab: Tab = route.startsWith("#/settings/services") ? "services" : "plan";
  return (
    <div className="settings-page">
      <header className="design-head settings-head">
        <div>
          <div className="f-eyebrow">Foundation</div>
          <h1>Settings</h1>
        </div>
        <nav className="settings-tabs" aria-label="Settings">
          {TABS.map((t) => (
            <a key={t.id} href={`#/settings/${t.id}`} className={`settings-tab${tab === t.id ? " is-current" : ""}`} aria-current={tab === t.id ? "page" : undefined}>
              {t.label}
            </a>
          ))}
        </nav>
        <div className="settings-spacer" />
        <NightOrb onToggle={() => setNight(!isNight())} />
        <a className="f-pill" href="#/">
          ← Back to the board
        </a>
      </header>
      {tab === "plan" ? <PlanTab /> : <ServicesTab />}
    </div>
  );
}

// ---------------------------------------------------------------- plan

export async function fetchPlan(): Promise<{ plan: Plan | null; canMove: boolean }> {
  return api("/api/plan");
}

export async function moveCard(id: string, status: string): Promise<PlanCard> {
  const r = await api<{ card: PlanCard }>(`/api/plan/cards/${encodeURIComponent(id)}`, { method: "POST", json: { status } });
  return r.card;
}

export async function syncWithGitHub(): Promise<{ plan: Plan; summary: { moved: number; created: number; cards: number } }> {
  return api("/api/plan/sync", { method: "POST", json: {} });
}

export async function addCard(card: NewCardInput): Promise<PlanCard> {
  const r = await api<{ card: PlanCard }>("/api/plan/cards", { method: "POST", json: card });
  return r.card;
}

export interface NewCardInput {
  title: string;
  kind: CardKind;
  milestone: string;
  area: string;
  body?: string;
  request_id: string;
}

function PlanTab() {
  const [plan, setPlan] = useState<Plan>(PLAN);
  const [canMove, setCanMove] = useState(false);
  /** where the board came from: the copy bundled with the app, or the server's file */
  const [source, setSource] = useState<"bundled" | "server">("bundled");
  const [err, setErr] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncState>({ busy: false });

  useEffect(() => {
    let live = true;
    fetchPlan()
      .then((r) => {
        if (!live) return;
        if (r.plan) {
          setPlan(r.plan);
          setSource("server");
        }
        setCanMove(r.canMove);
      })
      .catch(() => live && setSource("bundled"));
    return () => {
      live = false;
    };
  }, []);

  const onMove = async (id: string, status: string) => {
    const before = plan;
    // the card moves at once; the server's answer confirms it (or puts it back)
    setPlan((p) => ({ ...p, cards: p.cards.map((c) => (c.id === id ? { ...c, status } : c)) }));
    setErr(null);
    try {
      const card = await moveCard(id, status);
      setPlan((p) => ({ ...p, cards: p.cards.map((c) => (c.id === id ? card : c)) }));
    } catch (e) {
      setPlan(before);
      setErr((e as Error).message);
    }
  };

  const onSync = async () => {
    setSync({ busy: true });
    setErr(null);
    try {
      const r = await syncWithGitHub();
      setPlan(r.plan);
      setSync({ busy: false, said: syncSentence(r.summary) });
    } catch (e) {
      setSync({ busy: false });
      setErr((e as Error).message);
    }
  };

  const onCreate = async (input: NewCardInput) => {
    setErr(null);
    const card = await addCard(input);
    setPlan((p) => (p.cards.some((c) => c.id === card.id) ? p : { ...p, cards: [...p.cards, card] }));
    return card;
  };

  return <PlanBoard plan={plan} source={source} canMove={canMove} onMove={onMove} onSync={onSync} onCreate={onCreate} sync={sync} error={err} />;
}

export interface SyncState {
  busy: boolean;
  /** what the last sync did, in a sentence */
  said?: string;
}

const KIND_LABEL: Record<CardKind, string> = { bug: "Bug", plan: "Plan", hookup: "Needs a person" };

export function PlanBoard({
  plan,
  source,
  canMove,
  onMove,
  onSync,
  onCreate,
  sync,
  error,
  height,
}: {
  plan: Plan;
  source: "bundled" | "server";
  canMove: boolean;
  onMove(id: string, status: string): void;
  /** Sync with GitHub (admins; the server runs scripts/plan.mjs sync) */
  onSync?(): void;
  /** a new card (admins); resolves when the server has it */
  onCreate?(input: NewCardInput): Promise<PlanCard>;
  sync?: SyncState;
  error?: string | null;
  /** fixed board height (the design page's demo); the page lets it run */
  height?: number;
}) {
  const [filter, setFilter] = useState<PlanFilter>({});
  const [open, setOpen] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const cols = useMemo(() => boardColumns(plan, filter), [plan, filter]);
  const n = counts(plan);
  const pushed = plan.cards.some((c) => c.issue);
  const moved = plan.cards.filter((c) => c.moved).length;
  const fresh = plan.cards.filter((c) => !c.issue).length;

  return (
    <section className="kb" style={height ? { height } : undefined}>
      <div className="kb-head">
        <div className="kb-title">
          <div className="kb-title-row">
            <h2>The plan</h2>
            {canMove && (onCreate || onSync) && (
              <div className="kb-actions">
                {onCreate && (
                  <button className="f-pill kb-toggle" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
                    + New card
                  </button>
                )}
                {onSync && (
                  <button className="f-pill kb-sync" onClick={onSync} disabled={sync?.busy} title={`Reads every issue on ${plan.repo}, then sends the columns moved here and the cards made here`}>
                    {sync?.busy ? (
                      <>
                        <span className="kb-spin" aria-hidden /> Syncing…
                      </>
                    ) : (
                      <>↻ Sync with GitHub</>
                    )}
                  </button>
                )}
                {sync?.said && !sync.busy && <span className="kb-said">{sync.said}</span>}
              </div>
            )}
          </div>
          <p>
            {n.open} open · {n.bug} {n.bug === 1 ? "bug" : "bugs"} · {n.plan} {n.plan === 1 ? "plan" : "plans"} · {n.hookup} waiting on a person.{" "}
            {pushed ? (
              <>
                The local copy of{" "}
                <a href={`https://github.com/${plan.repo}/issues?q=label%3Aplan`} target="_blank" rel="noopener">
                  the issues on GitHub ↗
                </a>
                {plan.syncedAt ? (
                  <>
                    , synced <time title={new Date(plan.syncedAt).toLocaleString()}>{ago(plan.syncedAt)}</time>
                  </>
                ) : (
                  ""
                )}
                .
              </>
            ) : (
              <>
                Not on GitHub yet: <code>npm run plan:push</code> makes an issue for every card.
              </>
            )}
            {pushed && moved + fresh > 0 && (
              <>
                {" "}
                <b className="kb-moved-count">{waitingWords(moved, fresh)}</b>, not on GitHub yet.
              </>
            )}
            {source === "bundled" && <span className="kb-source"> Showing the copy bundled with the app.</span>}
          </p>
        </div>
        <div className="kb-filters">
          <FilterChip on={!filter.kind} onClick={() => setFilter((f) => ({ ...f, kind: undefined }))}>
            All
          </FilterChip>
          {(["bug", "plan", "hookup"] as CardKind[]).map((k) => (
            <FilterChip key={k} on={filter.kind === k} onClick={() => setFilter((f) => ({ ...f, kind: f.kind === k ? undefined : k }))}>
              <span className={`kb-kind is-${k}`} />
              {KIND_LABEL[k]}
            </FilterChip>
          ))}
          <select className="kb-select" value={filter.milestone ?? ""} onChange={(e) => setFilter((f) => ({ ...f, milestone: e.target.value || undefined }))} aria-label="Milestone">
            <option value="">Every milestone</option>
            {plan.milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input className="kb-search" placeholder="Find a card or #issue" value={filter.query ?? ""} onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))} />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {adding && onCreate && (
          <motion.div key="new" className="kb-new-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={cardSpring}>
            <NewCardForm plan={plan} onCreate={onCreate} onDone={() => setAdding(false)} />
          </motion.div>
        )}
      </AnimatePresence>
      {error && <div className="kb-error">{error}</div>}

      <LayoutGroup>
        <div className="kb-board">
          {cols.map((col) => (
            <div
              key={col.id}
              className={`kb-col is-${col.id}${over === col.id && dragging ? " is-over" : ""}`}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== col.id) setOver(col.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === col.id ? null : o));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plan-card") || dragging;
                setDragging(null);
                setOver(null);
                const card = plan.cards.find((c) => c.id === id);
                if (card && card.status !== col.id) onMove(card.id, col.id);
              }}
            >
              <div className="kb-col-head" title={col.hint}>
                <span className="kb-col-name">{col.name}</span>
                <span className="kb-col-count">{col.cards.length}</span>
              </div>
              <div className="kb-col-hint">{col.hint}</div>
              <div className="kb-col-cards">
                <AnimatePresence initial={false}>
                  {col.cards.map((card) => (
                    <PlanCardView
                      key={card.id}
                      plan={plan}
                      card={card}
                      open={open === card.id}
                      canMove={canMove}
                      dragging={dragging === card.id}
                      onToggle={() => setOpen((o) => (o === card.id ? null : card.id))}
                      onDragStart={() => setDragging(card.id)}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      onMove={onMove}
                    />
                  ))}
                </AnimatePresence>
                {col.cards.length === 0 && <div className="kb-col-empty">{filter.kind || filter.milestone || filter.query ? "Nothing here matches." : "Nothing here."}</div>}
              </div>
            </div>
          ))}
        </div>
      </LayoutGroup>
    </section>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button className={`kb-chip${on ? " is-on" : ""}`} onClick={onClick} aria-pressed={on}>
      {children}
    </button>
  );
}

const cardSpring = { type: "spring", ...springs.camera } as const;

function PlanCardView({
  plan,
  card,
  open,
  canMove,
  dragging,
  onToggle,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  plan: Plan;
  card: PlanCard;
  open: boolean;
  canMove: boolean;
  dragging: boolean;
  onToggle(): void;
  onDragStart(): void;
  onDragEnd(): void;
  onMove(id: string, status: string): void;
}) {
  const milestone = plan.milestones.find((m) => m.id === card.milestone);
  const body = useMemo(() => (open ? renderMarkdown(card.body) : ""), [open, card.body]);
  return (
    <motion.article
      layout="position"
      layoutId={`plan-${card.id}`}
      transition={cardSpring}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: dragging ? 0.4 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={`kb-card is-${card.kind}${open ? " is-open" : ""}${card.moved ? " is-moved" : ""}`}
    >
      <div
        className="kb-card-face"
        role="button"
        tabIndex={0}
        draggable={canMove}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plan-card", card.id);
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={open}
      >
        <div className="kb-card-title">{card.title}</div>
        <div className="kb-card-meta">
          <span className={`kb-kind is-${card.kind}`} title={KIND_LABEL[card.kind]} />
          <span>{milestone?.name ?? card.milestone}</span>
          <span className="kb-card-area">{card.area}</span>
          {card.issue ? (
            <a className="kb-card-issue" href={issueUrl(plan, card.issue)} target="_blank" rel="noopener" draggable={false} onClick={(e) => e.stopPropagation()} title={`Open #${card.issue} on GitHub`}>
              #{card.issue}
            </a>
          ) : (
            <span className="kb-card-issue is-local" title="Made here; the next sync makes it an issue">
              new
            </span>
          )}
        </div>
        {card.moved && (
          <div className="kb-card-moved">
            Moved from {plan.columns.find((c) => c.id === card.moved!.from)?.name ?? card.moved.from} by {card.moved.by}
          </div>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="kb-card-more" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={cardSpring}>
            <div className="kb-card-body note-rendered" dangerouslySetInnerHTML={{ __html: body }} />
            <div className="kb-card-actions">
              {card.issue ? (
                <a className="f-pill" href={issueUrl(plan, card.issue)} target="_blank" rel="noopener">
                  Open #{card.issue} on GitHub ↗
                </a>
              ) : (
                <span className="kb-card-note">No issue yet</span>
              )}
              {canMove && (
                <label className="kb-move">
                  <span>Move to</span>
                  <select value={card.status} onChange={(e) => onMove(card.id, e.target.value)} onClick={(e) => e.stopPropagation()}>
                    {plan.columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function NewCardForm({ plan, onCreate, onDone }: { plan: Plan; onCreate(input: NewCardInput): Promise<PlanCard>; onDone(): void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CardKind>("bug");
  const [milestone, setMilestone] = useState(plan.milestones[plan.milestones.length - 1]?.id ?? "");
  const [area, setArea] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // one id per card being written: a doubled press makes one card
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const ok = title.trim().length >= 4;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onCreate({ title: title.trim(), kind, milestone, area: area.trim() || "general", body: body.trim() || undefined, request_id: requestId });
      setTitle("");
      setBody("");
      setRequestId(crypto.randomUUID());
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="kb-new" onSubmit={submit}>
      <input className="kb-new-title" autoFocus placeholder="What's wrong, or what should we build?" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} aria-label="Title" />
      <div className="kb-new-row">
        <div className="kb-new-kinds" role="group" aria-label="Kind">
          {(["bug", "plan", "hookup"] as CardKind[]).map((k) => (
            <FilterChip key={k} on={kind === k} onClick={() => setKind(k)}>
              <span className={`kb-kind is-${k}`} />
              {KIND_LABEL[k]}
            </FilterChip>
          ))}
        </div>
        <select className="kb-select" value={milestone} onChange={(e) => setMilestone(e.target.value)} aria-label="Milestone">
          {plan.milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input className="kb-search kb-new-area" placeholder="Area: wires, sections…" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area" />
      </div>
      <textarea className="kb-new-body" placeholder="How to see it, or what done looks like (markdown)" value={body} onChange={(e) => setBody(e.target.value)} rows={3} aria-label="Description" />
      <div className="kb-new-row">
        <span className="kb-new-note">{kind === "hookup" ? "Goes to Needs you." : "Goes to Backlog."} Sync with GitHub makes it an issue.</span>
        <button type="button" className="f-pill" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="f-pill is-accent" disabled={!ok || busy}>
          {busy ? "Adding…" : "Add card"}
        </button>
      </div>
      {err && <div className="kb-error">{err}</div>}
    </form>
  );
}

// ---------------------------------------------------------------- services

interface Integrations {
  slack: boolean;
  github: boolean | "cli";
  google: boolean;
  anthropicApi: boolean;
  agent: { subscription: boolean; subscriptionNote?: string | null; api: boolean; model: string };
}

function ServicesTab() {
  const [s, setS] = useState<Integrations | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Integrations>("/api/integrations").then(setS, (e: Error) => setErr(e.message));
  }, []);
  const rows: Array<{ name: string; on: boolean | null; detail: string; how: string }> = s
    ? [
        { name: "Agent · subscription", on: s.agent.subscription, detail: s.agent.subscription ? "Claude Code is installed here" : (s.agent.subscriptionNote ?? "Claude Code isn't on this computer's PATH"), how: "Install Claude Code and sign in (`claude`). A sign-in that has expired shows up when an agent runs." },
        { name: "Agent · API", on: s.agent.api, detail: s.agent.api ? `On credits, ${s.agent.model}` : "No API key", how: "Set ANTHROPIC_API_KEY." },
        { name: "Slack", on: s.slack, detail: s.slack ? "Bot token set" : "Not connected", how: "Create the app from docs/slack-app-manifest.yml and set SLACK_BOT_TOKEN." },
        { name: "GitHub", on: s.github === true || s.github === "cli", detail: s.github === "cli" ? "Through the gh login" : s.github ? "Token set" : "No token", how: "Set GITHUB_TOKEN, or sign in with gh." },
        { name: "Google sign-in (own client)", on: s.google, detail: s.google ? "Own client" : "Through flowform", how: "Optional: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET for a hosted server." },
      ]
    : [];
  return (
    <section className="services">
      <p className="design-lede">What this server is connected to. Every integration is off until its key exists; the server always starts. SPEC §6 has the full list.</p>
      {err && <div className="kb-error">{err}</div>}
      {!s && !err && <div className="kb-col-empty">Asking the server…</div>}
      <div className="services-list">
        {rows.map((r) => (
          <div key={r.name} className="services-row">
            <span className={`f-dot ${r.on ? "is-ok" : "is-warn"}`} />
            <span className="services-name">{r.name}</span>
            <span className="services-detail">{r.detail}</span>
            {!r.on && <span className="services-how">{r.how}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
