/**
 * XR — Execution cancellation honesty (S-2 launch pass).
 *
 * The execution fabric supports cooperative cancellation (`service.cancel`)
 * and a bail-out watchdog that stamps an honest `cancelled` outcome when the
 * underlying action cannot be interrupted (JS has no universal forced
 * cancellation). Before this file neither path was pinned.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { ExecutionRepo, adaptWorkspaceStore, type ExecutionDb } from "../../src/execution/repository.ts";
import { ExecutionService } from "../../src/execution/service.ts";
import { IN_PROCESS_PLACEMENT, okObservation } from "../../src/execution/adapters/common.ts";
import type { ExecutionRecord } from "../../src/execution/types.ts";

let dir: string;
let raw: Database;
let db: ExecutionDb;
let service: ExecutionService;
let auditEvents: Array<{ event: string; detail: Record<string, unknown> }>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xr-exec-cancel-"));
  raw = new Database(join(dir, "test.db"), { create: true });
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db = adaptWorkspaceStore({
    exec: (s: string) => raw.exec(s),
    prepare: (s: string) => raw.prepare(s),
  });
  auditEvents = [];
  service = new ExecutionService({
    repo: new ExecutionRepo(db),
    audit: (event, detail) => auditEvents.push({ event, detail }),
  });
});

afterEach(() => {
  try { raw.close(); } catch { /* already closed */ }
  // Windows (hosted CI): closing a WAL-mode bun:sqlite handle does not make
  // the directory removable synchronously — the freshly-written WAL is still
  // briefly locked (fsync completion + Defender/indexer peeking), and a plain
  // rmSync fails with EBUSY. Observed on windows-latest: three ×
  // "error: EBUSY: resource busy or locked" from THIS line (PR #45 check-run
  // 93173409316 annotations). Node's rmSync retries EBUSY/EPERM internally —
  // same contract as test/helpers/suite-tmp.ts (R-8).
  //
  // The retries were necessary but NOT sufficient. When they are exhausted
  // rmSync still THROWS, and a throwing afterEach marks the test `(fail)` even
  // though every assertion in it passed — which is exactly what the Windows
  // lane reported: the three `execution cancellation` tests failed with no
  // assertion diff, on main as well as on PRs (main@3308aff job 93181649605
  // and PR #48 job 94138640579 carry an identical annotation list).
  //
  // Temp-directory cleanup is HYGIENE, not an assertion. It must never decide
  // whether the behaviour under test is correct. The suite's own R-8 root
  // sweep (test/helpers/suite-tmp.ts) reclaims anything left behind on the
  // next run, so swallowing a residual EBUSY here loses nothing real.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  } catch (e) {
    // Surfaced, never fatal: a locked temp dir is an OS artifact, not a defect
    // in cancellation semantics.
    console.warn(`[cleanup] could not remove ${dir}: ${(e as Error).message}`);
  }
});

function baseOpts(overrides: Record<string, unknown> = {}): Parameters<ExecutionService["execute"]>[0] {
  return {
    workspaceId: "ws",
    actor: { kind: "user", source: "cli" },
    intent: { summary: "cancellable task", origin: { kind: "user", source: "cli" } },
    capability: { kind: "core_tool", name: "read_file" },
    placement: IN_PROCESS_PLACEMENT,
    idempotency: "naturally_idempotent",
    inputSummary: "{}",
    ...overrides,
  } as unknown as Parameters<ExecutionService["execute"]>[0];
}

