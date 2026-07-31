/**
 * Phase 1 · T5 — Claim-first idempotency.
 *
 * Effective exactly-once for external effects:
 *   - claim BEFORE the effect (INSERT-then-execute);
 *   - completed slots replay (dedup) — a duplicate delivery never re-runs;
 *   - a crashed-pending non-idempotent effect is NEVER re-run
 *     (at-most-once + reconciliation);
 *   - the ExecutionService wires the primitive around its adapter boundary.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { IdempotencyStore } from "../../src/state/idempotency.ts";
import { ExecutionRepo, adaptWorkspaceStore } from "../../src/execution/repository.ts";
import { ExecutionService } from "../../src/execution/service.ts";
import type { ExecuteOptions } from "../../src/execution/types.ts";
import { rmrf } from "./helpers.ts";

function freshStore(): { store: WorkspaceStore; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "xr-idem-"));
  const store = new WorkspaceStore("idem", join(dir, "xr.db"));
  return {
    store,
    dir,
    cleanup: () => {
      store.close();
      rmrf(dir);
    },
  };
}

describe("Phase 1 · claim-first idempotency primitive", () => {
  test("claim-then-complete prevents duplicate effects on duplicate delivery", () => {
    const { store, cleanup } = freshStore();
    try {
      const idem = new IdempotencyStore(store);
      let effectCount = 0;

      const run = (key: string) => {
        const claim = idem.claim(key, "external_effect");
        if (!claim.proceed) return { replayed: true, cached: claim.cachedResult };
        effectCount += 1; // the external effect (non-idempotent API call)
        idem.complete(key, JSON.stringify({ ok: true }));
        return { replayed: false };
      };

      run("k1"); // first delivery → effect runs
      run("k1"); // duplicate delivery → replay, NO second effect
      run("k1");
      expect(effectCount).toBe(1);
      expect(idem.get("k1")?.state).toBe("completed");
    } finally {
      cleanup();
    }
  });

  test("interrupted non-idempotent effect is never re-run (at-most-once + reconciliation)", () => {
    const { store, cleanup } = freshStore();
    try {
      const idem = new IdempotencyStore(store);
      let effectCount = 0;

      // Run 1: claim + effect, then "crash" before complete.
      const c1 = idem.claim("nid-1", "external_effect");
      expect(c1.proceed).toBe(true);
      effectCount += 1;

      // Run 2 (after restart): slot is pending → non-idempotent → refuse.
      const c2 = idem.claim("nid-1", "external_effect");
      expect(c2.proceed).toBe(false);
      expect(c2.crashedPending).toBe(true);
      idem.requireReconciliation("nid-1", "interrupted; non-idempotent");

      // Run 3: now requires_reconciliation → refuse again, no effect.
      const c3 = idem.claim("nid-1", "external_effect");
      expect(c3.proceed).toBe(false);
      expect(c3.requiresReconciliation).toBe(true);

      expect(effectCount).toBe(1);
      expect(idem.get("nid-1")?.state).toBe("requires_reconciliation");
    } finally {
      cleanup();
    }
  });

  test("failed slot is retryable", () => {
    const { store, cleanup } = freshStore();
    try {
      const idem = new IdempotencyStore(store);
      idem.claim("f1", "external_effect");
      idem.fail("f1", "boom");
      const retry = idem.claim("f1", "external_effect");
      expect(retry.proceed).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("idempotent-with-key crashed-pending slot may be re-run safely", () => {
    const { store, cleanup } = freshStore();
    try {
      const idem = new IdempotencyStore(store);
      idem.claim("ik-1", "external_effect");
      // crashed pending; the caller (execution fabric) knows it is idempotent_with_key → re-run allowed
      const retry = idem.claim("ik-1", "external_effect");
      expect(retry.crashedPending).toBe(true);
      // The fabric's contract: idempotent_with_key proceeds and completes again.
      idem.complete("ik-1", "ok");
      expect(idem.get("ik-1")?.state).toBe("completed");
    } finally {
      cleanup();
    }
  });
});

describe("Phase 1 · execution-fabric claim-first integration", () => {
  function makeService() {
    const { store, cleanup } = freshStore();
    const repo = new ExecutionRepo(adaptWorkspaceStore(store));
    const idem = new IdempotencyStore(store);
    const service = new ExecutionService({ repo, idempotency: idem });
    return { store, repo, idem, service, cleanup };
  }

  function opts(overrides: Partial<ExecuteOptions> = {}): ExecuteOptions {
    return {
      workspaceId: "w",
      capability: { kind: "core_tool", name: "pay" },
      actor: { kind: "user", source: "cli" },
      intent: { summary: "pay", origin: { kind: "user", source: "cli" } },
      idempotency: "non_idempotent",
      idempotencyKey: "pay-1",
      inputSummary: "charge card",
      ...overrides,
    } as ExecuteOptions;
  }

  test("duplicate delivery with same key executes the effect exactly once", async () => {
    const { service, cleanup } = makeService();
    try {
      let effectCount = 0;
      const run = () =>
        service.execute(
          opts({
            run: async () => {
              effectCount += 1;
              return { summary: `charged ${effectCount}`, transportOk: true };
            },
          }),
        );
      const a = await run();
      const b = await run(); // duplicate delivery
      expect(effectCount).toBe(1);
      expect(a.outcome?.kind).toBe("succeeded");
      expect(b.outcome?.kind).toBe("succeeded");
      expect(b.observation?.summary ?? "").toContain("duplicate");
      void cleanup;
    } finally {
      cleanup();
    }
  });

  test("simulated crash between effect and completion → non-idempotent retry refuses re-run", async () => {
    const { store, idem, cleanup } = makeService();
    try {
      const key = "crash-pay";
      let effectCount = 0;

      // Simulate the crash: claim directly (as the fabric does), run effect,
      // and DO NOT complete.
      const claim = idem.claim(key, "core_tool");
      expect(claim.proceed).toBe(true);
      effectCount += 1;

      // Retry through the fabric: must refuse, mark reconciliation, no effect.
      const repo2 = new ExecutionRepo(adaptWorkspaceStore(store));
      const service2 = new ExecutionService({ repo: repo2, idempotency: idem });
      const r = await service2.execute(
        opts({
          idempotencyKey: key,
          run: async () => {
            effectCount += 1;
            return { summary: "charged", transportOk: true };
          },
        }),
      );
      expect(effectCount).toBe(1); // not re-run
      expect(r.outcome?.kind).toBe("failed");
      expect(r.outcome?.error?.code).toBe("RECONCILIATION_REQUIRED");
      expect(idem.get(key)?.state).toBe("requires_reconciliation");
    } finally {
      cleanup();
    }
  });
});
