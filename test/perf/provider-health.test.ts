/**
 * XR Phase 01 — provider health bounding + caching + dedup tests.
 *
 * Baselines measured on the pre-Phase-01 tree (main@9680298):
 *   · providers.list server-side ~16 s (2×8 s health probes per provider,
 *     client killed by Bun's 10 s timeout)
 *   · chat.stream.post 32 s → 503
 */

import { describe, expect, test } from "bun:test";
// Side-effect: registers the built-in provider presets (the daemon gets these
// via the factory import chain; a test importing health.ts alone would start
// with an empty registry otherwise).
import "../../src/providers/factory.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fakeHealthyServer() {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/models") || url.pathname.endsWith("/v1/models")) {
        return Response.json({ data: [{ id: "fake-model" }] });
      }
      return Response.json({ ok: true });
    },
  });
}

function blackholeServer() {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return new Promise(() => {});
    },
  });
}

async function freshConfig(baseUrl?: string) {
  const { loadConfig } = await import("../../src/config/config.ts");
  const { config } = loadConfig();
  // The local-provider factory prefers localModels.runtimes[id].baseUrl over
  // providers[id].baseUrl — override BOTH so the test endpoint wins even when
  // a parallel test file has written an ambient config.
  const providers = config.providers as Record<string, Record<string, unknown> | undefined>;
  providers.ollama = { ...(providers.ollama ?? {}), baseUrl };
  const runtimes = (config.localModels as Record<string, any>).runtimes;
  runtimes.ollama = { ...(runtimes.ollama ?? {}), baseUrl };
  return config;
}

describe("Phase 01 — provider health", () => {
  test("success: a reachable provider reports ok and the result is cached", async () => {
    const srv = fakeHealthyServer();
    try {
      const { checkProviderHealthCached, invalidateProviderHealthCache, providerHealthCacheStats } =
        await import("../../src/providers/health.ts");
      invalidateProviderHealthCache();
      const config = await freshConfig(`http://127.0.0.1:${srv.port}`);
      const h = await checkProviderHealthCached(config, "ollama");
      expect(h.ok).toBe(true);
      expect(h.cached).toBe(false);
      // Second call: cache hit, no re-probe.
      const h2 = await checkProviderHealthCached(config, "ollama");
      expect(h2.ok).toBe(true);
      expect(h2.cached).toBe(true);
      expect(providerHealthCacheStats().hits).toBeGreaterThanOrEqual(1);
    } finally {
      srv.stop();
    }
  });

  test("bounded timeout: a hanging endpoint reports ok:false within the 2.5 s bound (was 8–16 s)", async () => {
    const srv = blackholeServer();
    try {
      const { checkProviderHealthCached, invalidateProviderHealthCache } =
        await import("../../src/providers/health.ts");
      invalidateProviderHealthCache();
      const config = await freshConfig(`http://127.0.0.1:${srv.port}`);
      const started = Date.now();
      const h = await checkProviderHealthCached(config, "ollama");
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(3500);
      expect(h.ok).toBe(false);
      expect(h.detail).toContain("timed out");
    } finally {
      srv.stop();
    }
  });

  test("negative results are cached briefly: a repeat call does not re-probe", async () => {
    const srv = blackholeServer();
    try {
      const { checkProviderHealthCached, invalidateProviderHealthCache } =
        await import("../../src/providers/health.ts");
      invalidateProviderHealthCache();
      const config = await freshConfig(`http://127.0.0.1:${srv.port}`);
      await checkProviderHealthCached(config, "ollama"); // cold: 2.5 s probe
      const started = Date.now();
      const h = await checkProviderHealthCached(config, "ollama"); // warm: cached
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(200);
      expect(h.ok).toBe(false);
      expect(h.cached).toBe(true);
    } finally {
      srv.stop();
    }
  });

  test("concurrent callers are deduplicated onto ONE probe", async () => {
    const srv = blackholeServer();
    try {
      const { checkProviderHealthCached, invalidateProviderHealthCache, providerHealthCacheStats } =
        await import("../../src/providers/health.ts");
      invalidateProviderHealthCache();
      const config = await freshConfig(`http://127.0.0.1:${srv.port}`);
      const before = providerHealthCacheStats().deduped;
      const started = Date.now();
      const results = await Promise.all(Array.from({ length: 5 }, () => checkProviderHealthCached(config, "ollama")));
      const elapsed = Date.now() - started;
      expect(providerHealthCacheStats().deduped - before).toBeGreaterThanOrEqual(4);
      // One bounded probe (~2.5 s), not five sequential probes.
      expect(elapsed).toBeLessThan(4000);
      for (const r of results) expect(r.ok).toBe(false);
    } finally {
      srv.stop();
    }
  });

  test("auth short-circuit: a keyed provider with no key returns immediately without network", async () => {
    const { checkProviderHealthCached, invalidateProviderHealthCache } =
      await import("../../src/providers/health.ts");
    invalidateProviderHealthCache();
    const config = await freshConfig(); // no key for groq in this env
    const started = Date.now();
    const h = await checkProviderHealthCached(config, "groq");
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(500);
    expect(h.ok).toBe(false);
    expect(h.detail).toContain("API key");
  });
});

