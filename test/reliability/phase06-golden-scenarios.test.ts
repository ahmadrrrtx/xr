/**
 * XR Phase 06 · Step 56 — GOLDEN RELIABILITY SCENARIOS.
 *
 * End-to-end scenarios executed through the REAL components (fabric,
 * checkpoints, leases, idempotency slots, taxonomy, recovery). The hard-crash
 * variants of Scenarios E/F live in phase06-crash-recovery.test.ts (real
 * SIGKILL); here E/F run the same decision paths via simulated process death.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { IdempotencyStore } from "../../src/state/idempotency.ts";
import { ExecutionRepo, adaptWorkspaceStore } from "../../src/execution/repository.ts";
import { ExecutionService } from "../../src/execution/service.ts";
import { ProviderError } from "../../src/providers/errors.ts";
import type { ExecuteOptions } from "../../src/execution/types.ts";
import { rmrf } from "./helpers.ts";

async function withHarness(fn: (h: {
  store: WorkspaceStore;
  repo: ExecutionRepo;
  idem: IdempotencyStore;
  service: ExecutionService;
  auditEvents: Array<{ event: string; detail: Record<string, unknown> }>;
}) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "xr-p06-golden-"));
  const store = new WorkspaceStore("golden", join(dir, "xr.db"));
  const repo = new ExecutionRepo(adaptWorkspaceStore(store));
  const idem = new IdempotencyStore(store);
  const auditEvents: Array<{ event: string; detail: Record<string, unknown> }> = [];
  const service = new ExecutionService({
    repo,
    idempotency: idem,
    audit: (event, detail) => auditEvents.push({ event, detail }),
  });
  try {
    await fn({ store, repo, idem, service, auditEvents });
  } finally {
    try {
      store.close();
    } catch {
      /* noop */
    }
    await rmrf(dir);
  }
}

function opts(overrides: Partial<ExecuteOptions> = {}): ExecuteOptions {
  return {
    workspaceId: "ws-golden",
    actor: { kind: "user", source: "cli" },
    intent: { summary: "golden", origin: { kind: "user", source: "cli" } },
    capability: { kind: "core_tool", name: "read_file" },
    placement: { kind: "in_process" },
    idempotency: "naturally_idempotent",
    inputSummary: "{}",
    ...overrides,
  } as ExecuteOptions;
}

