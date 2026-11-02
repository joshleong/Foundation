/**
 * One search across everything Foundation can see: the boards (every card's
 * text), uploaded files (full text, CAD headers), Slack messages (when a user
 * token with search:read is configured — flowform's Slack search), GitHub
 * repositories, and registered apps. Local sources answer from SQLite FTS5
 * in a few milliseconds; remote sources run in parallel with a short timeout
 * so a slow integration never holds the palette open.
 */

import type { SearchHit } from "@foundation/protocol";
import { config } from "./config.ts";
import { all } from "./db.ts";
import { searchRepos } from "./github.ts";

const REMOTE_TIMEOUT = 2500;

function ftsQuery(q: string): string {
  const terms = q
    .toLowerCase()
    .replace(/["'()*:^]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  return terms.map((t) => `"${t}"*`).join(" ");
}

export function searchLocal(q: string, boardId?: string, limit = 30): SearchHit[] {
  const match = ftsQuery(q);
  if (!match) return [];
  const rows = all<{ source: string; ref: string; board_id: string | null; title: string; snip: string; rank: number }>(
    `select source, ref, board_id, title, snippet(search_fts, 4, '«', '»', '…', 14) as snip, bm25(search_fts, 0, 0, 0, 4, 1) as rank
       from search_fts where search_fts match ? ${boardId ? "and (board_id = ? or board_id is null)" : ""}
       order by rank limit ?`,
    ...(boardId ? [match, boardId, limit] : [match, limit]),
  );
  return rows.map((r) => ({
    source: r.source as SearchHit["source"],
    id: `${r.source}:${r.ref}`,
    title: r.title,
    snippet: r.snip,
    objectId: r.source === "board" ? r.ref : r.source === "huddle" ? r.ref.split("/")[0] : undefined,
    url: r.source === "file" ? `/files/${r.ref}` : undefined,
    score: -r.rank,
  }));
}

async function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), REMOTE_TIMEOUT))]);
}

export async function searchSlack(q: string, limit = 8): Promise<SearchHit[]> {
  if (!config.slack.token) return [];
  const res = await fetch(`https://slack.com/api/search.messages?query=${encodeURIComponent(q)}&count=${limit}&sort=score`, {
    headers: { authorization: `Bearer ${config.slack.token}` },
  });
  const body = (await res.json()) as {
    ok: boolean;
    messages?: { matches: Array<{ iid: string; text: string; permalink: string; username?: string; channel?: { name?: string } }> };
  };
  if (!body.ok || !body.messages) return [];
  return body.messages.matches.map((m, i) => ({
    source: "slack" as const,
    id: `slack:${m.iid}`,
    title: `#${m.channel?.name ?? "dm"} · ${m.username ?? "someone"}`,
    snippet: m.text.slice(0, 220),
    url: m.permalink,
    score: 1 - i * 0.05,
  }));
}

export async function searchGithub(q: string): Promise<SearchHit[]> {
  const repos = await searchRepos(q, 5);
  return repos.map((r, i) => ({
    source: "github" as const,
    id: `github:${r.fullName}`,
    title: r.fullName,
    snippet: r.description ?? "",
    url: r.url,
    score: 0.8 - i * 0.05,
  }));
}

export function searchApps(q: string): SearchHit[] {
  const like = `%${q.toLowerCase()}%`;
  return all<{ id: string; name: string; url: string; description: string }>(
    "select id, name, url, description from apps where lower(name) like ? or lower(coalesce(description,'')) like ? or lower(coalesce(url,'')) like ? or lower(coalesce(repo,'')) like ? limit 8",
    like,
    like,
    like,
    like,
  ).map((a) => ({ source: "app" as const, id: `app:${a.id}`, title: a.name, snippet: a.description ?? a.url ?? "", url: a.url, score: 2 }));
}

export async function searchAll(q: string, opts: { boardId?: string; remote?: boolean } = {}): Promise<{ hits: SearchHit[]; sources: Record<string, number> }> {
  const local = searchLocal(q, opts.boardId);
  const apps = searchApps(q);
  const [slack, github] = opts.remote === false ? [[], []] : await Promise.all([withTimeout(searchSlack(q), []), withTimeout(searchGithub(q), [])]);
  const hits = [...apps, ...local, ...slack, ...github];
  const sources: Record<string, number> = {};
  for (const h of hits) sources[h.source] = (sources[h.source] ?? 0) + 1;
  return { hits, sources };
}

export function integrationStatus() {
  return {
    slack: Boolean(config.slack.token),
    github: Boolean(config.github.token) || "cli",
    google: Boolean(config.google.clientId),
    anthropicApi: Boolean(config.anthropic.apiKey),
  };
}
