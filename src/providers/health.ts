/**
 * XR — Provider Health Check Engine
 * Tests connectivity, auth, and model availability for any provider.
 * Safe for diagnostics: never prints raw API keys.
 *
 * Phase 01 — the daemon request path uses `checkProviderHealthCached`:
 *   · bounded to HEALTH_BOUND_MS (2500 ms) per provider — a hanging endpoint
 *     can no longer stall providers.list/chat for 8–32 s;
 *   · results cached (success 60 s, failure 15 s) and deduplicated so N
 *     concurrent callers trigger ONE probe (no probe storms on dead hosts);
 *   · auth short-circuits before any network work (unchanged behavior).
 *
 * TIMEOUT ≠ CANCELLATION: the race returns the fallback at 2500 ms but the
 * underlying `provider.health()` fetch (internally bounded at 8 s per probe)
 * continues in the background because the Provider interface has no signal
 * plumbing. The cache/dedup ensure that raced probe is not repeated for the
 * TTL window — the documented mitigation (docs/perf/PERF-BUDGETS.md §Phase 01).
 *
 * Rollback: XR_HEALTH_CACHE=0|false disables the cache only (bounding stays).
 */

import type { XRConfig } from "../config/config.ts";
import { registry } from "./registry.ts";
import { getSecret } from "../security/secrets.ts";
import { bounded } from "../util/concurrency.ts";
import { TtlCache } from "../util/ttl-cache.ts";
import { xrMetrics } from "../observability/metrics.ts";

export interface ProviderHealthReport {
  id: string;
  ok: boolean;
  latencyMs?: number;
  detail: string;
  authOk: boolean;
  modelAvailable?: boolean;
  timestamp: string;
}

export interface CachedProviderHealth extends ProviderHealthReport {
  /** True when served from the cache (fresh or stale). */
  cached: boolean;
  /** True when the cached value was past its TTL (background refresh served next time). */
  stale: boolean;
  /** True when the probe was deduplicated onto an in-flight probe. */
  deduped: boolean;
  /** Wall-clock ms the (bounded) probe took. */
  probeMs: number;
}

export const HEALTH_BOUND_MS = 2500;
const HEALTH_CACHE_POSITIVE_TTL_MS =
  Number(process.env.XR_HEALTH_CACHE_TTL_MS ?? 60_000) > 0
    ? Number(process.env.XR_HEALTH_CACHE_TTL_MS ?? 60_000)
    : 60_000;
/** Failed health is cached much shorter so a newly-started runtime recovers fast. */
const HEALTH_CACHE_NEGATIVE_TTL_MS = Math.min(15_000, Math.max(1_000, Math.floor(HEALTH_CACHE_POSITIVE_TTL_MS / 4)));

export function healthCacheEnabled(): boolean {
  const raw = process.env.XR_HEALTH_CACHE;
  return raw === undefined || raw === "" || !/^(0|false|off|no)$/i.test(raw);
}

const providerHealthCache = new TtlCache<ProviderHealthReport>({
  ttlMs: HEALTH_CACHE_POSITIVE_TTL_MS,
  staleWhileRevalidateMs: 15_000,
  maxEntries: 64,
  onStats: (event) => {
    if (event === "hit") xrMetrics.providerHealthCacheHits.inc();
    else if (event === "miss") xrMetrics.providerHealthCacheMisses.inc();
    else if (event === "dedup") xrMetrics.deduplicatedRequests.inc({ resource: "provider_health" });
    else xrMetrics.providerHealthCacheRefreshes.inc();
  },
});

/** Test/ops hooks. */
export function providerHealthCacheStats() {
  return {
    ...providerHealthCache.stats(),
    enabled: healthCacheEnabled(),
    positiveTtlMs: HEALTH_CACHE_POSITIVE_TTL_MS,
    negativeTtlMs: HEALTH_CACHE_NEGATIVE_TTL_MS,
    boundMs: HEALTH_BOUND_MS,
  };
}
export function invalidateProviderHealthCache(id?: string): void {
  if (id === undefined) {
    providerHealthCache.clear();
    return;
  }
  // Targeted invalidation: drop every key for this provider id (any model).
  const prefix = `${id}|`;
  for (const key of [...providerHealthCache.keys()]) {
    if (key === id || key.startsWith(prefix)) providerHealthCache.delete(key);
  }
}

