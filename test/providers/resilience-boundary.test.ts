/** RC-204/206: deterministic adverse composition, not live API validation. */
import { expect, test } from "bun:test";
import {
  ResilientProvider,
  classifyError,
  type FailoverRecord,
  type ResilientDeps,
} from "../../src/intelligence/degradation.ts";
import { RoutingHealth } from "../../src/intelligence/health.ts";
import { ProviderAbortError } from "../../src/providers/request-guard.ts";
import { ProviderError } from "../../src/providers/errors.ts";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import { PRESETS } from "../../src/providers/presets.ts";
import { ConfigSchema } from "../../src/config/config.ts";
import { CostGovernor } from "../../src/cost/governor.ts";
import {
  attemptControls,
  ProviderBudgetAdmissionError,
} from "../../src/core/model-accounting.ts";
import type {
  ChatOptions,
  ModelTurn,
  Provider,
  ProviderStreamChunk,
} from "../../src/core/types.ts";

const ok = (): ModelTurn => ({
  message: "completed",
  toolCalls: [],
  done: true,
});
function target(
  id = "primary",
  run: () => ModelTurn | Promise<ModelTurn> = ok,
): Provider {
  return {
    id,
    modelId: "m",
    label: id,
    async chat() {
      return run();
    },
    async health() {
      return { ok: true };
    },
  };
}
function health(): RoutingHealth {
  return new RoutingHealth({ file: null });
}
function probeHealth(id = "primary"): RoutingHealth {
  let now = 1_000;
  const h = new RoutingHealth({
    file: null,
    now: () => now,
    random: () => 0.5,
    config: { minSamples: 1, cooldownMs: 10, jitterRatio: 0 },
  });
  h.record(id, "m", { ok: false, latencyMs: 1, qualityOk: true });
  now += 20;
  expect(h.gate(id, "m").state).toBe("half_open");
  return h;
}
function deps(
  h: RoutingHealth,
  extra: Partial<ResilientDeps> = {},
): ResilientDeps {
  return {
    health: h,
    construct: (step) => target(step.providerId),
    localityGuard: () => true,
    canFallback: () => true,
    retry: { maxInPlaceRetries: 0 },
    warn() {},
    ...extra,
  };
}
const admitted: ChatOptions = { beforeAttempt() {} };
async function consume(
  p: Provider,
  options: ChatOptions = admitted,
): Promise<ProviderStreamChunk[]> {
  const chunks: ProviderStreamChunk[] = [];
  for await (const chunk of p.chatStream!([], [], options)) chunks.push(chunk);
  return chunks;
}
function streaming(
  p: Provider,
  stream: () => AsyncGenerator<ProviderStreamChunk>,
): Provider {
  return {
    ...p,
    capabilities: {
      streaming: true,
      toolUse: false,
      functionCalling: false,
      jsonMode: false,
    },
    chatStream: stream,
  };
}

for (const mode of ["chat", "stream"] as const) {
  test(`${mode}: half-open budget refusal releases the probe without a request or fabricated outcome`, async () => {
    const h = probeHealth();
    let requests = 0;
    const p = new ResilientProvider(
      target("primary", () => {
        requests++;
        return ok();
      }),
      "m",
      [],
      deps(h),
    );
    const options = {
      beforeAttempt() {
        throw new ProviderBudgetAdmissionError("synthetic budget refusal");
      },
    };
    await expect(
      mode === "chat" ? p.chat([], [], options) : consume(p, options),
    ).rejects.toBeInstanceOf(ProviderBudgetAdmissionError);
    expect(requests).toBe(0);
    expect(h.gate("primary", "m").samples).toBe(1);
    expect(h.permit("primary", "m")).toBe("probe");
    h.cancelProbe("primary", "m");
  });

  test(`${mode}: an unknown admission error mentioning 503 is terminal, with no request or fallback`, async () => {
    const h = probeHealth();
    let requests = 0;
    const p = new ResilientProvider(
      target("primary", () => {
        requests++;
        return ok();
      }),
      "m",
      [{ providerId: "backup", modelId: "m", reason: "fixture" }],
      deps(h, {
        construct: () => {
          requests++;
          return target("backup");
        },
        retry: { maxInPlaceRetries: 5 },
      }),
    );
    const options = {
      beforeAttempt() {
        throw new Error("audit database unavailable HTTP 503");
      },
    };
    await expect(
      mode === "chat" ? p.chat([], [], options) : consume(p, options),
    ).rejects.toMatchObject({ name: "ProviderAccountingError" });
    expect(requests).toBe(0);
    expect(h.gate("primary", "m").samples).toBe(1);
    expect(h.permit("primary", "m")).toBe("probe");
    h.cancelProbe("primary", "m");
  });

  test(`${mode}: fallback identity mismatch releases its half-open lease before any wrong-target request`, async () => {
    const h = probeHealth("backup");
    let wrongRequests = 0;
    const primary = target("primary", () => {
      throw new Error("HTTP 503");
    });
    const wrong = target("backup", () => {
      wrongRequests++;
      return ok();
    });
    // Both modern and legacy transport identities must agree independently.
    Object.assign(wrong, { model: "wrong-transport-model" });
    const p = new ResilientProvider(
      primary,
      "m",
      [{ providerId: "backup", modelId: "m", reason: "fixture" }],
      deps(h, { construct: () => wrong }),
    );
    await expect(
      mode === "chat" ? p.chat([], [], admitted) : consume(p),
    ).rejects.toThrow(/identity mismatch/);
    expect(wrongRequests).toBe(0);
    expect(h.gate("backup", "m").samples).toBe(1);
    expect(h.permit("backup", "m")).toBe("probe");
    h.cancelProbe("backup", "m");
  });
}

