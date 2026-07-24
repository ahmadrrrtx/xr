/**
 * XR 4.1 — Plugin & Skill Operation Adapter
 *
 * Minimal adapter that records canonical execution records for consequential
 * plugin/skill operations (install, invoke, lifecycle hooks that mutate state).
 * Preserves existing plugin/skill manifests, permissions, and lifecycle.
 */
import type { ExecutionService } from "../service.ts";
import type { ActorIdentity, ExecutionObservation } from "../types.ts";
import {
  IN_PROCESS_PLACEMENT,
  failObservation,
  okObservation,
  safeJson,
  sizeBytes,
  systemActor,
} from "./common.ts";
import { pluginTrustRequest, pluginTrustRequestFromPerms, skillTrustRequest } from "../../trust/tool-support.ts";

export interface OpAdapterOptions {
  service: ExecutionService;
  workspaceId: string;
  sessionId?: string;
  actor?: ActorIdentity;
  audit?: (event: string, detail: Record<string, unknown>) => void;
  timeoutMs?: number;
  /**
   * XR 4.2 — declared & granted plugin permission scopes. When provided, the
   * plugin operation is classified by its EFFECTIVE (granted) risk and records
   * declared-vs-authority (hard-boundary capabilities like shell/control/browser
   * are membrane-blocked regardless of declaration).
   */
  declaredPermissions?: string[];
  grantedPermissions?: string[];
}

export interface OpResult<T> {
  ok: boolean;
  result?: T;
  error?: string;
  executionId: string;
}

async function runOp<T>(
  kind: "plugin_operation" | "skill_operation",
  owner: string,
  operation: string,
  summary: string,
  inputSummary: string,
  perform: () => Promise<T>,
  opts: OpAdapterOptions,
  idempotent: boolean,
): Promise<OpResult<T>> {
  const actor = opts.actor ?? systemActor(kind);
  let out: T | undefined;
  let errMsg: string | undefined;

  const rec = await opts.service.execute({
    workspaceId: opts.workspaceId,
    sessionId: opts.sessionId,
    actor,
    intent: { summary, origin: actor },
    capability: { kind, name: operation, owner },
    placement: IN_PROCESS_PLACEMENT,
    // XR 4.2 — classify the operation by EFFECTIVE (granted) risk. The plugin
    // VM/worker is a process membrane, NOT a hard OS boundary; hard-boundary
    // capabilities (shell/control/browser) are membrane-blocked (declared ≠
    // authority). When permissions are supplied we record that explicitly.
    trust: {
      request:
        kind === "plugin_operation"
          ? opts.grantedPermissions || opts.declaredPermissions
            ? pluginTrustRequestFromPerms(owner, operation, opts.grantedPermissions ?? [], opts.declaredPermissions ?? [], process.cwd())
            : pluginTrustRequest(owner, operation, process.cwd())
          : skillTrustRequest(owner, operation, process.cwd()),
    },
    idempotency: idempotent ? "naturally_idempotent" : "unknown_unsafe",
    inputSummary,
    inputBytes: sizeBytes(inputSummary),
    timeoutMs: opts.timeoutMs,
    maxAttempts: 1,
    audit: opts.audit,
    run: async (): Promise<ExecutionObservation> => {
      try {
        out = await perform();
        return okObservation(`${kind}:${owner}/${operation} completed`, {
          meta: { owner, operation },
          outputBytes: sizeBytes(safeJson(out)),
        });
      } catch (err) {
        errMsg = err instanceof Error ? err.message : String(err);
        return failObservation(errMsg, { logs: [errMsg], meta: { owner, operation } });
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

export function executePluginOp<T>(
  pluginId: string,
  operation: string,
  summary: string,
  input: unknown,
  perform: () => Promise<T>,
  opts: OpAdapterOptions,
  idempotent = false,
): Promise<OpResult<T>> {
  return runOp("plugin_operation", pluginId, operation, summary, safeJson(input), perform, opts, idempotent);
}

export function executeSkillOp<T>(
  skillId: string,
  operation: string,
  summary: string,
  input: unknown,
  perform: () => Promise<T>,
  opts: OpAdapterOptions,
  idempotent = false,
): Promise<OpResult<T>> {
  return runOp("skill_operation", skillId, operation, summary, safeJson(input), perform, opts, idempotent);
}
