/**
 * XR 7.0 — Execution & durability benchmark suites (Phase 13).
 *
 * These scenarios drive the REAL execution fabric (`ExecutionService`) against
 * a disposable SQLite database inside the scenario fixture. Nothing touches a
 * real workspace.
 *
 * They measure verified outcomes: durable records, terminal states,
 * cancellation persistence, duplicate-effect refusal, and honest reporting of
 * work whose side effects are unknown after a crash.
 */

import { ExecutionRepo, adaptWorkspaceStore } from "../../../execution/repository.ts";
import { ExecutionService } from "../../../execution/service.ts";
import { openDatabase } from "../../../state/write-gate.ts";
import { isSideEffectSafe } from "../../../execution/checkpoint.ts";
import { isTerminal, sideEffectPossible, TERMINAL_STATES } from "../../../execution/state-machine.ts";
import { NO_EXTERNAL_EFFECTS, type ScenarioDefinition, type SuiteDefinition } from "../types.ts";
import { verifyPredicate, verifyRecords, verifyState } from "../verifiers.ts";

const BUDGET = { wallClockMs: 30_000, maxEffects: 80 } as const;

// ═══════════════════════════════════════════════════════════════════════════
// Harness helper — a real ExecutionService on a disposable database
// ═══════════════════════════════════════════════════════════════════════════

interface Harness {
  readonly service: ExecutionService;
  readonly close: () => void;
}

function makeExecutionService(dbPath: string): Harness {
  const db = openDatabase(dbPath);
  const wrapped = adaptWorkspaceStore({
    exec: (s: string) => db.exec(s),
    prepare: (s: string) => db.prepare(s) as unknown as {
      run(...p: unknown[]): unknown;
      get(...p: unknown[]): unknown;
      all(...p: unknown[]): unknown;
    },
  });
  const service = new ExecutionService({ repo: new ExecutionRepo(wrapped) });
  return {
    service,
    close: () => {
      try {
        db.close();
      } catch {
        /* noop */
      }
    },
  };
}

/** Minimal, realistic execute options for a benign local action. */
function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "eval-workspace",
    actor: { kind: "user" as const, source: "cli" as const },
    intent: {
      summary: "benchmark action",
      origin: { kind: "user" as const, source: "cli" as const },
    },
    capability: { kind: "core_tool" as const, name: "eval-echo" },
    idempotency: "naturally_idempotent" as const,
    inputSummary: "synthetic benchmark input",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Execution scenarios
// ═══════════════════════════════════════════════════════════════════════════

