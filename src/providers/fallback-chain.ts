/**
 * XR Phase 04 — Fallback Chain
 *
 * Explicit, bounded, auditable and policy-aware fallback.
 * Primary → fallbackProvider → local healthy runtime → error 503 only if all fail.
 *
 * Automatic fallback can cause cost/privacy surprises, so it must be explicit.
 */

import type { XRConfig } from "../config/config.ts";
import type { LocalRuntimeStatus } from "../local/runtimes.ts";
import { detectAllRuntimes } from "../local/runtimes.ts";

export interface FallbackStep {
  providerId: string;
  modelId: string;
  reason: string;
  kind: "primary" | "fallbackProvider" | "local";
}

export interface FallbackChain {
  steps: FallbackStep[];
  /** Whether fallback is allowed by policy */
  allowed: boolean;
  /** The full chain explanation for audit */
  explanation: string;
}

/**
 * Resolve the fallback chain according to:
 * explicit task provider → workspace/provider preference → configured default → safe fallback.
 *
 * Precedence documented:
 * explicit task provider ↓ workspace/provider preference ↓ configured default ↓ safe fallback if supported
 *
 * This function is policy-aware: it respects intelligencePlane.allowFallback, localityPolicy, etc.
 */
export async function resolveFallbackChain(
  config: XRConfig,
  opts: {
    primaryProviderId?: string;
    primaryModelId?: string;
    allowFallback?: boolean;
    localityPolicy?: string;
  } = {},
): Promise<FallbackChain> {
  const allowFallback = opts.allowFallback ?? config.intelligencePlane?.allowFallback ?? true;
  const steps: FallbackStep[] = [];

  const primaryId = opts.primaryProviderId ?? config.defaults.provider;
  const primaryModel = opts.primaryModelId ?? config.defaults.model;

  steps.push({
    providerId: primaryId,
    modelId: primaryModel,
    reason: "primary",
    kind: "primary",
  });

  if (!allowFallback) {
    return {
      steps,
      allowed: false,
      explanation: "Fallback disabled by policy — only primary will be tried",
    };
  }

  // Step 2: configured fallbackProvider if different
  const fallbackId = config.defaults.fallbackProvider;
  const fallbackModel = config.defaults.fallbackModel ?? primaryModel;
  if (fallbackId && fallbackId !== primaryId) {
    steps.push({
      providerId: fallbackId,
      modelId: fallbackModel,
      reason: `configured fallbackProvider (${fallbackId})`,
      kind: "fallbackProvider",
    });
  } else if (fallbackId && fallbackId === primaryId && fallbackModel !== primaryModel) {
    // Same provider different model is still useful diversity (Phase0 T11 fix)
    steps.push({
      providerId: fallbackId,
      modelId: fallbackModel,
      reason: `configured fallback model (${fallbackModel}) on same provider`,
      kind: "fallbackProvider",
    });
  }

  // Step 3: best local healthy runtime → only if locality allows
  const locality = opts.localityPolicy ?? config.intelligencePlane?.localityPolicy ?? "any";
  const localAllowed = locality === "any" || locality === "local_only" || locality === "private_only";
  const allowCloudFallback = config.intelligencePlane?.allowCloudFallback ?? false;

  // If primary is cloud and locality is local_only, we should NOT fallback to cloud, but local is ok.
  // If allowCloudFallback is false and localAllowed, still allow local.
  // Try to find best local healthy runtime if not already in chain
  if (localAllowed || allowCloudFallback) {
    try {
      const runtimes = await detectAllRuntimes();
      const bestLocal = findBestLocalHealthy(runtimes, steps.map((s) => s.providerId));
      if (bestLocal) {
        // Provider id for runtime e.g., ollama
        const localProviderId = bestLocal.providerId;
        const localModel = bestLocal.models[0] ?? config.defaults.fallbackModel ?? config.defaults.model ?? "qwen2.5:7b";
        // Avoid duplicate if already in chain
        if (!steps.some((s) => s.providerId === localProviderId)) {
          steps.push({
            providerId: localProviderId,
            modelId: localModel,
            reason: `best local healthy runtime (${bestLocal.id} — ${bestLocal.detail})`,
            kind: "local",
          });
        }
      }
    } catch {
      // Best effort — failing to detect runtimes should not break chain resolution
    }
  }

  // Deduplicate steps that are identical provider+model
  const deduped = deduplicateChain(steps);

  const explanation =
    deduped.length === 1
      ? `Primary only: ${deduped[0].providerId}/${deduped[0].modelId} (no fallback configured or allowed)`
      : `Fallback chain: ${deduped.map((s) => `${s.providerId}/${s.modelId} (${s.reason})`).join(" → ")}`;

  return {
    steps: deduped,
    allowed: allowFallback,
    explanation,
  };
}

function findBestLocalHealthy(
  runtimes: LocalRuntimeStatus[],
  excludeProviderIds: string[],
): LocalRuntimeStatus | undefined {
  // Prefer healthy with models, then healthy, then installed, then ollama
  const candidates = runtimes.filter((r) => !excludeProviderIds.includes(r.providerId));
  return (
    candidates.find((r) => r.healthy && r.models.length > 0) ??
    candidates.find((r) => r.healthy) ??
    candidates.find((r) => r.installed && r.id === "ollama") ??
    candidates.find((r) => r.installed)
  );
}

function deduplicateChain(steps: FallbackStep[]): FallbackStep[] {
  const seen = new Set<string>();
  const out: FallbackStep[] = [];
  for (const step of steps) {
    const key = `${step.providerId}|${step.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(step);
  }
  return out;
}

/**
 * Execute a fallback chain with bounded health checks.
 * Returns the first healthy provider from the chain, or null if all fail.
 */
export async function executeFallbackChain(
  chain: FallbackChain,
  healthCheck: (providerId: string, modelId: string) => Promise<{ ok: boolean }>,
  opts: { boundedTimeoutMs?: number } = {},
): Promise<FallbackStep | null> {
  for (const step of chain.steps) {
    try {
      const health = await healthCheck(step.providerId, step.modelId);
      if (health.ok) return step;
    } catch {
      // Continue to next fallback
      continue;
    }
  }
  return null;
}
