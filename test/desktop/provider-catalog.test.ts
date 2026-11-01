/**
 * Provider catalog derivation (2026-11-01) — the desktop "Add a provider"
 * grid must come from the ENGINE's provider list, not a hardcoded subset.
 *
 * buildProviderCatalog() is pure: these tests pin the merge, grouping and
 * the degraded fallback without a DOM (icons are value imports; React is
 * only needed if a component renders).
 */
import { describe, expect, test } from "bun:test";

import {
  buildProviderCatalog,
  CUSTOM_ENDPOINT_ENTRY,
} from "../../desktop/src/engine/providerCatalog.ts";
import type { EngineProvider } from "../../desktop/src/engine/types.ts";

function ep(id: string, over: Partial<EngineProvider> = {}): EngineProvider {
  return {
    id,
    label: id.toUpperCase(),
    kind: "hosted",
    hasKey: false,
    healthy: false,
    ...over,
  } as EngineProvider;
}

describe("buildProviderCatalog", () => {
  test("derives every engine provider — hosted, local and custom — plus the custom endpoint", () => {
    const input: EngineProvider[] = [
      ep("openai", { description: "engine description ignored for openai", baseUrl: "https://api.openai.com/v1", docsUrl: "https://openai.com" }),
      ep("groq"),
      ep("lmstudio", { kind: "local", keyless: true, baseUrl: "http://localhost:1234/v1" }),
      ep("ollama", { kind: "local", keyless: true }),
      ep("my-gateway", { kind: "custom", baseUrl: "https://gw.internal/v1" }),
    ];
    const { entries, degraded, counts } = buildProviderCatalog(input);
    expect(degraded).toBe(false);
    // 5 engine entries + the desktop custom endpoint.
    expect(entries.length).toBe(6);
    expect(counts).toEqual({ hosted: 3, local: 2 });
    // Engine metadata flows through; curated taglines/keysUrls win where
    // they exist, engine description/docsUrl fill the rest.
    const openai = entries.find((e) => e.id === "openai")!;
    expect(openai.tagline).toBe("Current GPT models and manual legacy choices."); // curated
    expect(openai.baseUrl).toBe("https://api.openai.com/v1"); // from the engine
    expect(openai.keysUrl).toBe("https://platform.openai.com/api-keys"); // curated override
    const lm = entries.find((e) => e.id === "lmstudio")!;
    expect(lm.keyless).toBe(true);
    expect(lm.engineKind).toBe("local");
    const gw = entries.find((e) => e.id === "my-gateway")!;
    expect(gw.tagline).toBe(""); // no description, no curated line — honest empty
    // The custom endpoint is always last.
    expect(entries[entries.length - 1].id).toBe("custom");
    expect(entries[entries.length - 1].kind).toBe("custom");
  });

  test("groups local runtimes after hosted and maps desktop modal kinds", () => {
    const { entries } = buildProviderCatalog([
      ep("anthropic"),
      ep("ollama", { kind: "local", keyless: true }),
      ep("google"),
      ep("bedrock"),
    ]);
    const ids = entries.map((e) => e.id);
    // hosted (alphabetical) then local then custom endpoint.
    expect(ids).toEqual(["anthropic", "bedrock", "google", "ollama", "custom"]);
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(byId.get("anthropic")!.kind).toBe("anthropic");
    expect(byId.get("google")!.kind).toBe("gemini");
    expect(byId.get("ollama")!.kind).toBe("ollama");
    expect(byId.get("bedrock")!.kind).toBe("openai-compatible");
  });

  test("engine docsUrl is the keysUrl when no curated override exists", () => {
    const { entries } = buildProviderCatalog([
      ep("vllm", { kind: "local", keyless: true, docsUrl: "https://docs.vllm.ai" }),
    ]);
    expect(entries.find((e) => e.id === "vllm")!.keysUrl).toBe("https://docs.vllm.ai");
  });

  test("degraded fallback when the engine is unreachable or lists nothing", () => {
    const { entries, degraded, counts } = buildProviderCatalog(null);
    expect(degraded).toBe(true);
    expect(counts.local).toBe(0);
    expect(entries[entries.length - 1].id).toBe("custom");
    // The fallback still offers the majors the previous UI shipped.
    for (const id of ["openai", "anthropic", "google", "groq", "openrouter"]) {
      expect(entries.some((e) => e.id === id)).toBe(true);
    }
    const empty = buildProviderCatalog([]);
    expect(empty.degraded).toBe(true);
  });

  test("every catalog entry carries an icon component", () => {
    const { entries } = buildProviderCatalog([ep("openai"), ep("koboldcpp", { kind: "local" }), ep("totally-unknown")]);
    for (const e of entries) {
      expect(typeof e.icon).toBe("object");
      expect(e.icon).toBeTruthy();
      expect((e.icon as unknown as { displayName?: string }).displayName).toBeTruthy();
    }
  });

  test("the custom endpoint entry is immutable shared state", () => {
    expect(CUSTOM_ENDPOINT_ENTRY.id).toBe("custom");
    expect(CUSTOM_ENDPOINT_ENTRY.keyless).toBeUndefined();
  });
});