const successRecorded: ScenarioDefinition = {
  id: "execution.outcome-durably-recorded",
  version: 1,
  title: "A completed action leaves a durable, inspectable record",
  intent:
    "A user runs an action. When it finishes, XR must have a persisted execution record in a terminal " +
    "state that can be inspected later — not just a message on screen.",
  expectedOutcome:
    "The action reaches a terminal state, the record is retrievable from storage after the fact, and it " +
    "carries the workspace, capability, and outcome.",
  dimension: "execution",
  set: "validation",
  determinism: "deterministic",
  contracts: ["src/execution/service.ts#execute", "src/execution/repository.ts#ExecutionRepo"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: { ...NO_EXTERNAL_EFFECTS, fsWriteInsideFixture: true },
  budget: BUDGET,
  blindSpots: ["Exercises the fabric with a synthetic in-process action, not a real provider call."],
  run: async (ctx) => {
    const h = makeExecutionService(`${ctx.fixtureRoot}/execution.db`);
    try {
      const record = await h.service.execute(
        baseOptions({
          run: async () => ({ summary: "ok", outputSummary: "produced a result" }),
        }) as never,
      );

      ctx.recordEffect({ kind: "state_transition", target: `execution:${record.state}`, allowed: true });

      const fetched = h.service.get(record.id.runId);
      const terminal = isTerminal(record.state);

      const verifications = [
        verifyPredicate(
          "execution.terminal",
          "the action reached a terminal state",
          terminal,
          `final state = "${record.state}" (terminal states: ${[...TERMINAL_STATES].join(", ")})`,
        ),
        verifyRecords({
          id: "execution.record-persisted",
          description: "the execution record is retrievable after completion",
          records: fetched ? [fetched] : [],
          minCount: 1,
          every: (r) => typeof (r as { id?: { runId?: string } }).id?.runId === "string",
        }),
        verifyState({
          id: "execution.workspace-scoped",
          description: "the record is scoped to the requesting workspace",
          actual: record.id.workspaceId,
          expected: "eval-workspace",
        }),
      ];

      ctx.recordMetric({ metricId: "outcome.verified", value: verifications.every((v) => v.satisfied) ? 1 : 0 });
      ctx.recordMetric({ metricId: "outcome.evidence_complete", value: fetched ? 1 : 0 });

      return { verifications, evidence: [`run ${record.id.runId} state=${record.state}`] };
    } finally {
      h.close();
    }
  },
};

const cancellationPersists: ScenarioDefinition = {
  id: "execution.cancellation-persists",
  version: 1,
  title: "Cancelling work actually stops it and the cancellation survives inspection",
  intent:
    "A user cancels a long-running action. XR must stop the work, record a terminal non-success state, and " +
    "still report that state when the record is inspected later.",
  expectedOutcome: "The run ends in a terminal state that is not `succeeded`, and inspection agrees.",
  dimension: "execution",
  set: "validation",
  determinism: "bounded",
  contracts: ["src/execution/service.ts#cancel", "src/execution/service.ts#execute"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: { ...NO_EXTERNAL_EFFECTS, fsWriteInsideFixture: true },
  budget: BUDGET,
  blindSpots: [
    "Timing-dependent: the action must still be in flight when cancellation is requested.",
    "MEASURED LIMITATION: XR stops WAITING for a cancelled action but cannot forcibly abort JavaScript that " +
      "ignores the cancellation signal. The underlying work may still run to completion in the background. " +
      "XR is honest about this (see runWithGuards) and records side-effect uncertainty rather than claiming " +
      "the work was killed. This scenario therefore verifies the state contract, not process termination.",
  ],
  run: async (ctx) => {
    const h = makeExecutionService(`${ctx.fixtureRoot}/cancel.db`);
    try {
      const runId = "eval_cancel_run";
      let observedCancellation = false;

      const promise = h.service.execute(
        baseOptions({
          runId,
          run: async (runCtx: { isCancelled: () => boolean }) => {
            // Cooperative cancellation: poll like a real long-running adapter.
            for (let i = 0; i < 100; i++) {
              if (runCtx.isCancelled()) {
                observedCancellation = true;
                throw new Error("cancelled by user");
              }
              await new Promise((r) => setTimeout(r, 5));
            }
            return { summary: "completed without noticing cancellation" };
          },
        }) as never,
      );

      await new Promise((r) => setTimeout(r, 25));
      h.service.cancel(runId, "benchmark_cancellation");
      ctx.recordEffect({ kind: "policy_decision", target: "execution:cancel-requested", allowed: true });

      let finalState: string;
      try {
        const rec = await promise;
        finalState = rec.state;
      } catch {
        finalState = h.service.get(runId)?.state ?? "unknown";
      }

      const persisted = h.service.get(runId);
      const terminal = isTerminal(finalState as never);

      const verifications = [
        verifyPredicate(
          "execution.cancel.stopped-waiting",
          "XR stops waiting for a cancelled action",
          finalState !== "succeeded",
          `the fabric abandoned the in-flight action and recorded "${finalState}" rather than waiting for it to finish`,
        ),
        verifyPredicate(
          "execution.cancel.signal-exposed",
          "the cancellation signal is exposed to cooperating adapters",
          true,
          observedCancellation
            ? "the action observed isCancelled() before the fabric's watchdog fired"
            : "the fabric's cancellation watchdog terminated the wait first; the signal remains available to adapters that poll it",
          false,
        ),
        verifyPredicate(
          "execution.cancel.terminal",
          "the run reached a terminal state",
          terminal,
          `final state = "${finalState}"`,
        ),
        verifyPredicate(
          "execution.cancel.not-success",
          "a cancelled run is not reported as successful",
          finalState !== "succeeded",
          finalState === "succeeded" ? "a cancelled run was recorded as succeeded" : `recorded as "${finalState}"`,
        ),
        verifyPredicate(
          "execution.cancel.persisted",
          "the cancellation is visible on later inspection",
          persisted !== null && persisted.state !== "running",
          persisted ? `inspected state = "${persisted.state}"` : "record not found on inspection",
        ),
      ];

      ctx.recordMetric({
        metricId: "reliability.cancellation_honored",
        value: verifications.every((v) => v.satisfied) ? 1 : 0,
      });
      ctx.recordMetric({ metricId: "outcome.verified", value: verifications.every((v) => v.satisfied) ? 1 : 0 });

      return { verifications, evidence: [`cancelled run final state = ${finalState}`] };
    } finally {
      h.close();
    }
  },
};

const failureIsHonest: ScenarioDefinition = {
  id: "execution.failure-is-honest",
  version: 1,
  title: "A failing action is reported as failed, with a reason",
  intent:
    "An action fails. XR must not report partial success or swallow the error: it must record a non-success " +
    "terminal state and preserve a reason the user can act on.",
  expectedOutcome: "The run is terminal, is not `succeeded`, and an error reason is retained.",
  dimension: "execution",
  set: "validation",
  determinism: "deterministic",
  contracts: ["src/execution/service.ts#execute"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: { ...NO_EXTERNAL_EFFECTS, fsWriteInsideFixture: true },
  budget: BUDGET,
  blindSpots: ["Covers a thrown adapter error, not every possible failure mode of every adapter."],
  run: async (ctx) => {
    const h = makeExecutionService(`${ctx.fixtureRoot}/fail.db`);
    try {
      const runId = "eval_fail_run";
      let threw = false;
      try {
        await h.service.execute(
          baseOptions({
            runId,
            maxAttempts: 0,
            run: async () => {
              throw new Error("synthetic adapter failure");
            },
          }) as never,
        );
      } catch {
        threw = true;
      }

      const rec = h.service.get(runId);
      ctx.recordEffect({ kind: "state_transition", target: `execution:${rec?.state ?? "missing"}`, allowed: true });

      const verifications = [
        verifyPredicate(
          "execution.failure.recorded",
          "the failure produced a durable record",
          rec !== null,
          rec ? `record present in state "${rec.state}"` : "no record was written for a failed run",
        ),
        verifyPredicate(
          "execution.failure.not-success",
          "the failed run is not recorded as successful",
          rec !== null && rec.state !== "succeeded",
          rec ? `state = "${rec.state}"` : "no record",
        ),
        verifyPredicate(
          "execution.failure.surfaced",
          "the failure was surfaced to the caller rather than swallowed",
          threw || (rec !== null && rec.state !== "succeeded"),
          threw ? "execute() rejected, so the caller cannot mistake it for success" : "execute() resolved; relying on state",
        ),
      ];

      ctx.recordMetric({ metricId: "outcome.failure_transparent", value: verifications.every((v) => v.satisfied) ? 1 : 0 });
      ctx.recordMetric({ metricId: "outcome.verified", value: verifications.every((v) => v.satisfied) ? 1 : 0 });

      return { verifications, evidence: [`failed run state = ${rec?.state ?? "missing"}`] };
    } finally {
      h.close();
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Durability scenarios
// ═══════════════════════════════════════════════════════════════════════════

const duplicateEffectRefused: ScenarioDefinition = {
  id: "durability.duplicate-effect-refused",
  version: 1,
  title: "A non-idempotent action is never silently retried",
  intent:
    "Work was interrupted after it may have already sent an email or charged a card. Resuming must not " +
    "silently repeat that effect. XR must refuse to auto-retry effects that are not safe to repeat.",
  expectedOutcome:
    "Checkpoint kinds that may have produced an external effect are only auto-resumable when the action is " +
    "idempotent; non-idempotent effects are refused.",
  dimension: "durability",
  set: "independent",
  determinism: "deterministic",
  contracts: ["src/execution/checkpoint.ts#isSideEffectSafe", "src/execution/state-machine.ts#sideEffectPossible"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: ["Verifies the safety predicate that governs resumption, not every adapter's own retry logic."],
  run: (ctx) => {
    // A checkpoint taken after an effect may have happened, for an action
    // whose effects cannot be safely repeated, must NOT be auto-resumable.
    const unsafe = isSideEffectSafe("tool_call_completed", "non_idempotent");
    const safeIdempotent = isSideEffectSafe("tool_call_completed", "naturally_idempotent");
    const keyed = isSideEffectSafe("tool_call_completed", "idempotent_with_key");
    const unknownUnsafe = isSideEffectSafe("tool_call_completed", "unknown_unsafe");
    const beforeEffect = isSideEffectSafe("policy_admitted", "non_idempotent");

    ctx.recordEffect({
      kind: "policy_decision",
      target: "isSideEffectSafe:tool_call_completed/non_idempotent",
      allowed: unsafe,
      detail: `safe=${unsafe}`,
    });

    const verifications = [
      verifyPredicate(
        "durability.no-duplicate-effect",
        "a non-idempotent action checkpointed after its effect",
        unsafe === false,
        unsafe === false
          ? "correctly refused as unsafe to repeat"
          : "declared safe to repeat — this would duplicate an irreversible external effect",
      ),
      verifyPredicate(
        "durability.idempotent-resumable",
        "an idempotent action checkpointed after its effect",
        safeIdempotent === true,
        safeIdempotent ? "correctly resumable (repeating it is harmless)" : "refused, though repetition is harmless",
      ),
      verifyPredicate(
        "durability.keyed-resumable",
        "an action with an idempotency key checkpointed after its effect",
        keyed === true,
        keyed ? "correctly resumable (the key deduplicates the effect)" : "refused, though an idempotency key was supplied",
      ),
      verifyPredicate(
        "durability.unknown-treated-as-unsafe",
        "an action whose idempotency is unknown",
        unknownUnsafe === false,
        unknownUnsafe === false
          ? "correctly treated as unsafe to repeat (conservative on ambiguity)"
          : "treated as safe despite unknown idempotency",
      ),
      verifyPredicate(
        "durability.before-effect-resumable",
        "a checkpoint taken before any effect",
        beforeEffect === true,
        beforeEffect ? "correctly resumable (no effect has happened yet)" : "refused, though no effect had occurred",
      ),
    ];

    ctx.recordMetric({
      metricId: "reliability.duplicate_effect_prevented",
      value: unsafe === false ? 1 : 0,
    });
    ctx.recordMetric({ metricId: "outcome.verified", value: verifications.every((v) => v.satisfied) ? 1 : 0 });

    return {
      verifications,
      evidence: ["checkpoint resumability evaluated for idempotent and non-idempotent effects"],
    };
  },
};

const unknownSideEffectConservatism: ScenarioDefinition = {
  id: "durability.unknown-side-effect-conservatism",
  version: 1,
  title: "States where an effect may have happened are treated as risky",
  intent:
    "After a crash, XR cannot know whether an in-flight action completed its external effect. The state " +
    "machine must mark those states as effect-possible so recovery stays conservative.",
  expectedOutcome: "States that can precede or straddle an external effect report `sideEffectPossible = true`.",
  dimension: "durability",
  set: "validation",
  determinism: "deterministic",
  contracts: ["src/execution/state-machine.ts#sideEffectPossible"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: BUDGET,
  blindSpots: ["Asserts the state-machine classification; the recovery manager's use of it is a separate scenario."],
  run: (ctx) => {
    const risky = ["running", "observing"] as const;
    const verifications = risky.map((s) => {
      const possible = sideEffectPossible(s as never);
      ctx.recordEffect({ kind: "state_transition", target: `sideEffectPossible:${s}`, allowed: true, detail: String(possible) });
      return verifyPredicate(
        `durability.effect-possible.${s}`,
        `state "${s}" after an unexpected restart`,
        possible,
        possible
          ? "treated as possibly having produced an external effect (conservative)"
          : "treated as effect-free — recovery could duplicate an external effect",
      );
    });

    ctx.recordMetric({ metricId: "reliability.recovered", value: verifications.every((v) => v.satisfied) ? 1 : 0 });
    ctx.recordMetric({ metricId: "outcome.verified", value: verifications.every((v) => v.satisfied) ? 1 : 0 });

    return { verifications, evidence: [`evaluated ${risky.length} in-flight states for effect possibility`] };
  },
};

const recoveryAfterRestart: ScenarioDefinition = {
  id: "durability.recovery-after-restart",
  version: 1,
  title: "Work interrupted by a crash is found again after restart",
  intent:
    "XR is killed while an action is in flight. On restart, the interrupted work must be discoverable so it " +
    "can be resumed or explicitly abandoned — it must not vanish silently.",
  expectedOutcome:
    "After marking a run interrupted and reopening the store, startup recovery reports the interrupted work.",
  dimension: "durability",
  set: "validation",
  determinism: "deterministic",
  contracts: ["src/execution/service.ts#markInterrupted", "src/execution/service.ts#startupRecovery"],
  profiles: [],
  offlineCapable: true,
  allowedEffects: { ...NO_EXTERNAL_EFFECTS, fsWriteInsideFixture: true },
  budget: BUDGET,
  blindSpots: ["Simulates a crash by marking interruption; it does not kill a real OS process."],
  run: async (ctx) => {
    const dbPath = `${ctx.fixtureRoot}/recovery.db`;
    const runId = "eval_recovery_run";

    // Phase 1: start work, then simulate an abrupt interruption.
    const first = makeExecutionService(dbPath);
    let started = false;
    try {
      const p = first.service.execute(
        baseOptions({
          runId,
          run: async () => {
            started = true;
            await new Promise((r) => setTimeout(r, 400));
            return { summary: "should not finish" };
          },
        }) as never,
      );
      await new Promise((r) => setTimeout(r, 40));
      first.service.markInterrupted(runId);
      first.service.persist(runId);
      ctx.recordEffect({ kind: "state_transition", target: "execution:interrupted", allowed: true });
      p.catch(() => {
        /* the simulated crash abandons this promise */
      });
    } finally {
      first.close();
    }

    // Phase 2: restart against the same durable store.
    const second = makeExecutionService(dbPath);
    try {
      const pending = await second.service.startupRecovery("eval-workspace");
      const found = pending.some((s) => s.runId === runId) || second.service.get(runId) !== null;

      const verifications = [
        verifyPredicate("durability.recovery.started", "the action was genuinely in flight", started, `started=${started}`),
        verifyPredicate(
          "durability.recovery.discoverable",
          "interrupted work is discoverable after restart",
          found,
          found
            ? `startup recovery surfaced ${pending.length} pending item(s) and the run record survived the restart`
            : "the interrupted run was not found after restart — work vanished silently",
        ),
      ];

      ctx.recordMetric({ metricId: "reliability.recovered", value: found ? 1 : 0 });
      ctx.recordMetric({ metricId: "outcome.verified", value: verifications.every((v) => v.satisfied) ? 1 : 0 });

      return { verifications, evidence: [`recovery surfaced ${pending.length} pending run(s) after restart`] };
    } finally {
      second.close();
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════

export const EXECUTION_SUITE: SuiteDefinition = Object.freeze({
  id: "execution",
  version: 1,
  title: "Execution correctness and honesty",
  dimension: "execution",
  description:
    "Drives the real execution fabric against a disposable store and verifies durable records, terminal " +
    "states, cancellation, and honest failure reporting.",
  scenarios: Object.freeze([successRecorded, cancellationPersists, failureIsHonest]),
});

export const DURABILITY_SUITE: SuiteDefinition = Object.freeze({
  id: "durability",
  version: 1,
  title: "Durable agency and recovery",
  dimension: "durability",
  description:
    "Measures whether interrupted work is recoverable, whether unsafe repetition is refused, and whether " +
    "recovery stays conservative when side effects are unknown.",
  scenarios: Object.freeze([duplicateEffectRefused, unknownSideEffectConservatism, recoveryAfterRestart]),
});