test("pre-admission caller abort is typed, free of requests/costs, and releases the probe", async () => {
  const h = probeHealth();
  let requests = 0,
    settlements = 0;
  const primary = target("primary", () => {
    requests++;
    return ok();
  });
  const abort = new AbortController();
  abort.abort();
  const rates = {
    inPerMTok: 1,
    outPerMTok: 2,
    source: "explicit deterministic fixture",
  };
  const governor = new CostGovernor({ maxUsd: 1 }, rates);
  const controls = attemptControls({
    provider: primary,
    pricingTarget: { id: "primary", model: "m" },
    pricing: rates,
    governor,
    sessionId: "unit",
    step: 0,
    messages: [],
    tools: [],
    signal: abort.signal,
    audit() {},
    recordCost() {
      settlements++;
    },
  });
  const p = new ResilientProvider(primary, "m", [], deps(h));
  await expect(p.chat([], [], controls)).rejects.toMatchObject({
    name: "ProviderAbortError",
    kind: "cancelled",
  });
  expect(requests).toBe(0);
  expect(settlements).toBe(0);
  expect(governor.snapshot().usd).toBe(0);
  expect(h.permit("primary", "m")).toBe("probe");
  h.cancelProbe("primary", "m");
  governor.close();
});

test("a stopped stream consumer releases a half-open probe, not a fictional success", async () => {
  const h = probeHealth();
  let settled = 0;
  const primary = streaming(target(), async function* () {
    yield { text: "partial" };
    yield { finish: true };
  });
  const p = new ResilientProvider(primary, "m", [], deps(h));
  for await (const _chunk of p.chatStream([], [], {
    beforeAttempt() {},
    afterAttempt(result) {
      settled++;
      expect(result.error).toBeDefined();
    },
  }))
    break;
  expect(settled).toBe(1);
  expect(h.gate("primary", "m").samples).toBe(1);
  expect(h.permit("primary", "m")).toBe("probe");
  h.cancelProbe("primary", "m");
});

test("partial stream timeout records a failure and never stitches in a fallback", async () => {
  const h = health();
  let fallbackRequests = 0;
  const primary = streaming(target(), async function* () {
    yield { text: "visible partial" };
    throw new ProviderAbortError("timeout", "primary");
  });
  const p = new ResilientProvider(
    primary,
    "m",
    [{ providerId: "backup", modelId: "m", reason: "fixture" }],
    deps(h, {
      construct: () =>
        target("backup", () => {
          fallbackRequests++;
          return ok();
        }),
    }),
  );
  const chunks: string[] = [];
  try {
    for await (const chunk of p.chatStream([], [], admitted))
      if (chunk.text) chunks.push(chunk.text);
    throw new Error("expected timeout");
  } catch (error) {
    expect(error).toMatchObject({
      name: "ProviderAbortError",
      kind: "timeout",
    });
  }
  expect(chunks).toEqual(["visible partial"]);
  expect(fallbackRequests).toBe(0);
  expect(h.gate("primary", "m").samples).toBe(1);
  expect(h.gate("primary", "m").errorRate).toBe(1);
});

