/**
 * XR Phase 01 — daemon request-path performance tests.
 *
 * Baselines measured on the pre-Phase-01 tree (main@9680298), all local-runtime
 * ports blackholed:
 *   · /api/health     16 ms  (already light — must stay light)
 *   · /api/overview   33 ms  (already light — must stay light)
 *   · /api/providers  16.0 s server-side; client killed by Bun 10 s timeout
 *   · /api/onboarding 30.6 s server-side; client killed by Bun 10 s timeout
 *   · /api/models     ~36 s server-side; client killed by Bun 10 s timeout
 *   · chat.stream.post 32 s → 503
 *
 * This file binds its OWN blackhole servers on EPHEMERAL ports and points the
 * test config's local runtime base URLs at them — no shared fixed ports, so it
 * cannot race other test files (the global-port blackhole is used only by
 * test/perf/runtime-detection.test.ts).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "perf-token";

function blackholeServer(): { port: number; stop(): void } {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return new Promise(() => {}); // accept, never answer
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop() };
}

describe("Phase 01 — daemon request path under slow-failing probes", () => {
  let handler: (req: Request) => Promise<Response> | Response;
  let home: string;
  const prevHome = process.env.XR_HOME;
  const blackholes: Array<{ port: number; stop(): void }> = [];

  beforeAll(async () => {
    const { invalidateConfigCache } = await import("../../src/config/cache.ts");
    home = mkdtempSync(join(tmpdir(), "xr-routes-"));
    process.env.XR_HOME = home;
    invalidateConfigCache("all");

    // Point two local runtimes at blackholes so their probes hang (the other
    // runtimes fail fast with ECONNREFUSED, as on a normal machine).
    const { loadConfig, saveConfig } = await import("../../src/config/config.ts");
    const { config } = loadConfig();
    const runtimes = (config.localModels as Record<string, any>).runtimes;
    for (const id of ["ollama", "lmstudio"]) {
      const bh = blackholeServer();
      blackholes.push(bh);
      runtimes[id] = { ...(runtimes[id] ?? {}), baseUrl: `http://127.0.0.1:${bh.port}` };
    }
    saveConfig(config);

    const { makeHandler } = await import("../../src/daemon/server.ts");
    const { Store } = await import("../../src/state/workspace-store.ts");
    const store = new Store(join(home, "d.db"));
    handler = makeHandler(store, TOKEN);
  });

  afterAll(() => {
    for (const bh of blackholes) {
      try {
        bh.stop();
      } catch {
        /* ignore */
      }
    }
    process.env.XR_HOME = prevHome;
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const get = (path: string) =>
    new Request(`http://127.0.0.1:3141${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });

  test("/api/health does not trigger heavy detection and stays < 200 ms", async () => {
    const { runtimeCacheStats } = await import("../../src/local/runtimes.ts");
    const { hardwareCacheStats } = await import("../../src/local/hardware.ts");
    const missesBefore = runtimeCacheStats().misses + hardwareCacheStats().misses;
    const started = Date.now();
    const res = await handler(get("/api/v1/health"));
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(200);
    // No detection work was started by the health check.
    expect(runtimeCacheStats().misses + hardwareCacheStats().misses).toBe(missesBefore);
  });

  test("/api/overview stays lightweight (< 500 ms CI tolerance)", async () => {
    const started = Date.now();
    const res = await handler(get("/api/v1/overview"));
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(500);
  });

  test("providers.list completes within the 2.5 s health bound — no Bun timeout (was 16 s)", async () => {
    const started = Date.now();
    const res = await handler(get("/api/v1/providers"));
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(4000);
    const body: any = await res.json();
    expect(body.providers.length).toBeGreaterThanOrEqual(20);
  }, 15_000);

  test("onboarding.status completes within the p95 < 3 s target (was 30.6 s)", async () => {
    const started = Date.now();
    const res = await handler(get("/api/v1/onboarding/status"));
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(3500);
  }, 20_000);

  test("models.list completes without a 10 s timeout (was ~36 s)", async () => {
    const started = Date.now();
    const res = await handler(get("/api/v1/models"));
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(4000);
  }, 20_000);

  test("chat.stream returns a fast, honest 503 when the provider is unreachable (was 32 s)", async () => {
    const started = Date.now();
    const res = await handler(
      new Request("http://127.0.0.1:3141/api/v1/chat", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }),
    );
    const elapsed = Date.now() - started;
    expect(res.status).toBe(503);
    expect(elapsed).toBeLessThan(4000);
    const body: any = await res.json();
    expect(body.error).toContain("Provider offline");
  }, 15_000);

  test("repeat dashboard traffic is served from caches (warm requests are fast)", async () => {
    // Warm every endpoint once (populates caches), then measure.
    await handler(get("/api/v1/providers"));
    await handler(get("/api/v1/onboarding/status"));
    await handler(get("/api/v1/models"));
    const started = Date.now();
    await Promise.all([
      handler(get("/api/v1/providers")),
      handler(get("/api/v1/onboarding/status")),
      handler(get("/api/v1/models")),
    ]);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(500); // all served from shared caches
  });
});

describe("Phase 01 — dashboard client", () => {
  test("the dashboard script stages rendering and does not duplicate fetches", async () => {
    const { DASHBOARD_SCRIPT } = await import("../../src/daemon/dashboard.ts");
    // Stage one = lightweight cells; stage two = provider/model cells.
    expect(DASHBOARD_SCRIPT).toContain('api("/api/overview")');
    expect(DASHBOARD_SCRIPT).toContain("// Stage two — provider/model cells");
    // loadProviderChip reuses the already-fetched payloads.
    expect(DASHBOARD_SCRIPT).toContain("loadProviderChip(ovDone, providersDone)");
    // config is fetched once inside loadDashboard and shared across the
    // composer/voice/settings sync (other panels fetch config themselves).
    const dashBody = DASHBOARD_SCRIPT.slice(
      DASHBOARD_SCRIPT.indexOf("async function loadDashboard"),
      DASHBOARD_SCRIPT.indexOf("async function loadTrustPanel"),
    );
    const configFetches = dashBody.split('api("/api/config")').length - 1;
    expect(configFetches).toBe(1);
    expect(DASHBOARD_SCRIPT).toContain("loadComposerMeta(cfg)");
    expect(DASHBOARD_SCRIPT).toContain("loadVoiceStatus(cfg)");
    expect(DASHBOARD_SCRIPT).toContain("syncSettingsFromConfig(cfg)");
  });
});
