/**
 * XR 4.1 — Workflow/Task Correlation Adapter
 *
 * Provides helpers to correlate multi-agent workflow tasks with canonical
 * execution records without redesigning workflow graph execution.
 */
import type { ExecutionService } from "../service.ts";
import type {
  ActorIdentity,
  ExecutionObservation,
} from "../types.ts";
import {
  IN_PROCESS_PLACEMENT,
  failObservation,
  okObservation,
  safeJson,
  sizeBytes,
  systemActor,
} from "./common.ts";

export interface TaskAdapterOptions {
  service: ExecutionService;
  workspaceId: string;
  workflowId: string;
  taskId: string;
  actor?: ActorIdentity;
  audit?: (event: string, detail: Record<string, unknown>) => void;
  timeoutMs?: number;
}

export interface TaskExecutionResult<T> {
  ok: boolean;
  result?: T;
  error?: string;
  executionId: string;
}

export async function executeWorkflowTask<T>(
  name: string,
  inputSummary: string,
  perform: () => Promise<T>,
  opts: TaskAdapterOptions,
): Promise<TaskExecutionResult<T>> {
  const actor = opts.actor ?? systemActor("workflow");
  let out: T | undefined;
  let errMsg: string | undefined;
  const rec = await opts.service.execute({
    workspaceId: opts.workspaceId,
    workflowId: opts.workflowId,
    taskId: opts.taskId,
    actor,
    intent: {
      summary: `workflow task ${opts.workflowId}/${opts.taskId}: ${name}`,
      origin: actor,
    },
    capability: { kind: "workflow_task", name, owner: opts.workflowId },
    placement: IN_PROCESS_PLACEMENT,
    idempotency: "non_idempotent",
    inputSummary: inputSummary.slice(0, 4000),
    inputBytes: sizeBytes(inputSummary),
    timeoutMs: opts.timeoutMs,
    maxAttempts: 1,
    audit: opts.audit,
    run: async (): Promise<ExecutionObservation> => {
      try {
        out = await perform();
        return okObservation(`task ${opts.taskId} completed`, {
          meta: { workflowId: opts.workflowId, taskId: opts.taskId },
          outputBytes: sizeBytes(safeJson(out)),
        });
      } catch (err) {
        errMsg = err instanceof Error ? err.message : String(err);
        return failObservation(errMsg, { logs: [errMsg] });
      }
    },
  });
  const ok = rec.outcome?.kind === "succeeded";
  return {
    ok,
    result: ok ? out : undefined,
    error: ok ? undefined : errMsg ?? rec.outcome?.message,
    executionId: rec.id.runId,
  };
}
