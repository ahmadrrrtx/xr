/**
 * XR Phase 01 — hardware detection performance tests.
 *
 * Baselines measured on the pre-Phase-01 tree (main@9680298):
 *   · detectHardwareSpecs() wall ~3.5 s per call with slow GPU tooling
 *     (nvidia-smi 2.5 s + --help 1 s + lspci 1 s), executed on EVERY
 *     /api/models request, blocking the request path.
 *   · no cache existed.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGINAL_PATH = process.env.PATH;

function fakeBinDir(sleepSeconds: number): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-fakebin-"));
  writeFileSync(
    join(dir, "nvidia-smi"),
    `#!/bin/sh\nsleep ${sleepSeconds}\necho "NVIDIA GeForce RTX 4090, 24564"\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(dir, "lspci"),
    `#!/bin/sh\nsleep ${sleepSeconds}\necho "VGA compatible controller: NVIDIA Corporation GA102"\n`,
    { mode: 0o755 },
  );
  return dir;
}

describe("Phase 01 — hardware detection", () => {
  test.skipIf(process.platform === "win32")(
    "async detection does not block the event loop (slow GPU tooling)",
    async () => {
    const dir = fakeBinDir(2);
    process.env.PATH = `${dir}:${ORIGINAL_PATH ?? ""}`;
    try {
      // Re-import so PATH is observed (module reads env lazily anyway).
      const { detectHardwareSpecsAsync, invalidateHardwareCache } = await import("../../src/local/hardware.ts");
      invalidateHardwareCache();
      let maxGap = 0;
      let last = performance.now();
      const sampler = setInterval(() => {
        const now = performance.now();
        const gap = now - last;
        if (gap > maxGap) maxGap = gap;
        last = now;
      }, 5);
      const started = Date.now();
      const specs = await detectHardwareSpecsAsync();
      const wall = Date.now() - started;
      clearInterval(sampler);
      // The probes take ~2 s each; a synchronous implementation would stall
      // the loop by ≥2 s. Async must keep the loop responsive.
      expect(maxGap).toBeLessThan(250);
      expect(wall).toBeGreaterThanOrEqual(1000); // probes actually ran
      expect(specs.gpus.length).toBeGreaterThan(0);
      expect(specs.acceleration).toContain("cuda");
    } finally {
      process.env.PATH = ORIGINAL_PATH;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }, 20_000);

  test("hardware specs are cached: a repeat lookup is near-instant", async () => {
    const { getHardwareSpecs, invalidateHardwareCache, hardwareCacheStats } = await import("../../src/local/hardware.ts");
    invalidateHardwareCache();
    await getHardwareSpecs(); // cold
    const misses = hardwareCacheStats().misses;
    const started = Date.now();
    const specs = await getHardwareSpecs(); // warm
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(100);
    expect(hardwareCacheStats().misses).toBe(misses);
    expect(specs.cpuCores).toBeGreaterThan(0);
  }, 15_000);

  test("hardware work behind a short-TTL cache: expiry serves stale and refreshes in the background", async () => {
    // Deterministic integration check: real detection work behind a TtlCache
    // with a short TTL (the module-level hardware cache keeps its documented
    // 5-minute default; primitive expiry semantics are covered separately).
    const { TtlCache } = await import("../../src/util/ttl-cache.ts");
    const { detectHardwareSpecsAsync } = await import("../../src/local/hardware.ts");
    const cache = new TtlCache<Awaited<ReturnType<typeof detectHardwareSpecsAsync>>>({
      ttlMs: 150,
      staleWhileRevalidateMs: 1000,
    });
    const first = await cache.getOrStart("hw", detectHardwareSpecsAsync);
    expect(first.value.cpuCores).toBeGreaterThan(0);
    const before = cache.stats().refreshes;
    let refreshed = false;
    for (let i = 0; i < 30 && !refreshed; i++) {
      await new Promise((r) => setTimeout(r, 120));
      const result = await cache.getOrStart("hw", detectHardwareSpecsAsync);
      expect(result.value.cpuCores).toBeGreaterThan(0);
      refreshed = cache.stats().refreshes > before;
    }
    expect(refreshed).toBe(true);
  }, 20_000);

  test("missing GPU tools: detection succeeds with zero GPUs (no throw)", async () => {
    const { detectHardwareSpecsAsync } = await import("../../src/local/hardware.ts");
    // Fake bins not on PATH in this test → nvidia-smi/lspci absent.
    const specs = await detectHardwareSpecsAsync();
    expect(specs.gpus).toBeDefined();
    expect(Array.isArray(specs.acceleration)).toBe(true);
    expect(typeof specs.tier).toBe("string");
  }, 15_000);

  test("XR_HARDWARE_CACHE=0 disables the cache but detection still works", async () => {
    process.env.XR_HARDWARE_CACHE = "0";
    try {
      const { getHardwareSpecs, hardwareCacheStats } = await import("../../src/local/hardware.ts");
      const before = hardwareCacheStats().misses;
      await getHardwareSpecs();
      expect(hardwareCacheStats().misses).toBe(before); // cache untouched
      const specs = await getHardwareSpecs();
      expect(specs.cpuCores).toBeGreaterThan(0);
    } finally {
      delete process.env.XR_HARDWARE_CACHE;
    }
  }, 15_000);

  test("background refresh lifecycle can be started and stopped without throwing", async () => {
    const { startHardwareBackgroundRefresh, stopHardwareBackgroundRefresh, getHardwareSpecs, invalidateHardwareCache } =
      await import("../../src/local/hardware.ts");
    invalidateHardwareCache();
    startHardwareBackgroundRefresh();
    await new Promise((r) => setTimeout(r, 50));
    const specs = await getHardwareSpecs();
    expect(specs.cpuCores).toBeGreaterThan(0);
    stopHardwareBackgroundRefresh();
  }, 15_000);
});
