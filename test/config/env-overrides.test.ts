/**
 * XR Config — envOverrides contract (Phase 4 · S-1 finding F3).
 *
 * Before this: bare `*_BASE_URL` env vars were honored NOWHERE on the task
 * path, so a user exporting OPENROUTER_BASE_URL for a local gateway silently
 * sent traffic to the preset endpoint. The fix is an explicit, schema-typed,
 * namespaced contract: `config.envOverrides["<dotted.path>"] = "ENV_VAR"`.
 *
 * These tests pin the whole contract: what applies, what is refused, and a
 * true end-to-end run-path check (buildProvider → chat hits the ENV URL).
 */
import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_HOME = mkdtempSync(join(tmpdir(), "xr-envovr-test-"));
process.env.XR_HOME = TEST_HOME;

const { applyEnvOverrides, ConfigSchema } = await import("../../src/config/config.ts");
const { invalidateConfigCache, stopWatcher } = await import("../../src/config/cache.ts");
const { buildProvider } = await import("../../src/providers/factory.ts");

const ENV_KEYS = [
  "XR_TEST_TARGET",
  "XR_TEST_BAD",
  "XR_TRUST_HARDENED",
  "OPENROUTER_BASE_URL",
];

function savedEnv(): Map<string, string | undefined> {
  return new Map(ENV_KEYS.map((k) => [k, process.env[k]]));
}
function restoreEnv(saved: Map<string, string | undefined>): void {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of ENV_KEYS) if (!saved.has(k)) delete process.env[k];
}

function baseConfig(overrides: Record<string, unknown> = {}) {
  return ConfigSchema.parse({
    providers: { openrouter: { baseUrl: "https://openrouter.ai/api/v1" } },
    envOverrides: { "providers.openrouter.baseUrl": "XR_TEST_TARGET" },
    ...overrides,
  });
}

