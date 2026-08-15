/**
 * XR Phase 06 · Steps 20/21/26/27/52/53 — CRASH RECOVERY, honest and real.
 *
 * Nothing here is simulated with a flag: the crash cases spawn a REAL child
 * process that runs the full ExecutionService against a REAL SQLite workspace
 * DB and is SIGKILLed at a deterministic point (before effect / after effect
 * / never). The parent then RESTARTS against the same database — discovery,
 * classification, audit-chain verification and duplicate-side-effect
 * prevention are asserted on the durable state that actually survived.
 */
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { IdempotencyStore } from "../../src/state/idempotency.ts";
import { ExecutionRepo, adaptWorkspaceStore } from "../../src/execution/repository.ts";
import { ExecutionService } from "../../src/execution/service.ts";
import type { ExecuteOptions } from "../../src/execution/types.ts";
import { rmrf } from "./helpers.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD = join(__dirname, "phase06-crash-scenarios", "effect-crash-child.ts");

function runChild(env: Record<string, string>): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", CHILD], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}`,
        ...env,
      },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    child.on("close", (code) => resolve({ code, stdout: out }));
  });
}

/**
 * Load-flake guard for CI: under full-suite parallel load a child can fail to
 * even START (bun cold compile racing dozens of workers). That is an infra
 * startup failure, NOT a crash scenario — retry once. A child that reached its
 * crash point is never retried: its outcome is the thing under test.
 */
async function runChildUntilCrash(env: Record<string, string>): Promise<{ code: number | null; stdout: string }> {
  let r = await runChild(env);
  if (r.code !== null && r.code !== 0 && !r.stdout.includes("[crash-point]")) {
    r = await runChild(env);
  }
  return r;
}

/**
 * Platform-honest crash assertion (Phase 06 CI fix).
 *
 * The PORTABLE truth that the child died at its deterministic crash point is
 * its stdout: it printed `[crash-point]` (emitted after the side effect,
 * immediately before the self-kill) and NEVER printed `[done]` (only emitted
 * by a clean completion). That semantic holds on every OS.
 *
 * The exit-code shape, however, is OS-specific: POSIX surfaces SIGKILL as a
 * signal death (code === null), while Windows implements it as
 * TerminateProcess and Bun reports a non-zero exit code — asserting null
 * there is a POSIX assumption, not a reliability property. Strictness stays
 * where the semantics are guaranteed; honesty stays everywhere.
 */
function expectCrashedAtCrashPoint(r: { code: number | null; stdout: string }): void {
  expect(r.stdout).toContain("[crash-point]");
  expect(r.stdout).not.toContain("[done]");
  if (process.platform !== "win32") {
    expect(r.code).toBeNull(); // POSIX: killed by signal, no exit code
  } else {
    expect(r.code).not.toBe(0); // Windows: TerminateProcess → abnormal exit, never clean
  }
}

function openWorkspace(dbPath: string): {
  store: WorkspaceStore;
  repo: ExecutionRepo;
  idem: IdempotencyStore;
  service: ExecutionService;
} {
  const store = new WorkspaceStore("crash-parent", dbPath);
  const repo = new ExecutionRepo(adaptWorkspaceStore(store));
  const idem = new IdempotencyStore(store);
  const service = new ExecutionService({ repo, idempotency: idem });
  return { store, repo, idem, service };
}

function effectCount(effectFile: string): number {
  if (!existsSync(effectFile)) return 0;
  return readFileSync(effectFile, "utf8").split("\n").filter((l) => l.length > 0).length;
}

