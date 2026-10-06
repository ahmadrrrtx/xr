/*
 * Engine wire types (Phase 14) — the shapes the XR daemon actually emits,
 * verified live against `src/daemon/routes/*.routes.ts` and
 * `src/core/types.ts#ChatStreamEvent`. Only what the desktop consumes.
 */

export type ChatMode = 'agent' | 'ask' | 'plan';

/** `src/core/ux-status.ts` vocabulary (unknown values are tolerated). */
export type RunStatus =
  | 'preparing'
  | 'provider_selection'
  | 'provider_ready'
  | 'generating'
  | 'tool_running'
  | 'compacting_context'
  | 'awaiting_approval'
  | 'budget_stopped'
  | 'cancelled'
  | 'finishing'
  | 'done'
  | 'error'
  | (string & {});

export interface EngineUsage {
  inTokens: number;
  outTokens: number;
}

/** Structured preview the consent plane attaches to an approval. */
export interface EnginePreview {
  kind?: string;
  tool?: string;
  riskTier?: string;
  untrustedReason?: string;
  sections?: Array<{ title: string; body: string; kind?: string; truncated?: boolean }>;
}

export interface EngineApprovalRequired {
  id: string;
  tool: string;
  reason: string;
  args?: Record<string, unknown>;
  riskTier?: string;
  preview?: EnginePreview | string | null;
  ttlMs?: number;
}

export type EngineChatFrame =
  | {
      type: 'status';
      status: RunStatus;
      provider?: string;
      model?: string;
      message?: string;
      runId?: string;
      /** First frame only. */
      acknowledged?: boolean;
      mode?: ChatMode;
      cancelled?: boolean;
    }
  | { type: 'token'; text: string }
  | { type: 'tool_call'; id: string; tool: string; args?: Record<string, unknown> }
  | { type: 'tool_result'; id: string; tool: string; ok: boolean; result?: string; error?: string }
  | { type: 'usage'; usage: EngineUsage }
  | { type: 'error'; code?: string; message?: string; error?: string; retryable?: boolean; detail?: unknown }
  | {
      type: 'done';
      fullText?: string;
      finalMessage?: string;
      usage?: EngineUsage;
      finishReason?: string;
      stopped?: 'done' | 'error' | 'budget' | 'cancelled' | 'max_steps' | (string & {});
      steps?: number;
      ttftMs?: number;
      totalMs?: number;
      runId?: string;
    }
  /** Consent request — the run blocks until POST /approvals/:id/decision. */
  | { approval_required: EngineApprovalRequired; type?: undefined }
  /** Legacy observation line (`▸ think …`, `✗ error: …`); informational only. */
  | { text: string; type?: undefined };

/* ---------- catalogue ---------- */

export interface EngineProvider {
  id: string;
  label: string;
  tier?: string;
  kind: 'local' | 'cloud' | 'hosted';
  hasKey: boolean;
  authOk?: boolean;
  healthy: boolean;
  latencyMs?: number | null;
  detail?: string | null;
  capabilities?: { chat?: boolean; toolUse?: boolean; jsonMode?: boolean; streaming?: boolean; embeddings?: boolean };
  defaultModel?: string | null;
  cached?: boolean;
}

export interface EngineProvidersResponse {
  primary: string;
  model: string;
  fallback?: string | null;
  fallbackModel?: string | null;
  providers: EngineProvider[];
}

export interface EngineLocalModel {
  id?: string;
  name?: string;
  model?: string;
  size?: number;
  sizeBytes?: number;
  parameterSize?: string;
  quantization?: string;
  contextLength?: number;
  modifiedAt?: string;
  [k: string]: unknown;
}

export interface EngineModelsResponse {
  selected: { runtime: string; model: string; routing: string; provider?: string; enabled?: boolean };
  current: {
    id: string;
    providerId: string;
    label: string;
    baseUrl?: string;
    installed: boolean;
    running: boolean;
    configured?: boolean;
    healthy: boolean;
    models: EngineLocalModel[];
    version?: string | null;
    detail?: string | null;
    docsUrl?: string | null;
    installSupport?: unknown;
    modelManagement?: unknown;
  };
  hardware?: {
    summary?: string;
    specs?: { os?: string; arch?: string; cpuCores?: number; totalRamGb?: number; freeRamGb?: number; availableDiskGb?: number; gpus?: unknown[]; tier?: string };
  };
  recommendation?: unknown;
  runtimes?: unknown[];
  installed?: unknown[];
  catalog?: { modelCount?: number; providerCount?: number; builtAt?: string };
  fallbackChain?: unknown;
}

export interface EngineHealth {
  ok: boolean;
  name?: string;
  version?: { display?: string; [k: string]: unknown } | string;
  host?: string;
  binding?: string;
  auth?: string;
  ts?: number | string;
}

export interface EngineBudget {
  config: { perTaskUsd?: number; perTaskTokens?: number };
  persisted?: { monthly_cap?: number | null; daily_cap?: number | null; warnings_enabled?: boolean; auto_fallback?: boolean };
  usage: { totalUsd: number; totalTokens: number; dayUsd?: number; monthUsd?: number };
  burn?: { monthUsd?: number; monthlyCap?: number | null; burnPct?: number | null };
  byModel?: Record<string, { usd?: number; tokens?: number; calls?: number }>;
  byProvider?: Record<string, { usd?: number; tokens?: number; calls?: number }>;
  recent?: unknown[];
  generatedAt?: string | number;
}

export interface EnginePendingApproval {
  id: string;
  taskId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  tool: string;
  argsHash?: string;
  reason: string;
  preview?: EnginePreview | string | null;
  riskTier?: string;
  surface?: string;
  requestedAt: number;
  ttlMs: number;
  expiresAt: number;
}

export interface EngineAuditEntry {
  id: number | string;
  session_id?: string | null;
  event: string;
  detail?: string | Record<string, unknown> | null;
  hash?: string;
  created_at: string | number;
}
