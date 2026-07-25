/**
 * XR 4.3 — Execution history & recovery CLI command.
 * `xr execution [--json] [--limit N] [--session SID] [--run RUNID] [--recovery] [--resume RUNID]`
 */
import { WorkspaceStore } from "../state/workspace-store.ts";
import { ExecutionRepo, adaptWorkspaceStore } from "../execution/repository.ts";
import { formatLine, STATE_LABEL, OUTCOME_LABEL, RECOVERY_STATE_LABEL, RECOVERY_CLASSIFICATION_LABEL } from "../execution/inspection.ts";
import type { ExecutionSummary, RecoveryStatus } from "../execution/types.ts";
import { CheckpointManager } from "../execution/checkpoint.ts";
import { RecoveryManager } from "../execution/recovery.ts";
import { LeaseManager } from "../execution/lease.ts";
import type { ExecutionDb } from "../execution/repository.ts";

interface ExecutionCmdArgs {
  json?: boolean;
  limit?: number;
  session?: string;
  run?: string;
  workspace?: string;
  recovery?: boolean;
  resume?: string;
  cancel?: string;
}

export async function runExecutionCmd(args: ExecutionCmdArgs = {}): Promise<void> {
  const store = WorkspaceStore.lastOpened() ?? new WorkspaceStore("default");
  const repo = new ExecutionRepo(adaptWorkspaceStore(store));
  repo.migrate();

  // XR 4.3 — Phase 4 recovery managers (for the recovery sub-commands)
  const db = repo.rawDb;
  const checkpoints = new CheckpointManager(db);
  checkpoints.migrate();
  const leases = new LeaseManager(db);
  leases.migrate();
  const recovery = new RecoveryManager(db, checkpoints, leases);
  recovery.migrate();

  const workspaceId = store.workspaceId;

  // ── XR 4.3 — Recovery status mode ────────────────────────────────────
  if (args.recovery) {
    const interrupted = repo.findInterrupted(workspaceId);
    if (interrupted.length === 0) {
      console.log(`No interrupted executions found in workspace "${workspaceId}".`);
      return;
    }

    const statuses: RecoveryStatus[] = interrupted.map((r) => recovery.buildStatus(r));

    if (args.json) {
      console.log(JSON.stringify(statuses, null, 2));
      return;
    }

    console.log(`Recovery status (workspace: ${workspaceId}, showing ${statuses.length}):
`);
    for (const s of statuses) {
      const stateIcon = s.safeToResume ? "⚠" : "✗";
      const stateLabel = RECOVERY_STATE_LABEL[s.recoveryState] ?? s.recoveryState;
      const classLabel = s.classification ? RECOVERY_CLASSIFICATION_LABEL[s.classification] ?? s.classification : "unknown";
      console.log(`  ${stateIcon} ${s.runId}`);
      console.log(`     State:        ${stateLabel}`);
      console.log(`     Class:        ${classLabel}`);
      console.log(`     Safe resume:  ${s.safeToResume ? "yes" : "no"}`);
      if (s.blockedReason) console.log(`     Blocked:      ${s.blockedReason}`);
      if (s.lastCheckpoint) console.log(`     Checkpoint:   ${s.lastCheckpoint} (${s.lastCheckpointAt ? new Date(s.lastCheckpointAt).toISOString() : "?"})`);
      if (s.checkpointProgress) console.log(`     Progress:     ${s.checkpointProgress}`);
      if (s.environmentState) console.log(`     Environment:  ${s.environmentState}`);
      console.log("");
    }
    return;
  }

  // ── XR 4.3 — Resume command ──────────────────────────────────────────
  if (args.resume) {
    const runId = args.resume;
    const record = repo.get(runId);
    if (!record) {
      console.error(`execution ${runId} not found`);
      process.exitCode = 1;
      return;
    }

    // Classify recovery
    const classification = recovery.classify(record);
    console.log(`Classification: ${classification.classification}`);
    console.log(`Action:         ${classification.action}`);
    console.log(`Reason:         ${classification.reason}`);

    if (classification.action === "blocked") {
      console.error(`Cannot resume: ${classification.reason}`);
      process.exitCode = 1;
      return;
    }

    if (classification.action === "requires_approval") {
      const { confirm } = await import("../interfaces/cli.ts");
      const approved = await confirm(
        `Resume execution ${runId}? Side-effect status is unknown. ` +
        `Non-idempotent actions may have already executed. Continue?`,
        false,
      );
      if (!approved) {
        console.log("Resume cancelled by user.");
        return;
      }
    }

    // Record the recovery decision as user-decided
    recovery.recordDecision("execution", runId, "auto_resume", classification.classification,
      classification.reason, "user");

    // Reset state for re-execution
    record.state = "queued";
    record.observation = undefined;
    record.outcome = undefined;
    record.updatedAt = Date.now();
    record.id.attempt++;
    record.retryCount = (record.retryCount ?? 0) + 1;
    record.history.push({ from: "reconciliation_required", to: "queued", at: Date.now(), reason: "user resumed after recovery" });

    try {
      repo.save(record);
      console.log(`Execution ${runId} resumed (attempt ${record.id.attempt}).`);
    } catch (err) {
      console.error(`Failed to persist resume: ${(err as Error).message}`);
      process.exitCode = 1;
    }
    return;
  }

  // ── XR 4.3 — Durable cancel ─────────────────────────────────────────
  if (args.cancel) {
    const runId = args.cancel;
    const record = repo.get(runId);
    if (!record) {
      console.error(`execution ${runId} not found`);
      process.exitCode = 1;
      return;
    }

    recovery.requestCancellation("execution", runId, "user", "user requested cancellation via CLI");
    recovery.acknowledgeCancellation("execution", runId, record.state === "running" || record.state === "observing");

    console.log(`Cancellation requested for ${runId} (durable — survives restart).`);
    return;
  }

  // ── Normal execution view ────────────────────────────────────────────
  if (args.run) {
    const rec = repo.get(args.run);
    if (!rec) {
      console.error(`execution ${args.run} not found`);
      process.exitCode = 1;
      return;
    }
    if (args.json) {
      console.log(JSON.stringify(rec, null, 2));
      return;
    }
    console.log(`Run:        ${rec.id.runId}`);
    console.log(`Correl:     ${rec.id.correlationId}`);
    console.log(`State:      ${STATE_LABEL[rec.state]}`);
    console.log(`Actor:      ${rec.actor.kind}`);
    console.log(`Capability: ${rec.action?.capability.kind}:${rec.action?.capability.name}`);
    console.log(`Placement:  ${rec.action?.placement.kind}`);
    console.log(`Attempt:    ${rec.id.attempt}`);
    console.log(`Created:    ${new Date(rec.createdAt).toISOString()}`);
    if (rec.startedAt) console.log(`Started:    ${new Date(rec.startedAt).toISOString()}`);
    if (rec.endedAt) console.log(`Ended:      ${new Date(rec.endedAt).toISOString()}`);
    if (rec.durationMs != null) console.log(`Duration:   ${rec.durationMs}ms`);
    if (rec.outcome) {
      console.log(`Outcome:    ${OUTCOME_LABEL[rec.outcome.kind]}`);
      console.log(`Message:    ${rec.outcome.message}`);
    }
    if (rec.cost) {
      console.log(`Cost:       ${rec.cost.state} $${(rec.cost.actualUsd ?? rec.cost.estimatedUsd ?? 0).toFixed(6)}`);
    }
    // XR 4.3 — Show recovery status if applicable
    const cp = checkpoints.getLatestCheckpoint(args.run);
    if (cp) {
      console.log(`Checkpoint: ${cp.kind} (safe: ${cp.sideEffectSafe}, ${new Date(cp.createdAt).toISOString()})`);
      console.log(`Progress:   ${cp.progressSummary}`);
    }
    const durableCancel = recovery.getDurableCancellation("execution", args.run);
    if (durableCancel) {
      console.log(`Cancel:     requested ${new Date(durableCancel.requestedAt).toISOString()}${durableCancel.acknowledged ? " (acknowledged)" : ""}${durableCancel.sideEffectPossible ? " [side-effect possible]" : ""}`);
    }
    return;
  }

  const summaries: ExecutionSummary[] = repo.query({
    workspaceId,
    sessionId: args.session,
    limit: Math.min(args.limit ?? 20, 200),
  });

  if (args.json) {
    console.log(JSON.stringify(summaries, null, 2));
    return;
  }

  if (summaries.length === 0) {
    console.log(`No execution records yet in workspace "${workspaceId}".`);
    return;
  }
  const color = process.stdout.isTTY;
  console.log(`Execution history (workspace: ${workspaceId}, showing ${summaries.length})`);
  for (const s of summaries) {
    console.log(formatLine(s, { color }));
  }
}
