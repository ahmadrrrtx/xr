/**
 * Typed client for the XR engine daemon API (/api/v1).
 * The shell NEVER computes risk/policy/budget — it renders engine truth and forwards decisions.
 * (Boundary law: docs/xr-rebuild/XR_SECURITY_AUDIT.md SEC-07)
 */
const BASE = "/api/v1";

export class EngineDown extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch {
    throw new EngineDown("engine unreachable");
  }
  if (res.status === 401) throw new EngineDown("unauthorized — pairing required");
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return (await res.json()) as T;
}

/* ---------- stream events (engine vocabulary, src/core/types.ts) ---------- */
export type StreamEvent =
  | { type: "status"; status: string; message?: string; runId?: string; provider?: string; model?: string }
  | { type: "token"; text: string }
  | { type: "tool_call"; id: string; tool: string; args: unknown }
  | { type: "tool_result"; id: string; tool: string; ok: boolean; result?: string; error?: string }
  | { type: "done"; text?: string; runId?: string; [k: string]: unknown }
  | { type: "error"; error?: string; message?: string; [k: string]: unknown }
  | { type: string; [k: string]: unknown };

export async function chatStream(
  body: { message: string; mode?: "agent" | "ask" | "plan"; sessionId?: string },
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
  } catch {
    throw new EngineDown("engine unreachable");
  }
  if (!res.ok || !res.body) throw new Error(`${res.status} chat`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") { onEvent({ type: "done" }); continue; }
        try { onEvent(JSON.parse(payload) as StreamEvent); } catch { /* keepalive */ }
      }
    }
  }
}

/* ---------- entities ---------- */
export interface SessionSummary {
  id: string; title?: string; prompt?: string; mode?: string; status?: string;
  cwd?: string; workspace?: string; model?: string; provider?: string; costUsd?: number;
  [k: string]: unknown;
}
export interface Approval { id: string; action?: string; reason?: string; risk?: string; status?: string; [k: string]: unknown; }
export interface FileEntry { name: string; rel: string; type: "file" | "dir"; size: number; git?: string | null; isText?: boolean; }
export interface FilesRoot { entries?: FileEntry[]; branch?: string | null; dirty?: boolean; [k: string]: unknown; }
export interface MemoryEntry { id: string; text?: string; content?: string; category?: string; scope?: string; [k: string]: unknown; }
export interface ProviderInfo { id: string; name?: string; local?: boolean; keyless?: boolean; available?: boolean; models?: string[]; capabilities?: string[]; [k: string]: unknown; }

export const api = {
  health: () => req<Record<string, unknown>>("/health"),
  overview: () => req<Record<string, unknown>>("/overview"),
  sessions: () => req<SessionSummary[] | { sessions: SessionSummary[] }>("/sessions"),
  session: (id: string) => req<Record<string, unknown>>(`/sessions/${encodeURIComponent(id)}`),
  approvals: () => req<Approval[] | { pending: Approval[]; approvals?: Approval[] }>("/approvals"),
  /** Forward a human decision; engine re-validates and enforces (UI is display-only). */
  decide: (id: string, approved: boolean) =>
    req<unknown>(`/approvals/${encodeURIComponent(id)}/decision`, { method: "POST", body: JSON.stringify({ approved }) }),
  files: (path = "") => req<FilesRoot>(`/files?path=${encodeURIComponent(path)}`),
  fileRead: (path: string) => req<{ content?: string; text?: string; binary?: boolean }>(`/files/read?path=${encodeURIComponent(path)}`),
  fileDiff: (path: string) => req<Record<string, unknown>>(`/files/diff?path=${encodeURIComponent(path)}`),
  memory: () => req<MemoryEntry[] | { entries: MemoryEntry[] }>("/memory"),
  providers: () => req<ProviderInfo[] | { providers: ProviderInfo[]; active?: string }>("/providers"),
  models: () => req<Record<string, unknown>>("/models"),
  providersSet: (provider: string, model?: string) =>
    req<unknown>("/providers/set", { method: "POST", body: JSON.stringify({ provider, model: model ?? null }) }),
  modelsTest: (runtime: string, model: string) =>
    req<Record<string, unknown>>("/models/test", { method: "POST", body: JSON.stringify({ runtime, model }) }),
  cost: () => req<Record<string, unknown>>("/cost"),
};

export function asList<T>(v: T[] | { [k: string]: unknown } | undefined, ...keys: string[]): T[] {
  if (Array.isArray(v)) return v;
  if (v) for (const k of keys) if (Array.isArray((v as Record<string, unknown>)[k])) return (v as Record<string, unknown>)[k] as T[];
  return [];
}
