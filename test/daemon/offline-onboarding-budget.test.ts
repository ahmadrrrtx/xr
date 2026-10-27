/** Real authenticated route/schema/store path, isolated homes. Network and OS
 * store tests below are deterministic seams, NOT live backend validation. */
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ConfigSchema,
  loadConfig,
  saveConfig,
} from "../../src/config/config.ts";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { invalidateProviderHealthCache } from "../../src/providers/health.ts";
import { invalidateInternetCache } from "../../src/daemon/state/cache.ts";
import { invalidateRuntimeCache } from "../../src/local/runtimes.ts";
import { PRESETS } from "../../src/providers/factory.ts";
import {
  __setOsBackendForTests,
  clearSecretMemo,
  getSecretSyncCached,
} from "../../src/security/secrets.ts";
const TOKEN = "isolated-deterministic-owner-token";
const originalFetch = globalThis.fetch;
const envNames = [
  "XR_HOME",
  "XR_SECRET_BACKEND",
  "XR_NETWORK_PROBES",
  PRESETS.google.apiKeyEnv!,
] as const;
let saved: Array<string | undefined>,
  home: string,
  store: Store,
  handler: ReturnType<typeof makeHandler>;
let network: number;
beforeEach(() => {
  saved = envNames.map((n) => process.env[n]);
  home = mkdtempSync(join(tmpdir(), "xr-onboarding-policy-"));
  process.env.XR_HOME = home;
  process.env.XR_SECRET_BACKEND = "file";
  process.env.XR_NETWORK_PROBES = "on";
  delete process.env[PRESETS.google.apiKeyEnv!];
  __setOsBackendForTests(null);
  clearSecretMemo();
  invalidateProviderHealthCache();
  invalidateInternetCache();
  invalidateRuntimeCache();
  saveConfig(
    ConfigSchema.parse({
      defaults: { provider: "openai", model: "gpt-6-luna" },
    }),
  );
  store = new Store(join(home, "state.db"));
  handler = makeHandler(store, TOKEN);
  network = 0;
  globalThis.fetch = (async () => {
    network++;
    return Response.json({ models: [] });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  store.close();
  clearSecretMemo();
  __setOsBackendForTests(undefined);
  envNames.forEach((n, i) => {
    if (saved[i] === undefined) delete process.env[n];
    else process.env[n] = saved[i];
  });
  rmSync(home, { recursive: true, force: true });
});
async function call(path: string, body?: unknown) {
  return (await handler(
    new Request(`http://127.0.0.1:3141/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  ))!;
}
test("onboarding/capability/catalog inspection works offline, exposes unknown state and sends ZERO probes", async () => {
  const status = (await (await call("/onboarding/status")).json()) as any;
  expect(status.internetState).toBe("unknown");
  expect(status.local.healthState).toBe("unknown");
  expect(JSON.stringify(status)).not.toContain("apiKey");
  for (const path of [
    "/providers",
    "/providers/catalog",
    "/providers/capabilities?id=google",
  ])
    expect((await call(path)).status).toBe(200);
  expect(network).toBe(0);
});
test("key save is offline by default, vendor change chooses vendor model and audit never contains the key", async () => {
  const fakeKey = "test-only-not-a-real-provider-key";
  const res = await call("/onboarding/provider", {
    providerId: "google",
    apiKey: fakeKey,
  });
  expect(res.status).toBe(200);
  const result = (await res.json()) as any;
  expect(result.health).toBeNull();
  expect(result.model).toBe(PRESETS.google.defaultModel);
  expect(network).toBe(0);
  expect(loadConfig().config.defaults.provider).toBe("google");
  expect(loadConfig().config.defaults.model).not.toBe("gpt-6-luna");
  expect(readFileSync(join(home, ".env"), "utf8")).not.toContain(fakeKey);
  expect(JSON.stringify(store.recentAudit(100))).not.toContain(fakeKey);
  expect(store.verifyChain().valid).toBe(true);
});
test("only an explicit probe sends provider requests (mocked transport, not a live compatibility claim)", async () => {
  const res = await call("/onboarding/provider", {
    providerId: "google",
    apiKey: "test-only-fake-key",
    probe: true,
    setDefault: false,
  });
  expect(res.status).toBe(200);
  expect(network).toBeGreaterThan(0);
  expect(loadConfig().config.defaults.provider).toBe("openai");
});
test("failed audit intent prevents secret/config effects; no falsely completed save", async () => {
  const before = readFileSync(join(home, "config.json"), "utf8");
  // Store construction created its audit identity before this request.
  const beforeSecrets = existsSync(join(home, ".env"))
    ? createHash("sha256")
        .update(readFileSync(join(home, ".env")))
        .digest("hex")
    : null;
  const audit = spyOn(store, "audit").mockImplementation(() => {
    throw new Error("deterministic audit unavailable");
  });
  try {
    expect(
      (
        await call("/onboarding/provider", {
          providerId: "google",
          apiKey: "test-only-fake-key",
        })
      ).status,
    ).toBe(400);
    expect(
      existsSync(join(home, ".env"))
        ? createHash("sha256")
            .update(readFileSync(join(home, ".env")))
            .digest("hex")
        : null,
    ).toBe(beforeSecrets);
    expect(getSecretSyncCached(PRESETS.google.apiKeyEnv!)).toBeUndefined();
    expect(readFileSync(join(home, "config.json"), "utf8")).toBe(before);
    expect(network).toBe(0);
  } finally {
    audit.mockRestore();
  }
});
test("engine credential removal is acknowledged and never means vendor/environment/backup revocation", async () => {
  expect(
    (
      await call("/onboarding/provider", {
        providerId: "google",
        apiKey: "test-only-fake-key",
      })
    ).status,
  ).toBe(200);
  expect(getSecretSyncCached(PRESETS.google.apiKeyEnv!)).toBeDefined();
  const res = await call("/onboarding/provider/remove", {
    providerId: "google",
  });
  expect(res.status).toBe(200);
  expect(((await res.json()) as any).notice).toContain(
    "Revoke it at the provider",
  );
  expect(getSecretSyncCached(PRESETS.google.apiKeyEnv!)).toBeUndefined();
  expect(network).toBe(0);
});
test("budget inspection reports the actual $10 default, and a partial change cannot replace it with a fictional $0", async () => {
  const before = (await (await call("/budget")).json()) as any;
  expect(before.persisted.monthly_cap).toBe(10);
  expect(before.burn.monthlyCap).toBe(10);
  expect((await call("/budget/set", { perTaskUsd: 0.05 })).status).toBe(200);
  expect(store.getBudgetConfig()!.monthly_cap).toBe(10);
  expect((await call("/budget/set", { monthlyCap: -1 })).status).toBe(400);
  expect(store.getBudgetConfig()!.monthly_cap).toBe(10);
});
test("atomic tighten-only cannot raise a newer engine cap, null explicitly clears daily cap only on owner update", async () => {
  store.setBudgetConfig({ monthly_cap: 1, daily_cap: 0.1 });
  expect(
    (
      await call("/budget/set", {
        monthlyCap: 50,
        dailyCap: 5,
        perTaskUsd: 99,
        tightenOnly: true,
      })
    ).status,
  ).toBe(200);
  expect(store.getBudgetConfig()!.monthly_cap).toBe(1);
  expect(store.getBudgetConfig()!.daily_cap).toBe(0.1);
  expect(loadConfig().config.budget.perTaskUsd).not.toBe(99);
  expect((await call("/budget/set", { dailyCap: null })).status).toBe(200);
  expect(store.getBudgetConfig()!.daily_cap).toBeNull();
  expect(store.getBudgetConfig()!.monthly_cap).toBe(1);
  expect(
    (await call("/budget/set", { monthlyCap: 0, tightenOnly: true })).status,
  ).toBe(200);
  expect(store.getBudgetConfig()!.monthly_cap).toBe(0);
});
test("ordinary vendor switch also cannot borrow the previous vendor model", async () => {
  const res = await call("/providers/set", { provider: "google" });
  expect(res.status).toBe(200);
  expect(((await res.json()) as any).model).toBe(PRESETS.google.defaultModel);
  expect(network).toBe(0);
});