/** Wait until execute() has created the record (runId is first visible via audit). */
async function waitForRunId(): Promise<string> {
  for (let i = 0; i < 400; i++) {
    const evt = auditEvents.find((e) => e.event === "execution.created");
    if (evt) return evt.detail.runId as string;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("execution.created never audited — execute() did not start");
}

describe("execution cancellation", () => {
  test("cooperative cancel via ctx.isCancelled() → cancel dominates the thrown error", async () => {
    let entered = false;
    const exec: Promise<ExecutionRecord> = service.execute(
      baseOpts({
        run: async (ctx: { isCancelled: () => boolean }) => {
          entered = true;
          for (let i = 0; i < 2000; i++) {
            if (ctx.isCancelled()) throw new Error("aborted by user");
            await new Promise((r) => setTimeout(r, 5));
          }
          return okObservation("finished despite cancel — must never be reported");
        },
      }),
    );
    while (!entered) await new Promise((r) => setTimeout(r, 5));
    const runId = await waitForRunId();
    service.cancel(runId, "user_request");

    const rec = await exec;
    // Contract: once the cancel flag is set, the outcome is 'cancelled' — the
    // flag dominates any error the cooperative action throws on its way out.
    expect(rec.state).toBe("cancelled");
    expect(rec.outcome!.kind).toBe("cancelled");
    expect(rec.cancellation?.requested).toBe(true);
    expect(rec.retryCount ?? 0).toBe(0); // never retried
    expect(auditEvents.some((e) => e.event === "execution.outcome")).toBe(true);
  });

  test("non-cooperative action + cancel → watchdog stamps honest 'cancelled'", async () => {
    const exec: Promise<ExecutionRecord> = service.execute(
      baseOpts({
        run: async () => {
          // Ignores ctx completely — like a blocking native call.
          await new Promise((r) => setTimeout(r, 500));
          return okObservation("late result that must NOT be reported as success");
        },
      }),
    );
    const runId = await waitForRunId();
    // Give the action a moment to be mid-flight, then cancel.
    await new Promise((r) => setTimeout(r, 25));
    service.cancel(runId, "user_request");

    const rec = await exec;
    expect(rec.state).toBe("cancelled");
    expect(rec.outcome!.kind).toBe("cancelled");
    expect(rec.cancellation?.requested).toBe(true);
    expect(rec.cancellation?.acknowledged).toBe(true);
    // Mid-action cancellation cannot prove the side effect did not happen.
    expect(rec.outcome!.error?.sideEffectUnknown).toBe(true);
    // A cancellation is terminal — never retried.
    expect(rec.retryCount ?? 0).toBe(0);
  });

  test("cancel flag persists durably for inspection", async () => {
    const exec: Promise<ExecutionRecord> = service.execute(
      baseOpts({
        run: async () => {
          await new Promise((r) => setTimeout(r, 300));
          return okObservation("late");
        },
      }),
    );
    const runId = await waitForRunId();
    await new Promise((r) => setTimeout(r, 25));
    service.cancel(runId, "user_request");
    const rec = await exec;

    // The completed record must be readable from the repo with its honest outcome.
    const persisted = service.get(runId);
    expect(persisted).not.toBeNull();
    expect(persisted!.state).toBe(rec.state);
    expect(persisted!.outcome!.kind).toBe("cancelled");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 06 · Steps 15–18 — CANCELLATION PROPAGATION.
// The run's AbortSignal must reach provider transports AND interruptible tool
// subprocesses, and its outcome must be attributed HONESTLY (cancelled ≠
// timeout ≠ success). Cancellation is audited and NEVER treated as proof that
// a side effect did not happen.
// ═══════════════════════════════════════════════════════════════════════════
import { runCommand } from "../../src/util/process.ts";
import { guardedRequest, ProviderAbortError, isCancellation, isTimeout } from "../../src/providers/request-guard.ts";
import { isSideEffectSafe } from "../../src/execution/checkpoint.ts";

describe("Phase 06 · cancellation propagation (spec steps 15–18)", () => {
  test("AbortSignal reaches subprocesses: runCommand kills the child and reports 'cancelled'", async () => {
    const controller = new AbortController();
    const p = runCommand("sleep", ["5"], { timeoutMs: 30_000, signal: controller.signal });
    // Let the child start, then cancel.
    await new Promise((r) => setTimeout(r, 100));
    controller.abort();
    const started = Date.now();
    const result = await p;
    expect(result.ok).toBe(false);
    expect(result.error).toBe("cancelled"); // NOT "timeout", NOT success
    expect(Date.now() - started).toBeLessThan(3000); // child actually died
  }, 10_000);

  test("already-aborted signal fails fast without spawning", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runCommand("sleep", ["5"], { signal: controller.signal });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("cancelled");
  });

  test("provider transport receives the signal: caller abort → 'cancelled', never 'timeout'", async () => {
    const controller = new AbortController();
    const p = guardedRequest("test-provider", { signal: controller.signal, timeoutMs: 30_000 }, (signal) => {
      return new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => resolve("late"), 5000);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new Error("aborted"));
        });
      });
    });
    setTimeout(() => controller.abort(), 20);
    let caught: unknown;
    try {
      await p;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderAbortError);
    expect(isCancellation(caught)).toBe(true); // honest attribution
    expect(isTimeout(caught)).toBe(false);
  });

  test("shell tool honors ctx.signal and audits the cancellation", async () => {
    const { shellTool } = await import("../../src/tools/system.ts");
    const audits: Array<{ event: string; detail: Record<string, unknown> }> = [];
    const controller = new AbortController();
    const ctx = {
      cwd: dir,
      approve: async () => true,
      audit: (event: string, detail: Record<string, unknown>) => audits.push({ event, detail }),
      dryRun: false,
      hardened: false, // compat path: direct subprocess (the one we can cancel)
      signal: controller.signal,
    } as unknown as Parameters<typeof shellTool.run>[1];

    const p = shellTool.run({ cmd: "sleep 5" }, ctx);
    await new Promise((r) => setTimeout(r, 150));
    controller.abort();
    const result = await p;
    expect(result.ok).toBe(false);
    expect(result.output.toLowerCase()).toContain("cancel");
    expect(audits.some((a) => a.event === "shell.cancelled")).toBe(true);
    expect(audits.some((a) => a.event === "shell.run")).toBe(false); // never reported as executed-ok
  }, 15_000);

  test("an already-cancelled run does not start new shell side effects", async () => {
    const { shellTool } = await import("../../src/tools/system.ts");
    const audits: Array<{ event: string }> = [];
    const controller = new AbortController();
    controller.abort();
    const ctx = {
      cwd: dir,
      approve: async () => true,
      audit: (event: string) => audits.push({ event }),
      dryRun: false,
      hardened: false,
      signal: controller.signal,
    } as unknown as Parameters<typeof shellTool.run>[1];
    const result = await shellTool.run({ cmd: "echo side-effect >> should-not-exist.txt" }, ctx);
    expect(result.ok).toBe(false);
    expect(audits.some((a) => a.event === "shell.cancelled")).toBe(true);
  });

  test("cancellation_requested remains side-effect-UNSAFE (step 17)", () => {
    // A cancellation may land during an external mutation — it is NOT proof
    // the effect was avoided. The taxonomy must keep saying so.
    expect(isSideEffectSafe("cancellation_requested")).toBe(false);
    expect(isSideEffectSafe("cancellation_requested", "naturally_idempotent")).toBe(false);
  });
});
