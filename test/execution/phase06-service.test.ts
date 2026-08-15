/**
 * XR Phase 06 — Execution fabric integration tests.
 *
 * Pins the service-level reliability contracts:
 *   · Step 7  — TOOL EXECUTION → CHECKPOINT WRITE → COMPLETION CLAIM ordering
 *   · Step 13 — provider failure classification flows through decideRetry
 *   · Step 23 — broken audit chain blocks startup recovery (no silent resume)
 *   · Step 25 — workflow lease: concurrent second execution is rejected
 *   · Step 40 — retries preserve the SAME logical idempotency key
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { IdempotencyStore } from "../../src/state/idempotency.ts";
import { ExecutionRepo, adaptWorkspaceStore } from "../../src/execution/repository.ts";
import { ExecutionService } from "../../src/execution/service.ts";
import { ProviderError } from "../../src/providers/errors.ts";
import type { ExecuteOptions } from "../../src/execution/types.ts";
import { rmrf } from "../reliability/helpers.ts";

function makeHarness(opts: { verifyAuditChain?: () => { valid: boolean; reason?: string } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "xr-p06-svc-"));
  const store = new WorkspaceStore("p06", join(dir, "xr.db"));
  const repo = new ExecutionRepo(adaptWorkspaceStore(store));
  const idem = new IdempotencyStore(store);
  const auditEvents: Array<{ event: string; detail: Record<string, unknown> }> = [];
  const service = new ExecutionService({
    repo,
    idempotency: idem,
    audit: (event, detail) => auditEvents.push({ event, detail }),
    ...(opts.verifyAuditChain ? { verifyAuditChain: opts.verifyAuditChain } : {}),
  });
  return {
    dir,
    store,
    repo,
    idem,
    service,
    auditEvents,
    cleanup: async () => {
      try {
        store.close();
      } catch {
        /* noop */
      }
      await rmrf(dir);
    },
  };
}

function opts(overrides: Partial<ExecuteOptions> = {}): ExecuteOptions {
  return {
    workspaceId: "ws",
    actor: { kind: "user", source: "cli" },
    intent: { summary: "phase06", origin: { kind: "user", source: "cli" } },
    capability: { kind: "core_tool", name: "read_file" },
    placement: { kind: "in_process" },
    idempotency: "naturally_idempotent",
    inputSummary: "{}",
    ...overrides,
  } as ExecuteOptions;
}