describe("Phase 06 · real process crash recovery (spec steps 20/21/26/52)", () => {
  test("SCENARIO F — crash AFTER non-idempotent effect: side effect occurs exactly once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-p06-crashA-"));
    const dbPath = join(dir, "xr.db");
    const effectFile = join(dir, "effects.log");
    try {
      // 1. Child executes, performs the side effect, dies before settlement.
      const r = await runChildUntilCrash({
        XR_DB: dbPath,
        XR_EFFECT_FILE: effectFile,
        XR_EFFECT_KIND: "append",
        XR_CRASH: "after_effect",
        XR_KEY: "ck_crash_A",
        XR_IDEMPOTENCY: "non_idempotent",
        XR_WORKSPACE: "ws-crash",
      });
      expectCrashedAtCrashPoint(r); // died at the deterministic crash point
      expect(effectCount(effectFile)).toBe(1); // the effect happened once

      // 2. Restart against the SAME database.
      const { store, service } = openWorkspace(dbPath);
      try {
        // Audit chain must be intact after the crash (step 47).
        expect(store.verifyChain().valid).toBe(true);

        // 3. Startup recovery discovers the interrupted execution.
        const statuses = await service.startupRecovery("ws-crash");
        expect(statuses.length).toBeGreaterThanOrEqual(1);
        const mine = statuses.find((s) => s.runId === "ex_crash_child");
        expect(mine).toBeDefined();
        // Non-idempotent effect may have happened → honest "unknown side
        // effect", NOT auto-resumed, NOT claimed completed.
        expect(mine!.classification).toBe("unknown_side_effect");
        expect(mine!.action).toBe("requires_approval");
        expect(mine!.safeToResume).toBe(false);

        // 4. Execution B resumes with the SAME idempotency key.
        let effectRan = false;
        const retry = await service.execute({
          workspaceId: "ws-crash",
          runId: "ex_crash_retry",
          actor: { kind: "user", source: "cli" },
          intent: { summary: "retry after crash", origin: { kind: "user", source: "cli" } },
          capability: { kind: "core_tool", name: "external_append" },
          placement: { kind: "in_process" },
          idempotency: "non_idempotent",
          idempotencyKey: "ck_crash_A",
          inputSummary: "retry",
          run: async () => {
            effectRan = true;
            return { summary: "must never run", transportOk: true };
          },
        } as ExecuteOptions);

        // THE core Phase 06 assertion: NO duplicate side effect.
        expect(effectRan).toBe(false);
        expect(effectCount(effectFile)).toBe(1);
        expect(retry.outcome?.error?.code).toBe("RECONCILIATION_REQUIRED");
        expect(retry.state).toBe("failed");
      } finally {
        store.close();
      }
    } finally {
      await rmrf(dir);
    }
  }, 60_000);

  test("crash BEFORE non-idempotent effect: never re-run blindly either (at-most-once)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-p06-crashB-"));
    const dbPath = join(dir, "xr.db");
    const effectFile = join(dir, "effects.log");
    try {
      const r = await runChildUntilCrash({
        XR_DB: dbPath,
        XR_EFFECT_FILE: effectFile,
        XR_EFFECT_KIND: "append",
        XR_CRASH: "before_effect",
        XR_KEY: "ck_crash_B",
        XR_IDEMPOTENCY: "non_idempotent",
        XR_WORKSPACE: "ws-crash",
      });
      expectCrashedAtCrashPoint(r);
      expect(effectCount(effectFile)).toBe(0); // effect never ran

      const { store, service } = openWorkspace(dbPath);
      try {
        expect(store.verifyChain().valid).toBe(true);
        const statuses = await service.startupRecovery("ws-crash");
        expect(statuses.some((s) => s.runId === "ex_crash_child")).toBe(true);

        // The slot was claimed but the process died — XR cannot PROVE the
        // effect did not happen, so a non-idempotent re-run stays refused.
        let effectRan = false;
        const retry = await service.execute({
          workspaceId: "ws-crash",
          runId: "ex_crash_retry_b",
          actor: { kind: "user", source: "cli" },
          intent: { summary: "retry", origin: { kind: "user", source: "cli" } },
          capability: { kind: "core_tool", name: "external_append" },
          placement: { kind: "in_process" },
          idempotency: "non_idempotent",
          idempotencyKey: "ck_crash_B",
          inputSummary: "retry",
          run: async () => {
            effectRan = true;
            return { summary: "nope", transportOk: true };
          },
        } as ExecuteOptions);
        expect(effectRan).toBe(false);
        expect(effectCount(effectFile)).toBe(0);
        expect(retry.outcome?.error?.code).toBe("RECONCILIATION_REQUIRED");
      } finally {
        store.close();
      }
    } finally {
      await rmrf(dir);
    }
  }, 60_000);

  test("crash AFTER keyed-idempotent effect: same-key retry converges, no divergence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-p06-crashC-"));
    const dbPath = join(dir, "xr.db");
    const effectFile = join(dir, "target.txt");
    try {
      const r = await runChildUntilCrash({
        XR_DB: dbPath,
        XR_EFFECT_FILE: effectFile,
        XR_EFFECT_KIND: "write",
        XR_CRASH: "after_effect",
        XR_KEY: "ck_crash_C",
        XR_IDEMPOTENCY: "idempotent_with_key",
        XR_WORKSPACE: "ws-crash",
      });
      expectCrashedAtCrashPoint(r);
      expect(readFileSync(effectFile, "utf8")).toBe("convergent-content-v1");

      const { store, service, idem } = openWorkspace(dbPath);
      try {
        expect(store.verifyChain().valid).toBe(true);
        await service.startupRecovery("ws-crash");

        // Keyed-idempotent: retrying with the SAME key is safe and converges.
        const retry = await service.execute({
          workspaceId: "ws-crash",
          runId: "ex_crash_retry_c",
          actor: { kind: "user", source: "cli" },
          intent: { summary: "retry", origin: { kind: "user", source: "cli" } },
          capability: { kind: "core_tool", name: "write_file" },
          placement: { kind: "in_process" },
          idempotency: "idempotent_with_key",
          idempotencyKey: "ck_crash_C",
          inputSummary: "retry",
          run: async () => {
            // Same logical operation, same key: re-writing converges.
            const { writeFileSync } = await import("node:fs");
            writeFileSync(effectFile, "convergent-content-v1");
            return { summary: "written", transportOk: true };
          },
        } as ExecuteOptions);
        expect(retry.outcome?.kind).toBe("succeeded");
        expect(readFileSync(effectFile, "utf8")).toBe("convergent-content-v1");
        // The slot is now settled durably — later duplicates replay, never re-run.
        expect(idem.get("ck_crash_C")?.state).toBe("completed");
      } finally {
        store.close();
      }
    } finally {
      await rmrf(dir);
    }
  }, 60_000);

  test("control: no crash → completes, and a later duplicate replays without effect", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-p06-crashD-"));
    const dbPath = join(dir, "xr.db");
    const effectFile = join(dir, "effects.log");
    try {
      const r = await runChildUntilCrash({
        XR_DB: dbPath,
        XR_EFFECT_FILE: effectFile,
        XR_EFFECT_KIND: "append",
        XR_CRASH: "none",
        XR_KEY: "ck_crash_D",
        XR_IDEMPOTENCY: "non_idempotent",
        XR_WORKSPACE: "ws-crash",
      });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("[done] state=succeeded");
      expect(effectCount(effectFile)).toBe(1);

      const { store, service } = openWorkspace(dbPath);
      try {
        let effectRan = false;
        const dup = await service.execute({
          workspaceId: "ws-crash",
          runId: "ex_crash_dup",
          actor: { kind: "user", source: "cli" },
          intent: { summary: "dup", origin: { kind: "user", source: "cli" } },
          capability: { kind: "core_tool", name: "external_append" },
          placement: { kind: "in_process" },
          idempotency: "non_idempotent",
          idempotencyKey: "ck_crash_D",
          inputSummary: "dup",
          run: async () => {
            effectRan = true;
            return { summary: "dup", transportOk: true };
          },
        } as ExecuteOptions);
        expect(effectRan).toBe(false);
        expect(effectCount(effectFile)).toBe(1); // exactly once
        expect(dup.outcome?.kind).toBe("succeeded"); // replayed success
        expect(dup.duplicateOf).toBe("ex_crash_child");
      } finally {
        store.close();
      }
    } finally {
      await rmrf(dir);
    }
  }, 60_000);
});

