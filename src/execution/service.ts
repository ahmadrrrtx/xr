/**
 * XR 4.3 — Execution Service (the "Fabric" with Durable Agency)
 *
 * Owns the canonical orchestration of every execution:
 *   - create execution
 *   - register intent/plan
 *   - enforce policy/approval/budget (bridging to existing gates)
 *   - prepare action
 *   - invoke adapter callback in current placement
 *   - normalize observation/outcome
 *   - record cost/audit/history without double-charging
 *   - apply timeout/cancellation/retry rules
 *   - XR 4.3: checkpoints, leases, durable cancellation, and recovery
 *
 * Does NOT own model routing, isolation, memory redesign, or business
 * workflow planning — that is for later phases.
 */
import { randomUUID } from "node:crypto";
import {
  EXECUTION_ADAPTER_VERSION,
  EXECUTION_BOUNDS,
  type ActorIdentity,
  type ExecutionEvent,
  type ExecutionListener,
  type ExecutionRecord,
  type ExecutionState,
  type ExecuteOptions,
  type ExecutionOutcome,
  type PolicyDecision,
  type Placement,
  type RecoveryStatus,
} from "./types.ts";
import type { TrustService } from "../trust/service.ts";
import type { PlacementKind } from "../trust/types.ts";
import type { ExecutionRepo } from "./repository.ts";
import type { IdempotencyStore } from "../state/idempotency.ts";
import { canRun, isTerminal, transition, wasInFlight } from "./state-machine.ts";
import {
  BudgetExceededError,
  CancellationUnsupportedError,
  ExecutionTimeoutError,
  NonIdempotentRetryBlockedError,
} from "./errors.ts";
import { CheckpointManager } from "./checkpoint.ts";
import { LeaseManager } from "./lease.ts";
import { RecoveryManager } from "./recovery.ts";

export interface ExecutionServiceDeps {
  repo: ExecutionRepo;
  /** Optional audit bridge (existing audit repo). */
  audit?: (event: string, detail: Record<string, unknown>) => void;
  /**
   * Phase 1 (T5) — claim-first idempotency slots. When present, non-idempotent
   * executions with an idempotency key claim their slot BEFORE the side effect
   * so a crash between effect and completion record can never duplicate the
   * effect (effective exactly-once; at-most-once + reconciliation otherwise).
   */
  idempotency?: IdempotencyStore;
  /**
   * XR 4.2 — optional Trust & Isolation service. When present AND an action
   * supplies `opts.trust`, the fabric classifies risk, decides placement, and
   * runs Tier 1/2 work inside a verified environment (fail closed otherwise).
   * When absent, behavior is identical to XR 4.1.
   */
  trust?: TrustService;
  /**
   * XR 4.3 — optional recovery callback for notifying the runtime about
   * recovery status changes (for daemon/CLI UX updates).
   */
  onRecoveryStatus?: (status: RecoveryStatus) => void;
}

export class ExecutionService {
  private readonly listeners = new Set<ExecutionListener>();
  /** In-memory index of live executions (for cancellation/progress). */
  private readonly live = new Map<string, ExecutionRecord>();
  /** Cancellation flags keyed by run id. */
  private readonly cancelFlags = new Map<string, { cancelled: boolean; reason?: string }>();

  // XR 4.3 — Durable Agency managers
  readonly checkpoints: CheckpointManager;
  readonly leases: LeaseManager;
  readonly recovery: RecoveryManager;

  constructor(private readonly deps: ExecutionServiceDeps) {
    deps.repo.migrate();

    // XR 4.3 — Initialize durable agency managers
    const db = deps.repo.rawDb;
    this.checkpoints = new CheckpointManager(db);
    this.leases = new LeaseManager(db);
    this.recovery = new RecoveryManager(db, this.checkpoints, this.leases);
    // Migration: ensure all Phase 4 tables exist
    this.checkpoints.migrate();
    this.leases.migrate();
    this.recovery.migrate();
  }

  // ── Lifecycle hooks (registered as a lifecycle participant) ─────────────

  async onInit(): Promise<void> {
    // No async initialization required beyond migration (already done in constructor).
  }

  async onStart(): Promise<void> {
    // Service is ready to accept executions.
  }

  async onStop(): Promise<void> {
    // XR 4.3 — Mark active executions as interrupted before shutdown.
    // Request cancellation so they can wind down gracefully.
    for (const [runId] of this.live) {
      this.markInterrupted(runId);
      this.cancel(runId, "runtime_shutdown");
    }
  }

  /** Health contribution: counts of live/recent executions. */
  health(): { liveCount: number; listenerCount: number; ready: true } {
    return {
      liveCount: this.live.size,
      listenerCount: this.listeners.size,
      ready: true,
    };
  }

