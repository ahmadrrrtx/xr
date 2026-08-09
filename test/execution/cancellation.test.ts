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
  rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
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