describe("envOverrides contract — apply/refuse semantics", () => {
  let saved: Map<string, string | undefined>;
  beforeEach(() => {
    saved = savedEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    invalidateConfigCache();
  });

  test("mapping applies: string leaf overridden, application reported", () => {
    process.env.XR_TEST_TARGET = "http://127.0.0.1:9999/v1";
    const { config, warnings } = applyEnvOverrides(baseConfig());
    const providers = config.providers as Record<string, { baseUrl: string }>;
    expect(providers.openrouter.baseUrl).toBe("http://127.0.0.1:9999/v1");
    expect(warnings.some((w) => w.includes("providers.openrouter.baseUrl ← XR_TEST_TARGET"))).toBe(true);
    restoreEnv(saved);
  });

  test("locked: envOverridesLocked ignores the whole map (with warning)", () => {
    process.env.XR_TEST_TARGET = "http://127.0.0.1:9999/v1";
    const { config, warnings } = applyEnvOverrides(baseConfig({ envOverridesLocked: true }));
    const providers = config.providers as Record<string, { baseUrl: string }>;
    expect(providers.openrouter.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(warnings.some((w) => w.includes("envOverridesLocked"))).toBe(true);
    restoreEnv(saved);
  });

  test("non-UPPER_SNAKE env var names are refused", () => {
    process.env.XR_TEST_TARGET = "http://127.0.0.1:9999/v1";
    const { config, warnings } = applyEnvOverrides(
      baseConfig({ envOverrides: { "providers.openrouter.baseUrl": "xr_lower_case" } }),
    );
    const providers = config.providers as Record<string, { baseUrl: string }>;
    expect(providers.openrouter.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(warnings.some((w) => w.includes("not an UPPER_SNAKE"))).toBe(true);
    restoreEnv(saved);
  });

  test("unknown config root is refused", () => {
    process.env.XR_TEST_TARGET = "http://127.0.0.1:9999/v1";
    const { warnings } = applyEnvOverrides(baseConfig({ envOverrides: { "definitelyNotARoot.x": "XR_TEST_TARGET" } }));
    expect(warnings.some((w) => w.includes("unknown config root"))).toBe(true);
    restoreEnv(saved);
  });

  test("non-string leaf is refused (numbers/booleans stay file-owned)", () => {
    process.env.XR_TEST_TARGET = "9001";
    const { config, warnings } = applyEnvOverrides(baseConfig({ envOverrides: { "budget.perTaskUsd": "XR_TEST_TARGET" } }));
    expect(config.budget.perTaskUsd).toBe(0.25);
    expect(warnings.some((w) => w.includes("no writable string leaf"))).toBe(true);
    restoreEnv(saved);
  });

  test("prototype-pollution segments are refused", () => {
    process.env.XR_TEST_TARGET = "http://127.0.0.1:9999/v1";
    for (const seg of ["__proto__", "prototype", "constructor"]) {
      const { warnings } = applyEnvOverrides(baseConfig({ envOverrides: { [`providers.${seg}.baseUrl`]: "XR_TEST_TARGET" } }));
      expect(warnings.some((w) => w.includes("no writable string leaf"))).toBe(true);
    }
    expect(({} as Record<string, unknown>).baseUrl).toBeUndefined();
    restoreEnv(saved);
  });

  test("value failing schema validation is refused (fail-closed to file value)", () => {
    process.env.XR_TEST_TARGET = "not-a-url-at-all";
    const { config, warnings } = applyEnvOverrides(baseConfig());
    const providers = config.providers as Record<string, { baseUrl: string }>;
    expect(providers.openrouter.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(warnings.some((w) => w.includes("failed schema validation"))).toBe(true);
    restoreEnv(saved);
  });

  test("unset env var is a silent no-op", () => {
    const { config, warnings } = applyEnvOverrides(baseConfig());
    const providers = config.providers as Record<string, { baseUrl: string }>;
    expect(providers.openrouter.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(warnings).toHaveLength(0);
    restoreEnv(saved);
  });

  test("XR_TRUST_HARDENED still applies and composes with the map", () => {
    process.env.XR_TRUST_HARDENED = "0";
    process.env.XR_TEST_TARGET = "http://127.0.0.1:9999/v1";
    const { config, warnings } = applyEnvOverrides(baseConfig());
    expect(config.security.hardened).toBe(false);
    const providers = config.providers as Record<string, { baseUrl: string }>;
    expect(providers.openrouter.baseUrl).toBe("http://127.0.0.1:9999/v1");
    expect(warnings.length).toBe(2);
    restoreEnv(saved);
  });
});

describe("envOverrides — end-to-end run path (F3 regression)", () => {
  let saved: Map<string, string | undefined>;
  beforeEach(() => {
    saved = savedEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    invalidateConfigCache();
  });

  test("xr run path honors the ENCODED mapping: traffic goes to the env URL", async () => {
    // Note: this deliberately builds config in-memory rather than via loadConfig()
    // — config.ts binds XR_HOME at module import, which the shared-suite module
    // instance may have initialized with a different test file's home. The run
    // path being pinned here is: parsed config → applyEnvOverrides → factory →
    // adapter → HTTP. Disk reading of the map is plain JSON (covered above).
    const hits: string[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        hits.push(`${req.method} ${new URL(req.url).pathname}`);
        if (req.method === "GET") return Response.json({ object: "list", data: [] });
        return Response.json({
          id: "stub",
          object: "chat.completion",
          created: 0,
          model: "stub-model",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({ message: "env override honored on the run path", tool_calls: [], done: true }),
            },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    });
    try {
      process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${server.port}/v1`;
      const mapped = ConfigSchema.parse({
        providers: { openrouter: { baseUrl: "https://openrouter.ai/api/v1" } },
        envOverrides: { "providers.openrouter.baseUrl": "OPENROUTER_BASE_URL" },
      });
      const { config, warnings } = applyEnvOverrides(mapped);
      expect(warnings.some((w) => w.includes("providers.openrouter.baseUrl ← OPENROUTER_BASE_URL"))).toBe(true);

      const provider = buildProvider(config, { provider: "openrouter", model: "stub-model" });
      const turn = await provider.chat([{ role: "user", content: "probe" }], []);
      expect(turn.message).toContain("env override honored on the run path");
      expect(hits.some((h) => h.startsWith("POST /v1/chat/completions"))).toBe(true);
    } finally {
      server.stop(true);
      restoreEnv(saved);
    }
  });
});

afterAll(() => {
  stopWatcher();
  rmSync(TEST_HOME, { recursive: true, force: true });
});