describe("Phase 06 · golden reliability scenarios (spec step 56)", () => {
  test("SCENARIO A — normal task: full lifecycle, completed, audit valid", async () => {
    await withHarness(async (h) => {
      const rec = await h.service.execute(
        opts({
          runId: "ex_golden_A",
          capability: { kind: "core_tool", name: "write_file" },
          idempotency: "idempotent_with_key",
          idempotencyKey: "ck_golden_A",
          run: async () => ({ summary: "work done", transportOk: true }),
        }),
      );
      expect(rec.state).toBe("succeeded");
      expect(rec.outcome?.kind).toBe("succeeded");
      // full honest lifecycle audited
      expect(h.auditEvents.some((e) => e.event === "execution.created")).toBe(true);
      expect(h.auditEvents.some((e) => e.event === "execution.outcome" && e.detail.state === "succeeded")).toBe(true);
      // checkpoints at the boundaries
      const kinds = h.service.checkpoints.getCheckpoints("ex_golden_A", 100).map((c) => c.kind);
      expect(kinds).toContain("task_accepted");
      expect(kinds).toContain("policy_admitted");
      expect(kinds).toContain("tool_call_completed");
      // audit chain intact
      expect(h.store.verifyChain().valid).toBe(true);
    });
  });

  test("SCENARIO B — provider failure: bounded recovery via retry/fallback continues the task", async () => {
    await withHarness(async (h) => {
      let calls = 0;
      const rec = await h.service.execute(
        opts({
          runId: "ex_golden_B",
          maxAttempts: 3,
          retryBackoffMs: 1,
          run: async () => {
            calls++;
            // primary provider fails transiently (503); bounded recovery
            // retries the same safe operation — no unnecessary failure.
            if (calls === 1) throw new ProviderError("unavailable", "primary", "HTTP 503");
            return { summary: "continued via bounded recovery", transportOk: true };
          },
        }),
      );
      expect(rec.state).toBe("succeeded");
      expect(calls).toBe(2); // bounded: exactly one recovery attempt
      expect(rec.retryCount).toBe(1);
    });
  });

  test("SCENARIO C — tool failure: classify → retry only when safe → continue", async () => {
    await withHarness(async (h) => {
      // C1 — transient failure of a SAFE (idempotent) tool → retried, continues.
      let calls = 0;
      const ok = await h.service.execute(
        opts({
          runId: "ex_golden_C1",
          maxAttempts: 3,
          retryBackoffMs: 1,
          run: async () => {
            calls++;
            if (calls === 1) throw Object.assign(new Error("locked"), { code: "SQLITE_BUSY" });
            return { summary: "tool recovered", transportOk: true };
          },
        }),
      );
      expect(ok.state).toBe("succeeded");
      expect(calls).toBe(2);

      // C2 — permanent (non-retryable) failure → classified, terminal, honest.
      let calls2 = 0;
      const bad = await h.service.execute(
        opts({
          runId: "ex_golden_C2",
          maxAttempts: 3,
          retryBackoffMs: 1,
          run: async () => {
            calls2++;
            throw Object.assign(new Error("denied"), { code: "PATH_ESCAPE" });
          },
        }),
      );
      expect(bad.state).toBe("failed");
      expect(calls2).toBe(1); // security failures are never retried
    });
  });

  test("SCENARIO D — cancellation: request → cleanup → checkpoint → cancelled", async () => {
    await withHarness(async (h) => {
      const exec = h.service.execute(
        opts({
          runId: "ex_golden_D",
          capability: { kind: "core_tool", name: "write_file" },
          idempotency: "idempotent_with_key",
          idempotencyKey: "ck_golden_D",
          run: async (ctx: { isCancelled: () => boolean }) => {
            for (let i = 0; i < 4000; i++) {
              if (ctx.isCancelled()) throw new Error("aborted by user");
              await new Promise((r) => setTimeout(r, 5));
            }
            return { summary: "never", transportOk: true };
          },
        }),
      );
      await new Promise((r) => setTimeout(r, 40)); // let it reach running
      h.service.cancel("ex_golden_D", "user_request");
      const rec = await exec;

      expect(rec.state).toBe("cancelled");
      expect(rec.outcome?.kind).toBe("cancelled");
      expect(rec.cancellation?.requested).toBe(true);
      expect(rec.cancellation?.acknowledged).toBe(true);
      // durable + audited cancellation, cleanup checkpoint written
      const durable = h.service.recovery.getDurableCancellation("execution", "ex_golden_D");
      expect(durable).not.toBeNull();
      const kinds = h.service.checkpoints.getCheckpoints("ex_golden_D", 100).map((c) => c.kind);
      expect(kinds).toContain("cancellation_requested");
      expect(kinds).toContain("cleanup_completed");
      expect(h.auditEvents.some((e) => e.event === "execution.outcome" && e.detail.outcome === "cancelled")).toBe(true);
      // honesty: cancellation is NOT proof the side effect was avoided
      expect(rec.outcome?.error?.sideEffectUnknown).toBe(true);
    });
  });

  test("SCENARIO E — crash (simulated): interrupted → discovery → honest classification", async () => {
    await withHarness(async (h) => {
      // A non-idempotent external write, run to completion, then durable state
      // rewound to what a kill -9 mid-action would have left: state running,
      // checkpoint at a non-safe boundary, no terminal outcome.
      const rec = await h.service.execute(
        opts({
          runId: "ex_golden_E",
          capability: { kind: "core_tool", name: "external_write" },
          idempotency: "non_idempotent",
          idempotencyKey: "ck_golden_E",
          run: async () => ({ summary: "x", transportOk: true }),
        }),
      );
      const stored = h.repo.get(rec.id.runId)!;
      stored.state = "running";
      stored.endedAt = undefined;
      h.repo.save(stored);

      const statuses = await h.service.startupRecovery("ws-golden");
      const mine = statuses.find((s) => s.runId === "ex_golden_E");
      expect(mine).toBeDefined(); // interrupted execution discovered
      // running + unsafe checkpoint boundary + non-idempotent action →
      // honest "unknown side effect" needing approval, never a false
      // "completed" and never a silent auto-resume.
      expect(mine!.classification).toBe("unknown_side_effect");
      expect(mine!.action).toBe("requires_approval");
      expect(mine!.recoveryState).toBe("startup_recovery_pending");
      expect(h.repo.get("ex_golden_E")!.state).not.toBe("succeeded");
    });
  });

  test("SCENARIO F — duplicate side effect: write → crash → resume → exactly once", async () => {
    await withHarness(async (h) => {
      const key = "ck_golden_F";
      let effectCount = 0;

      // Execution A: claim slot, perform the effect, then "die" before
      // settlement (the slot stays pending — exactly what SIGKILL leaves).
      const claim = h.idem.claim(key, "core_tool", "ex_golden_F");
      expect(claim.proceed).toBe(true);
      effectCount += 1; // the external write
      // (process dies here — no complete(), no record finalize)

      // Execution B resumes with the SAME key (non-idempotent external write).
      const rec = await h.service.execute(
        opts({
          runId: "ex_golden_F2",
          capability: { kind: "core_tool", name: "external_write" },
          idempotency: "non_idempotent",
          idempotencyKey: key,
          run: async () => {
            effectCount += 1; // MUST NOT happen
            return { summary: "dup", transportOk: true };
          },
        }),
      );
      expect(effectCount).toBe(1); // side effect occurs exactly once
      expect(rec.outcome?.error?.code).toBe("RECONCILIATION_REQUIRED");
      expect(h.idem.get(key)?.state).toBe("requires_reconciliation");
      expect(h.auditEvents.some((e) => e.event === "execution.reconciliation_required")).toBe(true);
    });
  });

  test("SCENARIO G — corrupted state: checkpoint/audit corruption → BLOCKED, never resumed", async () => {
    await withHarness(async (h) => {
      // G1 — corrupted checkpoint
      const rec = await h.service.execute(
        opts({
          runId: "ex_golden_G",
          capability: { kind: "core_tool", name: "write_file" },
          idempotency: "non_idempotent",
          idempotencyKey: "ck_golden_G",
          run: async () => ({ summary: "x", transportOk: true }),
        }),
      );
      // rewind to interrupted + corrupt the checkpoint kind
      const stored = h.repo.get(rec.id.runId)!;
      stored.state = "running";
      stored.endedAt = undefined;
      h.repo.save(stored);
      (h.repo.rawDb as { prepare: (s: string) => { run: (...p: unknown[]) => unknown } })
        .prepare(`UPDATE execution_checkpoints SET kind = 'corrupted_kind' WHERE run_id = ?`)
        .run(rec.id.runId);
      const statuses = await h.service.startupRecovery("ws-golden");
      const mine = statuses.find((s) => s.runId === "ex_golden_G");
      expect(mine).toBeDefined();
      expect(mine!.action).toBe("blocked");
      expect(mine!.classification).toBe("checkpoint_invalid");
      expect(mine!.recoveryState).toBe("recovery_blocked");
    });

    // G2 — broken audit chain blocks recovery entirely
    await withHarness(async (h) => {
      const guarded = new ExecutionService({
        repo: new ExecutionRepo(adaptWorkspaceStore(h.store)),
        idempotency: h.idem,
        verifyAuditChain: () => ({ valid: false, reason: "hash mismatch" }),
      });
      const rec = await guarded.execute(
        opts({ runId: "ex_golden_G2", run: async () => ({ summary: "x", transportOk: true }) }),
      );
      const stored = h.repo.get(rec.id.runId)!;
      stored.state = "queued";
      h.repo.save(stored);
      const statuses = await guarded.startupRecovery("ws-golden");
      const mine = statuses.find((s) => s.runId === "ex_golden_G2");
      expect(mine).toBeDefined();
      expect(mine!.classification).toBe("audit_chain_broken");
      expect(mine!.action).toBe("blocked");
    });
  });
});
