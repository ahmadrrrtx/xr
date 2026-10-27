/** Listing is inspection, not authorization to contact configured endpoints. */
import { afterEach, expect, test } from "bun:test";
import { ConfigSchema } from "../../src/config/config.ts";
import { providersRoutes } from "../../src/daemon/routes/providers.routes.ts";
import type { DaemonRouteContext } from "../../src/daemon/routes/router.ts";
import { invalidateProviderHealthCache } from "../../src/providers/health.ts";
import { registerRuntimeSecretResolver } from "../../src/security/secret-broker.ts";
import { providerGateway } from "../../src/providers/gateway.ts";
import "../../src/providers/factory.ts";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  invalidateProviderHealthCache();
});

test("GET /api/providers is offline; credentials do not fabricate auth or health", async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    throw new Error("unexpected network request");
  }) as unknown as typeof fetch;
  const unregister = registerRuntimeSecretResolver(
    () => "deterministic-fake-credential",
  );
  try {
    invalidateProviderHealthCache();
    const config = ConfigSchema.parse({
      defaults: { provider: "openai", model: "gpt-6.1-sol" },
    });
    const handler = providersRoutes().find(
      (route) => route.id === "providers.list",
    )!;
    const response = await handler.handle({
      config,
      json: (data) => Response.json(data),
    } as DaemonRouteContext);
    const body = (await response!.json()) as any;
    expect(requests).toBe(0);
    expect(body.primary).toBe("openai");
    const openai = body.providers.find((p: any) => p.id === "openai");
    expect(openai.hasKey).toBe(true);
    expect(openai.authOk).toBe(false);
    expect(openai.healthy).toBe(false);
    expect(openai.healthState).toBe("unknown");
    expect(openai.authState).toBe("unverified");
    expect(openai.checkedAt).toBeNull();
  } finally {
    unregister();
  }
});

test("offline inspection retains only measured fresh health for the same endpoint", async () => {
  const config = ConfigSchema.parse({});
  invalidateProviderHealthCache();
  // Local diagnostic is explicit and mocked; it is not live validation.
  globalThis.fetch = (async () =>
    Response.json({ models: [] })) as unknown as typeof fetch;
  await providerGateway.health(config, "ollama");
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const before = providerGateway.inspectHealth(config, "ollama");
  expect(before).toBeDefined();
  expect(before!.cached).toBe(true);
  const changed = ConfigSchema.parse({
    providers: { ollama: { baseUrl: "https://different.invalid/v1" } },
  });
  expect(providerGateway.inspectHealth(changed, "ollama")).toBeUndefined();
  expect(requests).toBe(0);
});