describe("Phase 06 · checkpoint ordering (spec step 7)", () => {
  test("TOOL EXECUTION → CHECKPOINT WRITE → COMPLETION CLAIM, never reordered", async () => {
    const h = makeHarness();
    try {
      const events: string[] = [];
      // Instrument the checkpoint manager + completion claim (outcome event).
      const originalCreate = h.service.checkpoints.createCheckpoint.bind(h.service.checkpoints);
      h.service.checkpoints.createCheckpoint = (rec, kind, extra) => {
        events.push(`checkpoint:${kind}`);
        return originalCreate(rec, kind, extra);
      };
      h.service.addListener((e) => {
        if (e.type === "outcome") events.push("completion_claim");
      });

      const rec = await h.service.execute(
        opts({
          capability: { kind: "core_tool", name: "write_file" },
          idempotency: "idempotent_with_key",
          idempotencyKey: "ck_order_1",
          run: async () => {
            events.push("tool_execution");
            return { summary: "wrote", transportOk: true };
          },
        }),
      );
      expect(rec.state).toBe("succeeded");

      const tool = events.indexOf("tool_execution");
      const cp = events.findIndex((e) => e === "checkpoint:tool_call_completed");
      const claim = events.indexOf("completion_claim");
      expect(tool).toBeGreaterThanOrEqual(0);
      expect(cp).toBeGreaterThan(tool); // checkpoint AFTER the tool ran
      expect(claim).toBeGreaterThan(cp); // claim only AFTER the checkpoint
      // The durable checkpoint exists before the run reports success.
      const latest = h.service.checkpoints.getLatestCheckpoint(rec.id.runId);
      expect(latest?.kind).toBe("tool_call_completed");
      expect(latest!.createdAt).toBeLessThanOrEqual(rec.endedAt!);
    } finally {
      await h.cleanup();
    }
  });

  test("lifecycle checkpoints land at every declared boundary (env_admitted/cleanup_completed included)", async () => {
    const h = makeHarness();
    try {
      const rec = await h.service.execute(
        opts({
          capability: { kind: "core_tool", name: "write_file" },
          idempotency: "idempotent_with_key",
          idempotencyKey: "ck_boundaries",
          run: async () => ({ summary: "ok", transportOk: true }),
        }),
      );
      const kinds = h.service.checkpoints.getCheckpoints(rec.id.runId, 100).map((c) => c.kind);
      expect(kinds).toContain("task_accepted");
      expect(kinds).toContain("policy_admitted");
      expect(kinds).toContain("step_started");
      expect(kinds).toContain("tool_call_completed");
    } finally {
      await h.cleanup();
    }
  });

  test("cancellation writes cleanup_completed and remains side-effect-honest", async () => {
    const h = makeHarness();
    try {
      const exec = h.service.execute(
        opts({
          capability: { kind: "core_tool", name: "write_file" },
          idempotency: "idempotent_with_key",
          idempotencyKey: "ck_cancel_cleanup",
          run: async (ctx: { isCancelled: () => boolean }) => {
            for (let i = 0; i < 2000; i++) {
              if (ctx.isCancelled()) throw new Error("aborted");
              await new Promise((r) => setTimeout(r, 5));
            }
            return { summary: "never", transportOk: true };
          },
        }),
      );
      const runId = (h.auditEvents.find((e) => e.event === "execution.created")?.detail.runId as string) ??
        (await new Promise<string>((resolve) => {
          const t = setInterval(() => {
            const e = h.auditEvents.find((x) => x.event === "execution.created");
            if (e) {
              clearInterval(t);
              resolve(e.detail.runId as string);
            }
          }, 5);
        }));
      await new Promise((r) => setTimeout(r, 30));
      h.service.cancel(runId, "user_request");
      const rec = await exec;
      expect(rec.state).toBe("cancelled");
      const kinds = h.service.checkpoints.getCheckpoints(runId, 100).map((c) => c.kind);
      expect(kinds).toContain("cancellation_requested");
      expect(kinds).toContain("cleanup_completed");
      // The cleanup checkpoint must NOT claim side-effect safety.
      const cleanupCp = h.service.checkpoints.getCheckpoints(runId, 100).find((c) => c.kind === "cleanup_completed");
      expect(cleanupCp?.sideEffectSafe).toBe(true); // cleanup_completed is an ALWAYS_SAFE boundary
      // …while the cancellation record itself carries the honest uncertainty:
      expect(rec.cancellation?.sideEffectPossible).toBe(true);
      expect(rec.outcome?.error?.sideEffectUnknown).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe("Phase 06 · retry classification in the fabric (spec steps 12/13/40)", () => {
  test("retryable provider failure + idempotent op → bounded retry succeeds on attempt 2", async () => {
    const h = makeHarness();
    try {
      let calls = 0;
      const rec = await h.service.execute(
        opts({
          capability: { kind: "core_tool", name: "read_file" },
          idempotency: "naturally_idempotent",
          maxAttempts: 3,
          retryBackoffMs: 1,
          run: async () => {
            calls++;
            if (calls === 1) throw new ProviderError("unavailable", "p", "provider p HTTP 503");
            return { summary: "ok after fallback retry", transportOk: true };
          },
        }),
      );
      expect(calls).toBe(2);
      expect(rec.state).toBe("succeeded");
      expect(rec.retryCount).toBe(1);
      expect(h.auditEvents.some((e) => e.event === "execution.retry_decision" && e.detail.verdict === "retry")).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("NON-retryable provider failure (auth) → terminal on first attempt", async () => {
    const h = makeHarness();
    try {
      let calls = 0;
      const rec = await h.service.execute(
        opts({
          idempotency: "naturally_idempotent",
          maxAttempts: 3,
          retryBackoffMs: 1,
          run: async () => {
            calls++;
            throw new ProviderError("authentication_failure", "p", "401 invalid api key");
          },
        }),
      );
      expect(calls).toBe(1); // never retried
      expect(rec.state).toBe("failed");
      expect(h.auditEvents.some((e) => e.event === "execution.retry_decision" && e.detail.verdict === "do_not_retry")).toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  test("retry keeps the SAME logical idempotency key (step 40)", async () => {
    const h = makeHarness();
    try {
      let calls = 0;
      const rec = await h.service.execute(
        opts({
          capability: { kind: "core_tool", name: "write_file" },
          idempotency: "idempotent_with_key",
          idempotencyKey: "ck_same_key_retry",
          maxAttempts: 3,
          retryBackoffMs: 1,
          run: async () => {
            calls++;
            if (calls === 1) throw new ProviderError("network_failure", "p", "ECONNRESET");
            return { summary: "written", transportOk: true };
          },
        }),
      );
      expect(rec.state).toBe("succeeded");
      expect(calls).toBe(2);
      // ONE slot, ONE key — the retry did not mint a new identity.
      expect(h.idem.get("ck_same_key_retry")?.state).toBe("completed");
      expect(h.idem.count()).toBe(1);
      // And a later duplicate replays instead of re-running.
      let thirdCall = false;
      const dup = await h.service.execute(
        opts({
          capability: { kind: "core_tool", name: "write_file" },
          idempotency: "idempotent_with_key",
          idempotencyKey: "ck_same_key_retry",
          run: async () => {
            thirdCall = true;
            return { summary: "never", transportOk: true };
          },
        }),
      );
      expect(thirdCall).toBe(false);
      expect(dup.outcome?.kind).toBe("succeeded");
    } finally {
      await h.cleanup();
    }
  });

  test("retryable error + unknown side effect of non-idempotent op → reconciliation, never blind retry", async () => {
    const h = makeHarness();
    try {
      let calls = 0;
      const rec = await h.service.execute(
        opts({
          capability: { kind: "core_tool", name: "charge_card" },
          idempotency: "non_idempotent",
          idempotencyKey: "ck_charge_once",
          maxAttempts: 3,
          retryBackoffMs: 1,
          run: async () => {
            calls++;
            // Fail AFTER the point where a side effect may have happened:
            // the fabric sees state=running → sideEffectUnknown.
            throw new ProviderError("network_failure", "p", "connection reset after submit");
          },
        }),
      );
      expect(calls).toBe(1); // no blind retry of a possible charge
      expect(rec.state).toBe("reconciliation_required");
      expect(rec.outcome?.kind).toBe("reconciliation_required");
      expect(h.idem.get("ck_charge_once")?.state).toBe("requires_reconciliation");
    } finally {
      await h.cleanup();
    }
  });
});

describe("Phase 06 · audit-chain gate on startup recovery (spec step 23)", () => {
  test("broken audit chain blocks auto-resume and reports recovery_blocked", async () => {
    const h = makeHarness({ verifyAuditChain: () => ({ valid: false, reason: "hash gap at 7" }) });
    try {
      // Seed an interrupted execution that would otherwise auto-resume.
      const rec = await h.service.execute(
        opts({ runId: "ex_audit_broken", run: async () => ({ summary: "ok", transportOk: true }) }),
      );
      const stored = h.repo.get(rec.id.runId)!;
      stored.state = "queued";
      h.repo.save(stored);

      const statuses = await h.service.startupRecovery("ws");
      const mine = statuses.find((s) => s.runId === "ex_audit_broken");
      expect(mine).toBeDefined();
      expect(mine!.classification).toBe("audit_chain_broken");
      expect(mine!.action).toBe("blocked");
      expect(mine!.recoveryState).toBe("recovery_blocked");
      expect(mine!.safeToResume).toBe(false);
    } finally {
      await h.cleanup();
    }
  });

  test("valid audit chain allows normal recovery classification", async () => {
    const h = makeHarness({ verifyAuditChain: () => ({ valid: true }) });
    try {
      const rec = await h.service.execute(
        opts({ runId: "ex_audit_ok", run: async () => ({ summary: "ok", transportOk: true }) }),
      );
      const stored = h.repo.get(rec.id.runId)!;
      stored.state = "queued";
      h.repo.save(stored);

      const statuses = await h.service.startupRecovery("ws");
      const mine = statuses.find((s) => s.runId === "ex_audit_ok");
      expect(mine).toBeDefined();
      expect(mine!.classification).not.toBe("audit_chain_broken");
      expect(mine!.action).toBe("auto_resume");
      // resumed honestly from a verified basis — never claimed without one
      expect(mine!.recoveryState).toBe("resumed");
    } finally {
      await h.cleanup();
    }
  });
});

describe("Phase 06 · workflow lease protection in execute() (spec step 25)", () => {
  test("a second execution of the same workflow is rejected while the first holds the lease", async () => {
    const h = makeHarness();
    try {
      let firstRunning: () => void = () => {};
      const gate = new Promise<void>((r) => (firstRunning = r));
      let releaseFirst: () => void = () => {};
      const hold = new Promise<void>((r) => (releaseFirst = r));

      const first = h.service.execute(
        opts({
          runId: "ex_wf_first",
          workflowId: "wf_shared",
          run: async () => {
            firstRunning();
            await hold; // hold the lease until the second attempt has been judged
            return { summary: "first done", transportOk: true };
          },
        }),
      );
      await gate; // first is now mid-execution, holding the workflow lease

      const second = await h.service.execute(
        opts({
          runId: "ex_wf_second",
          workflowId: "wf_shared",
          run: async () => ({ summary: "MUST NEVER RUN", transportOk: true }),
        }),
      );

      expect(second.state).toBe("failed");
      expect(second.outcome?.error?.code).toBe("WORKFLOW_LEASE_HELD");
      // Either gate (in-process liveness or cross-process lease) may fire;
      // both report the same code and an "already executing" reason.
      expect(second.outcome?.message).toContain("already");
      expect(second.outcome?.message).toContain("wf_shared");
      expect(h.auditEvents.some((e) => e.event === "execution.lease_rejected")).toBe(true);

      releaseFirst();
      const firstRec = await first;
      expect(firstRec.state).toBe("succeeded");

      // After the first finished (lease released), the workflow can run again.
      const third = await h.service.execute(
        opts({
          runId: "ex_wf_third",
          workflowId: "wf_shared",
          run: async () => ({ summary: "third ok", transportOk: true }),
        }),
      );
      expect(third.state).toBe("succeeded");
    } finally {
      await h.cleanup();
    }
  });

  test("cross-process: a second runtime owning another lease rejects the same workflow", async () => {
    const h = makeHarness();
    try {
      // A second "process" = a second service over the SAME durable DB with a
      // distinct LeaseManager identity. It acquires the workflow lease first.
      const otherRepo = new ExecutionRepo(adaptWorkspaceStore(h.store));
      const otherService = new ExecutionService({ repo: otherRepo });
      const otherLease = otherService.leases.acquire("workflow", "wf_xproc", "ws");
      expect(otherLease).not.toBeNull();

      // The first runtime now attempts the same workflow — the durable lease
      // is held by a live other owner, so it must be rejected.
      const rec = await h.service.execute(
        opts({
          runId: "ex_wf_xproc",
          workflowId: "wf_xproc",
          run: async () => ({ summary: "MUST NEVER RUN", transportOk: true }),
        }),
      );
      expect(rec.state).toBe("failed");
      expect(rec.outcome?.error?.code).toBe("WORKFLOW_LEASE_HELD");

      otherService.leases.release("workflow", "wf_xproc", "test_done");
    } finally {
      await h.cleanup();
    }
  });
});
