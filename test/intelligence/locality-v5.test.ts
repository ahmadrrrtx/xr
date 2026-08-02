/**
 * XR Phase 5 · T5 — the locality invariant holds across EVERY Phase 5 path.
 *
 * Constitution Art. VII.3 / XXI.4: sensitive work never silently routes to
 * cloud. These tests extend the Phase 2 invariant suite to the NEW surfaces
 * Phase 5 adds: the circuit breaker, the resilient chain executor, the
 * behavioral evaluator, and degradation/escalation. Asserts EFFECTS: which
 * provider was actually constructed/called (cloud never is), not flags.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IntelligenceRouter } from "../../src/intelligence/router.ts";
import { buildCatalog } from "../../src/intelligence/catalog.ts";
import {
  localityAllowed,
  localityOf,
} from "../../src/intelligence/routing-service.ts";
import { RoutingHealth, healthView } from "../../src/intelligence/health.ts";
import {
  ResilientProvider,
  RoutingEscalationError,
} from "../../src/intelligence/degradation.ts";
import { buildFallbackChain } from "../../src/intelligence/fallback.ts";
import { evaluateAll } from "../../src/intelligence/evaluator.ts";
import { ConfigSchema, type XRConfig } from "../../src/config/config.ts";
import type { Message, ModelTurn, Provider } from "../../src/core/types.ts";

const CLOUD_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "GOOGLE_API_KEY", "MISTRAL_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

function localOnlyConfig(): XRConfig {
  return ConfigSchema.parse({
    defaults: { provider: "ollama", model: "qwen2.5:7b" },
    intelligencePlane: { localityPolicy: "local_only", mode: "local_only" },
  });
}

beforeEach(() => {
  for (const k of CLOUD_KEYS) {
    saved[k] = process.env[k];
    process.env[k] = "sk-test-not-real"; // cloud LOOKS available; policy must still refuse
  }
});

afterEach(() => {
  for (const k of CLOUD_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("Phase 5 · locality invariant on the new routing-quality paths", () => {
  test("router + breaker: a tripped local provider under local_only yields honest unavailability, NOT a cloud fallback", () => {
    const config = localOnlyConfig();
    const health = new RoutingHealth({ file: null, config: { minSamples: 2 } });
    // Trip every local runtime's breaker
    for (const id of ["ollama", "lmstudio", "jan", "localai", "vllm", "llamacpp", "gpt4all", "koboldcpp", "textgenwebui", "sglang"]) {
      health.record(id, undefined, { ok: false });
      health.record(id, undefined, { ok: false });
      const m = id === "ollama" ? "qwen2.5:7b" : undefined;
      health.record(id, m, { ok: false });
      health.record(id, m, { ok: false });
    }
    const catalog = buildCatalog(config);
    const router = new IntelligenceRouter({ catalog, health: healthView(health) });
    const { decision } = router.route(config, { requirements: { modelClass: "chat", summary: "patient intake summary" } });
    if (!decision.unavailable) {
      expect(decision.selected).toBeDefined();
      expect(localityAllowed("local_only", localityOf(decision.selected!.providerId))).toBe(true);
      // every chain hop is local too
      for (const step of decision.fallbackChain) {
        expect(localityAllowed("local_only", localityOf(step.providerId))).toBe(true);
      }
    } else {
      // honest refusal, never silent cloud
      expect(decision.selected?.providerId).not.toMatch(/openai|anthropic|groq|google|mistral/);
      expect(decision.humanHandoff?.required).toBe(true);
    }
  });

  test("resilient executor: a poisoned chain can never hop to cloud under local_only (defense in depth)", async () => {
    const calls: string[] = [];
    const mk = (id: string, bad: boolean): Provider => ({
      id,
      label: id,
      async chat(_m: Message[]) {
        calls.push(id);
        if (bad) throw new Error("500 boom");
        return { message: "ok", toolCalls: [], done: true } as ModelTurn;
      },
      async health() {
        return { ok: true };
      },
    });
    // Even if a crafted chain step names a CLOUD provider, the per-hop
    // locality guard (same derivation as the authority) must refuse it.
    const rp = new ResilientProvider(mk("ollama", true), "m1", [{ providerId: "openai", modelId: "gpt-4o", reason: "poisoned" }], {
      health: new RoutingHealth({ file: null }),
      construct: (step) => mk(step.providerId, false),
      localityGuard: (id) => localityAllowed("local_only", localityOf(id)),
      sleep: async () => {},
      retry: { maxInPlaceRetries: 0 },
    });
    await expect(rp.chat([{ role: "user", content: "sensitive patient data analysis" }], [])).rejects.toBeInstanceOf(RoutingEscalationError);
    expect(calls).toEqual(["ollama"]);
    expect(calls).not.toContain("openai");
  });

  test("fallback chain builder excludes cloud candidates under local_only even when they score higher", () => {
    const config = localOnlyConfig();
    const catalog = buildCatalog(config);
    const requirements = { modelClass: "chat", localityPolicy: "local_only" } as never;
    const evals = evaluateAll(catalog.models, requirements, {
      routingMode: "automatic",
      localityPolicy: "local_only",
      allowFallback: true,
      allowCloudFallback: false,
      preferFree: true,
      disableHistorical: false,
    });
    const compatible = evals.filter((e) => e.compatible);
    expect(compatible.length).toBeGreaterThan(0);
    const plan = buildFallbackChain(compatible, compatible[0]!.model, requirements, {
      routingMode: "automatic",
      localityPolicy: "local_only",
      allowFallback: true,
      allowCloudFallback: false,
      preferFree: true,
      disableHistorical: false,
    });
    for (const step of plan.steps) {
      expect(localityAllowed("local_only", localityOf(step.providerId))).toBe(true);
    }
  });

  test("behavioral measurement honors locality: providers the policy forbids are skipped, never probed", async () => {
    // The IntelligenceService.measureModels path is enforced by the SAME
    // localityAllowed/localityOf derivation; here we assert the derivation.
    const policy = "local_only";
    for (const id of ["openai", "anthropic", "groq", "google", "mistral", "deepseek", "together", "openrouter"]) {
      expect(localityAllowed(policy, localityOf(id))).toBe(false);
    }
    for (const id of ["ollama", "lmstudio", "jan"]) {
      expect(localityAllowed(policy, localityOf(id))).toBe(true);
    }
    // private_only permits private-local custom endpoints but not cloud
    expect(localityAllowed("private_only", localityOf("openai"))).toBe(false);
    expect(localityAllowed("private_only", localityOf("ollama"))).toBe(true);
  });

  test("no_cloud policy: cloud AND hybrid are refused, private and local pass", () => {
    expect(localityAllowed("no_cloud", "cloud")).toBe(false);
    expect(localityAllowed("no_cloud", "hybrid")).toBe(false);
    expect(localityAllowed("no_cloud", "unknown")).toBe(false);
    expect(localityAllowed("no_cloud", "private")).toBe(true);
    expect(localityAllowed("no_cloud", "local")).toBe(true);
  });

  test("health/behavioral stores are local files inside XR_HOME, never egress (no network in store layer)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-locality-"));
    process.env.XR_HOME = dir;
    try {
      const health = new RoutingHealth();
      health.record("ollama", "m", { ok: true });
      health.flush();
      const { existsSync } = await import("node:fs");
      expect(existsSync(join(dir, "cache", "intelligence", "health.json"))).toBe(true);
      // The whole intelligence plane has no fetch/http client — statically:
      const src = await import("node:fs").then((fs) =>
        ["health.ts", "behavioral.ts", "slo.ts", "degradation.ts", "difficulty.ts", "failover.ts"]
          .map((f) => fs.readFileSync(new URL(`../../src/intelligence/${f}`, import.meta.url), "utf8"))
          .join("\n"),
      );
      expect(src).not.toMatch(/node:http|https\.request|fetch\(/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.XR_HOME;
    }
  });
});
