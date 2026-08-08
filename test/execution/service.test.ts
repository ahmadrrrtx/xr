import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { ExecutionRepo, adaptWorkspaceStore, type ExecutionDb } from "../../src/execution/repository.ts";
import { ExecutionService } from "../../src/execution/service.ts";
import { IN_PROCESS_PLACEMENT, okObservation, failObservation } from "../../src/execution/adapters/common.ts";
import type { ExecutionRecord } from "../../src/execution/types.ts";

function makeService(): {
  raw: { db: Database; path: string; destroy: () => void };
  db: ExecutionDb;
  service: ExecutionService;
  auditEvents: Array<{ event: string; detail: Record<string, unknown> }>;
} {
  const dir = mkdtempSync(join(tmpdir(), "xr-exec-svc-"));
  const path = join(dir, "test.db");
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const wrapped = adaptWorkspaceStore({
    exec: (s: string) => db.exec(s),
    prepare: (s: string) => db.prepare(s),
  });
  const auditEvents: Array<{ event: string; detail: Record<string, unknown> }> = [];
  const service = new ExecutionService({
    repo: new ExecutionRepo(wrapped),
    audit: (event, detail) => auditEvents.push({ event, detail }),
  });
  return {
    raw: {
      db,
      path,
      destroy: () => {
        try { db.close(); } catch { /* noop */ }
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
      },
    },
    db: wrapped,
    service,
    auditEvents,
  };
}

