/** XR 5.1 — Bounded recovery + circuit breaker unit tests (§7.7). */
import { describe, test, expect } from "bun:test";
import {
  classifyFailure,
  decideRecovery,
  recordOutcomeOnCircuit,
  circuitState,
  newRecoveryBudget,
} from "../../src/environment/recovery.ts";
import {
  EnvironmentSessionRegistry,
  transitionSession,
} from "../../src/environment/lifecycle.ts";
import { defaultEnvironmentPolicy, type EnvironmentSession } from "../../src/environment/types.ts";

function liveSession(): EnvironmentSession {
  const r = new EnvironmentSessionRegistry({ idleTimeoutMs: 3_600_000 });
  const s = r.create({ type: "browser", workspaceId: "/ws", policy: defaultEnvironmentPolicy("/tmp/x", "s") });
  transitionSession(s, "provision");
  transitionSession(s, "ready");
  transitionSession(s, "active");
  return s;
}

describe("classifyFailure taxonomy", () => {
  test("perception failures are retryable-reobserve", () => {
    expect(classifyFailure("waiting for selector '#submit' failed: timeout 15000ms exceeded")).toBe("retryable_reobserve");
    expect(classifyFailure("navigation timeout of 30000 ms exceeded")).toBe("retryable_reobserve");
    expect(classifyFailure("Target closed")).toBe("retryable_reobserve");
    expect(classifyFailure("Page crashed!")).toBe("retryable_reobserve");
  });

  test("policy/permission/validation failures are terminal", () => {
    expect(classifyFailure("permission 'desktop' not granted")).toBe("terminal");
    expect(classifyFailure("denied by user")).toBe("terminal");
    expect(classifyFailure("computer control is disabled")).toBe("terminal");
    expect(classifyFailure("invalid action: selector must be string")).toBe("terminal");
    expect(classifyFailure("browser op warp not implemented")).toBe("terminal");
  });
});

describe("decideRecovery (bounded; never endless mutation)", () => {
  const base = { failureMessage: "waiting for selector failed: timeout 15000ms exceeded" };

  test("allows ONE re-observe retry for a recoverable perception failure", () => {
    const d = decideRecovery({ ...base, reversibility: "reversible", sideEffectUnknown: false, budget: newRecoveryBudget() });
    expect(d.retry).toBe(true);
    expect(d.kind).toBe("reobserve_retry");
  });

  test("budget exhaustion stops retrying", () => {
    const budget = newRecoveryBudget();
    budget.retriesUsed = 1;
    const d = decideRecovery({ ...base, reversibility: "reversible", sideEffectUnknown: false, budget });
    expect(d.retry).toBe(false);
    expect(d.reason).toContain("budget");
  });

  test("irreversible actions NEVER auto-retry", () => {
    const d = decideRecovery({ ...base, reversibility: "irreversible", sideEffectUnknown: false, budget: newRecoveryBudget() });
    expect(d.retry).toBe(false);
    expect(d.reason).toContain("irreversible");
  });

  test("unknown-reversibility actions NEVER auto-retry", () => {
    const d = decideRecovery({ ...base, reversibility: "unknown", sideEffectUnknown: false, budget: newRecoveryBudget() });
    expect(d.retry).toBe(false);
  });

  test("unknown side effects NEVER auto-retry — human review required", () => {
    const d = decideRecovery({ ...base, reversibility: "reversible", sideEffectUnknown: true, budget: newRecoveryBudget() });
    expect(d.retry).toBe(false);
    expect(d.reason).toContain("unknown");
  });

  test("non-perceptual failures never retry", () => {
    const d = decideRecovery({ failureMessage: "permission denied", reversibility: "reversible", sideEffectUnknown: false, budget: newRecoveryBudget() });
    expect(d.retry).toBe(false);
  });

  test("open circuit blocks recovery", () => {
    const s = liveSession();
    s.circuitOpenUntil = Date.now() + 60_000;
    const d = decideRecovery({ ...base, reversibility: "reversible", sideEffectUnknown: false, budget: newRecoveryBudget(), session: s });
    expect(d.retry).toBe(false);
    expect(d.reason).toContain("circuit");
  });
});

describe("circuit breaker", () => {
  test("opens after the configured threshold of consecutive failures", () => {
    const s = liveSession();
    recordOutcomeOnCircuit(s, false);
    expect(s.circuitOpenUntil).toBeUndefined();
    recordOutcomeOnCircuit(s, false);
    const third = recordOutcomeOnCircuit(s, false); // default threshold 3
    expect(third.opened).toBe(true);
    expect(third.reason).toContain("3 consecutive failures");
    expect(circuitState(s).open).toBe(true);
    expect(circuitState(s).remainingMs).toBeGreaterThan(0);
  });

  test("success resets the consecutive failure count", () => {
    const s = liveSession();
    recordOutcomeOnCircuit(s, false);
    recordOutcomeOnCircuit(s, false);
    const ok = recordOutcomeOnCircuit(s, true);
    expect(ok.consecutiveFailures).toBe(0);
    expect(s.consecutiveFailures).toBe(0);
  });

  test("circuit half-opens after cooldown expires", () => {
    const s = liveSession();
    for (let i = 0; i < 3; i++) recordOutcomeOnCircuit(s, false, Date.now(), { cooldownMs: 5_000 });
    expect(circuitState(s, Date.now()).open).toBe(true);
    const later = Date.now() + 6_000;
    expect(circuitState(s, later).open).toBe(false);
  });

  test("custom thresholds are honored", () => {
    const s = liveSession();
    recordOutcomeOnCircuit(s, false, Date.now(), { threshold: 2 });
    const second = recordOutcomeOnCircuit(s, false, Date.now(), { threshold: 2 });
    expect(second.opened).toBe(true);
  });
});
