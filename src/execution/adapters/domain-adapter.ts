/**
 * XR 4.1 — Research & Business operation adapter.
 *
 * Minimal correlation for research sessions and business actions. These
 * adapters do not redesign research or business internals; they just wrap
 * consequential operations so they appear in the unified execution history.
 */
import type { ExecutionService } from "../service.ts";
import type {
  ActorIdentity,
  CapabilityIdentity,
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

export interface DomainOpOptions {
  service: ExecutionService;
  workspaceId: string;
  sessionId?: string;
  actor?: ActorIdentity;
  audit?: (event: string, detail: Record<string, unknown>) => void;
  timeoutMs?: number;
}

export interface DomainOpResult<T> {
  ok: boolean;
  result?: T;
  error?: string;
  executionId: string;
}

async function runDomainOp<T>(
  kind: CapabilityIdentity["kind"],
  module: string,
  name: string,
  summary: string,
  inputSummary: string,
  perform: () => Promise<T>,
  opts: DomainOpOptions,
): Promise<DomainOpResult<T>> {
  const actor = opts.actor ?? systemActor(kind);
  let out: T | undefined;
  let errMsg: string | undefined;
  const rec = await opts.service.execute({
    workspaceId: opts.workspaceId,
    sessionId: opts.sessionId,
    actor,
    intent: { summary, origin: actor },
    capability: { kind: kind as any, name, owner: module },
    placement: IN_PROCESS_PLACEMENT,
    idempotency: "idempotent_with_key",
    idempotencyKey: `${kind}:${module}:${name}:${safeJson({}).slice(0, 32)}`,
    inputSummary: inputSummary.slice(0, 4000),
    inputBytes: sizeBytes(inputSummary),
    timeoutMs: opts.timeoutMs,
    maxAttempts: 1,
    audit: opts.audit,
    run: async (): Promise<ExecutionObservation> => {
      try {
        out = await perform();
        return okObservation(`${kind}:${module}/${name} completed`, {
          meta: { module, name },
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

export function executeResearchOp<T>(
  operation: string,
  summary: string,
  input: unknown,
  perform: () => Promise<T>,
  opts: DomainOpOptions & { sessionId?: string },
): Promise<DomainOpResult<T>> {
  return runDomainOp("research_operation", "research", operation, summary, safeJson(input), perform, opts);
}

export function executeBusinessOp<T>(
  module: string,
  action: string,
  summary: string,
  input: unknown,
  perform: () => Promise<T>,
  opts: DomainOpOptions,
): Promise<DomainOpResult<T>> {
  return runDomainOp("business_action", module, action, summary, safeJson(input), perform, opts);
}
