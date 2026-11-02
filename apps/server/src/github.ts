/**
 * GitHub: find the repository behind an app, read its README and recent
 * commits, search the org's repos. Uses GITHUB_TOKEN when set, otherwise the
 * `gh` CLI's login on this machine (local dev), otherwise unauthenticated
 * public API (60 req/h).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.ts";

const exec = promisify(execFile);

let ghCliOk: boolean | null = null;

async function api<T>(path: string): Promise<T> {
  if (config.github.token) {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { authorization: `Bearer ${config.github.token}`, accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
    return (await res.json()) as T;
  }
  if (ghCliOk !== false) {
    try {
      const { stdout } = await exec("gh", ["api", path.replace(/^\//, "")], { maxBuffer: 16 * 1024 * 1024, timeout: 15_000 });
      ghCliOk = true;
      return JSON.parse(stdout) as T;
    } catch (e) {
      if (ghCliOk === null) ghCliOk = false;
      else throw e;
    }
  }
  const res = await fetch(`https://api.github.com${path}`, { headers: { accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export interface RepoInfo {
  fullName: string;
  url: string;
  description: string | null;
  homepage: string | null;
  defaultBranch: string;
  pushedAt: string;
  language: string | null;
  private: boolean;
}

interface GhRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  default_branch: string;
  pushed_at: string;
  language: string | null;
  private: boolean;
}

const toInfo = (r: GhRepo): RepoInfo => ({
  fullName: r.full_name,
  url: r.html_url,
  description: r.description,
  homepage: r.homepage,
  defaultBranch: r.default_branch,
  pushedAt: r.pushed_at,
  language: r.language,
  private: r.private,
});

export function parseRepo(input: string): string | null {
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?]|$)/.exec(input) ?? /^([\w.-]+)\/([\w.-]+)$/.exec(input.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export async function repoInfo(repo: string): Promise<RepoInfo> {
  return toInfo(await api<GhRepo>(`/repos/${repo}`));
}

export async function repoReadme(repo: string): Promise<string> {
  const r = await api<{ content: string; encoding: string }>(`/repos/${repo}/readme`);
  return Buffer.from(r.content, r.encoding as BufferEncoding).toString("utf8");
}

export async function repoCommits(repo: string, n = 8) {
  const rows = await api<Array<{ sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } } }>>(
    `/repos/${repo}/commits?per_page=${n}`,
  );
  return rows.map((c) => ({ sha: c.sha.slice(0, 7), url: c.html_url, message: c.commit.message.split("\n")[0], author: c.commit.author.name, date: c.commit.author.date }));
}

export async function searchRepos(q: string, limit = 8): Promise<RepoInfo[]> {
  const scope = config.github.org ? `+org:${config.github.org}` : "+user:@me";
  try {
    const r = await api<{ items: GhRepo[] }>(`/search/repositories?q=${encodeURIComponent(q)}${scope}&per_page=${limit}`);
    return r.items.map(toInfo);
  } catch {
    const r = await api<{ items: GhRepo[] }>(`/search/repositories?q=${encodeURIComponent(q)}&per_page=${limit}`);
    return r.items.map(toInfo);
  }
}

/**
 * Find the repo behind a running app: an explicit GitHub URL wins; then a
 * repo whose homepage matches the app's host; then a name search on the
 * host's first label (vercel/netlify/pages deployments are usually named
 * after the repo).
 */
export async function discoverRepo(appUrl: string): Promise<RepoInfo | null> {
  const direct = parseRepo(appUrl);
  if (direct) return repoInfo(direct).catch(() => null);
  let host: string;
  try {
    host = new URL(appUrl).hostname;
  } catch {
    return null;
  }
  const label = host.split(".")[0].replace(/-(git-[\w-]+|[a-z0-9]{9})$/, "");
  if (!label || label === "localhost" || /^\d+$/.test(label)) return null;
  const candidates = await searchRepos(label, 10).catch(() => []);
  const byHome = candidates.find((c) => c.homepage && c.homepage.includes(host));
  if (byHome) return byHome;
  const byName = candidates.find((c) => c.fullName.split("/")[1].toLowerCase() === label.toLowerCase());
  return byName ?? null;
}
