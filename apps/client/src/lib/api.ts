/**
 * The client's one door to the Foundation server. In dev, Vite proxies /api,
 * /auth, /files, /mcp and /sync to the server (vite.config.ts), so the
 * session cookie is same-origin. VITE_FOUNDATION_SERVER points a built or
 * Tauri client at a remote server.
 */

import type { AgentEvent, SearchHit, UserInfo } from "@foundation/protocol";

export const SERVER = (import.meta.env.VITE_FOUNDATION_SERVER as string | undefined)?.replace(/\/$/, "") ?? "";

export function serverUrl(path: string) {
  return `${SERVER}${path}`;
}

export function wsUrl(path: string) {
  const base = SERVER || window.location.origin;
  return base.replace(/^http/, "ws") + path;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(serverUrl(path), {
    credentials: "include",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
  return body as T;
}

export const me = () => api<{ user: UserInfo | null }>("/api/me");
export const authConfig = () => api<{ google: boolean; devLogin: boolean; flowform?: { url: string } }>("/auth/config");
/** desktop: Google through flowform in the system browser; the window polls with a secret only it holds */
export const flowformBegin = () => api<{ url: string; poll: string; expiresIn: number }>("/auth/flowform/begin", { method: "POST" });
export const flowformPoll = (poll: string) =>
  api<{ status: "pending" | "ok" | "error"; user?: UserInfo; error?: string }>("/auth/flowform/poll", { method: "POST", headers: { authorization: `Bearer ${poll}` } });
export const devLogin = (email: string, name: string) => api<{ user: UserInfo }>("/auth/dev", { method: "POST", json: { email, name } });
export const logout = () => api("/auth/logout", { method: "POST" });

export function search(q: string, board: string, remote = true, signal?: AbortSignal) {
  return api<{ hits: SearchHit[]; sources: Record<string, number> }>(
    `/api/search?q=${encodeURIComponent(q)}&board=${encodeURIComponent(board)}&remote=${remote ? 1 : 0}`,
    { signal },
  );
}

export interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}

/** Upload with progress (XHR — fetch can't report upload progress). */
export function uploadFile(file: File, board: string, onProgress?: (f: number) => void): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", serverUrl(`/api/files?board=${encodeURIComponent(board)}&name=${encodeURIComponent(file.name)}`));
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", file.type || guessMime(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 300) reject(new ApiError(xhr.status, body.error ?? "upload failed"));
        else resolve(body.file);
      } catch {
        reject(new ApiError(xhr.status, "upload failed"));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "network error"));
    xhr.send(file);
  });
}

function guessMime(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    step: "model/step", stp: "model/step", iges: "model/iges", igs: "model/iges", stl: "model/stl", obj: "model/obj",
    glb: "model/gltf-binary", gltf: "model/gltf+json", "3mf": "model/3mf", md: "text/markdown", csv: "text/csv", pdf: "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Stream an agent turn (SSE over a POST). */
export async function streamAgent(
  body: { board: string; prompt: string; runtime?: string },
  onEvent: (e: AgentEvent) => void,
  signal: AbortSignal,
) {
  const res = await fetch(serverUrl("/api/agent"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text();
    throw new ApiError(res.status, (t && JSON.parse(t).error) || "agent unavailable");
  }
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
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)) as AgentEvent);
    }
  }
}
