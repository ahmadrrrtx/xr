/**
 * XR Phase 06 · Step 37 — honest unresolved-work summary for `xr status`.
 *
 * Reads the execution store read-only and reports the durable-execution
 * picture in the runtime's own vocabulary:
 *
 *   running / interrupted / recoverable / needs_approval / blocked
 *
 * Discovery counts are NOT recovery claims — nothing here says "recovered";
 * it reports what exists and what needs attention. Never throws: a missing or
 * damaged store reports `{ available: false }` instead of crashing `xr status`.
 */

import { WorkspaceStore } from "../state/workspace-store.ts";
import { ExecutionRepo, adaptWorkspaceStore } from "./repository.ts";
import { CheckpointManager } from "./checkpoint.ts";
import { LeaseManager } from "./lease.ts";
import { RecoveryManager } from "./recovery.ts";

export interface RecoveryWorkSummary {
  /** False when no workspace store could be opened (nothing to report). */
  available: boolean;
  workspaceId?: string;
  /** Executions whose records are still in-flight (queued/running/observing/…). */
  interrupted: number;
  /** Classified safe to auto-resume from a verified checkpoint. */
  recoverable: number;
  /** Side-effect status unknown — a human must approve any resume. */
  needsApproval: number;
  /** Cannot resume (cancellation pending, audit/authority/checkpoint invalid, env lost). */
  blocked: number;
  /** Live leases held by this or other processes (active ownership). */
  activeLeases: number;
  /** Last checkpoint-prune completion timestamp (maintenance meta), if any. */
  checkpointPruneLastAt?: number;
  /** Present only when opening/reading the store failed. */
  error?: string;
}

/** Build the summary. Bounded, read-only, secret-free, exception-safe. */
export function collectRecoveryWorkSummary(): RecoveryWorkSummary {
  try {
    const store = WorkspaceStore.lastOpened() ?? new WorkspaceStore("default");
    const repo = new ExecutionRepo(adaptWorkspaceStore(store));
    repo.migrate();

    const db = repo.rawDb;
    const checkpoints = new CheckpointManager(db);
    checkpoints.migrate();
    const leases = new LeaseManager(db);
    leases.migrate();
    const recovery = new RecoveryManager(db, checkpoints, leases);
    recovery.migrate();

    const workspaceId = store.workspaceId;
    const interruptedRecords = repo.findInterrupted(workspaceId);

    let recoverable = 0;
    let needsApproval = 0;
    let blocked = 0;
    for (const record of interruptedRecords) {
      const c = recovery.classify(record);
      if (c.action === "auto_resume") recoverable++;
      else if (c.action === "requires_approval") needsApproval++;
      else blocked++;
    }

    const activeLeases = leases.getWorkspaceLeases(workspaceId).length;
    const lastPruneRaw = checkpoints.getMaintenanceMeta("checkpoint_prune_last_at");
    const checkpointPruneLastAt = lastPruneRaw ? Number.parseInt(lastPruneRaw, 10) : undefined;

    return {
      available: true,
      workspaceId,
      interrupted: interruptedRecords.length,
      recoverable,
      needsApproval,
      blocked,
      activeLeases,
      ...(Number.isFinite(checkpointPruneLastAt) ? { checkpointPruneLastAt } : {}),
    };
  } catch (e) {
    return {
      available: false,
      interrupted: 0,
      recoverable: 0,
      needsApproval: 0,
      blocked: 0,
      activeLeases: 0,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
  // NOTE: the store is intentionally NOT closed here — WorkspaceStore is the
  // process-scoped single writer (Phase 1 invariant) and `xr status` exits
  // right after; closing it could race other users of the same handle.
}
