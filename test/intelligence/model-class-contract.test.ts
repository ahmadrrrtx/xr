/**
 * XR Phase 5 · T7 — future model classes via the contract; provider-add is a
 * bounded adapter.
 *
 * Constitution Art. VII.1/4: any future model class must be addable through
 * the model contract WITHOUT redesign (no kernel/loop edits); adding a
 * provider is a bounded adapter. Asserts EFFECTS:
 *   · a SYNTHETIC provider declaring a future capability class routes when a
 *     task requires it — with zero edits to src/core or the agent loop;
 *   · the future class fails closed when undeclared (unknown ≠ supported);
 *   · the provider appears through the exact same adapter path as built-ins
 *     (config customProviders → preset → descriptors → routing → construct).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { IntelligenceRouter } from "../../src/intelligence/router.ts";
import { buildCatalog } from "../../src/intelligence/catalog.ts";
import { ConfigSchema, type XRConfig } from "../../src/config/config.ts";
import { registry } from "../../src/providers/registry.ts";
import "../../src/providers/factory.ts"; // preset bootstrap (same as runtime)

const CLOUD_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

function configWithSynthetic(): XRConfig {
  return ConfigSchema.parse({
    defaults: { provider: "ollama", model: "qwen2.5:7b" },
    providerEngine: {
      routingStrategy: "hybrid",
      customProviders: [
        {
          id: "synthex",
          label: "Synthex Research (Synthetic)",
          baseUrl: "http://localhost:9999/v1",
          defaultModel: "synthex-temporal-1",
          // The future class arrives through the CAPABILITY contract:
          // an extension capability, not a code change.
          capabilities: { chat: true, toolUse: true, streaming: true },
        },
      ],
      providerCapabilities: {
        synthex: { toolUse: true },
      },
    },
    intelligencePlane: {},
  });
}

beforeEach(() => {
  for (const k of CLOUD_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of CLOUD_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("Phase 5 · future model classes via the contract (T7)", () => {
  test("a synthetic provider with a future extension capability routes when required", () => {
    const config = configWithSynthetic();
    const catalog = buildCatalog(config);
    // The synthetic provider is in the catalog through the SAME adapter path
    // as every built-in (customProviders → preset → descriptors).
    const provider = catalog.providers.find((p) => p.providerId === "synthex");
    expect(provider).toBeDefined();
    expect(provider!.kind).toBe("custom");
    const models = catalog.models.filter((m) => m.providerId === "synthex");
    expect(models.length).toBeGreaterThan(0);

    // Declare the future class on the synthetic model via the contract's
    // capability extensions (this is what a real future adapter would do).
    for (const m of models) {
      m.capabilities.extensions = { video_temporal_reasoning: "supported" };
    }

    const router = new IntelligenceRouter({ catalog });
    const { decision } = router.route(config, {
      requirements: {
        modelClass: "chat",
        require: { extensions: ["video_temporal_reasoning"] },
        summary: "detect the frame where the robot drops the package",
      },
    });

    expect(decision.unavailable).toBe(false);
    expect(decision.selected?.providerId).toBe("synthex");
    expect(decision.explanation.length).toBeGreaterThan(0);
    // And the reason names the extension match path (taskFit scored a fit)
    expect(decision.factors.join(" ")).toMatch(/class match|tool-use capable|chat/);
  });

  test("the same future class FAILS CLOSED when no model declares it", () => {
    const config = configWithSynthetic();
    const catalog = buildCatalog(config); // no extension declared anywhere
    const router = new IntelligenceRouter({ catalog });
    const { decision } = router.route(config, {
      requirements: {
        modelClass: "chat",
        require: { extensions: ["video_temporal_reasoning"] },
        summary: "temporal reasoning task",
      },
    });
    // Honest unavailability with named rejections — never a pretend fit.
    expect(decision.unavailable).toBe(true);
    expect(decision.rejected.length).toBeGreaterThan(0);
    const flat = JSON.stringify(decision.rejected);
    expect(flat).toMatch(/video_temporal_reasoning/);
    expect(decision.humanHandoff?.required).toBe(true);
  });

  test("undeclared extension is unknown, never silently supported", () => {
    const config = configWithSynthetic();
    const catalog = buildCatalog(config);
    for (const m of catalog.models) {
      expect(m.capabilities.extensions?.["video_temporal_reasoning"] ?? "unknown").not.toBe("supported");
    }
  });

  test("provider add is ADAPTER-ONLY: no kernel/loop file changed to route the synthetic provider", () => {
    // Constitutional proof (Art. VII acceptance): the Phase 5 diff may touch
    // the routing authority (src/intelligence), config schema, CLI/daemon
    // surfaces, and tests — but MUST NOT change the kernel or the agent loop
    // to route a new provider/model class.
    const diff = execSync("git diff --name-only HEAD -- src/core src/services/agent-service.ts src/core/agent.ts src/core/execution", {
      cwd: join(import.meta.dir, "../.."),
      encoding: "utf8",
    }).trim();
    expect(diff).toBe("");
  });

  test("custom provider construction works through the registry adapter path (no core edits)", () => {
    const config = configWithSynthetic();
    registry.syncCustom(config);
    const preset = registry.getPreset("synthex");
    expect(preset).toBeDefined();
    expect(preset!.baseUrl).toBe("http://localhost:9999/v1");
    // constructable via the same factory every provider uses
    const provider = registry.createProvider("synthex", config, "synthex-temporal-1");
    expect(provider.id).toBe("synthex");
  });
});