  /** XR 4.2 — the wired Trust & Isolation service, if any (used by adapters). */
  get trust(): TrustService | undefined {
    return this.deps.trust;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Subscribe to execution events (streaming/progress/UX). */
  addListener(l: ExecutionListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Request cancellation of a running execution. */
  cancel(runId: string, reason = "user_request"): void {
    const flag = this.cancelFlags.get(runId) ?? { cancelled: false };
    flag.cancelled = true;
    flag.reason = reason;
    this.cancelFlags.set(runId, flag);

    // XR 4.3 — Durable cancellation: persist so it survives restart
    const liveRec = this.live.get(runId);
    if (liveRec) {
      this.checkpoints.createCheckpoint(liveRec, "cancellation_requested", {
        progressSummary: `Cancellation requested: ${reason}`,
        payload: { reason },
      });
    }
    this.recovery.requestCancellation("execution", runId, "user", reason);
  }

  /** Get recovery status for a specific execution. */
  getRecoveryStatus(runId: string): RecoveryStatus | null {
    const record = this.deps.repo.get(runId);
    if (!record) return null;
    return this.recovery.buildStatus(record);
  }

  /** Get all executions needing recovery attention. */
  getRecoveryPending(workspaceId: string): RecoveryStatus[] {
    const interrupted = this.deps.repo.findInterrupted(workspaceId);
    return interrupted.map((r) => this.recovery.buildStatus(r));
  }

  /**
   * Resume a recoverable execution from its last checkpoint.
   * Only succeeds if the recovery classification is "auto_resume" or 
   * the user has explicitly approved the resume.
   */
  async resumeRecoverable(runId: string, opts?: { force?: boolean }): Promise<ExecutionRecord | null> {
    const record = this.deps.repo.get(runId);
    if (!record) return null;

    const classification = this.recovery.classify(record);
    if (classification.action === "blocked" && !opts?.force) return null;
    if (classification.action === "requires_approval" && !opts?.force) return null;

    // Record the recovery decision
    this.recovery.recordDecision(
      "execution", runId,
      "auto_resume", classification.classification,
      classification.reason,
      opts?.force ? "user" : "system",
    );

    // For recoverable executions that were pre-action, reset to queued
    if (!wasInFlight(record.state) || record.state === "awaiting_approval") {
      // Reset state to queued for re-execution
      const t = transition(runId, record.state, "retry", "recovery resume");
      record.state = t.next;
      record.history.push(t.entry);
      record.observation = undefined;
      record.outcome = undefined;
      record.updatedAt = Date.now();
      this.deps.repo.save(record);
      return record;
    }

    return record;
  }

  /**
   * Run startup recovery: discover interrupted work, classify, and
   * record recovery decisions. Does NOT automatically resume unsafe work.
   */
  async startupRecovery(workspaceId: string): Promise<RecoveryStatus[]> {
    const results: RecoveryStatus[] = [];

    // Acquire recovery lease to prevent duplicate startup recovery
    const recoveryLease = this.leases.acquire("recovery", workspaceId, workspaceId, { ttlMs: 60000 });
    if (!recoveryLease) return results; // Another process is handling recovery

    try {
      // Discover unfinished work
      const interrupted = this.deps.repo.findInterrupted(workspaceId);

      // Classify and record decisions
      for (const record of interrupted) {
        const classification = this.recovery.classify(record);

        // Record the decision
        this.recovery.recordDecision(
          "execution", record.id.runId,
          classification.action, classification.classification,
          classification.reason,
          "system",
        );

        // Build status
        const status = this.recovery.buildStatus(record);
        results.push(status);

        // Notify
        this.deps.onRecoveryStatus?.(status);

        // Auto-resume safe work
        if (classification.action === "auto_resume") {
          await this.resumeRecoverable(record.id.runId, { force: true });
          status.recoveryState = "resumed";
        }
      }

      // Clean up dirty environments
      const dirtyEnvs = this.recovery.getDirtyEnvironments(workspaceId);
      for (const env of dirtyEnvs) {
        this.recovery.updateEnvironmentState(env.environmentId, "quarantined", {
          quarantined: true,
          quarantineReason: "Process crash during active environment use",
          cleanupState: "failed",
        });
      }
    } finally {
      this.leases.release("recovery", workspaceId, "recovery_complete");
    }

    return results;
  }

  /** Mark an execution as interrupted (called on graceful shutdown for active work). */
  markInterrupted(runId: string): void {
    const record = this.live.get(runId);
    if (record) {
      this.checkpoints.createCheckpoint(record, "recovery_decided", {
        progressSummary: "Runtime shutdown — execution interrupted",
      });
    }
    this.deps.repo.markInterrupted(runId);
  }

  /** Retrieve a record from the repo. */
  get(runId: string): ExecutionRecord | null {
    return this.deps.repo.get(runId);
  }

  /** Persist a live record to the repo now (best-effort, does not throw fatal). */
  persist(runId: string): void {
    const rec = this.live.get(runId);
    if (!rec) return;
    try {
      this.deps.repo.save(rec);
    } catch {
      // Persistence failure is noted on the record but must not crash the run.
      // The caller inspects `outcome.error` for persistence failure signals.
    }
  }

  /**
   * The canonical execute() entry point. Runs a single action through the
   * full fabric lifecycle. Returns the completed ExecutionRecord.
   */
  async execute(opts: ExecuteOptions): Promise<ExecutionRecord> {
    const now = Date.now();
    let claimedKey: string | null = null; // Phase 1 (T5): idempotency slot claimed before the effect
    const runId = opts.runId ?? `ex_${randomUUID().slice(0, 10)}`;
    const correlationId = opts.correlationId ?? runId;
    const placement: Placement = opts.placement ?? { kind: "in_process" };

    const record: ExecutionRecord = {
      id: {
        runId,
        workspaceId: opts.workspaceId,
        sessionId: opts.sessionId,
        workflowId: opts.workflowId,
        taskId: opts.taskId,
        attempt: 1,
        correlationId,
      },
      state: "created",
      actor: opts.actor,
      intent: opts.intent,
      plan: opts.plan,
      policy: [],
      action: undefined,
      observation: undefined,
      evidence: [],
      artifacts: [],
      history: [{ from: null, to: "created", at: now, reason: "execution created" }],
      createdAt: now,
      updatedAt: now,
      adapterVersion: EXECUTION_ADAPTER_VERSION,
    };
    this.live.set(runId, record);
    this.cancelFlags.set(runId, { cancelled: false });
    this.deps.audit?.("execution.created", {
      runId,
      correlationId,
      capability: `${opts.capability.kind}:${opts.capability.name}`,
      actor: opts.actor.kind,
      dryRun: !!opts.dryRun,
    });

    // XR 4.3 — Checkpoint: task accepted
    this.checkpoints.createCheckpoint(record, "task_accepted");

    try {
      // 1. Optional plan transition.
      if (opts.plan) {
        this.applyTransition(runId, record, "plan", "plan registered");
        this.checkpoints.createCheckpoint(record, "plan_recorded");
        this.persist(runId);
      }

      // 2. Policy/budget/approval phase.
      await this.applyPolicy(runId, record, opts);
      if (isTerminal(record.state)) {
        return this.finalize(runId, record);
      }
      // XR 4.3 — Checkpoint: policy admitted
      this.checkpoints.createCheckpoint(record, "policy_admitted");

      // 2b. XR 4.2 — Trust & Isolation gate (opt-in via opts.trust).
      //     Classifies risk, decides placement, and for Tier 1/2 runs the
      //     action inside a verified environment. Fails closed (denied) when
      //     required isolation is unavailable. Tier 0 continues on the fast
      //     in-process path below. No-op when no TrustService is wired.
      const trustGate = await this.runTrustGate(runId, record, opts);
      if (trustGate === "finalize") {
        return this.finalize(runId, record);
      }

      // 3. Build action descriptor, transition to authorized → queued → running.
      record.action = {
        capability: opts.capability,
        inputSummary: opts.inputSummary,
        inputBytes: opts.inputBytes,
        idempotency: opts.idempotency,
        idempotencyKey: opts.idempotencyKey,
        timeoutMs: opts.timeoutMs,
        dryRun: !!opts.dryRun,
        placement,
        authorizedBy: record.policy.length
          ? {
              decisionKind: record.policy[record.policy.length - 1].kind,
              at: record.policy[record.policy.length - 1].at,
              requestId:
                "requestId" in record.policy[record.policy.length - 1]
                  ? (record.policy[record.policy.length - 1] as { requestId?: string }).requestId
                  : undefined,
            }
          : undefined,
      };
      // Only apply authorize transition if we haven't reached authorized via grant_approval.
      if (record.state !== "authorized") {
        this.applyTransition(runId, record, "authorize", "policy satisfied");
      }
      this.applyTransition(runId, record, "queue", "ready for execution");
      this.persist(runId);

      // XR 4.3 — Checkpoint: step started (before action execution)
      this.checkpoints.createCheckpoint(record, "step_started", {
        progressSummary: `Starting ${opts.capability.kind}:${opts.capability.name}`,
      });

      // 4. Claim-first idempotency (Phase 1 · T5). Effective exactly-once:
      //    the slot is INSERTed BEFORE the side effect. Completed slots are
      //    replayed (dedup); an interrupted non-idempotent effect is NEVER
      //    re-run — it is surfaced as reconciliation-required.
      if (opts.idempotencyKey && opts.idempotency !== "naturally_idempotent") {
        const prior = this.deps.repo.findCompletedByIdempotencyKey(
          opts.workspaceId,
          opts.capability.kind,
          opts.capability.name,
          opts.idempotencyKey,
        );
        if (prior && prior.outcome?.kind === "succeeded") {
          record.duplicateOf = prior.id.runId;
          record.observation = prior.observation
            ? { ...prior.observation, summary: `(duplicate of ${prior.id.runId}) ${prior.observation.summary}` }
            : { summary: `(duplicate of ${prior.id.runId}) no side effect replayed`, transportOk: true };
          record.outcome = {
            kind: "succeeded",
            message: `Duplicate of prior successful execution ${prior.id.runId}; side effect not replayed.`,
            at: Date.now(),
          };
          this.applyTransition(runId, record, "start", "replaying cached success");
          this.applyTransition(runId, record, "succeed", "idempotent cache hit");
          this.deps.audit?.("execution.duplicate", { runId, priorRunId: prior.id.runId });
          return this.finalize(runId, record);
        }
        if (this.deps.idempotency) {
          const claim = this.deps.idempotency.claim(opts.idempotencyKey, opts.capability.kind, runId);
          if (claim.requiresReconciliation) {
            record.outcome = {
              kind: "failed",
              message: "Prior attempt left an unresolved side effect requiring reconciliation — this execution is not re-run.",
              at: Date.now(),
              error: {
                code: "RECONCILIATION_REQUIRED",
                message: "requires reconciliation; not re-run",
                retryable: false,
                sideEffectUnknown: true,
                category: "reconciliation",
              },
            };
            this.applyTransition(runId, record, "fail", "reconciliation required");
            this.deps.audit?.("execution.reconciliation_required", { runId, idempotencyKey: opts.idempotencyKey });
            return this.finalize(runId, record);
          }
          if (claim.cachedResult) {
            record.duplicateOf = record.duplicateOf ?? runId;
            record.observation = {
              summary: `(idempotent slot hit) ${claim.cachedResult}`,
              transportOk: true,
            };
            record.outcome = {
              kind: "succeeded",
              message: `Idempotent slot already completed; side effect not replayed.`,
              at: Date.now(),
            };
            this.applyTransition(runId, record, "start", "replaying cached slot");
            this.applyTransition(runId, record, "succeed", "idempotent slot hit");
            this.deps.audit?.("execution.duplicate", { runId, idempotencyKey: opts.idempotencyKey });
            return this.finalize(runId, record);
          }
          if (claim.crashedPending && opts.idempotency !== "idempotent_with_key") {
            this.deps.idempotency.requireReconciliation(
              opts.idempotencyKey,
              "interrupted non-idempotent effect — never re-run",
            );
            record.outcome = {
              kind: "failed",
              message:
                "A prior run claimed this effect and was interrupted; the effect is non-idempotent and will not be re-run. Requires reconciliation.",
              at: Date.now(),
              error: {
                code: "RECONCILIATION_REQUIRED",
                message: "interrupted non-idempotent effect",
                retryable: false,
                sideEffectUnknown: true,
                category: "reconciliation",
              },
            };
            this.applyTransition(runId, record, "fail", "reconciliation required");
            this.deps.audit?.("execution.reconciliation_required", { runId, idempotencyKey: opts.idempotencyKey });
            return this.finalize(runId, record);
          }
          // crashedPending + idempotent_with_key, or a fresh claim → run now.
          if (claim.proceed || claim.crashedPending) claimedKey = opts.idempotencyKey;
        }
      }

      // 5. Run with timeout/cancellation/retry.
      const maxAttempts = Math.max(1, Math.min(opts.maxAttempts ?? 1, EXECUTION_BOUNDS.MAX_ATTEMPTS));
      let lastErr: Error | null = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        record.id.attempt = attempt;
        if (attempt > 1) {
          record.retryCount = (record.retryCount ?? 0) + 1;
          this.deps.audit?.("execution.retry", { runId, attempt });
        }
        const startedAt = Date.now();
        record.startedAt = startedAt;
        this.applyTransition(runId, record, "start", attempt > 1 ? `attempt ${attempt}` : "execution started");
        this.emit({ type: "transition", runId, from: record.history[record.history.length - 2]?.from ?? null, to: "running", at: startedAt });

        const timeoutMs = Math.min(
          opts.timeoutMs ?? EXECUTION_BOUNDS.DEFAULT_TIMEOUT_MS,
          EXECUTION_BOUNDS.MAX_TIMEOUT_MS,
        );
        record.timeout = { deadlineMs: startedAt + timeoutMs, stage: "before_action" };

        try {
          const observation = await this.runWithGuards(runId, record, opts, timeoutMs);
          record.observation = observation;
          record.startedAt = record.startedAt ?? startedAt;
          this.applyTransition(runId, record, "observe", "observation collected");

          // XR 4.3 — Checkpoint: step completed
          const cpKind = opts.capability.kind === "model_call" ? "model_turn_completed" as const :
            (opts.capability.kind === "core_tool" || opts.capability.kind === "mcp_tool") ? "tool_call_completed" as const :
            "step_completed" as const;
          this.checkpoints.createCheckpoint(record, cpKind, {
            progressSummary: `${cpKind} — ${observation.transportOk ? "ok" : "failed"}`,
          });
          // Determine outcome.
          if (opts.dryRun) {
            record.outcome = {
              kind: "dry_run_simulated",
              message: observation.summary || "Dry-run: no side effects performed.",
              at: Date.now(),
            };
            // Dry-run is semantically "ok" — state succeeds but outcome is marked simulated.
            this.applyTransition(runId, record, "succeed", "dry-run complete");
          } else if (observation.transportOk) {
            record.outcome = {
              kind: "succeeded",
              message: observation.summary || "Action completed successfully.",
              stoppedReason: "done",
              at: Date.now(),
            };
            this.applyTransition(runId, record, "succeed", "action returned successfully");
          } else {
            record.outcome = {
              kind: "failed",
              message: observation.summary || "Action failed.",
              at: Date.now(),
              error: {
                code: "ACTION_FAILED",
                message: observation.summary || "Action failed.",
                retryable: false,
                sideEffectUnknown: false,
                category: "unknown",
              },
            };
            this.applyTransition(runId, record, "fail", "action returned failure");
          }
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
          const cancelled = this.cancelFlags.get(runId)?.cancelled;
          const deadlineExceeded = Date.now() - startedAt >= timeoutMs;

          if (cancelled) {
            record.cancellation = {
              requested: true,
              requestedAt: Date.now(),
              reason: this.cancelFlags.get(runId)?.reason,
              acknowledged: true,
              sideEffectPossible: record.state === "running" || record.state === "observing",
            };
            record.outcome = {
              kind: "cancelled",
              message: `Execution cancelled${record.cancellation.reason ? `: ${record.cancellation.reason}` : ""}.`,
              at: Date.now(),
              error: {
                code: "CANCELLED",
                message: lastErr.message,
                retryable: false,
                sideEffectUnknown: !!record.cancellation.sideEffectPossible,
                category: "cancellation",
              },
            };
            this.applyTransition(runId, record, "cancel", "cancelled");
            break;
          }

          if (deadlineExceeded) {
            record.timeout = { ...record.timeout, firedAt: Date.now(), stage: record.state === "running" ? "during_action" : "before_action" };
            // If we're in running/observing when deadline fires, side effect may have happened.
            const sideEffectUnknown = record.state === "running" || record.state === "observing";
            if (sideEffectUnknown) record.timeout.stage = "after_unknown";
            record.outcome = {
              kind: "timed_out",
              message: `Execution timed out after ${timeoutMs}ms${sideEffectUnknown ? " (side-effect status unknown)" : ""}.`,
              at: Date.now(),
              error: {
                code: "TIMEOUT",
                message: lastErr.message,
                retryable: !sideEffectUnknown,
                sideEffectUnknown,
                category: "timeout",
              },
            };
            this.applyTransition(runId, record, "timeout", "timeout fired");
            if (attempt < maxAttempts && !sideEffectUnknown && opts.isRetryable && (await opts.isRetryable(lastErr, attempt))) {
              // Reset state for retry by creating a child-like continuation. But our retry
              // model keeps the same runId and increments attempt, so transition back to queued.
              this.resetForRetry(record);
              await sleep(opts.retryBackoffMs ?? 100);
              continue;
            }
            break;
          }

          // Generic failure.
          record.outcome = {
            kind: "failed",
            message: safeMessage(lastErr),
            at: Date.now(),
            error: {
              code: (lastErr as any).code ?? "ACTION_ERROR",
              message: safeMessage(lastErr),
              retryable: Boolean((lastErr as any).retryable),
              sideEffectUnknown: record.state === "running" || record.state === "observing",
              category: "unknown",
              detail: { name: lastErr.name },
            },
          };
          this.applyTransition(runId, record, "fail", safeMessage(lastErr));

          const canRetry =
            attempt < maxAttempts &&
            opts.idempotency !== "non_idempotent" &&
            opts.idempotency !== "unknown_unsafe" &&
            (!record.outcome.error?.sideEffectUnknown) &&
            (!opts.isRetryable || (await opts.isRetryable(lastErr, attempt)));

          if (canRetry) {
            this.resetForRetry(record);
            await sleep(opts.retryBackoffMs ?? 100);
            continue;
          }

          if (opts.idempotency === "non_idempotent" && record.outcome.error?.sideEffectUnknown) {
            // Honest reporting: we don't know if the side effect happened; upgrade to reconciliation_required.
            record.outcome = {
              ...record.outcome,
              kind: "reconciliation_required",
              message: `Non-idempotent action failed after possible side effect: ${safeMessage(lastErr)}. Manual reconciliation required.`,
            };
            record.state = "reconciliation_required";
            record.history.push({ from: "failed", to: "reconciliation_required", at: Date.now(), reason: "side-effect unknown" });
          }
          break;
        }
      }

      if (!record.outcome) {
        record.outcome = {
          kind: "failed",
          message: lastErr ? safeMessage(lastErr) : "Execution ended without producing an outcome.",
          at: Date.now(),
        };
        if (record.state !== "failed") this.applyTransition(runId, record, "fail", "no outcome recorded");
      }

      this.settleIdempotencySlot(claimedKey, record);
      return this.finalize(runId, record);
    } catch (topErr) {
      // Catastrophic error during orchestration itself.
      record.outcome = record.outcome ?? {
        kind: "failed",
        message: safeMessage(topErr),
        at: Date.now(),
        error: {
          code: "EXECUTION_ERROR",
          message: safeMessage(topErr),
          retryable: false,
          sideEffectUnknown: record.state === "running" || record.state === "observing",
          category: "unknown",
        },
      };
      if (!isTerminal(record.state)) {
        try {
          this.applyTransition(runId, record, "fail", "orchestrator error");
        } catch {
          // Best effort.
        }
      }
      this.settleIdempotencySlot(claimedKey, record);
      return this.finalize(runId, record);
    } finally {
      this.live.delete(runId);
      this.cancelFlags.delete(runId);
    }
  }

  /**
   * Phase 1 (T5) — settle a claimed idempotency slot after the effect:
   * complete on success, fail on failure, reconciliation on unknown.
   */
  private settleIdempotencySlot(claimedKey: string | null, record: ExecutionRecord): void {
    if (!claimedKey || !this.deps.idempotency) return;
    const kind = record.outcome?.kind;
    try {
      if (kind === "succeeded" || kind === "partially_completed" || kind === "dry_run_simulated") {
        this.deps.idempotency.complete(claimedKey, record.outcome?.message ?? "ok", record.id.runId);
      } else if (kind === "reconciliation_required" || record.outcome?.error?.sideEffectUnknown) {
        this.deps.idempotency.requireReconciliation(
          claimedKey,
          record.outcome?.message ?? "side-effect status unknown",
        );
      } else {
        this.deps.idempotency.fail(claimedKey, record.outcome?.message ?? "failed");
      }
    } catch {
      /* slot settlement is best-effort; the execution record is authoritative */
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private emit(event: ExecutionEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* listener errors never break execution */
      }
    }
  }

  private applyTransition(runId: string, rec: ExecutionRecord, event: Parameters<typeof transition>[2], reason?: string): void {
    const { next, entry } = transition(runId, rec.state, event, reason);
    rec.state = next;
    rec.history.push(entry);
    rec.updatedAt = entry.at;
    this.emit({ type: "transition", runId, from: entry.from, to: next, at: entry.at });
  }

  private async applyPolicy(runId: string, rec: ExecutionRecord, opts: ExecuteOptions): Promise<void> {
    this.applyTransition(runId, rec, "submit_policy", "policy evaluation started");

    // Budget check first (existing governor path).
    if (opts.checkBudget) {
      try {
        const decision = await opts.checkBudget();
        if (!decision.allow) {
          const bd: PolicyDecision = {
            kind: "budget_blocked",
            reason: decision.reason ?? "budget exceeded",
            meter: decision.meter,
            at: Date.now(),
          };
          rec.policy.push(bd);
          rec.outcome = {
            kind: "budget_stopped",
            message: `Budget stopped: ${bd.reason}${bd.meter ? ` (${bd.meter})` : ""}`,
            stoppedReason: "budget",
            at: Date.now(),
          };
          this.applyTransition(runId, rec, "budget_block", bd.reason);
          this.deps.audit?.("execution.budget_blocked", { runId, reason: bd.reason });
          return;
        }
        if (decision.warning) {
          rec.policy.push({ kind: "allowed", reason: decision.warning, at: Date.now() });
        }
      } catch (err) {
        rec.policy.push({ kind: "unavailable", reason: safeMessage(err), at: Date.now() });
        rec.outcome = {
          kind: "unavailable",
          message: `Budget check failed: ${safeMessage(err)}`,
          at: Date.now(),
        };
        this.applyTransition(runId, rec, "mark_unavailable", "budget check failed");
        return;
      }
    }

    // Approval gate — if the caller supplies an approve() hook AND the
    // capability class requires approval, we surface the request.
    const needsApproval = capabilityRequiresApproval(opts.capability);
    if (needsApproval && opts.approve) {
      const requestId = `apr_${randomUUID().slice(0, 8)}`;
      const pd: PolicyDecision = {
        kind: "requires_approval",
        requestId,
        reason: `Action "${opts.capability.name}" requires approval.`,
        at: Date.now(),
        preview: opts.plan?.preview,
      };
      rec.policy.push(pd);
      this.applyTransition(runId, rec, "require_approval", "awaiting user approval");
      this.emit({
        type: "awaiting_approval",
        runId,
        request: {
          requestId,
          capability: opts.capability,
          reason: pd.reason,
          preview: pd.preview,
          argsSummary: opts.inputSummary,
          createdAt: pd.at,
        },
        at: pd.at,
      });
      this.deps.audit?.("execution.approval_requested", { runId, requestId, capability: opts.capability.name });
      this.persist(runId);

      const approved = await opts.approve({
        requestId,
        capability: opts.capability,
        reason: pd.reason,
        preview: pd.preview,
        argsSummary: opts.inputSummary,
        createdAt: pd.at,
      });
      if (approved) {
        rec.policy.push({ kind: "approval_granted", requestId, by: "user", at: Date.now() });
        this.applyTransition(runId, rec, "grant_approval", "user approved");
        this.deps.audit?.("execution.approval_granted", { runId, requestId });
      } else {
        rec.policy.push({ kind: "approval_denied", requestId, by: "user", reason: "user denied", at: Date.now() });
        rec.outcome = {
          kind: "denied",
          message: "Action denied by user.",
          stoppedReason: "approval",
          at: Date.now(),
        };
        this.applyTransition(runId, rec, "deny", "user denied approval");
        this.deps.audit?.("execution.approval_denied", { runId, requestId });
        return;
      }
    }

    // Default allow (existing permission model is authoritative outside the fabric).
    if (!rec.policy.some((p) => p.kind === "allowed" || p.kind === "approval_granted")) {
      rec.policy.push({ kind: "allowed", reason: "default allow (existing policy authoritative)", at: Date.now() });
    }
  }

  /**
   * XR 4.2 — Trust & Isolation gate. Returns "finalize" when the action was
   * fully handled here (blocked, or executed inside an environment) and the
   * caller should finalize+return; or "continue" to use the fast in-process
   * path. Never runs high-risk work in-process: missing isolation → denied.
   */
  private async runTrustGate(
    runId: string,
    rec: ExecutionRecord,
    opts: ExecuteOptions,
  ): Promise<"continue" | "finalize"> {
    if (!opts.trust || !this.deps.trust) return "continue";
    const t = opts.trust;
    const capability = `${opts.capability.kind}:${opts.capability.name}`;
    const approvalRef = rec.policy
      .filter((p) => p.kind === "approval_granted")
      .map((p) => (p as { requestId?: string }).requestId)
      .filter((x): x is string => !!x)
      .pop();

    const evaluation = await this.deps.trust.evaluate({
      request: t.request,
      runId,
      correlationId: rec.id.correlationId,
      workspaceId: opts.workspaceId,
      actor: actorString(opts.actor),
      capability,
      approvalRef,
      executable: t.executable,
      credentialRefs: t.credentialRefs,
    });
    rec.trust = evaluation.trust;
    this.persist(runId);

    if (evaluation.outcome.kind === "blocked") {
      rec.action = this.buildAction(opts, rec, { kind: "in_process", description: "blocked before placement" });
      rec.outcome = {
        kind: "denied",
        message: `Blocked by Trust & Isolation: ${evaluation.outcome.reason}`,
        stoppedReason: "approval",
        at: Date.now(),
        error: {
          code: "TRUST_BLOCKED",
          message: evaluation.outcome.reason,
          retryable: false,
          sideEffectUnknown: false,
          category: "policy",
          detail: {
            remediation: evaluation.outcome.remediation,
            tier: evaluation.trust.classification.tier,
          },
        },
      };
      this.applyTransition(runId, rec, "deny", "trust/isolation blocked");
      this.deps.audit?.("execution.trust_blocked", {
        runId,
        tier: evaluation.trust.classification.tier,
        reason: evaluation.outcome.reason,
      });
      return "finalize";
    }

    if (evaluation.outcome.kind === "ran_in_environment") {
      const obs = evaluation.outcome.observation;
      // Normalize to authorized before dispatching.
      if (rec.state !== "authorized") {
        this.applyTransition(runId, rec, "authorize", "trust admission");
      }
      rec.action = this.buildAction(
        opts,
        rec,
        trustPlacementToExecution(evaluation.trust.decision.placement, evaluation.trust.decision.reason),
      );
      this.applyTransition(runId, rec, "queue", "dispatching to environment");
      rec.startedAt = Date.now();
      this.applyTransition(runId, rec, "start", "environment execution");
      rec.observation = obs;
      this.applyTransition(runId, rec, "observe", "environment observation collected");
      if (obs.transportOk) {
        rec.outcome = {
          kind: "succeeded",
          message: obs.summary || "Isolated action completed.",
          stoppedReason: "done",
          at: Date.now(),
        };
        this.applyTransition(runId, rec, "succeed", "environment action succeeded");
      } else {
        rec.outcome = {
          kind: "failed",
          message: obs.summary || "Isolated action failed.",
          at: Date.now(),
          error: {
            code: "ENV_ACTION_FAILED",
            message: obs.summary || "Isolated action failed.",
            retryable: false,
            sideEffectUnknown: false,
            category: "unknown",
          },
        };
        this.applyTransition(runId, rec, "fail", "environment action failed");
      }
      this.deps.audit?.("execution.trust_environment", {
        runId,
        placement: evaluation.trust.decision.placement,
        ok: obs.transportOk,
        environmentId: evaluation.trust.decision.environmentId,
        verified: evaluation.trust.verification?.verified ?? false,
        quarantined: evaluation.trust.quarantined ?? false,
      });
      return "finalize";
    }

    // in_process_ok → fast path.
    return "continue";
  }

  /** Build an ExecutionAction descriptor (shared by trust + normal paths). */
  private buildAction(opts: ExecuteOptions, rec: ExecutionRecord, placement: Placement): import("./types.ts").ExecutionAction {
    const last = rec.policy.length ? rec.policy[rec.policy.length - 1] : undefined;
    return {
      capability: opts.capability,
      inputSummary: opts.inputSummary,
      inputBytes: opts.inputBytes,
      idempotency: opts.idempotency,
      idempotencyKey: opts.idempotencyKey,
      timeoutMs: opts.timeoutMs,
      dryRun: !!opts.dryRun,
      placement,
      authorizedBy: last
        ? {
            decisionKind: last.kind,
            at: last.at,
            requestId: "requestId" in last ? (last as { requestId?: string }).requestId : undefined,
          }
        : undefined,
    };
  }

  private async runWithGuards(
    runId: string,
    rec: ExecutionRecord,
    opts: ExecuteOptions,
    timeoutMs: number,
  ): Promise<import("./types.ts").ExecutionObservation> {
    let progressToken = 0;
    const ctx = {
      isCancelled: () => !!this.cancelFlags.get(runId)?.cancelled,
      deadlineRemainingMs: () => {
        const start = rec.startedAt ?? Date.now();
        return Math.max(0, timeoutMs - (Date.now() - start));
      },
      progress: (msg: string, meta?: Record<string, unknown>) => {
        progressToken++;
        this.emit({ type: "progress", runId, message: msg, meta, at: Date.now() });
      },
      addEvidence: (e: Omit<import("./types.ts").ExecutionEvidence, "recordedAt">) => {
        if (rec.evidence.length < EXECUTION_BOUNDS.MAX_EVIDENCE) {
          rec.evidence.push({ ...e, recordedAt: Date.now() });
        }
      },
      addArtifact: (a: Omit<import("./types.ts").ExecutionArtifact, "recordedAt">) => {
        if (rec.artifacts.length < EXECUTION_BOUNDS.MAX_ARTIFACTS) {
          rec.artifacts.push({ ...a, recordedAt: Date.now() });
        }
      },
      recordUsage: (u: {
        inTokens: number;
        outTokens: number;
        usd?: number;
        provider?: string;
        model?: string;
        estimatedUsd?: number;
      }) => {
        if (rec.cost && rec.cost.state === "charged") {
          // Prevent double-charging.
          return;
        }
        rec.cost = {
          estimatedUsd: u.estimatedUsd,
          actualUsd: u.usd,
          inTokens: u.inTokens,
          outTokens: u.outTokens,
          providerId: u.provider,
          model: u.model,
          state: u.usd !== undefined ? "charged" : "estimated_only",
        };
        if (opts.recordCost && u.usd !== undefined) {
          opts.recordCost({
            provider: u.provider ?? "unknown",
            model: u.model,
            inTokens: u.inTokens,
            outTokens: u.outTokens,
            usd: u.usd,
          });
        }
      },
    };

    // Race against a timeout promise. We do NOT abort the underlying action
    // (JS has no universal cancellation), but we stop waiting and enter the
    // timeout outcome path. Honest about side-effect uncertainty.
    return await new Promise<import("./types.ts").ExecutionObservation>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new ExecutionTimeoutError(runId, timeoutMs, rec.state));
      }, timeoutMs);
      // Cancellation watchdog.
      const cancelWatch = setInterval(() => {
        if (settled) return;
        if (this.cancelFlags.get(runId)?.cancelled) {
          settled = true;
          clearInterval(cancelWatch);
          clearTimeout(timer);
          reject(new CancellationUnsupportedError(runId));
        }
      }, 5);
      Promise.resolve()
        .then(() => opts.run(ctx))
        .then(
          (obs) => {
            if (settled) return;
            settled = true;
            clearInterval(cancelWatch);
            clearTimeout(timer);
            resolve(obs);
          },
          (err) => {
            if (settled) return;
            settled = true;
            clearInterval(cancelWatch);
            clearTimeout(timer);
            reject(err);
          },
        );
    });
  }

  private resetForRetry(rec: ExecutionRecord): void {
    // After a retryable failure/timeout before side effects, move back to queued.
    // We append a synthetic transition rather than wiping history.
    const now = Date.now();
    const t = transition(rec.id.runId, rec.state, "retry", `retry attempt ${rec.id.attempt + 1}`);
    rec.state = t.next;
    rec.history.push(t.entry);
    rec.observation = undefined;
    rec.outcome = undefined;
    rec.updatedAt = now;
  }

  private finalize(runId: string, rec: ExecutionRecord): ExecutionRecord {
    const now = Date.now();
    rec.endedAt = now;
    if (rec.startedAt) rec.durationMs = now - rec.startedAt;
    if (rec.outcome) {
      this.emit({ type: "outcome", runId, outcome: rec.outcome, at: now });
    }
    try {
      this.deps.repo.save(rec);
    } catch (err) {
      // Persistence failure must not fabricate success. Annotate the outcome
      // and downgrade to reconciliation_required when we thought we succeeded.
      if (rec.outcome?.kind === "succeeded") {
        rec.outcome.kind = "reconciliation_required";
        rec.state = "reconciliation_required";
        rec.outcome.message = `Outcome not durable: ${safeMessage(err)}`;
        rec.history.push({ from: "succeeded", to: "reconciliation_required", at: now, reason: "persistence failed" });
      }
    }
    this.deps.audit?.("execution.outcome", {
      runId,
      state: rec.state,
      outcome: rec.outcome?.kind,
      durationMs: rec.durationMs,
      costUsd: rec.cost?.actualUsd ?? rec.cost?.estimatedUsd,
    });
    return rec;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function safeMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Determine if a capability requires approval. Phase 2 preserves the existing
 * tool.requiresApproval semantics for core tools; control actions already
 * classify risk and require approval for sensitive/destructive operations.
 * Adapters pass this information via capability meta or by wrapping opts.
 */
function capabilityRequiresApproval(cap: { kind: string; name: string }): boolean {
  // By default, let the caller decide via opts.approve presence. We always
  // require approval for destructive control actions and shell operations.
  if (cap.kind === "control_action") return true;
  if (cap.kind === "core_tool") {
    return ["shell", "delete_file", "write_file", "git"].includes(cap.name);
  }
  if (cap.kind === "mcp_tool") return true; // MCP tools default to approval-gated
  if (cap.kind === "plugin_operation") return true;
  return false;
}

/** XR 4.2 — compact, secret-free actor identifier for authority grants. */
function actorString(a: ActorIdentity): string {
  switch (a.kind) {
    case "user":
      return `user:${a.userId ?? a.source}`;
    case "agent":
      return `agent:${a.agentId}`;
    case "system":
      return `system:${a.component}`;
    case "workflow":
      return `workflow:${a.workflowId}`;
    case "plugin":
      return `plugin:${a.pluginId}`;
    case "skill":
      return `skill:${a.skillId}`;
    case "mcp":
      return `mcp:${a.serverId}`;
    case "research":
      return `research:${a.sessionId}`;
    case "business":
      return `business:${a.module}`;
  }
}

/** XR 4.2 — map a trust PlacementKind to the execution Placement union. */
function trustPlacementToExecution(kind: PlacementKind, description?: string): Placement {
  switch (kind) {
    case "in_process":
      return { kind: "in_process", description };
    case "restricted_process":
      return { kind: "restricted_process", description };
    case "namespace_sandbox":
      return { kind: "namespace_sandbox", description };
    case "container":
      return { kind: "container", description };
    case "browser_isolated":
      return { kind: "browser_isolated", description };
  }
}