describe("Phase 01 — catalog cache", () => {
  test("catalog is built once per config state; repeats are cache hits", async () => {
    const { buildCatalog, invalidateCatalogCache, catalogCacheStats } = await import("../../src/intelligence/catalog.ts");
    invalidateCatalogCache();
    const config = await freshConfig();
    const c1 = buildCatalog(config);
    expect(c1.providers.length).toBeGreaterThan(0);
    const missesAfterFirst = catalogCacheStats().misses;
    const c2 = buildCatalog(config);
    expect(c2).toBe(c1); // identical instance from the cache
    expect(catalogCacheStats().misses).toBe(missesAfterFirst);
    expect(catalogCacheStats().hits).toBeGreaterThanOrEqual(1);
  });

  test("a config change invalidates the catalog cache", async () => {
    const { buildCatalog, invalidateCatalogCache, catalogCacheStats } = await import("../../src/intelligence/catalog.ts");
    const { loadConfig } = await import("../../src/config/config.ts");
    invalidateCatalogCache();
    const a = loadConfig().config;
    const b = structuredClone(a);
    b.defaults.provider = b.defaults.provider === "ollama" ? "groq" : "ollama";
    buildCatalog(a);
    const misses1 = catalogCacheStats().misses;
    buildCatalog(b);
    expect(catalogCacheStats().misses).toBeGreaterThan(misses1);
  });

  test("storing an API key invalidates the catalog (credentialAvailable changes)", async () => {
    const { buildCatalog, invalidateCatalogCache, catalogCacheStats } = await import("../../src/intelligence/catalog.ts");
    const { loadConfig } = await import("../../src/config/config.ts");
    const { PRESETS } = await import("../../src/providers/presets.ts");
    invalidateCatalogCache();
    const config = loadConfig().config;
    const groqEnv = PRESETS["groq"]!.apiKeyEnv!;
    const had = process.env[groqEnv];
    try {
      buildCatalog(config);
      const misses1 = catalogCacheStats().misses;
      process.env[groqEnv] = "sk-test";
      buildCatalog(config); // same config, changed key presence
      expect(catalogCacheStats().misses).toBeGreaterThan(misses1);
    } finally {
      if (had === undefined) delete process.env[groqEnv];
      else process.env[groqEnv] = had;
    }
  });
});

describe("Phase 01 — daemon request-path integrity", () => {
  test("providers.list triggers at most ONE catalog build (N+1 eliminated)", async () => {
    const { buildCatalog, invalidateCatalogCache, catalogCacheStats } = await import("../../src/intelligence/catalog.ts");
    const { invalidateProviderHealthCache } = await import("../../src/providers/health.ts");
    const { makeHandler } = await import("../../src/daemon/server.ts");
    const { Store } = await import("../../src/state/workspace-store.ts");
    const { loadConfig } = await import("../../src/config/config.ts");
    invalidateCatalogCache();
    invalidateProviderHealthCache();
    const home = mkdtempSync(join(tmpdir(), "xr-cat-"));
    const prevHome = process.env.XR_HOME;
    process.env.XR_HOME = home;
    const { invalidateConfigCache } = await import("../../src/config/cache.ts");
    invalidateConfigCache("all");
    try {
      loadConfig(); // populate config for the route
      const store = new Store(join(home, "d.db"));
      const h = makeHandler(store, "tok");
      const missesBefore = catalogCacheStats().misses;
      const res = await h(new Request("http://127.0.0.1:3141/api/v1/providers", {
        headers: { authorization: "Bearer tok" },
      }));
      expect(res.status).toBe(200);
      const body: any = await res.json();
      // 26+ providers in the list; the whole request may add at most one
      // catalog build (the health-check path also resolves providers).
      const addedMisses = catalogCacheStats().misses - missesBefore;
      expect(addedMisses).toBeLessThanOrEqual(1);
      expect(body.providers.length).toBeGreaterThanOrEqual(20);
    } finally {
      process.env.XR_HOME = prevHome;
      invalidateConfigCache("all");
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});
