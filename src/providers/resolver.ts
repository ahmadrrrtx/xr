/**
 * XR — Provider Resolver (Phase 1 · Step 5 · RC-3).
 *
 * THE single entry for provider resolution. It is the ONLY place custom
 * presets are registered (`registry.syncCustom`) and every path that resolves a
 * provider — CLI, AgentService, routing, gateway, intelligence adapters —
 * goes through here so custom-provider lifecycle is unambiguous.
 *
 * Contract:
 *   - always loads config fresh (or accepts one) and syncs custom providers
 *     before resolving, so a freshly-added custom provider works in the same
 *     process and in a fresh process;
 *   - returns `{ provider, decision }` so callers can attach the (secret-free)
 *     routing decision to execution records;
 *   - keeps `buildProvider` / `buildProviderWithDecision` as delegating aliases
 *     (deprecated in 2.0) so existing call sites keep compiling.
 */

import type { XRConfig } from "../config/config.ts";
import type { Provider } from "../core/types.ts";
import { loadConfig } from "../config/config.ts";
import { registry } from "./registry.ts";
import { RoutingService, type ResolveOptions, type ResolveWithDecision } from "../intelligence/routing-service.ts";
import { setConfiguredRequestTimeout } from "./request-guard.ts";

export type { ResolveOptions, ResolveWithDecision } from "../intelligence/routing-service.ts";

/**
 * Load config (fresh when none supplied) and sync custom providers into the
 * registry. Idempotent; safe to call multiple times.
 */
export function syncCustomProviders(config?: XRConfig): XRConfig {
  const cfg = config ?? loadConfig().config;
  registry.syncCustom(cfg);
  return cfg;
}

/**
 * Resolve a provider to a concrete instance + routing decision. The single
 * documented entry for provider resolution. Always syncs custom providers and
 * honours the capability catalog (the instance carries its declared
 * capabilities via the registry).
 */
export function resolveProvider(
  config?: XRConfig,
  override?: ResolveOptions,
): ResolveWithDecision {
  const cfg = syncCustomProviders(config);
  setConfiguredRequestTimeout(cfg.providerEngine?.requestTimeoutMs);
  const router = new RoutingService(cfg);
  return router.resolveWithDecision(override);
}

/** Synchronous convenience: resolve to just the provider instance. */
export function resolveProviderSync(config?: XRConfig, override?: ResolveOptions): Provider {
  return resolveProvider(config, override).provider;
}
