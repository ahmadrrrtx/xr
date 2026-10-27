/** Offline view of the SAME capability/locality/consent decision used for
 * execution. Catalog inspection never discovers runtimes or sends a prompt. */
import type { XRConfig } from "../config/config.ts";
import { RoutingService } from "../intelligence/routing-service.ts";
export interface FallbackStep { providerId: string; modelId: string; reason: string; kind: "primary" | "fallbackProvider" | "local"; }
export interface FallbackChain { steps: FallbackStep[]; allowed: boolean; explanation: string; }
export async function resolveFallbackChain(config: XRConfig, opts: { primaryProviderId?: string; primaryModelId?: string; allowFallback?: boolean; localityPolicy?: string } = {}): Promise<FallbackChain> {
  const allowFallback = opts.allowFallback ?? config.intelligencePlane?.allowFallback ?? false;
  const decision = new RoutingService(config).decide({
    provider: opts.primaryProviderId ?? config.defaults.provider,
    model: opts.primaryModelId ?? config.defaults.model,
    requirements: { ...(opts.localityPolicy ? { localityPolicy: opts.localityPolicy as import("../intelligence/types.ts").PolicyConstraints["localityPolicy"] } : {}), allowFallback, allowCrossProviderFallback: config.intelligencePlane?.allowCrossProviderFallback === true, allowCloudFallback: config.intelligencePlane?.allowCloudFallback === true },
  });
  if (!decision.selected || decision.unavailable) return { steps: [], allowed: false, explanation: decision.explanation };
  const selected = decision.selected;
  const steps: FallbackStep[] = [{ providerId: selected.providerId, modelId: selected.modelId, kind: "primary", reason: "selected primary (offline; reachability not asserted)" }, ...decision.fallbackChain.map(s => ({ ...s, kind: "fallbackProvider" as const }))];
  return { steps, allowed: allowFallback, explanation: allowFallback ? `Consented compatible chain: ${steps.map(s => `${s.providerId}/${s.modelId}`).join(" → ")}` : "Fallback disabled — selected primary only" };
}
