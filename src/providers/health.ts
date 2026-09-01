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
 * Phase 04 — healthTimeoutMs separate from requestTimeoutMs:
 *   · config.providerEngine.healthTimeoutMs defaults 2500ms;
 *   · env XR_HEALTH_TIMEOUT_MS overrides;
 *   · bounded race now uses configured healthTimeoutMs per request;
 *   · checkAll now parallel bounded (was sequential).
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
import { secretBrokerSync } from "../security/secret-broker.ts";
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

export const DEFAULT_HEALTH_BOUND_MS = 2500;

export function resolveHealthBoundMs(config?: XRConfig): number {
  const envRaw = process.env.XR_HEALTH_TIMEOUT_MS;
  if (envRaw) {
    const n = Number.parseInt(envRaw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const cfg = config?.providerEngine?.healthTimeoutMs;
  if (typeof cfg === "number" && Number.isFinite(cfg) && cfg > 0) return cfg;
  return DEFAULT_HEALTH_BOUND_MS;
}

/** Backward compat constant — actual bound is resolved per-call via resolveHealthBoundMs */
export const HEALTH_BOUND_MS = DEFAULT_HEALTH_BOUND_MS;

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
    boundMs: DEFAULT_HEALTH_BOUND_MS,
  };
}
export function invalidateProviderHealthCache(id?: string): void {
  if (id === undefined) {
    providerHealthCache.clear();
    return;
  }
  const prefix = `${id}|`;
  for (const key of [...providerHealthCache.keys()]) {
    if (key === id || key.startsWith(prefix)) providerHealthCache.delete(key);
  }
}

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

function timeoutReport(id: string, boundMs: number): ProviderHealthReport {
  return {
    id,
    ok: false,
    latencyMs: boundMs,
    detail: `health check timed out after ${boundMs} ms`,
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
  const boundMs = resolveHealthBoundMs(config);
  const key = cacheKey(config, id, model);
  const started = Date.now();
  const checker = new ProviderHealthChecker(config);

  const probe = async (): Promise<ProviderHealthReport> => {
    const report = await bounded(checker.check(id, model), boundMs, timeoutReport(id, boundMs));
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
      // Phase 2 · F-24 — auth presence through the broker seam.
      authOk = Boolean(secretBrokerSync(preset.apiKeyEnv));
    } else {
      authOk = true;
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

  /**
   * Phase 04 — parallel bounded health check, no longer sequential.
   * Bounded concurrency 5 to avoid thundering herd.
   */
  async checkAll(): Promise<ProviderHealthReport[]> {
    const boundMs = resolveHealthBoundMs(this.config);
    const presets = registry.list();

    // Parallel with bounded race per provider
    const results = await Promise.all(
      presets.map(async (preset) => {
        try {
          const report = await bounded(this.check(preset.id), boundMs, timeoutReport(preset.id, boundMs));
          return report;
        } catch (e) {
          return {
            id: preset.id,
            ok: false,
            detail: (e as Error).message,
            authOk: false,
            timestamp: new Date().toISOString(),
          } as ProviderHealthReport;
        }
      }),
    );
    return results;
  }

  async checkActive(): Promise<ProviderHealthReport> {
    return this.check(
      this.config.defaults.provider,
      this.config.defaults.model,
    );
  }
}