describe("Phase 06 · recovery discovery performance (spec step 53)", () => {
  test("discovery + classification of many interrupted executions stays under 5s", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-p06-perf-"));
    const dbPath = join(dir, "xr.db");
    try {
      const { store, repo, service } = openWorkspace(dbPath);
      try {
        // Seed 40 interrupted executions with checkpoints.
        for (let i = 0; i < 40; i++) {
          const rec = await service.execute({
            workspaceId: "ws-perf",
            runId: `ex_perf_${i}`,
            actor: { kind: "user", source: "cli" },
            intent: { summary: `task ${i}`, origin: { kind: "user", source: "cli" } },
            capability: { kind: "core_tool", name: "read_file" },
            placement: { kind: "in_process" },
            idempotency: "naturally_idempotent",
            inputSummary: "{}",
            run: async () => ({ summary: "ok", transportOk: true }),
          } as ExecuteOptions);
          // Simulate a crash: force the durable record back to "running"
          // (what a kill -9 mid-action would have left behind).
          const stored = repo.get(rec.id.runId)!;
          stored.state = "running";
          stored.endedAt = undefined;
          repo.save(stored);
        }

        const started = Date.now();
        const statuses = await service.startupRecovery("ws-perf");
        const elapsed = Date.now() - started;

        expect(statuses.length).toBe(40);
        expect(elapsed).toBeLessThan(5000); // spec budget: < 5 s
        // The measured RTO figure is persisted for recovery.status.get.
        const recorded = service.checkpoints.getMaintenanceMeta("startup_recovery_last_duration_ms");
        expect(Number.parseInt(recorded!, 10)).toBeGreaterThanOrEqual(0);
      } finally {
        store.close();
      }
    } finally {
      await rmrf(dir);
    }
  }, 30_000);
});