test("an empty completed stream is not healthy and cannot silently fall back", async () => {
  const h = health();
  let constructed = 0;
  const p = new ResilientProvider(
    streaming(target(), async function* () {
      yield { finish: true };
    }),
    "m",
    [{ providerId: "backup", modelId: "m", reason: "fixture" }],
    deps(h, {
      construct: () => {
        constructed++;
        return target("backup");
      },
    }),
  );
  await expect(consume(p)).rejects.toThrow();
  expect(constructed).toBe(0);
  expect(h.gate("primary", "m").samples).toBe(1);
  expect(h.gate("primary", "m").errorRate).toBe(1);
});

test("a newly tripped circuit stops in-place retries; skipped hops cannot corrupt provenance/equivalence", async () => {
  const h = new RoutingHealth({ file: null, config: { minSamples: 1 } });
  let primaryRequests = 0,
    backupRequests = 0;
  const hops: FailoverRecord[] = [];
  const p = new ResilientProvider(
    target("primary", () => {
      primaryRequests++;
      throw new Error("HTTP 503");
    }),
    "m",
    ["skip", "backup"].map((providerId) => ({
      providerId,
      modelId: "m",
      reason: "fixture",
    })),
    deps(h, {
      localityGuard: (id) => id !== "skip",
      retry: { maxInPlaceRetries: 5 },
      onFailover: (hop) => hops.push(hop),
      construct: (step) =>
        target(step.providerId, () => {
          backupRequests++;
          return ok();
        }),
    }),
  );
  expect((await p.chat([], [], admitted)).message).toBe("completed");
  expect(primaryRequests).toBe(1);
  expect(backupRequests).toBe(1);
  expect(h.gate("primary", "m").state).toBe("open");
  expect(hops).toHaveLength(1);
  expect(hops[0]!.from).toEqual({ providerId: "primary", modelId: "m" });
  expect(hops[0]!.level).toBe("L2_reduced_fallback");
  expect(h.gate("skip", "m").samples).toBe(0);
});

test("structured auth/malformed/nonretryable errors beat misleading transient message text", async () => {
  const h = health();
  let requests = 0,
    fallbackRequests = 0;
  const error = new ProviderError(
    "authentication_failure",
    "primary",
    "HTTP 503 temporarily unavailable",
    { retryable: true },
  );
  const p = new ResilientProvider(
    target("primary", () => {
      requests++;
      throw error;
    }),
    "m",
    [{ providerId: "backup", modelId: "m", reason: "fixture" }],
    deps(h, {
      retry: { maxInPlaceRetries: 5 },
      construct: () =>
        target("backup", () => {
          fallbackRequests++;
          return ok();
        }),
    }),
  );
  await expect(p.chat([], [], admitted)).rejects.toBe(error);
  expect(requests).toBe(1);
  expect(fallbackRequests).toBe(0);
  expect(
    classifyError(
      new ProviderError("malformed_response", "primary", "HTTP 503"),
    ).cls,
  ).toBe("semantic");
  expect(
    classifyError(
      new ProviderError("unavailable", "primary", "HTTP 503", {
        retryable: false,
      }),
    ).cls,
  ).toBe("permanent");
  expect(
    classifyError(new Error("unauthorized password=fixture-private-material"))
      .reason,
  ).not.toContain("fixture-private-material");
  expect(
    classifyError(new Error("unknown token=fixture-private-material")).reason,
  ).not.toContain("fixture-private-material");
});

test("throwing telemetry after success cannot replay an already settled paid call", async () => {
  const h = health();
  let requests = 0,
    settlements = 0;
  const p = new ResilientProvider(
    target("primary", () => {
      requests++;
      return ok();
    }),
    "m",
    [],
    deps(h, {
      retry: { maxInPlaceRetries: 5 },
      onOutcome() {
        throw new Error("telemetry HTTP 503 unavailable");
      },
    }),
  );
  expect(
    (
      await p.chat([], [], {
        beforeAttempt() {},
        afterAttempt() {
          settlements++;
        },
      })
    ).message,
  ).toBe("completed");
  expect(requests).toBe(1);
  expect(settlements).toBe(1);
  expect(h.gate("primary", "m").samples).toBe(1);
  expect(h.gate("primary", "m").errorRate).toBe(0);
});

test("registry refuses a conflicting legacy transport model even if modern modelId looks correct", () => {
  const registry = new ProviderRegistry();
  const p = Object.assign(target("fixture"), { model: "wrong" });
  registry.register({ ...PRESETS.openai!, id: "fixture" }, () => p);
  expect(() =>
    registry.createProvider("fixture", ConfigSchema.parse({}), "m"),
  ).toThrow(/model mismatch/);
});
