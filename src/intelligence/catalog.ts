/**
 * XR 4.4 — Capability-aware provider/model catalog.
 * Built from the existing provider registry + presets; does not own adapters.
 */

import type { XRConfig } from "../config/config.ts";
import { registry } from "../providers/registry.ts";
import { PRESETS, type ProviderPreset } from "../providers/presets.ts";
import { getSecret, getSecretSyncCached } from "../security/secrets.ts";
import { TtlCache } from "../util/ttl-cache.ts";
import { xrMetrics } from "../observability/metrics.ts";
import {
  descriptorFromPreset,
  modelsFromPreset,
  modelKey,
} from "./capability.ts";
import type {
  ModelClass,
  ModelDescriptor,
  ProviderDescriptor,
} from "./types.ts";

export interface IntelligenceCatalog {
  providers: ProviderDescriptor[];
  models: ModelDescriptor[];
  builtAt: number;
}

// ── Phase 01 · catalog cache ─────────────────────────────────────────────────
//
// Every provider resolution (RoutingService → IntelligenceRouter → buildCatalog)
// used to rebuild the FULL provider/model catalog — a providers.list request
// with 26 providers ran 26 identical catalog builds (N+1). The catalog is
// now cached keyed by a CONFIG + REGISTRY + ENV fingerprint:
//   · config dimensions that shape the catalog (defaults, provider
//     capabilities, localModels, providers map, customProviders);
//   · the provider-registry version (customs synced/removed invalidate);
//   · API-key PRESENCE bits for keyed presets (a key stored/cleared
//     invalidates — credentialAvailable is part of the catalog).
// TTL 60 s + stale-while-revalidate 15 s. Rollback: XR_CATALOG_CACHE=0.

const CATALOG_CACHE_TTL_MS =
  Number(process.env.XR_CATALOG_CACHE_TTL_MS ?? 60_000) > 0
    ? Number(process.env.XR_CATALOG_CACHE_TTL_MS ?? 60_000)
    : 60_000;
const CATALOG_CACHE_SWR_MS = 15_000;

export function catalogCacheEnabled(): boolean {
  const raw = process.env.XR_CATALOG_CACHE;
  return raw === undefined || raw === "" || !/^(0|false|off|no)$/i.test(raw);
}

const catalogCache = new TtlCache<IntelligenceCatalog>({
  ttlMs: CATALOG_CACHE_TTL_MS,
  staleWhileRevalidateMs: CATALOG_CACHE_SWR_MS,
  maxEntries: 8,
  onStats: (event) => {
    if (event === "hit") xrMetrics.catalogCacheHits.inc();
    else if (event === "miss") xrMetrics.catalogCacheMisses.inc();
    else if (event === "dedup") xrMetrics.deduplicatedRequests.inc({ resource: "catalog" });
    else xrMetrics.catalogCacheRefreshes.inc();
  },
});

/** Keys currently refreshing in the background (sync API — no promise to await). */
const refreshing = new Set<string>();

/** Test/ops hooks. */
export function catalogCacheStats() {
  return { ...catalogCache.stats(), enabled: catalogCacheEnabled(), ttlMs: CATALOG_CACHE_TTL_MS };
}
export function invalidateCatalogCache(): void {
  catalogCache.clear();
  refreshing.clear();
}

/**
 * Fingerprint of everything that shapes the catalog. The catalog is a pure
 * function of (config, registry, key presence), so this key makes the cache
 * self-invalidating on any relevant change.
 */
export function catalogFingerprint(config?: XRConfig): string {
  const keyPresence: Record<string, boolean> = {};
  for (const preset of Object.values(PRESETS)) {
    if (preset.apiKeyEnv) {
      keyPresence[preset.apiKeyEnv] = !!(process.env[preset.apiKeyEnv] || getSecretSyncCached(preset.apiKeyEnv));
    }
  }
  return JSON.stringify({
    defaults: config
      ? {
          provider: config.defaults.provider,
          model: config.defaults.model,
          fallbackProvider: config.defaults.fallbackProvider ?? null,
          fallbackModel: config.defaults.fallbackModel ?? null,
        }
      : null,
    localModels: config
      ? {
          runtime: (config.localModels as any)?.runtime ?? null,
          selected: (config.localModels as any)?.selected ?? null,
          runtimes: (config.localModels as any)?.runtimes ?? {},
        }
      : null,
    providers: config ? (config.providers as Record<string, unknown>) ?? {} : null,
    providerCapabilities: config ? (config.providerEngine as any)?.providerCapabilities ?? {} : null,
    customProviders: config ? (config.providerEngine as any)?.customProviders ?? [] : null,
    registryVersion: registry.version,
    keyPresence,
  });
}

function credentialAvailable(preset: ProviderPreset): boolean {
  if (!preset.apiKeyEnv) return true;
  return !!(process.env[preset.apiKeyEnv] || getSecret(preset.apiKeyEnv));
}

/**
 * Build a fresh catalog from registry (built-ins + custom) and optional config
 * overlays (providerCapabilities, local runtime health).
 */
