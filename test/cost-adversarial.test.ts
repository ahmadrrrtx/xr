/**
 * XR Preview 1 · T22 — spend-cap ADVERSARIAL invariants at the settlement seam.
 *
 * The loop / fan-out ceilings are already pinned elsewhere:
 *   · `test/cost.test.ts` — an agent loop cannot pass its ceiling;
 *   · `test/phase2/reservations.test.ts` — racing processes cannot double-spend;
 *   · `test/phase6/worker-budget.test.ts` — a delegated tree cannot outrun its root.
 *
 * What was NOT pinned is the *retry storm* hazard, and it is the one that would
 * actually leak money: if a failed, retried or fallback attempt settled as free,
 * a provider that errors every time would let the runtime retry without bound and
 * never reach the cap. `src/core/model-accounting.ts` deliberately charges a
 * conservative estimate in that case. These tests hold that claim down, plus the
 * "persistence failure must not become a free retry" rule next to it.
 */
import { test, expect } from "bun:test";
import { attemptControls } from "../src/core/model-accounting.ts";
import { CostGovernor } from "../src/cost/governor.ts";
import type { Pricing } from "../src/cost/pricing-types.ts";

/** A provider stub that is never actually called by these tests. */
const provider = {
  id: "mock",
  label: "Mock",
  async chat() {
    throw new Error("unused");
  },
  async health() {
    return { ok: true };
  },
};

const pricing: Pricing = { inPerMTok: 0.5, outPerMTok: 1.5 };

function controlsFor(
  governor: CostGovernor,
  overrides: { recordCost?: (...a: never[]) => unknown; maxOutputTokens?: number } = {},
) {
  return attemptControls({
    provider: provider as never,
    pricingTarget: { id: "mock", model: "mock-1" },
    pricing,
    governor,
    sessionId: "s-adv",
    step: 0,
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    maxOutputTokens: overrides.maxOutputTokens ?? 4096,
    audit: () => {},
    recordCost:
      overrides.recordCost ??
      (() => {
        /* persisted elsewhere */
      }),
  } as never);
}

test("a SUCCESSFUL attempt settles the provider's reported usage exactly", async () => {
  const governor = new CostGovernor({ maxUsd: 100 }, pricing);
  const controls = controlsFor(governor);
  await controls.beforeAttempt?.({ providerId: "mock", modelId: "mock-1", fallback: false });
  await controls.afterAttempt?.({
    providerId: "mock",
    modelId: "mock-1",
    turn: {
      message: "hi",
      toolCalls: [],
      done: true,
      usage: { inTokens: 1000, outTokens: 1000 },
    },
  } as never);

  const snap = governor.snapshot();
  expect(snap.inTokens).toBe(1000);
  expect(snap.outTokens).toBe(1000);
  // 1000 in @ $0.5/M + 1000 out @ $1.5/M = $0.0005 + $0.0015 = $0.002
  expect(snap.usd).toBeCloseTo(0.002, 9);
});

test("a FAILED attempt is charged a conservative estimate, never zero", async () => {
  const governor = new CostGovernor({ maxUsd: 100 }, pricing);
  const controls = controlsFor(governor, { maxOutputTokens: 2048 });
  await controls.beforeAttempt?.({ providerId: "mock", modelId: "mock-1", fallback: false });
  // The provider errored before reporting usage — it may still have billed us.
  await controls.afterAttempt?.({
    providerId: "mock",
    modelId: "mock-1",
    error: new Error("connection reset after the request was sent"),
  });

  const snap = governor.snapshot();
  expect(snap.totalTokens).toBeGreaterThan(0); // NOT a free retry
  expect(snap.usd).toBeGreaterThan(0);
  // The reserve is the bound output allowance, not a guess in our favour.
  expect(snap.outTokens).toBe(2048);
});

test("RETRY STORM: failing attempts cannot retry for free — they exhaust the cap", async () => {
  // $0.02 ceiling with a 2048-token reserve per failed attempt (~$0.003 each).
  const governor = new CostGovernor({ maxUsd: 0.02 }, pricing);
  const controls = controlsFor(governor, { maxOutputTokens: 2048 });

  let attempts = 0;
  // The storm: keep failing. Nothing here is allowed to be free.
  while (governor.checkBeforeStep().allow && attempts < 500) {
    await controls.beforeAttempt?.({ providerId: "mock", modelId: "mock-1", fallback: false });
    await controls.afterAttempt?.({
      providerId: "mock",
      modelId: "mock-1",
      error: new Error(`boom ${attempts}`),
    });
    attempts++;
  }

  // It stopped because of the cap (not because the loop ran out), and it never
  // spent more than the ceiling.
  expect(governor.checkBeforeStep().allow).toBe(false);
  expect(attempts).toBeLessThan(500);
  expect(governor.snapshot().usd).toBeLessThanOrEqual(0.02 + 1e-9);
});

test("PERSISTENCE failure after settlement propagates — never a free retry", async () => {
  const governor = new CostGovernor({ maxUsd: 100 }, pricing);
  const controls = controlsFor(governor, {
    recordCost: () => {
      throw new Error("sqlite: disk I/O error");
    },
  });
  await controls.beforeAttempt?.({ providerId: "mock", modelId: "mock-1", fallback: false });

  let threw = false;
  try {
    await controls.afterAttempt?.({
      providerId: "mock",
      modelId: "mock-1",
      turn: {
        message: "hi",
        toolCalls: [],
        done: true,
        usage: { inTokens: 10, outTokens: 10 },
      },
    } as never);
  } catch {
    threw = true;
  }
  // The cost row could not be written, so the attempt is NOT silently forgiven:
  // the error surfaces and the (correctly charged) governor state is the one kept.
  expect(threw).toBe(true);
  expect(governor.snapshot().totalTokens).toBe(20);
});

test("an attempt with no usable pricing is refused BEFORE any request is sent", async () => {
  const governor = new CostGovernor({ maxTokens: 1000 }, pricing);
  const controls = controlsFor(governor, {});
  // Unknown model on a provider with no declared rate → admission must refuse.
  let refused = false;
  try {
    await controls.beforeAttempt?.({ providerId: "unpriced-provider", modelId: "x", fallback: false });
  } catch {
    refused = true;
  }
  expect(refused).toBe(true);
  expect(governor.snapshot().totalTokens).toBe(0); // nothing was sent, nothing charged
});
