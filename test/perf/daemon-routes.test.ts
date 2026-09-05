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
 * Determinism contract (PR #80 macOS repair): the daemon boots its config
 * ONCE per process (ConfigService is a boot-time singleton) and wires chat
 * fallbacks from the intelligence catalog's ranked candidates — so this file
 * maintains exactly ONE config world for the whole process:
 *   · primary ollama on a closed port (instant refusal),
 *   · configured fallback lmstudio on an IN-PROCESS stand-in server whose
 *     health a test can flip (`lmstudioHealthy`) without touching ports,
 *   · every other local runtime hard-removed from the chat candidate set
 *     (model-level chat capability overrides — see onlyChatCapableLocals).
 * All tests must go through this world; none may rewrite config mid-file.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "perf-token";

/**
 * The in-process lmstudio stand-in: a fixed port owned by this file for the
 * whole run (no other test binds it), with a health flag tests can flip so a
 * "provider down" scenario needs no socket churn and no config rewrite.
 */
const LMSTUDIO_PORT = 46587;
let lmstudioHealthy = true;

/**
 * Deterministically remove every local runtime except `keep` from the CHAT
 * candidate set:
 *   · model-level `chat: false` capability overrides — a HARD evaluator
 *     rejection (provider-level overrides do NOT propagate to model
 *     descriptors, so the models must be overridden explicitly);
 *   · unhealthy runtime marks (soft scoring factor on top).
 *
 * Why: the daemon wires its chat fallback from the intelligence catalog's
 * ranked compatible candidates (routePinned), NOT from
 * `defaults.fallbackProvider`. With every local preset compatible by default,
 * in-process ranking noise (metrics/breaker state accumulated earlier in the
 * lane) could wire `jan` — dead on CI runners — instead of the configured
 * healthy fallback (the macOS failure in PR #80). Constraining the candidate
 * set makes both chat scenarios in this file deterministic while still
 * exercising the real production path (boot config → catalog → evaluator →
 * pinned-route chain → bounded preflight health gate → FallbackProvider).
 */
async function onlyChatCapableLocals(config: Record<string, any>, keep: string[]): Promise<void> {
  const { LOCAL_RUNTIMES } = await import("../../src/local/registry.ts");
  const { PRESETS } = await import("../../src/providers/presets.ts");
  const capabilities = ((config.providerEngine as Record<string, any>) ?? {}).providerCapabilities ?? {};
  const runtimes = (config.localModels as Record<string, any>).runtimes;
  for (const def of LOCAL_RUNTIMES) {
    if (keep.includes(def.providerId) || keep.includes(def.id)) continue;
    const preset = (PRESETS as Record<string, any>)[def.providerId];
    const modelIds = new Set<string>([preset?.defaultModel, ...((preset?.knownModels as string[]) ?? [])].filter(Boolean));
    capabilities[def.providerId] = {
      ...capabilities[def.providerId],
      chat: false,
      models: Object.fromEntries([...modelIds].map((m) => [m, { chat: false }])),
    };
    runtimes[def.id] = { ...(runtimes[def.id] ?? {}), healthy: false, running: false };
  }
  config.providerEngine = { ...((config.providerEngine as Record<string, any>) ?? {}), providerCapabilities: capabilities };
}

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
  let healthy: ReturnType<typeof Bun.serve> | null = null;
  const prevHome = process.env.XR_HOME;

  beforeAll(async () => {
    const { invalidateConfigCache } = await import("../../src/config/cache.ts");
    home = mkdtempSync(join(tmpdir(), "xr-routes-"));
    process.env.XR_HOME = home;
    invalidateConfigCache("all");
    // Cross-file process hygiene: an earlier file in the same lane (e.g.
    // boot-profile) may have populated the module-level provider-health and
    // runtime-detection caches against a DIFFERENT XR_HOME/config.
    const { invalidateProviderHealthCache } = await import("../../src/providers/health.ts");
    const { invalidateRuntimeCache } = await import("../../src/local/runtimes.ts");
    invalidateProviderHealthCache();
    invalidateRuntimeCache();

    // THE one config world for this process (see the header comment):
    //   primary ollama → closed port (instant refusal, keeps chat fast);
    //   fallback lmstudio → in-process healthy server (flippable).
    healthy = Bun.serve({
      port: LMSTUDIO_PORT,
      hostname: "127.0.0.1",
      fetch(req) {
        if (!lmstudioHealthy) return new Response("lmstudio stand-in is down", { status: 500 });
        const url = new URL(req.url);
        if (url.pathname.endsWith("/models")) return Response.json({ data: [{ id: "qwen2.5:7b" }] });
        if (url.pathname.endsWith("/chat/completions")) {
          return Response.json({ choices: [{ message: { content: "fallback reply" } }], usage: { prompt_tokens: 2, completion_tokens: 3 } });
        }
        return Response.json({ ok: true });
      },
    });

    const { loadConfig, saveConfig } = await import("../../src/config/config.ts");
    const { config } = loadConfig();
    config.defaults.provider = "ollama";
    config.defaults.model = "qwen2.5:7b";
    config.defaults.fallbackProvider = "lmstudio";
    config.defaults.fallbackModel = "qwen2.5:7b";
    config.providerEngine.routingStrategy = "primary"; // deterministic primary+fallback
    const runtimes = (config.localModels as Record<string, any>).runtimes;
    runtimes.ollama = { ...(runtimes.ollama ?? {}), baseUrl: "http://127.0.0.1:1" };
    runtimes.lmstudio = { ...(runtimes.lmstudio ?? {}), baseUrl: `http://127.0.0.1:${LMSTUDIO_PORT}` };
    // Deterministic chat candidate set (see onlyChatCapableLocals) — applied
    // BEFORE the first chat boots the daemon kernel, so the boot-captured
    // ConfigService/IntelligenceService see the same constrained world.
    await onlyChatCapableLocals(config as unknown as Record<string, any>, ["ollama", "lmstudio"]);
    saveConfig(config);
    invalidateProviderHealthCache();
    invalidateRuntimeCache();

    const { makeHandler } = await import("../../src/daemon/server.ts");
    const { Store } = await import("../../src/state/workspace-store.ts");
    const store = new Store(join(home, "d.db"));
    handler = makeHandler(store, TOKEN);
  });

  afterAll(() => {
    try {
      healthy?.stop(true);
    } catch {
      /* ignore */
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
    // 5000 ms budget: the contract under test is "no 10 s client timeout" —
    // the original 4000 ms bound flaked on loaded Windows hosted runners at
    // ~4034 ms (0.8% over, pure scheduling noise; observed in PR #73). 5000 ms
    // still proves the regression class (36 s → <5 s) with real headroom.
    expect(elapsed).toBeLessThan(5000);
  }, 20_000);

  test("chat.stream returns a fast, honest 503 when the provider chain is unreachable (was 32 s)", async () => {
    // Take the fallback stand-in DOWN (instant 500s — no port churn): the
    // effective chain is primary(closed port) → fallback(down) → honest 503.
    lmstudioHealthy = false;
    const { invalidateProviderHealthCache } = await import("../../src/providers/health.ts");
    const { invalidateRuntimeCache } = await import("../../src/local/runtimes.ts");
    invalidateProviderHealthCache(); // preflight must probe NOW, not read a cached healthy row
    invalidateRuntimeCache();
    try {
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
    } finally {
      // Restore the single config world for the tests that follow.
      lmstudioHealthy = true;
      invalidateProviderHealthCache();
      invalidateRuntimeCache();
    }
  }, 15_000);

  test("chat with a dead primary but healthy fallback succeeds via the bounded fallback health gate", async () => {
    // Single config world (see header): primary ollama is on a closed port;
    // the configured fallback lmstudio is the in-process stand-in and is UP.
    // The preflight health gate must pass on lmstudio, and the chat must wire
    // ollama → lmstudio (the ONLY other chat-capable local) and succeed.
    const { invalidateProviderHealthCache } = await import("../../src/providers/health.ts");
    const { invalidateRuntimeCache } = await import("../../src/local/runtimes.ts");
    invalidateProviderHealthCache(); // never trust a row cached by an earlier test
    invalidateRuntimeCache();
    const started = Date.now();
    const res = await handler(
      new Request("http://127.0.0.1:3141/api/v1/chat", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }),
    );
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200); // NOT 503 — fallback health gate passed
    expect(elapsed).toBeLessThan(10_000); // bounded probes + fast chat
    const text = await res.text();
    expect(text).toContain("fallback reply");
    expect(text).toContain("done");
  }, 20_000);

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