function buildCatalogUncached(config?: XRConfig): IntelligenceCatalog {
  const presets = new Map<string, ProviderPreset>();

  // Built-in presets
  for (const p of Object.values(PRESETS)) {
    presets.set(p.id, p);
  }
  // Registry may have custom + overrides
  for (const p of registry.list()) {
    presets.set(p.id, p);
  }

  // Sync custom from config if provided
  if (config) {
    try {
      registry.syncCustom(config);
      for (const p of registry.list()) {
        presets.set(p.id, p);
      }
    } catch {
      /* registry may be empty in unit tests */
    }
  }

  const providers: ProviderDescriptor[] = [];
  const models: ModelDescriptor[] = [];

  for (const preset of presets.values()) {
    const cred = credentialAvailable(preset);
    const pd = descriptorFromPreset(preset, cred);

    // Overlay local runtime health from config when present
    if (config?.localModels?.runtimes && preset.kind === "local") {
      const rt = (config.localModels.runtimes as Record<string, any>)[preset.id];
      if (rt) {
        pd.health = {
          ok: !!rt.healthy,
          authOk: true,
          available: rt.running !== false && rt.healthy !== false,
          detail: rt.detail,
          checkedAt: rt.lastCheckedAt ? Date.parse(rt.lastCheckedAt) || Date.now() : Date.now(),
          stale: true,
        };
      }
    }

    // Optional per-provider capability overrides from config
    const override = config?.providerEngine?.providerCapabilities?.[preset.id];
    if (override && typeof override === "object") {
      applyCapabilityOverride(pd, override);
    }

    providers.push(pd);
    const ms = modelsFromPreset(preset, cred);
    for (const m of ms) {
      if (pd.health) m.health = pd.health;
      // Apply model-level overrides when present: providerCapabilities[id].models[modelId]
      if (override?.models?.[m.modelId]) {
        applyModelOverride(m, override.models[m.modelId]);
      }
      models.push(m);
    }
  }

  return { providers, models, builtAt: Date.now() };
}

/**
 * Cached catalog. Configuration/registry/key-presence fingerprint keyed, so a
 * config change, a custom provider sync, or a stored/cleared API key
 * invalidates automatically. Stale values are served for the SWR window while
 * a single background rebuild runs (the catalog is CPU-only, so the rebuild
 * happens in a microtask and never blocks a request).
 */
export function buildCatalog(config?: XRConfig): IntelligenceCatalog {
  if (!catalogCacheEnabled()) return buildCatalogUncached(config);

  const key = catalogFingerprint(config);
  const hit = catalogCache.get(key);
  if (hit) {
    if (hit.stale && !refreshing.has(key)) {
      refreshing.add(key);
      queueMicrotask(() => {
        try {
          catalogCache.set(key, buildCatalogUncached(config));
        } finally {
          refreshing.delete(key);
        }
      });
    }
    return hit.value;
  }

  // First caller in a burst builds; every other caller in the same tick hits
  // the cache — this is what collapses the per-provider N+1 rebuild.
  const catalog = buildCatalogUncached(config);
  catalogCache.set(key, catalog);
  return catalog;
}

function applyCapabilityOverride(pd: ProviderDescriptor, override: any): void {
  // Only accept explicit tri-state or boolean fields we know
  const capKeys = [
    "chat",
    "reasoning",
    "toolUse",
    "jsonMode",
    "streaming",
    "vision",
    "embeddings",
    "functionCalling",
  ] as const;
  // Every capKeys entry is a real ModelCapabilities key — direct indexed
  // writes typecheck; no `any` (A-6 seam).
  for (const k of capKeys) {
    if (override[k] === true) pd.capabilities[k] = "supported";
    else if (override[k] === false) pd.capabilities[k] = "unsupported";
    else if (override[k] === "supported" || override[k] === "unsupported" || override[k] === "unknown") {
      pd.capabilities[k] = override[k];
    }
  }
}

function applyModelOverride(m: ModelDescriptor, override: any): void {
  if (!override || typeof override !== "object") return;
  applyCapabilityOverride({ capabilities: m.capabilities } as ProviderDescriptor, override);
  if (typeof override.contextWindow === "number") {
    m.context.contextWindow = override.contextWindow;
  }
}

export function findModel(
  catalog: IntelligenceCatalog,
  providerId: string,
  modelId?: string,
): ModelDescriptor | undefined {
  if (modelId) {
    const exact = catalog.models.find(
      (m) => m.providerId === providerId && m.modelId === modelId,
    );
    if (exact) return exact;
  }
  // Default model for provider
  const def = catalog.models.find((m) => m.providerId === providerId && m.isDefault);
  if (def) return def;
  return catalog.models.find((m) => m.providerId === providerId);
}

export function findProvider(
  catalog: IntelligenceCatalog,
  providerId: string,
): ProviderDescriptor | undefined {
  return catalog.providers.find((p) => p.providerId === providerId);
}

export function modelsForClass(
  catalog: IntelligenceCatalog,
  modelClass: ModelClass,
): ModelDescriptor[] {
  if (modelClass === "unknown") return catalog.models;
  return catalog.models.filter(
    (m) =>
      m.classes.includes(modelClass) ||
      (modelClass === "chat" && m.capabilities.chat === "supported") ||
      (modelClass === "tool_use" && m.capabilities.toolUse === "supported") ||
      (modelClass === "structured_output" &&
        (m.capabilities.structuredOutput === "supported" ||
          m.capabilities.jsonMode === "supported")) ||
      (modelClass === "vision" && m.capabilities.vision === "supported") ||
      (modelClass === "embeddings" && m.capabilities.embeddings === "supported") ||
      (modelClass === "reasoning" && m.capabilities.reasoning === "supported"),
  );
}

export function listProviderIds(catalog: IntelligenceCatalog): string[] {
  return catalog.providers.map((p) => p.providerId);
}

export { modelKey };
