/**
 * Typed client for the XR engine daemon API (/api/v1).
 * The shell NEVER computes risk/policy/budget — it renders engine truth and forwards decisions.
 * (Boundary law: docs/xr-rebuild/XR_SECURITY_AUDIT.md SEC-07)
 *
 * Transport resolution (Phase 4 · D-02):
 *   · packaged Tauri app → absolute http://127.0.0.1:<ephemeral port> with the
 *     sidecar's bearer token, obtained via the `engine_link` invoke (the Rust
 *     shell parses port+token from the daemon's own startup banner);
 *   · browser dev (vite) → relative /api/v1 through the dev proxy, which
 *     injects XR_DEV_TOKEN. Same code, honest fallback.
 */

type TauriInternals = { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
interface EngineLink { reachable?: boolean; spawned?: boolean; port?: number | null; token?: string | null; reason?: string | null }

export class EngineDown extends Error {}

let linkPromise: Promise<{ base: string; token: string | null }> | null = null;

function endpoint(): Promise<{ base: string; token: string | null }> {
  if (!linkPromise) {
    linkPromise = (async () => {
      const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
      if (internals?.invoke) {
        // Poll until the sidecar handshake lands (~1–3 s cold start), bounded.
        for (let i = 0; i < 40; i++) {
          try {
            const link = (await internals.invoke("engine_link")) as EngineLink;
            if (link?.reachable && link.port && link.token) {
              return { base: `http://127.0.0.1:${link.port}/api/v1`, token: link.token };
            }
            // Dev build or spawn failure → honest fallback to relative paths.
            if (link && link.spawned === false && link.reason) break;
          } catch {
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      return { base: "/api/v1", token: null };
    })();
  }
  return linkPromise;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const { base, token } = await endpoint();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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
  body: { message: string; mode?: "agent" | "ask" | "plan"; sessionId?: string; model?: string },
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { base, token } = await endpoint();
  let res: Response;
  try {
    res = await fetch(`${base}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

/* ---------- phase 2B · terminal stream (engine vocabulary, src/daemon/routes/terminal.routes.ts) ---------- */
export type TerminalEvent =
  | { type: "status"; status: string; approvalId?: string; cmd?: string; riskTier?: string; ttlMs?: number; decision?: string | null; error?: string }
  | { type: "output"; stream: "stdout" | "stderr"; text: string }
  | { type: "exit"; code: number | null; timedOut?: boolean; truncated?: boolean; ms?: number }
  | { type: string; [k: string]: unknown };

/** POST /terminal/run — SSE: approval_required → output chunks → exit. Policy + approval live in the engine. */
export async function terminalRun(
  body: { cmd: string; timeoutMs?: number },
  onEvent: (e: TerminalEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { base, token } = await endpoint();
  let res: Response;
  try {
    res = await fetch(`${base}/terminal/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new EngineDown("engine unreachable");
  }
  if (!res.ok || !res.body) {
    // 403 = policy-blocked before consent; surface the engine's reason verbatim.
    let msg = `${res.status} terminal/run`;
    try { const j = (await res.json()) as { error?: string }; if (j.error) msg = j.error; } catch { /* non-JSON */ }
    throw new Error(msg);
  }
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
        try { onEvent(JSON.parse(payload) as TerminalEvent); } catch { /* keepalive */ }
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
/** Phase 6: workflow summaries straight from GET /agents (engine WorkflowRepo). */
export interface WorkflowSummary {
  id: string; kind?: string; goal?: string; status?: string; reviewState?: string; approvalState?: string;
  createdAt?: string; updatedAt?: string;
  tasks?: { total?: number; completed?: number; failed?: number; blocked?: number; awaitingReview?: number };
  [k: string]: unknown;
}
export interface FileEntry { name: string; rel: string; type: "file" | "dir"; size: number; git?: string | null; isText?: boolean; }
export interface FilesRoot { entries?: FileEntry[]; branch?: string | null; dirty?: boolean; [k: string]: unknown; }
export interface MemoryEntry { id: string; text?: string; content?: string; category?: string; scope?: string; [k: string]: unknown; }
export interface ProviderInfo { id: string; name?: string; local?: boolean; keyless?: boolean; available?: boolean; models?: string[]; capabilities?: string[]; [k: string]: unknown; }

/* ---------- phase 3 · library entities (engine-owned truth) ---------- */
export interface SkillInfo { id: string; name?: string; version?: string; description?: string; kind?: string; enabled?: boolean; installed?: boolean; health?: string; verification?: string; permissions?: unknown[]; categories?: string[]; tags?: string[]; [k: string]: unknown; }
export interface McpServer { id: string; name?: string; version?: string; transport?: string; command?: string | null; url?: string | null; enabled?: boolean; health?: string; trust?: string; lifecycleState?: string; tools?: boolean; [k: string]: unknown; }
export interface PluginInfo { id: string; name?: string; version?: string; type?: string; description?: string; enabled?: boolean; status?: string; loaded?: boolean; detail?: string; permissions?: unknown[]; grantedPermissions?: unknown[]; trustLevel?: string; health?: string; [k: string]: unknown; }
export interface SkillPermissionsReport { skillId?: string; safe?: unknown[]; dangerous?: unknown[]; missingApproval?: unknown[]; [k: string]: unknown; }
export interface SkillDependencyReport { skillId?: string; ok?: boolean; requiredMissing?: unknown[]; optionalMissing?: unknown[]; statuses?: unknown[]; [k: string]: unknown; }
export interface SkillInspect { skill?: SkillInfo; permissions?: SkillPermissionsReport | null; dependencies?: SkillDependencyReport | null; }

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
  fileRead: (path: string) => req<{ content?: string; text?: string; binary?: boolean; mtimeMs?: number }>(`/files/read?path=${encodeURIComponent(path)}`),
  fileDiff: (path: string) => req<Record<string, unknown>>(`/files/diff?path=${encodeURIComponent(path)}`),
  /**
   * Phase 2B — save the editor buffer. The engine raises a durable approval
   * and this promise stays pending until a human decides; poll api.approvals()
   * meanwhile to render the decision card. applied=true only after bytes hit disk.
   */
  filesWrite: (path: string, content: string, baseMtimeMs?: number) =>
    req<{ applied: boolean; approvalId?: string; decision?: string | null; bytes?: number; mtimeMs?: number; stale?: boolean }>(
      "/files/write",
      { method: "POST", body: JSON.stringify({ path, content, ...(baseMtimeMs !== undefined ? { baseMtimeMs } : {}) }) },
    ),
  memory: () => req<MemoryEntry[] | { entries: MemoryEntry[] }>("/memory"),
  providers: () => req<ProviderInfo[] | { providers: ProviderInfo[]; active?: string }>("/providers"),
  models: () => req<Record<string, unknown>>("/models"),
  providersSet: (provider: string, model?: string) =>
    req<unknown>("/providers/set", { method: "POST", body: JSON.stringify({ provider, model: model ?? null }) }),
  modelsTest: (runtime: string, model: string) =>
    req<Record<string, unknown>>("/models/test", { method: "POST", body: JSON.stringify({ runtime, model }) }),
  cost: () => req<Record<string, unknown>>("/cost"),

  /* ---------- phase 3 · library (skills / MCP / plugins) ---------- */
  skills: (q?: string) =>
    req<{ health?: Record<string, unknown>; skills?: SkillInfo[] }>(`/skills${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  skillSet: (id: string, enabled: boolean) =>
    req<{ ok?: boolean }>(`/skills/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`, { method: "POST" }),
  mcpServers: () => req<{ servers?: McpServer[] }>("/mcp"),
  mcpHealth: () => req<{ reports?: unknown[] }>("/mcp/health"),
  mcpAdd: (body: { id: string; transport: string; command?: string; args?: string[]; url?: string }) =>
    req<Record<string, unknown>>("/mcp/add", { method: "POST", body: JSON.stringify(body) }),
  mcpRemove: (id: string) => req<Record<string, unknown>>("/mcp/remove", { method: "POST", body: JSON.stringify({ id }) }),
  mcpSet: (id: string, enabled: boolean) =>
    req<Record<string, unknown>>(`/mcp/${enabled ? "enable" : "disable"}`, { method: "POST", body: JSON.stringify({ id }) }),
  plugins: () => req<{ summary?: Record<string, unknown>; plugins?: PluginInfo[] }>("/plugins"),
  pluginSet: (id: string, enabled: boolean) =>
    req<Record<string, unknown>>(`/plugins/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`, { method: "POST" }),

  /* ---------- phase 4 · library depth (inspect / marketplace / grants) ---------- */
  skillInspect: (id: string) => req<SkillInspect>(`/skills/${encodeURIComponent(id)}/inspect`),
  skillsMarketplace: (q?: string) =>
    req<Record<string, unknown>>(`/skills/marketplace${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  skillsMarketplaceSync: () => req<Record<string, unknown>>("/skills/marketplace/sync", { method: "POST" }),
  skillInstall: (id: string, registryId?: string) =>
    req<Record<string, unknown>>("/skills/marketplace/install", { method: "POST", body: JSON.stringify({ id, ...(registryId ? { registryId } : {}) }) }),
  /** Grant exactly these permission scopes (engine filters invalid ones; full replace). */
  pluginPermissions: (id: string, permissions: string[]) =>
    req<Record<string, unknown>>(`/plugins/${encodeURIComponent(id)}/permissions`, { method: "POST", body: JSON.stringify({ permissions }) }),

  /* ---------- phase 6 · team-run board (multi-agent workflows, engine-owned) ---------- */
  agents: () => req<{ roles?: Record<string, unknown>[]; workflows?: WorkflowSummary[]; health?: Record<string, unknown> }>("/agents"),
  workflow: (id: string) => req<Record<string, unknown>>(`/agents/workflows/${encodeURIComponent(id)}`),
};

export function asList<T>(v: T[] | { [k: string]: unknown } | undefined, ...keys: string[]): T[] {
  if (Array.isArray(v)) return v;
  if (v) for (const k of keys) if (Array.isArray((v as Record<string, unknown>)[k])) return (v as Record<string, unknown>)[k] as T[];
  return [];
}
