/**
 * XR 4.1 — MCP Adapter
 *
 * Normalizes MCP tool calls, resource reads, and prompt retrievals through
 * the execution fabric. Preserves server/transport identity and existing
 * approval/budget/audit wrappers.
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
  redact,
  safeJson,
  sizeBytes,
  systemActor,
} from "./common.ts";

export interface McpAdapterOptions {
  service: ExecutionService;
  workspaceId: string;
  sessionId?: string;
  actor?: ActorIdentity;
  serverId: string;
  /** Transport label (stdio, http, ...) — for inspection only. */
  transport?: string;
  audit?: (event: string, detail: Record<string, unknown>) => void;
  approve?: (req: {
    kind: "tool" | "resource" | "prompt";
    serverId: string;
    name: string;
    args?: Record<string, unknown>;
    reason: string;
  }) => Promise<boolean>;
  checkBudget?: () => { allow: boolean; reason?: string } | Promise<{ allow: boolean; reason?: string }>;
  dryRun?: boolean;
  timeoutMs?: number;
}

export interface McpExecutionResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
  executionId: string;
}

async function runMcp<T>(
  kind: CapabilityIdentity extends { kind: infer K } ? K : never,
  capKind: "mcp_tool" | "mcp_resource" | "mcp_prompt",
  name: string,
  args: Record<string, unknown> | undefined,
  perform: () => Promise<T>,
  opts: McpAdapterOptions,
): Promise<McpExecutionResult<T>> {
  const actor = opts.actor ?? systemActor(`mcp:${opts.serverId}`);
  const inputSummary = redact(safeJson({ kind, name, args }));
  let out: T | undefined;
  let errMsg: string | undefined;

  const rec = await opts.service.execute({
    workspaceId: opts.workspaceId,
    sessionId: opts.sessionId,
    actor,
    intent: {
      summary: `MCP ${kind} ${opts.serverId}/${name}`,
      origin: actor,
      correlationMeta: { serverId: opts.serverId, transport: opts.transport ?? "stdio" },
    },
    capability: { kind: capKind, name, owner: opts.serverId },
    placement: IN_PROCESS_PLACEMENT,
    idempotency: capKind === "mcp_tool" ? "unknown_unsafe" : "naturally_idempotent",
    inputSummary,
    inputBytes: sizeBytes(inputSummary),
    timeoutMs: opts.timeoutMs,
    dryRun: !!opts.dryRun,
    maxAttempts: 1,
    approve:
      capKind === "mcp_tool" && opts.approve
        ? async () =>
            opts.approve!({
              kind: "tool",
              serverId: opts.serverId,
              name,
              args,
              reason: `MCP tool ${opts.serverId}/${name}`,
            })
        : undefined,
    checkBudget: opts.checkBudget,
    audit: opts.audit,
    run: async (ctx): Promise<ExecutionObservation> => {
      try {
        out = await perform();
        ctx.addEvidence({
          kind: "mcp_response",
          reference: `${opts.serverId}/${capKind}/${name}`,
          meta: { transport: opts.transport ?? "stdio" },
        });
        return okObservation(`MCP ${capKind} ${name} completed`, {
          meta: { serverId: opts.serverId, name },
          outputBytes: sizeBytes(safeJson(out)),
        });
      } catch (err) {
        errMsg = err instanceof Error ? err.message : String(err);
        return failObservation(errMsg, { logs: [errMsg], meta: { serverId: opts.serverId, name } });
      }
    },
  });

  const ok = rec.outcome?.kind === "succeeded" || rec.outcome?.kind === "dry_run_simulated";
  return {
    ok,
    result: ok ? out : undefined,
    error: ok ? undefined : (errMsg ?? rec.outcome?.message ?? "MCP execution failed"),
    executionId: rec.id.runId,
  };
}

export async function executeMcpTool<T = unknown>(
  name: string,
  args: Record<string, unknown>,
  perform: () => Promise<T>,
  opts: McpAdapterOptions,
): Promise<McpExecutionResult<T>> {
  return runMcp("tool" as any, "mcp_tool", name, args, perform, opts);
}

export async function readMcpResource<T = unknown>(
  uri: string,
  perform: () => Promise<T>,
  opts: McpAdapterOptions,
): Promise<McpExecutionResult<T>> {
  return runMcp("resource" as any, "mcp_resource", uri, undefined, perform, opts);
}

export async function getMcpPrompt<T = unknown>(
  name: string,
  args: Record<string, unknown> | undefined,
  perform: () => Promise<T>,
  opts: McpAdapterOptions,
): Promise<McpExecutionResult<T>> {
  return runMcp("prompt" as any, "mcp_prompt", name, args, perform, opts);
}
