/**
 * XR-LAUNCH-012 — XR_NETWORK_PROBES=off (set by the suite preload) stops
 * best-effort probes from dialing OFF-machine hosts, while loopback probes
 * (local runtimes, the suite's stubs) still run for real.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import "../../src/providers/factory.ts";

const ORIG = process.env.XR_NETWORK_PROBES;
afterEach(() => {
  if (ORIG === undefined) delete process.env.XR_NETWORK_PROBES;
  else process.env.XR_NETWORK_PROBES = ORIG;
});

async function config(id: string, baseUrl: string) {
  const { loadConfig } = await import("../../src/config/config.ts");
  const { config } = loadConfig();
  const providers = config.providers as Record<string, Record<string, unknown> | undefined>;
  providers[id] = { ...(providers[id] ?? {}), baseUrl };
  const runtimes = (config.localModels as Record<string, any>).runtimes;
  if (runtimes[id]) runtimes[id] = { ...runtimes[id], baseUrl };
  return config;
}

describe("XR_NETWORK_PROBES=off", () => {
  test("the suite preload turns off-machine probes off", () => {
    expect(ORIG).toBe("off");
  });

  test("a hosted provider is not dialed; the report says why", async () => {
    process.env.XR_NETWORK_PROBES = "off";
    const { registerRuntimeSecretResolver } = await import("../../src/security/secret-broker.ts");
    const unregister = registerRuntimeSecretResolver((n) => (n === "OPENAI_API_KEY" ? "REDACTED-test-key" : undefined));
    const spy = spyOn(globalThis, "fetch");
    try {
      const { ProviderHealthChecker } = await import("../../src/providers/health.ts");
      const r = await new ProviderHealthChecker(await config("openai", "https://api.example.invalid/v1")).check("openai");
      expect(r.ok).toBe(false);
      expect(r.authOk).toBe(true);
      expect(r.detail).toContain("XR_NETWORK_PROBES=off");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      unregister();
    }
  });

  test("loopback endpoints are still probed for real", async () => {
    process.env.XR_NETWORK_PROBES = "off";
    const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ data: [{ id: "m" }], models: [{ name: "m" }] }) });
    try {
      const { ProviderHealthChecker } = await import("../../src/providers/health.ts");
      const r = await new ProviderHealthChecker(await config("ollama", `http://127.0.0.1:${srv.port}`)).check("ollama");
      expect(r.detail).not.toContain("XR_NETWORK_PROBES");
      expect(r.ok).toBe(true);
    } finally {
      srv.stop(true);
    }
  });

  test("the internet probe reports offline without a request", async () => {
    process.env.XR_NETWORK_PROBES = "off";
    const spy = spyOn(globalThis, "fetch");
    try {
      const { checkInternetCached, invalidateInternetCache } = await import("../../src/daemon/state/cache.ts");
      invalidateInternetCache();
      expect(await checkInternetCached()).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