/**
 * Effective base URL for a provider from config (mirrors the factory's
 * precedence: localModels.runtimes[id].baseUrl → providers[id].baseUrl →
 * preset.baseUrl). Included in the cache key so a config change that moves a
 * runtime endpoint invalidates health automatically.
 */
function effectiveBaseUrl(config: XRConfig, id: string): string {
  const preset = registry.getPreset(id);
  const runtime = (config.localModels as Record<string, any>)?.runtimes?.[id];
  const providerEntry = config.providers[id] as { baseUrl?: unknown } | undefined;
  const raw =
    runtime?.baseUrl ??
    (typeof providerEntry?.baseUrl === "string" ? providerEntry.baseUrl : undefined) ??
    preset?.baseUrl ??
    "";
  return String(raw).replace(/\/$/, "");
}

function cacheKey(config: XRConfig, id: string, model?: string): string {
  return `${id}|${model ?? ""}|${effectiveBaseUrl(config, id)}`;
}

/** The timeout fallback: deterministic, honest, never thrown. */
function timeoutReport(id: string, model?: string): ProviderHealthReport {
  return {
    id,
    ok: false,
    latencyMs: HEALTH_BOUND_MS,
    detail: `health check timed out after ${HEALTH_BOUND_MS} ms`,
    authOk: true,
    modelAvailable: false,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Bounded, cached, deduplicated provider health — THE daemon request path.
 * Never throws for probe failures (auth errors, timeouts and connectivity
 * failures are all reported as `ok:false` reports).
 */
export async function checkProviderHealthCached(
  config: XRConfig,
  id: string,
  model?: string,
): Promise<CachedProviderHealth> {
  const key = cacheKey(config, id, model);
  const started = Date.now();
  const checker = new ProviderHealthChecker(config);

  const probe = async (): Promise<ProviderHealthReport> => {
    const report = await bounded(checker.check(id, model), HEALTH_BOUND_MS, timeoutReport(id, model));
    xrMetrics.providerHealthDuration.observe({ provider: id }, Date.now() - started);
    return report;
  };

  if (!healthCacheEnabled()) {
    const report = await probe();
    return { ...report, cached: false, stale: false, deduped: false, probeMs: Date.now() - started };
  }

  const result = await providerHealthCache.getOrStart(
    key,
    probe,
    // Negative results get a short TTL so a just-started runtime recovers fast.
    { ttlMs: (report) => (report.ok ? undefined : HEALTH_CACHE_NEGATIVE_TTL_MS) },
  );

  return {
    ...result.value,
    cached: result.fromCache,
    stale: result.stale,
    deduped: false,
    probeMs: Date.now() - started,
  };
}

export class ProviderHealthChecker {
  constructor(private config: XRConfig) {}

  async check(id: string, model?: string): Promise<ProviderHealthReport> {
    const preset = registry.getPreset(id);
    const timestamp = new Date().toISOString();

    if (!preset) {
      return {
        id,
        ok: false,
        detail: "Unknown provider",
        authOk: false,
        timestamp,
      };
    }

    // Auth check (never reveals the key value)
    let authOk = false;
    if (preset.apiKeyEnv) {
      authOk = !!(
        process.env[preset.apiKeyEnv] || getSecret(preset.apiKeyEnv)
      );
    } else {
      authOk = true; // local or no-key provider
    }

    if (!authOk) {
      return {
        id,
        ok: false,
        detail: preset.apiKeyEnv
          ? `API key ${preset.apiKeyEnv} not set`
          : "No authentication required",
        authOk: false,
        timestamp,
      };
    }

    // Connectivity + model availability via provider health()
    try {
      const provider = registry.createProvider(
        id,
        this.config,
        model ?? preset.defaultModel,
      );
      const start = Date.now();
      const h = await provider.health();
      const latency = Date.now() - start;
      return {
        id,
        ok: h.ok,
        latencyMs: h.latencyMs ?? latency,
        detail: h.detail ?? (h.ok ? "healthy" : "unhealthy"),
        authOk,
        modelAvailable: h.ok,
        timestamp,
      };
    } catch (e) {
      return {
        id,
        ok: false,
        detail: (e as Error).message,
        authOk,
        timestamp,
      };
    }
  }

  async checkAll(): Promise<ProviderHealthReport[]> {
    const reports: ProviderHealthReport[] = [];
    for (const preset of registry.list()) {
      reports.push(await this.check(preset.id));
    }
    return reports;
  }

  async checkActive(): Promise<ProviderHealthReport> {
    return this.check(
      this.config.defaults.provider,
      this.config.defaults.model,
    );
  }
}
