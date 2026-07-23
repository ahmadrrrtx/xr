/**
 * XR 4.1 — Execution history CLI command.
 * `xr execution [--json] [--limit N] [--session SID] [--run RUNID]`
 */
import { WorkspaceStore } from "../state/workspace-store.ts";
import { ExecutionRepo, adaptWorkspaceStore } from "../execution/repository.ts";
import { formatLine, STATE_LABEL, OUTCOME_LABEL } from "../execution/inspection.ts";
import type { ExecutionSummary } from "../execution/types.ts";

interface ExecutionCmdArgs {
  json?: boolean;
  limit?: number;
  session?: string;
  run?: string;
  workspace?: string;
}

export async function runExecutionCmd(args: ExecutionCmdArgs = {}): Promise<void> {
  const store = WorkspaceStore.lastOpened() ?? new WorkspaceStore("default");
  const repo = new ExecutionRepo(adaptWorkspaceStore(store));
  repo.migrate();

  const workspaceId = store.workspaceId;

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
