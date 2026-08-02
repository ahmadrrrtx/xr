/**
 * XR Phase 8 · T2 — instrumentation wired into the REAL subsystems:
 * routing (intelligence service), isolation placement (environment
 * manager), and trace-correlated structured logs. Effects asserted against
 * recorded spans/metrics/logs, not internals.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { IntelligenceService } from "../../src/intelligence/service.ts";
import { ServiceRegistry } from "../../src/core/service-registry.ts";
import { Tokens } from "../../src/core/tokens.ts";
import { ConfigSchema } from "../../src/config/config.ts";
import type { ConfigService } from "../../src/services/config-service.ts";
import type { XRConfig } from "../../src/config/config.ts";
import { RoutingHealth } from "../../src/intelligence/health.ts";
import { BehavioralStore } from "../../src/intelligence/behavioral.ts";
import { RoutingSlo } from "../../src/intelligence/slo.ts";
import { EnvironmentManager } from "../../src/runtime/trust/environment/manager.ts";
import { CredentialBroker } from "../../src/runtime/trust/credentials.ts";
import {
  resetObservability,
  setTelemetryConfig,
  defaultTelemetryConfig,
  resetTracerState,
  resetMetrics,
  onSpanRecorded,
  setLogWriter,
  structuredLog,
  startSpan,
  withSpan,
  xrMetrics,
  GENAI,
  XR_ATTR,
  type SpanData,
  type LogRecord,
} from "../../src/observability/index.ts";

beforeEach(async () => {
  await resetObservability();
  setTelemetryConfig(defaultTelemetryConfig());
  resetTracerState();
  resetMetrics();
  setLogWriter(() => {});
});

afterEach(async () => {
  await resetObservability();
});

function baseConfig(): XRConfig {
  return ConfigSchema.parse({
    defaults: { provider: "ollama", model: "qwen2.5:7b" },
    providerEngine: { routingStrategy: "hybrid" },
    intelligencePlane: {
      retry: { maxInPlaceRetries: 1, baseDelayMs: 0, maxDelayMs: 1, totalBudgetMs: 200, jitterRatio: 0 },
    },
  });
}

test("routing decision produces a span + bounded metric (reason/provider, never the task)", async () => {
  const recorded: SpanData[] = [];
  onSpanRecorded((s) => recorded.push(s));

  const registry = new ServiceRegistry();
  registry.registerValue(Tokens.Config, { get: () => baseConfig() } as unknown as ConfigService);
  const service = new IntelligenceService(registry, {}, {
    health: new RoutingHealth({ file: null }),
    behavioral: new BehavioralStore({ file: null }),
    slo: new RoutingSlo({ file: null }),
  });

  const result = service.route({
    requirements: { modelClass: "chat", summary: "parent task text that must NOT be traced", pin: { providerId: "ollama", modelId: "qwen2.5:7b" } },
  });
  expect(result.decision.selected?.providerId).toBe("ollama");

  const span = recorded.find((s) => s.name === "xr.routing.select");
  expect(span).toBeDefined();
  expect(span!.attributes[GENAI.PROVIDER_NAME]).toBe("ollama");
  expect(span!.attributes[GENAI.REQUEST_MODEL]).toBe("qwen2.5:7b");
  expect(span!.attributes[XR_ATTR.ROUTING_REASON]).toBeDefined();
  expect(JSON.stringify(span!)).not.toContain("parent task text that must NOT be traced");

  const metricText = xrMetrics.routingDecisions;
  void metricText;
  // Routing latency histogram observed one sample.
  const latency = (xrMetrics.routingLatency as unknown as { snapshot: () => Array<{ count: number }> }).snapshot();
  expect(latency[0]?.count).toBeGreaterThanOrEqual(1);
});

test("isolation placement produces blocked/ran span + metric outcome", async () => {
  const recorded: SpanData[] = [];
  onSpanRecorded((s) => recorded.push(s));

  // No backends registered: an admitted high-risk placement must BLOCK
  // (fail-closed), and the observability must record exactly that outcome.
  const manager = new EnvironmentManager([], new CredentialBroker());
  const out = await manager.executeInEnvironment({
    decision: {
      kind: "admitted",
      requestedTier: "tier2_isolated",
      placement: "container",
      reason: "test decision",
      decidedAt: Date.now(),
      policyVersion: "test",
    },
    exec: { argv: ["/bin/true"], cwd: "/tmp", env: {}, timeoutMs: 1000, maxOutputBytes: 1024 },
    grant: {
      grantId: "g1",
      actor: "test",
      executionId: "r1",
      correlationId: "r1",
      workspaceId: "w1",
      capability: "core_tool:shell",
      tier: "tier2_isolated",
      fs: { writableRoots: [], readOnlyRoots: [], blockedPaths: [], ephemeralScratch: true },
      net: { mode: "none", allowlist: [], blockPrivateNetworks: true, blockOffAllowlistRedirects: true },
      proc: { allowedExecutables: ["/bin/true"], allowSpawn: false, maxProcesses: 1, stripAmbientEnv: true },
      resources: { wallClockMs: 1000, maxOutputBytes: 1024 },
      credentials: { mode: "none", refs: [], envNames: [] },
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      policyVersion: "test",
      revoked: false,
    },
  });
  expect("blocked" in out && out.blocked).toBe(true);

  const span = recorded.find((s) => s.name === "xr.isolation.place");
  expect(span).toBeDefined();
  expect(span!.attributes[XR_ATTR.PLACEMENT_TIER]).toBe("container");
  expect(span!.attributes[XR_ATTR.PLACEMENT_BLOCKED]).toBe(true);
  expect(span!.status).toBe("error");

  const placements = (xrMetrics.placements as unknown as { snapshot: () => Array<{ labels: Record<string, string>; value: number }> }).snapshot();
  expect(placements.some((s) => s.labels.outcome === "blocked" && s.labels.backend === "none")).toBe(true);
});

test("structured logs carry trace_id/span_id inside a span — and omit them outside", () => {
  const records: LogRecord[] = [];
  setLogWriter((_, r) => records.push(r));

  const outside = structuredLog("info", "outside.span", { info: "x" });
  expect(outside).not.toBeNull();
  expect(outside!.trace_id).toBeUndefined();

  const span = startSpan("corr");
  withSpan(span, () => {
    const inside = structuredLog("info", "inside.span", { info: "y" });
    expect(inside!.trace_id).toBe(span.traceId);
    expect(inside!.span_id).toBe(span.spanId);
    const childLog = structuredLog("warn", "nested", {});
    expect(childLog!.trace_id).toBe(span.traceId);
  });
  span.end();

  expect(records.length).toBe(3);
  expect(records[1].trace_id).toBe(records[2].trace_id);
});
