/**
 * XR Phase 06 · Step 12/13/50 — canonical retry taxonomy tests.
 *
 * Pins the ONE classification model: RETRYABLE vs NON_RETRYABLE errors, the
 * side-effect safety gate, bounded budgets, and the joint decideRetry verdict.
 */
import { describe, expect, test } from "bun:test";
import {
  backoffDelayMs,
  classifyDbError,
  classifyError,
  decideRetry,
  isRetryable,
  RETRY_BUDGET,
  withinRetryBudget,
} from "../../src/execution/retry-classification.ts";
import { ProviderError } from "../../src/providers/errors.ts";
import { ProviderAbortError } from "../../src/providers/request-guard.ts";
import { malformedProviderResponseError } from "../../src/providers/errors.ts";

describe("Phase 06 · retry classification (spec step 12)", () => {
  test("NETWORK_TIMEOUT → RETRYABLE", () => {
    expect(isRetryable(new ProviderAbortError("timeout", "p", 1000))).toBe(true);
    expect(classifyError(Object.assign(new Error("socket hang up"), { code: "ETIMEDOUT" })).category).toBe("timeout");
    expect(isRetryable(new Error("fetch failed: ECONNRESET"))).toBe(true);
  });

  test("CONNECTION_RESET → RETRYABLE", () => {
    expect(isRetryable(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(true);
    expect(classifyError(new Error("connection reset by peer")).retryClass).toBe("retryable");
  });

  test("PROVIDER_503 → RETRYABLE", () => {
    const e = new ProviderError("unavailable", "p", "provider p HTTP 503: service unavailable");
    expect(classifyError(e).retryClass).toBe("retryable");
    expect(classifyError(e).category).toBe("provider_transient");
  });

  test("PROVIDER_429 → RETRYABLE with retry-after honored", () => {
    const e = new ProviderError("rate_limit", "p", "429 too many requests", {
      details: { statusCode: 429, retryAfterMs: 2500 },
    });
    const c = classifyError(e);
    expect(c.retryClass).toBe("retryable");
    expect(c.category).toBe("provider_rate_limit");
    expect(c.retryAfterMs).toBe(2500);
  });

  test("TRANSIENT_TOOL_ERROR → RETRYABLE via structured hint", () => {
    // A tool adapter may mark an error retryable via a database-busy style code.
    const e = Object.assign(new Error("db busy"), { code: "SQLITE_BUSY" });
    expect(classifyError(e).retryClass).toBe("retryable");
    expect(classifyError(e).category).toBe("database_transient");
  });

  test("INVALID_API_KEY → NON_RETRYABLE", () => {
    const e = new ProviderError("authentication_failure", "p", "401 invalid api key");
    expect(classifyError(e).retryClass).toBe("non_retryable");
    expect(classifyError(e).category).toBe("auth");
    expect(isRetryable(new Error("Invalid API key provided"))).toBe(false);
  });

  test("AUTH_FAILURE → NON_RETRYABLE", () => {
    expect(isRetryable(new Error("authentication failed (401)"))).toBe(false);
  });

  test("MODEL_NOT_FOUND → NON_RETRYABLE", () => {
    const e = new ProviderError("model_unavailable", "p", "404 model not found");
    expect(classifyError(e).retryClass).toBe("non_retryable");
    expect(classifyError(e).category).toBe("model_unavailable");
    expect(isRetryable(new Error("The model `gpt-x` does not exist"))).toBe(false);
  });

  test("MALFORMED_TOOL_CALL → NON_RETRYABLE", () => {
    const e = Object.assign(new Error("bad args"), { code: "MALFORMED_TOOL_CALL" });
    expect(classifyError(e).retryClass).toBe("non_retryable");
    expect(classifyError(e).category).toBe("validation");
  });

  test("PATH_ESCAPE → NON_RETRYABLE (security)", () => {
    const e = Object.assign(new Error("blocked"), { code: "PATH_ESCAPE" });
    expect(classifyError(e).retryClass).toBe("non_retryable");
    expect(classifyError(e).category).toBe("security");
    expect(isRetryable(new Error("path escape detected: ../etc/passwd"))).toBe(false);
  });

  test("SECRET_LEAK → NON_RETRYABLE (security)", () => {
    expect(isRetryable(new Error("secret leak detected in output"))).toBe(false);
    expect(classifyError(new Error("secret leak detected")).category).toBe("security");
  });

  test("POLICY_DENIED → NON_RETRYABLE", () => {
    const e = Object.assign(new Error("no"), { code: "POLICY_DENIED" });
    expect(classifyError(e).retryClass).toBe("non_retryable");
    expect(classifyError(e).category).toBe("policy");
  });

  test("MALFORMED_PROVIDER_RESPONSE → NON_RETRYABLE", () => {
    const e = malformedProviderResponseError("openai", "not valid JSON");
    expect(classifyError(e).retryClass).toBe("non_retryable");
    expect(classifyError(e).category).toBe("provider_malformed");
    expect(e.retryable).toBe(false);
    // secret redaction inside the factory
    const e2 = malformedProviderResponseError("p", "bad json sk-abcdef1234567890 inside");
    expect(e2.message).not.toContain("sk-abcdef1234567890");
  });

  test("cancellation is never retryable", () => {
    expect(classifyError(new ProviderAbortError("cancelled", "p")).retryClass).toBe("non_retryable");
    expect(classifyError(new ProviderAbortError("cancelled", "p")).category).toBe("cancellation");
  });

  test("unknown errors classify conservatively NON_RETRYABLE", () => {
    expect(classifyError(new Error("something bizarre happened")).retryClass).toBe("non_retryable");
    expect(classifyError(null).retryClass).toBe("non_retryable");
    expect(classifyError(undefined).retryClass).toBe("non_retryable");
  });
});

describe("Phase 06 · database failure taxonomy (spec step 28)", () => {
  test("busy/locked is transient + retryable", () => {
    expect(classifyDbError(Object.assign(new Error("locked"), { code: "SQLITE_BUSY" }))).toEqual({
      kind: "transient",
      retryable: true,
      code: "SQLITE_BUSY",
    });
    expect(classifyDbError(new Error("database is locked")).kind).toBe("transient");
  });

  test("corruption is NOT an automatic retry loop", () => {
    expect(classifyDbError(Object.assign(new Error("x"), { code: "SQLITE_CORRUPT" })).retryable).toBe(false);
    expect(classifyDbError(new Error("database disk image is malformed")).kind).toBe("corrupt");
    expect(classifyDbError(new Error("disk I/O error")).retryable).toBe(false);
  });
});

describe("Phase 06 · bounded budget + backoff (spec steps 38/39)", () => {
  test("backoff grows exponentially then caps", () => {
    const noJitter = () => 0.5; // deterministic center
    const d1 = backoffDelayMs(1, { baseDelayMs: 100, maxDelayMs: 5000 }, noJitter);
    const d2 = backoffDelayMs(2, { baseDelayMs: 100, maxDelayMs: 5000 }, noJitter);
    const d3 = backoffDelayMs(3, { baseDelayMs: 100, maxDelayMs: 5000 }, noJitter);
    const d10 = backoffDelayMs(10, { baseDelayMs: 100, maxDelayMs: 5000 }, noJitter);
    expect(d1).toBe(100);
    expect(d2).toBe(200);
    expect(d3).toBe(400);
    expect(d10).toBeLessThanOrEqual(5000); // bounded, never infinite growth
  });

  test("retry-after acts as a floor", () => {
    const d = backoffDelayMs(1, { baseDelayMs: 10, retryAfterMs: 1500 }, () => 0.5);
    expect(d).toBeGreaterThanOrEqual(1500);
  });

  test("attempt + deadline budgets enforced", () => {
    const start = Date.now();
    expect(withinRetryBudget(1, start, { maxAttempts: 3 })).toBe(true);
    expect(withinRetryBudget(3, start, { maxAttempts: 3 })).toBe(false);
    // absolute ceiling clamps caller requests (500 → clamped to 5)
    expect(withinRetryBudget(4, start, { maxAttempts: 500 })).toBe(true); // under the clamped 5
    expect(withinRetryBudget(5, start, { maxAttempts: 500 })).toBe(false); // clamped ceiling reached
    expect(withinRetryBudget(1, start - 200_000, { maxAttempts: 5, deadlineMs: 120_000 })).toBe(false);
    expect(RETRY_BUDGET.ABSOLUTE_MAX_ATTEMPTS).toBeLessThanOrEqual(5);
  });
});

describe("Phase 06 · the JOINT retry decision (spec steps 11/40)", () => {
  test("retryable error + safe operation → retry with bounded delay", async () => {
    const d = await decideRetry({
      error: new ProviderError("unavailable", "p", "503"),
      idempotency: "naturally_idempotent",
      sideEffectUnknown: false,
      attempt: 1,
    });
    expect(d.verdict).toBe("retry");
    expect(d.delayMs).toBeGreaterThanOrEqual(0);
  });

  test("retryable error + UNSAFE side effect → reconcile, never blind retry", async () => {
    const d = await decideRetry({
      error: Object.assign(new Error("network timeout after remote write"), { code: "ETIMEDOUT" }),
      idempotency: "non_idempotent",
      sideEffectUnknown: true,
      attempt: 1,
    });
    expect(d.verdict).toBe("reconcile");
    expect(d.reason).toContain("reconciliation");
  });

  test("retryable error + unknown_unsafe + side effect unknown → reconcile", async () => {
    const d = await decideRetry({
      error: new Error("ECONNRESET"),
      idempotency: "unknown_unsafe",
      sideEffectUnknown: true,
      attempt: 1,
    });
    expect(d.verdict).toBe("reconcile");
  });

  test("non-retryable error → do_not_retry even on safe operation", async () => {
    const d = await decideRetry({
      error: new ProviderError("authentication_failure", "p", "401"),
      idempotency: "naturally_idempotent",
      sideEffectUnknown: false,
      attempt: 1,
    });
    expect(d.verdict).toBe("do_not_retry");
  });

  test("budget exhaustion stops retries of otherwise-retryable errors", async () => {
    const d = await decideRetry({
      error: new ProviderError("unavailable", "p", "503"),
      idempotency: "naturally_idempotent",
      sideEffectUnknown: false,
      attempt: 3,
      budget: { maxAttempts: 3 },
    });
    expect(d.verdict).toBe("do_not_retry");
    expect(d.reason).toContain("budget");
  });

  test("caller predicate can veto but never authorize unsafe retries", async () => {
    const vetoed = await decideRetry({
      error: new ProviderError("unavailable", "p", "503"),
      idempotency: "naturally_idempotent",
      sideEffectUnknown: false,
      attempt: 1,
      callerAllowsRetry: () => false,
    });
    expect(vetoed.verdict).toBe("do_not_retry");

    // Even a permissive caller cannot defeat the side-effect gate.
    const unsafe = await decideRetry({
      error: new ProviderError("unavailable", "p", "503"),
      idempotency: "non_idempotent",
      sideEffectUnknown: true,
      attempt: 1,
      callerAllowsRetry: () => true,
    });
    expect(unsafe.verdict).toBe("reconcile");
  });

  test("cancellation is terminal", async () => {
    const d = await decideRetry({
      error: new ProviderAbortError("cancelled", "p"),
      idempotency: "naturally_idempotent",
      sideEffectUnknown: false,
      attempt: 1,
    });
    expect(d.verdict).toBe("do_not_retry");
  });
});