describe("XR 4.1 ExecutionService", () => {
  let h: ReturnType<typeof makeService>;
  beforeEach(() => { h = makeService(); });
  afterEach(() => h.raw.destroy());

  test("simple successful action records a complete record", async () => {
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "hello", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "read_file" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "naturally_idempotent",
      inputSummary: "{\"path\":\"/tmp/x\"}",
      run: async () => okObservation("file contents here"),
    });
    expect(rec.state).toBe("succeeded");
    expect(rec.outcome!.kind).toBe("succeeded");
    expect(rec.observation!.summary).toBe("file contents here");
    expect(rec.observation!.transportOk).toBe(true);
    expect(rec.id.runId).toStartWith("ex_");
    expect(rec.adapterVersion).toBe("xr-4.3.0"); // XR 4.3 — adapter version bump (durable agency)
    expect(rec.durationMs).toBeGreaterThanOrEqual(0);
    expect(rec.startedAt).toBeDefined();
    expect(rec.endedAt).toBeDefined();
    expect(h.auditEvents.some((e) => e.event === "execution.created")).toBe(true);
    expect(h.auditEvents.some((e) => e.event === "execution.outcome")).toBe(true);
  });

  test("action failure is normalized to 'failed' outcome", async () => {
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "system", component: "test" },
      intent: { summary: "bad action", origin: { kind: "system", component: "test" } },
      capability: { kind: "core_tool", name: "read_file" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "naturally_idempotent",
      inputSummary: "{\"path\":\"/x\"}",
      run: async () => {
        throw new Error("boom");
      },
    });
    expect(rec.state).toBe("failed");
    expect(rec.outcome!.kind).toBe("failed");
    expect(rec.outcome!.error?.code).toBe("ACTION_ERROR");
  });

  test("denied approval returns denied outcome", async () => {
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "write file", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "write_file" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "idempotent_with_key",
      idempotencyKey: "k-1",
      inputSummary: "{\"path\":\"/tmp/a\",\"content\":\"x\"}",
      approve: async () => false,
      run: async () => {
        expect.unreachable("run must not execute when denied");
        return okObservation("should not run");
      },
    });
    expect(rec.state).toBe("denied");
    expect(rec.outcome!.kind).toBe("denied");
    expect(rec.policy.some((p) => p.kind === "approval_denied")).toBe(true);
  });

  test("approved action proceeds", async () => {
    let approved = false;
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "write", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "write_file" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "idempotent_with_key",
      idempotencyKey: "k-approved",
      inputSummary: "{}",
      approve: async () => { approved = true; return true; },
      run: async () => okObservation("written"),
    });
    expect(approved).toBe(true);
    expect(rec.state).toBe("succeeded");
  });

  test("budget block prevents execution", async () => {
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "agent", agentId: "a", providerId: "p" },
      intent: { summary: "chat", origin: { kind: "agent", agentId: "a", providerId: "p" } },
      capability: { kind: "model_call", name: "p" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "non_idempotent",
      inputSummary: "{}",
      checkBudget: async () => ({ allow: false, reason: "cap hit", meter: "$1/$1" }),
      run: async () => { expect.unreachable("run must not execute when budget blocked"); return failObservation("no"); },
    });
    expect(rec.state).toBe("budget_blocked");
    expect(rec.outcome!.kind).toBe("budget_stopped");
    expect(rec.outcome!.stoppedReason).toBe("budget");
  });

  test("timeout fires and records timed_out outcome", async () => {
    const start = Date.now();
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "system", component: "test" },
      intent: { summary: "slow", origin: { kind: "system", component: "test" } },
      capability: { kind: "core_tool", name: "shell" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "non_idempotent",
      inputSummary: "{}",
      timeoutMs: 50,
      run: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return okObservation("too late");
      },
    });
    expect(rec.state).toBe("timed_out");
    expect(rec.outcome!.kind).toBe("timed_out");
    expect(Date.now() - start).toBeLessThan(2000); // XR 4.3 — checkpoint writes add overhead to otherwise fast timeout path
  });

  test("cancel() aborts a running action", async () => {
    let runId: string | undefined;
    let entered = false;
    h.service.addListener((ev) => {
      if (ev.type === "transition" && ev.to === "running") runId = ev.runId;
    });
    const runPromise = h.service.execute({
      workspaceId: "ws",
      actor: { kind: "system", component: "test" },
      intent: { summary: "cancellable", origin: { kind: "system", component: "test" } },
      capability: { kind: "core_tool", name: "shell" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "non_idempotent",
      inputSummary: "{}",
      timeoutMs: 2000,
      run: async (ctx) => {
        entered = true;
        while (!ctx.isCancelled()) {
          await new Promise((r) => setTimeout(r, 10));
        }
        return failObservation("cancelled inside run");
      },
    });
    // Wait for run to reach "running" state, then cancel.
    while (!runId || !entered) {
      await new Promise((r) => setTimeout(r, 5));
    }
    h.service.cancel(runId, "test");
    const rec = await runPromise;
    expect(rec.state).toBe("cancelled");
    expect(rec.outcome!.kind).toBe("cancelled");
  });

  test("dry-run reports dry_run_simulated outcome even when run returns ok", async () => {
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "dry", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "write_file" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "idempotent_with_key",
      inputSummary: "{}",
      dryRun: true,
      approve: async () => true,
      run: async () => okObservation("would write"),
    });
    expect(rec.outcome!.kind).toBe("dry_run_simulated");
    expect(rec.action!.dryRun).toBe(true);
  });

  test("duplicate idempotent key returns prior success without re-running", async () => {
    let runs = 0;
    const opts = {
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" } as const,
      intent: { summary: "idem", origin: { kind: "user" as const, source: "cli" as const } },
      capability: { kind: "core_tool" as const, name: "write_file" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "idempotent_with_key" as const,
      idempotencyKey: "dup-key-1",
      inputSummary: "{}",
      run: async () => { runs++; return okObservation("done"); },
    };
    const first = await h.service.execute(opts);
    expect(first.state).toBe("succeeded");
    expect(runs).toBe(1);
    const second = await h.service.execute(opts);
    expect(second.state).toBe("succeeded");
    expect(second.duplicateOf).toBe(first.id.runId);
    expect(runs).toBe(1); // run NOT invoked again
  });

  test("recordUsage prevents double cost charging", async () => {
    const costEvents: Array<{ usd: number }> = [];
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "agent", agentId: "a", providerId: "p" },
      intent: { summary: "m", origin: { kind: "agent", agentId: "a", providerId: "p" } },
      capability: { kind: "model_call", name: "p" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "non_idempotent",
      inputSummary: "{}",
      recordCost: (c) => costEvents.push({ usd: c.usd }),
      run: async (ctx) => {
        ctx.recordUsage({ inTokens: 10, outTokens: 20, usd: 0.0001, provider: "p", model: "m" });
        ctx.recordUsage({ inTokens: 999, outTokens: 999, usd: 0.999, provider: "p", model: "m" }); // second call should be ignored
        return okObservation("ok");
      },
    });
    expect(rec.cost!.actualUsd).toBeCloseTo(0.0001, 6);
    expect(costEvents).toHaveLength(1);
    expect(costEvents[0]!.usd).toBeCloseTo(0.0001, 6);
  });

  test("events are emitted for lifecycle transitions", async () => {
    const events: Array<{ type: string; to?: string }> = [];
    h.service.addListener((e) => {
      if (e.type === "transition") events.push({ type: "transition", to: e.to });
      if (e.type === "outcome") events.push({ type: "outcome" });
    });
    await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "ev", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "read_file" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "naturally_idempotent",
      inputSummary: "{}",
      run: async () => okObservation("ok"),
    });
    expect(events.map((e) => e.type)).toContain("transition");
    expect(events.map((e) => e.type)).toContain("outcome");
  });

  test("persistence failure does not fabricate success", async () => {
    // Force failure on save by wrapping the repo to throw.
    const badRepo = new ExecutionRepo(h.db);
    badRepo.save = () => { throw new Error("disk full"); };
    const svc = new ExecutionService({ repo: badRepo });
    const rec = await svc.execute({
      workspaceId: "ws",
      actor: { kind: "system", component: "t" },
      intent: { summary: "persist-fail", origin: { kind: "system", component: "t" } },
      capability: { kind: "core_tool", name: "read_file" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "naturally_idempotent",
      inputSummary: "{}",
      run: async () => okObservation("ok"),
    });
    // Outcome persistence failed → upgrade to reconciliation_required.
    expect(rec.state).toBe("reconciliation_required");
  });

  // ── S-2 launch pass: retry-policy pinning ────────────────────────────────
  // Verifying the retry contract for launch surfaced the REAL semantics, which
  // these tests now pin (see docs/audits/XR_RUNTIME_AUDIT.md A-14):
  //   · An action that throws mid-run has sideEffectUnknown=true → the service
  //     FAILS CLOSED: no automatic same-run retry, terminal `failed` — even
  //     with maxAttempts > 1. Retrying work whose side effect may already have
  //     happened would risk silently repeating it (double charge, double write).
  //   · Non-idempotent work additionally escalates to reconciliation_required.
  //   · Live retry therefore lives at other layers: provider failover
  //     (multi-agent), model-switch canary rollback, and recovery/resume.
  // Cancellation pinning lives in ./cancellation.test.ts.

  test("retry policy: thrown mid-run failure is terminal — no silent re-execution", async () => {
    let calls = 0;
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "flaky action", origin: { kind: "user", source: "cli" } },
      capability: { kind: "model_call", name: "flaky" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "naturally_idempotent",
      inputSummary: "{}",
      maxAttempts: 3,
      retryBackoffMs: 1,
      run: async () => {
        calls++;
        throw new Error(`failure ${calls}`);
      },
    });
    expect(rec.state).toBe("failed");
    expect(rec.outcome!.kind).toBe("failed");
    // sideEffectUnknown → fail closed. Asking for retries does not override it.
    expect(calls).toBe(1);
    expect(rec.retryCount ?? 0).toBe(0);
    expect(h.auditEvents.some((e) => e.event === "execution.retry")).toBe(false);
  });

  test("retry policy: non-idempotent thrown failure escalates to reconciliation_required", async () => {
    let calls = 0;
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "charge card", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "shell_exec" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "non_idempotent",
      inputSummary: "{}",
      maxAttempts: 3,
      retryBackoffMs: 1,
      run: async () => {
        calls++;
        throw new Error("gateway timeout");
      },
    });
    // We cannot prove the side effect did NOT happen → honest escalation, never a blind retry.
    expect(rec.state).toBe("reconciliation_required");
    expect(rec.outcome!.kind).toBe("reconciliation_required");
    expect(rec.outcome!.message).toContain("reconciliation");
    expect(calls).toBe(1);
    expect(h.auditEvents.some((e) => e.event === "execution.retry")).toBe(false);
  });

  test("retry policy: isRetryable veto → terminal failure", async () => {
    let calls = 0;
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "vetoed retry", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "read_file" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "naturally_idempotent",
      inputSummary: "{}",
      maxAttempts: 3,
      retryBackoffMs: 1,
      isRetryable: () => false,
      run: async () => {
        calls++;
        throw new Error("permanent 400");
      },
    });
    expect(rec.state).toBe("failed");
    expect(calls).toBe(1);
  });

  test("retry policy: maxAttempts cannot buy retries past the side-effect safety gate", async () => {
    let calls = 0;
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "clamp check", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "read_file" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "naturally_idempotent",
      inputSummary: "{}",
      maxAttempts: 99,
      retryBackoffMs: 1,
      run: async () => {
        calls++;
        throw new Error(`failure ${calls}`);
      },
    });
    expect(rec.state).toBe("failed");
    // EXECUTION_BOUNDS.MAX_ATTEMPTS=5 is the clamp, but the side-effect gate
    // fires first: exactly one attempt, terminal failure.
    expect(calls).toBe(1);
    expect(rec.id.attempt).toBe(1);
  });
});
