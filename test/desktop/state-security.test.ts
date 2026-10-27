import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { desktopEngineHome } from "../../desktop/scripts/engine-home";
import {
  assertSafeSetting,
  durableModelSelection,
} from "../../desktop/src/lib/persistent-safety";
import { prepareModelSetup } from "../../desktop/src/engine/setup";

test("desktop home ignores inherited CLI XR_HOME and resolves without copying/touching CLI data", () => {
  const root = mkdtempSync(join(tmpdir(), "xr-desktop-home-"));
  try {
    const cli = join(root, "cli-config");
    writeFileSync(cli, "untouched CLI bytes");
    const env = { XR_HOME: cli };
    expect(desktopEngineHome(env, root)).toBe(join(root, ".xr-desktop"));
    expect(readFileSync(cli, "utf8")).toBe("untouched CLI bytes");
    expect(env.XR_HOME).toBe(cli);
    expect(
      desktopEngineHome(
        { ...env, XR_DESKTOP_HOME: join(root, "desktop") },
        root,
      ),
    ).toBe(join(root, "desktop"));
    expect(() =>
      desktopEngineHome({ XR_DESKTOP_HOME: "relative" }, root),
    ).toThrow(/absolute/);
    const rust = readFileSync(
      new URL("../../desktop/src-tauri/src/engine.rs", import.meta.url),
      "utf8",
    );
    expect(rust).toContain("Command::new(&bin)");
    expect(rust).toContain('cmd.env("XR_HOME", &home)');
    expect(rust).toContain("crate::desktop_home::resolve()");
    expect(rust).toContain('cmd.env("XR_SECRET_NAMESPACE", "desktop")');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generic settings reject raw and nested credential paths, without echoing their values", () => {
  for (const [key, value] of [
    [
      "xr.generic",
      JSON.stringify({ nested: { apiKey: "fixture-private-key" } }),
    ],
    ["xr.providerKeys", { openai: "fixture-private-key" }],
    ["xr.model.default", { source: "cloud", apiKey: "fixture-private-key" }],
    ["xr.preferences", { nested: [{ access_token: "fixture-private-key" }] }],
  ] as const) {
    try {
      assertSafeSetting(key, value);
      throw new Error("expected refusal");
    } catch (error) {
      expect((error as Error).message).toContain("engine secret broker");
      expect((error as Error).message).not.toContain("fixture-private-key");
    }
  }
  expect(() =>
    assertSafeSetting("xr.budget", {
      maxTokens: 5000,
      defaultModel: "openai/gpt-6-luna",
    }),
  ).not.toThrow();
});

test("legacy onboarding migrates to only a model string, never a credential or an invented target", () => {
  expect(
    durableModelSelection({
      source: "cloud",
      providerId: "openai",
      model: "gpt-6-luna",
      apiKey: "fixture-private-key",
    }),
  ).toBe("openai/gpt-6-luna");
  expect(
    durableModelSelection({ source: "cloud", apiKey: "fixture-private-key" }),
  ).toBeNull();
  expect(
    durableModelSelection({
      source: "local",
      model: "qwen2.5:3b",
      label: "Qwen",
    }),
  ).toBe("ollama/qwen2.5:3b");
  expect(durableModelSelection("owner/custom-model")).toBe(
    "owner/custom-model",
  );
});

test("onboarding sends a key once, only to the chosen engine secret broker; persistence output has no key", async () => {
  const requests: unknown[] = [];
  const prepared = await prepareModelSetup(
    { source: "cloud", providerId: "anthropic", apiKey: "fixture-private-key" },
    {
      async saveSecret(input) {
        requests.push(input);
        return { ok: true, model: "claude-sonnet-5-5" };
      },
      async setDefault() {
        throw new Error("must not change another provider");
      },
    },
  );
  expect(requests).toEqual([
    {
      providerId: "anthropic",
      apiKey: "fixture-private-key",
      model: undefined,
      setDefault: true,
      probe: false,
    },
  ]);
  expect(prepared.selection).toBe("anthropic/claude-sonnet-5-5");
  expect(JSON.stringify(prepared)).not.toContain("fixture-private-key");
  expect(JSON.stringify(prepared)).not.toContain("apiKey");
  assertSafeSetting("xr.model.default", prepared.selection);
});

test("a failed/ambiguous key save has no completion result or plaintext fallback", async () => {
  let calls = 0;
  const ports = {
    async saveSecret() {
      calls++;
      throw new Error("engine unavailable");
    },
    async setDefault() {},
  };
  await expect(
    prepareModelSetup(
      { source: "cloud", providerId: "google", apiKey: "fixture-private-key" },
      ports,
    ),
  ).rejects.toThrow("engine unavailable");
  await expect(
    prepareModelSetup(
      { source: "cloud", apiKey: "fixture-private-key" },
      ports,
    ),
  ).rejects.toThrow("Choose the provider");
  expect(calls).toBe(1);
});

test("actual browser settings migration removes legacy plaintext copies and future writes cannot restore them", async () => {
  const original = globalThis.window;
  const values = new Map<string, string>([
    ["xr.providerKeys", JSON.stringify({ openai: "fixture-private-key" })],
    [
      "xr.model.default",
      JSON.stringify({
        source: "cloud",
        providerId: "google",
        model: "gemini-3.8-flash",
        apiKey: "fixture-private-key",
      }),
    ],
  ]);
  globalThis.window = {
    localStorage: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    },
  } as unknown as Window & typeof globalThis;
  try {
    const {
      purgeLegacyCredentialSettings,
      writeSettingJSON,
      writeSettingRaw,
      readSettingJSON,
    } = await import("../../desktop/src/lib/persistent-store");
    expect(await purgeLegacyCredentialSettings()).toBe(true);
    expect(await readSettingJSON("xr.model.default")).toBe(
      "google/gemini-3.8-flash",
    );
    expect(() =>
      writeSettingJSON("xr.providerKeys", { openai: "fixture-private-key" }),
    ).toThrow();
    expect(() => writeSettingRaw("xr.apiKey", "fixture-private-key")).toThrow();
    expect(JSON.stringify([...values])).not.toContain("fixture-private-key");
  } finally {
    globalThis.window = original;
  }
});
