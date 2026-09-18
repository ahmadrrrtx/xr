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
  if (!res.ok || !res.body) {
    // HTTP-level rejection (e.g. 503 provider offline): the engine answers with
    // a JSON {"error": …} body carrying the honest reason — surface it verbatim
    // instead of a bare status code (Phase 1 · BUG-1).
    let msg = `${res.status} chat`;
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
/** Phase 4 · planner template (GET /agents/templates). */
export interface AgentTemplate {
  kind: string; name: string; summary: string; roles: string[]; steps: number; sampleGoal: string;
}
/** Phase 4 · Control Cockpit — composed engine-side; shell only renders it. */
export interface CockpitState {
  mode: string;
  control: { enabled: boolean; disabledReason: string | null; capabilities?: unknown; browser?: unknown };
  pending: Approval[];
  permissions: string[];
  triggers: { pauseAll: boolean; inflight: number; triggers: unknown[] };
}
export interface ApprovalPreviewSection { title?: string; body?: string; kind?: "code" | "text" | "table"; truncated?: boolean; }
export interface ApprovalPreview { kind?: string; tool?: string; riskTier?: string; untrustedReason?: string; sections?: ApprovalPreviewSection[]; }
export interface Approval {
  id: string; action?: string; reason?: string; risk?: string; status?: string;
  tool?: string; surface?: string; runId?: string; sessionId?: string; taskId?: string;
  requestedAt?: number; ttlMs?: number; preview?: ApprovalPreview | null;
  [k: string]: unknown;
}
/** Phase 6: workflow summaries straight from GET /agents (engine WorkflowRepo). */
export interface WorkflowSummary {
  id: string; kind?: string; goal?: string; status?: string; reviewState?: string; approvalState?: string;
  createdAt?: string; updatedAt?: string;
  tasks?: { total?: number; completed?: number; failed?: number; blocked?: number; awaitingReview?: number };
  [k: string]: unknown;
}
/**
 * Phase 6: full workflow record (GET /agents/workflows/{id}).
 * Mirrors src/agents/types.ts WorkflowRecord — taskId/dependencies drive the DAG,
 * partitions carry engine-issued budgets, auditTrail is the per-task transcript.
 */
export interface WorkflowAuditEventV { ts?: number; kind?: string; message?: string; [k: string]: unknown; }
export interface WorkflowTaskV {
  taskId: string; agentId?: string; role?: string; name?: string; description?: string;
  parentTaskId?: string; dependencies?: string[]; status?: string;
  startedAt?: number; endedAt?: number; retryCount?: number; errors?: string[];
  outputs?: { summary?: string; artifacts?: Array<{ path: string; description?: string }> };
  auditTrail?: WorkflowAuditEventV[]; blockedReason?: string;
  [k: string]: unknown;
}
export interface WorkflowPartition {
  partitionId?: string; childId?: string; agentId?: string | null;
  capUsd?: number; capTokens?: number; consumedUsd?: number; consumedTokens?: number; status?: string;
}
/** Phase 4 · mirrors src/daemon/routes/agents-view.ts TeamView (engine-computed). */
export interface TeamView {
  workflowId: string;
  kind: string;
  goal: string;
  status: string;
  reviewState: string;
  approvalState: string;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  updatedAt: number;
  progressPct: number;
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  costUsd: number;
  costCapUsd: number;
  tokens: number;
  affordances: { pause: boolean; resume: boolean; cancel: boolean; steer: boolean };
  nodes: Array<{
    taskId: string;
    name: string;
    role: string;
    agentId: string;
    phase: string | null;
    status: string;
    reviewState: string;
    approvalState: string;
    blockedReason: string | null;
    tier: number;
    budget: { capUsd: number; consumedUsd: number; capTokens: number; consumedTokens: number };
    artifacts: Array<{ path: string; description?: string }>;
    startedAt: number | null;
    endedAt: number | null;
    awaitingReview: boolean;
  }>;
  edges: Array<{ from: string; to: string }>;
}

export interface WorkflowDetail {
  workflowId?: string; kind?: string; goal?: string; status?: string;
  reviewState?: string; approvalState?: string; cancellationState?: unknown;
  planSummary?: string; rootTaskIds?: string[]; tasks?: WorkflowTaskV[];
  partitions?: WorkflowPartition[]; currentAgentId?: string;
  createdAt?: number; updatedAt?: number; startedAt?: number; endedAt?: number;
  finalOutput?: { summary?: string }; errors?: string[];
  [k: string]: unknown;
}
/**
 * Phase 4 · Trust Center contracts — mirror the daemon's trust/budget/audit/
 * shield/control/triggers routes. The shell renders these and forwards
 * decisions; it never computes risk, policy or budget itself (SEC-07).
 */
export interface TrustBackend { id?: string; placement?: string; available?: boolean; describe?: string; }
export interface TrustStatus { enabled?: boolean; ready?: boolean; reason?: string; backends?: TrustBackend[]; [k: string]: unknown; }
export interface TrustClassification {
  classification?: {
    tier?: string; reasons?: string[]; requiredApprovalLevel?: string; requiredCredentialMode?: string;
    network?: unknown; resources?: unknown;
  };
  decision?: unknown;
  error?: string;
}
export interface BudgetState {
  config?: { perTaskUsd?: number; perTaskTokens?: number };
  persisted?: { monthly_cap?: number; daily_cap?: number | null; warnings_enabled?: boolean; auto_fallback?: boolean };
  usage?: { totalUsd?: number; totalTokens?: number; dayUsd?: number; monthUsd?: number };
  byModel?: unknown[];
  [k: string]: unknown;
}
export interface AuditEntry { id?: number; session_id?: string | null; event?: string; detail?: string; hash?: string; created_at?: number; }
export interface ShieldStatus {
  state?: { quarantined?: unknown[]; whitelisted?: unknown[]; history?: { timestamp?: number; type?: string; threatsCount?: number; scanMode?: string }[]; adBlockEnabled?: boolean; telemetryDisabled?: boolean };
  score?: { score?: number; checks?: { name?: string; ok?: boolean; detail?: string }[] };
  [k: string]: unknown;
}
export interface ControlStatus { enabled?: boolean; disabledReason?: string | null; capabilities?: Record<string, unknown>; [k: string]: unknown; }
export interface TriggersState { pauseAll?: boolean; inflight?: number; triggers?: unknown[]; [k: string]: unknown; }

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
  workflow: (id: string) => req<WorkflowDetail>(`/agents/workflows/${encodeURIComponent(id)}`),
  /** Phase 4 · engine-composed team-run snapshot (progress/cost/nodes/edges/affordances). */
  workflowView: (id: string) => req<{ workflow: TeamView }>(`/agents/workflows/${encodeURIComponent(id)}/view`),
  workflowCreate: (body: Record<string, unknown>) =>
    req<{ workflow: TeamView }>("/agents/workflows", { method: "POST", body: JSON.stringify(body) }),
  /** Phase 4 · trust-mode switch (persisted + enforced by the capabilities policy gate). */
  trustModeSet: (mode: string) =>
    req<{ ok: boolean; mode: string }>("/trust/mode", { method: "POST", body: JSON.stringify({ mode }) }),
  /** Phase 4 · steer a live run (engine delegateTask + audited handoff). */
  workflowSteer: (id: string, instruction: string, taskId?: string | null) =>
    req<{ workflow: TeamView }>(`/agents/workflows/${encodeURIComponent(id)}/steer`, {
      method: "POST",
      body: JSON.stringify({ instruction, taskId: taskId ?? undefined }),
    }),
  /** Phase 4 · human review decision for an awaiting_review task. */
  workflowReview: (id: string, taskId: string, approved: boolean, comment?: string) =>
    req<{ workflow: TeamView }>(`/agents/workflows/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify({ taskId, approved, comment: comment ?? undefined }),
    }),
  workflowControl: (id: string, action: "pause" | "resume" | "cancel") =>
    req<{ workflow: TeamView }>(`/agents/workflows/${encodeURIComponent(id)}/control`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),

  /* ---------- phase 4 · Trust Center (engine-owned truth; shell renders + forwards) ---------- */
  trust: () => req<TrustStatus>("/trust"),
  trustClassify: (cmd: string) =>
    req<TrustClassification>("/trust/classify", { method: "POST", body: JSON.stringify({ cmd }) }),
  budget: () => req<BudgetState>("/budget"),
  budgetSet: (patch: Record<string, unknown>) =>
    req<Record<string, unknown>>("/budget/set", { method: "POST", body: JSON.stringify(patch) }),
  audit: () => req<{ entries?: AuditEntry[] }>("/audit"),
  securityBench: () => req<Record<string, unknown>>("/security"),
  shieldStatus: () => req<ShieldStatus>("/shield/status"),
  shieldScan: () => req<Record<string, unknown>>("/shield/scan", { method: "POST", body: JSON.stringify({}) }),
  /** Phase 4 · Control Cockpit: one engine-composed pane (status+pending+permissions+triggers+mode). */
  /** Phase 4 · Skill template gallery (deterministic planner templates, engine-composed). */
  agentTemplates: () => req<{ templates: AgentTemplate[] }>("/agents/templates"),
  controlCockpit: () => req<CockpitState>("/control/cockpit"),
  controlStatus: () => req<ControlStatus>("/control/status"),
  controlPending: () => req<{ pending?: Approval[] }>("/control/pending"),
  controlApprove: (id: string, approved: boolean) =>
    req<{ ok?: boolean }>("/control/approve", { method: "POST", body: JSON.stringify({ id, approved }) }),
  controlPermissions: () => req<Record<string, unknown>>("/control/permissions"),
  /** Phase 4 · standing computer-use scope grant/revoke (persisted + audited engine-side). */
  permissionsGrant: (scope: string, revoke = false) =>
    req<{ ok?: boolean; granted?: string[] }>("/control/permissions/grant", {
      method: "POST",
      body: JSON.stringify({ scope, revoke }),
    }),
  triggers: () => req<TriggersState>("/triggers"),
  triggersPause: (pauseAll: boolean) =>
    req<{ ok?: boolean; pauseAll?: boolean }>("/triggers/pause", { method: "POST", body: JSON.stringify({ pauseAll, actor: "desktop" }) }),
  environmentPolicy: () => req<Record<string, unknown>>("/environment/policy"),
  contextPolicy: () => req<Record<string, unknown>>("/context/policy"),
  contextPending: () => req<Record<string, unknown>>("/context/pending"),
  contextRevoke: (id: string) => req<Record<string, unknown>>(`/context/revoke/${encodeURIComponent(id)}`, { method: "POST" }),

  /* ---------- phase 4 · Settings surfaces ---------- */
  workspaces: () => req<{ active?: string; workspaces?: { id?: string; name?: string; rootDir?: string }[] }>("/workspaces"),
  workspacesSwitch: (id: string) => req<Record<string, unknown>>("/workspaces/switch", { method: "POST", body: JSON.stringify({ id }) }),
  onboardingStatus: () =>
    req<{
      needsSetup?: boolean; reasons?: string[]; internet?: unknown;
      cloud?: { configured?: number; ready?: number; count?: number };
      local?: { runtime?: string; healthy?: boolean; running?: boolean; installed?: number };
      config?: { provider?: string; model?: string; memory?: boolean; voice?: boolean; approval?: boolean };
    }>("/onboarding/status"),
  /** Phase 1 — first-run connect: key goes straight to the engine secret store. */
  onboardingProvider: (body: { providerId: string; apiKey?: string; model?: string; probe?: boolean }) =>
    req<{ ok?: boolean; provider?: string; model?: string; secretBackend?: string; health?: { ok: boolean; detail: string | null; latencyMs: number | null }; error?: string }>(
      "/onboarding/provider", { method: "POST", body: JSON.stringify(body) },
    ),
  onboardingComplete: () => req<{ ok?: boolean }>("/onboarding/complete", { method: "POST", body: "{}" }),
  config: () => req<Record<string, unknown>>("/config"),
  metrics: () => req<Record<string, unknown>>("/metrics"),
  shieldPrivacy: () => req<ShieldStatus>("/shield/privacy"),
  mcpPins: () => req<{ servers: Record<string, { pinnedAt?: number; by?: string; tools?: Record<string, unknown> }> }>("/mcp/pins"),
  mcpPin: (serverId: string, actor?: string) =>
    req<Record<string, unknown>>("/mcp/pin", { method: "POST", body: JSON.stringify({ serverId, actor }) }),
  mcpUnpin: (serverId: string) =>
    req<Record<string, unknown>>("/mcp/unpin", { method: "POST", body: JSON.stringify({ serverId }) }),
  mcpPinDiff: (serverId: string) =>
    req<{ serverId: string; drift: { status: string; changed: { tool: string; before: string; after: string }[]; added: string[]; removed: string[] } }>(
      `/mcp/pins/diff/${encodeURIComponent(serverId)}`,
    ),
  voiceStatus: () => req<Record<string, unknown>>("/voice/status"),
  voiceSession: (action: "start" | "stop") => req<Record<string, unknown>>("/voice/session", { method: "POST", body: JSON.stringify({ action }) }),
  voiceAudio: (pcm: string) => req<Record<string, unknown>>("/voice/audio", { method: "POST", body: JSON.stringify({ pcm }) }),
  voiceBargeIn: () => req<Record<string, unknown>>("/voice/barge-in", { method: "POST", body: "{}" }),
  voicePlayed: () => req<Record<string, unknown>>("/voice/played", { method: "POST", body: "{}" }),
  voiceSay: (text: string) => req<Record<string, unknown>>("/voice/say", { method: "POST", body: JSON.stringify({ text }) }),
  skillsPins: () => req<{ pins: Record<string, boolean> }>("/skills/pins"),
  skillsPin: (id: string, pinned: boolean) =>
    req<Record<string, unknown>>("/skills/pin", { method: "POST", body: JSON.stringify({ id, pinned }) }),
  environmentCapabilities: () => req<Record<string, unknown>>("/environment/capabilities"),
  environmentStatus: () => req<Record<string, unknown>>("/environment/status"),
};

export function asList<T>(v: T[] | { [k: string]: unknown } | undefined, ...keys: string[]): T[] {
  if (Array.isArray(v)) return v;
  if (v) for (const k of keys) if (Array.isArray((v as Record<string, unknown>)[k])) return (v as Record<string, unknown>)[k] as T[];
  return [];
}
