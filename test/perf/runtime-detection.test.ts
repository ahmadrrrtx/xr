/**
 * XR Phase 01 — runtime detection performance tests.
 *
 * Validates ACTUAL behavior (wall-clock + cache/dedup statistics), not source
 * inspection. The blackhole helper reproduces the forensic slow-failing
 * environment; tolerances are generous so shared CI runners do not flake.
 *
 * Baselines measured on the pre-Phase-01 tree (main@9680298):
 *   · detectAllRuntimes sequential, all ports blackholed: ~29 s
 *   · providers.list server-side: ~16 s (client killed by Bun 10 s timeout)
 *   · cached lookup: N/A (no cache existed)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBlackhole, type BlackholeHandle } from "../helpers/blackhole.ts";

describe("Phase 01 — runtime detection", () => {
  let blackhole: BlackholeHandle | null = null;

  beforeAll(() => {
    blackhole = startBlackhole();
  });

  afterAll(() => {
    blackhole?.stop();
  });

  test("bounded-parallel detection: 11 runtimes with all ports blackholed completes well under the old ~29 s sequential time", async () => {
    if (!blackhole) return; // ports busy — skip on hosts with real runtimes
    const { detectAllRuntimes, invalidateRuntimeCache } = await import("../../src/local/runtimes.ts");
    invalidateRuntimeCache();
    const started = Date.now();
    const runtimes = await detectAllRuntimes();
    const elapsed = Date.now() - started;
    // 3 waves × 2.5 s bound = ~7.5 s worst case; generous CI ceiling:
    expect(elapsed).toBeLessThan(12_000);
    expect(runtimes.length).toBeGreaterThanOrEqual(10);
  }, 20_000);

  test("deterministic fallback on timeout: every runtime gets a status row, none throws", async () => {
    if (!blackhole) return;
    const { detectAllRuntimes, invalidateRuntimeCache } = await import("../../src/local/runtimes.ts");
    const { invalidateConfigCache } = await import("../../src/config/cache.ts");
    // Hermetic: a sibling test ("mixed healthy") spins up a LIVE endpoint and
    // mutates config/env. Run this assertion against a FRESH isolated HOME
    // with the runtime+config caches cleared, so the result reflects a real
    // all-blackholed detection — never a cached healthy row leaked across
    // tests or processes (this assertion flaked red on loaded CI runners
    // because it trusted whatever the bounded-parallel test had cached).
    const { mkdtempSync: mkdtemp, rmSync: rm } = await import("node:fs");
    const { tmpdir: tmp } = await import("node:os");
    const { join: joinPath } = await import("node:path");
    const home = mkdtemp(joinPath(tmp(), "xr-det-timeout-"));
    const prevHome = process.env.XR_HOME;
    process.env.XR_HOME = home;
    invalidateConfigCache("all");
    invalidateRuntimeCache();
    try {
      const runtimes = await detectAllRuntimes();
      // 11 runtimes are expected (every blackholed port yields a row); guard
      // the count too so a missing row can never pass silently.
      expect(runtimes.length).toBeGreaterThanOrEqual(10);
      for (const r of runtimes) {
        expect(typeof r.id).toBe("string");
        expect(r.healthy).toBe(false);
        expect(typeof r.detail).toBe("string");
        expect(r.detail.length).toBeGreaterThan(0);
        expect(Array.isArray(r.models)).toBe(true);
        expect(typeof r.installed).toBe("boolean");
        expect(typeof r.configured).toBe("boolean");
      }
    } finally {
      invalidateRuntimeCache();
      if (prevHome === undefined) delete process.env.XR_HOME;
      else process.env.XR_HOME = prevHome;
      invalidateConfigCache("all");
      try {
        rm(home, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }, 20_000);

  test("mixed healthy/unhealthy runtimes: a live endpoint is healthy, a hanging one is not, failures are deterministic", async () => {
    // Healthy fake server on an ephemeral port; the remaining runtimes fail
    // fast (ECONNREFUSED). Assert both outcomes come back correctly from ONE
    // bounded-parallel detection.
    const healthy = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/tags") return Response.json({ models: [{ name: "qwen2.5:7b" }] });
        if (url.pathname === "/api/version") return Response.json({ version: "0.5.0" });
        return Response.json({ data: [{ id: "fake-model" }] });
      },
    });
    try {
      const { detectAllRuntimes, invalidateRuntimeCache } = await import("../../src/local/runtimes.ts");
      const { loadConfig, saveConfig } = await import("../../src/config/config.ts");
      const { invalidateConfigCache } = await import("../../src/config/cache.ts");
      invalidateRuntimeCache();
      const home = mkdtempSync(join(tmpdir(), "xr-mixed-"));
      const prevHome = process.env.XR_HOME;
      process.env.XR_HOME = home;
      invalidateConfigCache("all");
      try {
        const { config } = loadConfig();
        (config.localModels as Record<string, any>).runtimes.ollama = {
          ...((config.localModels as Record<string, any>).runtimes.ollama ?? {}),
          baseUrl: `http://127.0.0.1:${healthy.port}`,
        };
        saveConfig(config);
        const runtimes = await detectAllRuntimes();
        const ollama = runtimes.find((r) => r.id === "ollama");
        expect(ollama?.healthy).toBe(true);
        expect(ollama?.models).toContain("qwen2.5:7b");
        expect(ollama?.version).toBe("0.5.0");
        // Every other runtime got a deterministic non-healthy row.
        for (const r of runtimes) {
          if (r.id === "ollama") continue;
          expect(r.healthy).toBe(false);
          expect(typeof r.detail).toBe("string");
          expect(r.detail.length).toBeGreaterThan(0);
        }
      } finally {
        process.env.XR_HOME = prevHome;
        invalidateConfigCache("all");
        try {
          rmSync(home, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    } finally {
      healthy.stop();
    }
  }, 15_000);

  test("cached runtime lookup is < 50 ms (target) and < 100 ms (CI tolerance)", async () => {
    if (!blackhole) return;
    const { detectAllRuntimes } = await import("../../src/local/runtimes.ts");
    await detectAllRuntimes(); // warm
    const started = Date.now();
    await detectAllRuntimes();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(100);
  });

  test("concurrent callers are deduplicated onto ONE detection", async () => {
    if (!blackhole) return;
    const { detectAllRuntimes, invalidateRuntimeCache, runtimeCacheStats } = await import("../../src/local/runtimes.ts");
    invalidateRuntimeCache();
    const before = runtimeCacheStats().deduped;
    const started = Date.now();
    const results = await Promise.all(Array.from({ length: 5 }, () => detectAllRuntimes()));
    const elapsed = Date.now() - started;
    const after = runtimeCacheStats();
    // 5 callers on a cold cache → at least 4 folded onto the in-flight probe.
    expect(after.deduped - before).toBeGreaterThanOrEqual(4);
    // One shared detection, not 5 sequential ones (~29 s each before Phase 01):
    expect(elapsed).toBeLessThan(15_000);
    for (const r of results) expect(r.length).toBe(results[0]!.length);
  }, 20_000);

  test("configuration change invalidates the cache (config-aware key)", async () => {
    if (!blackhole) return;
    const { detectAllRuntimes, runtimeCacheStats, invalidateRuntimeCache } = await import("../../src/local/runtimes.ts");
    const { loadConfig, saveConfig } = await import("../../src/config/config.ts");
    const { invalidateConfigCache } = await import("../../src/config/cache.ts");
    invalidateRuntimeCache();
    const home = mkdtempSync(join(tmpdir(), "xr-rt-key-"));
    const prevHome = process.env.XR_HOME;
    process.env.XR_HOME = home;
    invalidateConfigCache("all");
    try {
      const { config } = loadConfig();
      config.defaults.provider = "ollama";
      saveConfig(config);
      await detectAllRuntimes();
      const misses1 = runtimeCacheStats().misses;
      // Same config → cache hit (no additional detection).
      await detectAllRuntimes();
      expect(runtimeCacheStats().misses).toBe(misses1);
      // Different config → new fingerprint → new detection (cache invalidated).
      const next = loadConfig().config;
      next.defaults.provider = "groq";
      saveConfig(next);
      await detectAllRuntimes();
      expect(runtimeCacheStats().misses).toBeGreaterThan(misses1);
    } finally {
      process.env.XR_HOME = prevHome;
      invalidateConfigCache("all");
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }, 20_000);

  test("XR_RUNTIME_CACHE=0 disables the cache but keeps detection working (bounded, never sequential)", async () => {
    if (!blackhole) return;
    process.env.XR_RUNTIME_CACHE = "0";
    try {
      const { detectAllRuntimes, runtimeCacheStats } = await import("../../src/local/runtimes.ts");
      const missesBefore = runtimeCacheStats().misses;
      const started = Date.now();
      await detectAllRuntimes();
      const first = Date.now() - started;
      await detectAllRuntimes(); // uncached → detection runs again
      const second = Date.now() - started - first;
      expect(first).toBeLessThan(12_000);
      expect(second).toBeLessThan(12_000);
      expect(runtimeCacheStats().misses).toBe(missesBefore); // cache untouched
    } finally {
      delete process.env.XR_RUNTIME_CACHE;
    }
  }, 30_000);
});

describe("Phase 01 — shared commandExists cache", () => {
  test("repeated probes are served from the 60 s memo (no repeated subprocess)", async () => {
    const { commandExists, clearCommandExistsCache } = await import("../../src/util/process.ts");
    clearCommandExistsCache();
    const MISSING = "xr-definitely-not-a-real-command-9f3a";
    await commandExists(MISSING); // cold
    const started = Date.now();
    const ok = await commandExists(MISSING); // warm — memoized
    const elapsed = Date.now() - started;
    expect(ok).toBe(false);
    expect(elapsed).toBeLessThan(100);
  });
});

describe("Phase 01 — TtlCache primitive", () => {
  test("hit / miss / TTL expiration", async () => {
    const { TtlCache } = await import("../../src/util/ttl-cache.ts");
    const c = new TtlCache<string>({ ttlMs: 50 });
    c.set("a", "v");
    expect(c.get("a")?.value).toBe("v");
    await new Promise((r) => setTimeout(r, 90));
    expect(c.get("a")).toBeUndefined();
  });

  test("stale-while-revalidate serves stale and refreshes once in the background", async () => {
    const { TtlCache } = await import("../../src/util/ttl-cache.ts");
    const c = new TtlCache<number>({ ttlMs: 50, staleWhileRevalidateMs: 500 });
    let builds = 0;
    c.set("k", 1);
    await new Promise((r) => setTimeout(r, 80)); // past TTL, inside SWR
    const result = await c.getOrStart("k", async () => {
      builds++;
      return 2;
    });
    expect(result.value).toBe(1); // stale served
    expect(result.stale).toBe(true);
    await new Promise((r) => setTimeout(r, 30)); // let background refresh land
    expect(builds).toBe(1);
    expect(c.isFresh("k")).toBe(true);
  });

  test("concurrent getOrStart deduplicates onto one in-flight operation", async () => {
    const { TtlCache } = await import("../../src/util/ttl-cache.ts");
    const c = new TtlCache<number>({ ttlMs: 60_000 });
    let runs = 0;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        c.getOrStart("k", async () => {
          runs++;
          await new Promise((r) => setTimeout(r, 50));
          return 42;
        }),
      ),
    );
    expect(runs).toBe(1);
    for (const r of results) expect(r.value).toBe(42);
    expect(c.stats().deduped).toBeGreaterThanOrEqual(4);
  });

  test("a rejected operation does not poison the cache (pending slot removed)", async () => {
    const { TtlCache } = await import("../../src/util/ttl-cache.ts");
    const c = new TtlCache<number>({ ttlMs: 60_000 });
    let runs = 0;
    await expect(
      c.getOrStart("k", async () => {
        runs++;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(
      c.getOrStart("k", async () => {
        runs++;
        return 7;
      }),
    ).resolves.toMatchObject({ value: 7 });
    expect(runs).toBe(2); // retried — nothing cached from the rejection
    expect(c.stats().misses).toBe(2);
  });

  test("memory is bounded by maxEntries (oldest evicted)", async () => {
    const { TtlCache } = await import("../../src/util/ttl-cache.ts");
    const c = new TtlCache<number>({ ttlMs: 60_000, maxEntries: 2 });
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.size).toBe(2);
    expect(c.get("a")).toBeUndefined(); // oldest evicted
  });
});
