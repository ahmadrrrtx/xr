import { expect, test } from "bun:test";
import { ServiceRegistry } from "../../src/core/service-registry";
import { Tokens } from "../../src/core/tokens";
import { ConfigSchema } from "../../src/config/config";
import type { ConfigService } from "../../src/services/config-service";
import type { IntelligenceService } from "../../src/intelligence/service";
import { ProviderService } from "../../src/services/provider-service";
for (const gateway of ["0", "1"])
  test(`registered routing authority refusal is never retried through classic routing (gateway=${gateway})`, () => {
    const saved = process.env.XR_PROVIDER_GATEWAY;
    process.env.XR_PROVIDER_GATEWAY = gateway;
    try {
      const registry = new ServiceRegistry();
      registry.registerValue(Tokens.Config, {
        get: () => ConfigSchema.parse({}),
      } as ConfigService);
      let calls = 0;
      registry.registerValue(Tokens.Intelligence, {
        resolveProvider() {
          calls++;
          throw new Error("fixture policy refusal; no alternative allowed");
        },
      } as unknown as IntelligenceService);
      const providers = new ProviderService(registry);
      expect(() =>
        providers.getProvider({ provider: "openai", model: "gpt-6-luna" }),
      ).toThrow("fixture policy refusal");
      expect(calls).toBe(1);
      expect(providers.getLastDecision()).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.XR_PROVIDER_GATEWAY;
      else process.env.XR_PROVIDER_GATEWAY = saved;
    }
  });
test("initialization failure is not treated as an absent optional authority", () => {
  const registry = new ServiceRegistry();
  registry.registerValue(Tokens.Config, {
    get: () => ConfigSchema.parse({}),
  } as ConfigService);
  registry.registerSingleton(Tokens.Intelligence, () => {
    throw new Error("fixture invalid authority policy");
  });
  expect(() => new ProviderService(registry).getProvider()).toThrow(
    "fixture invalid authority policy",
  );
});
