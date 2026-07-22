/**
 * XR 4.1 — Core Tool Adapter
 *
 * Wraps an existing `Tool` (from src/core/types.ts) so that it runs through
 * the execution fabric while preserving the existing ToolContext contract.
 * Existing callers keep receiving ToolResult; the fabric gets a canonical record.
 */
import type { Tool, ToolContext, ToolResult, ApprovalRequest } from "../../core/types.ts";
import type { ExecutionService } from "../service.ts";
import type {
  ActorIdentity,
  ExecutionIntent,
  ExecutionObservation,
  ExecutionRecord,
  IdempotencyClass,
} from "../types.ts";
import { EXECUTION_ADAPTER_VERSION } from "../types.ts";
import {
  IN_PROCESS_PLACEMENT,
  defaultIdempotency,
  failObservation,
  okObservation,
  redact,
  safeJson,
  sizeBytes,
} from "./common.ts";

export interface ToolAdapterOptions {
  service: ExecutionService;
  workspaceId: string;
  sessionId?: string;
  actor?: ActorIdentity;
  cwd: string;
  dryRun?: boolean;
  approve?: (req: ApprovalRequest) => Promise<boolean>;
  audit?: (event: string, detail: Record<string, unknown>) => void;
  checkBudget?: () => { allow: boolean; reason?: string; suggestLocal?: boolean; warning?: string; meter?: string } | Promise<{ allow: boolean; reason?: string; suggestLocal?: boolean; warning?: string; meter?: string }>;
  timeoutMs?: number;
}

/** Tool approval requirements map (conservative: writes/shell/git/MCP approve; reads no-approve). */
const APPROVAL_REQUIRED: Record<string, boolean> = {
  read_file: false,
  list_dir: false,
  fetch_url: false,
  web_search: false,
  check_package: false,
  system_apps: false,
  system_clipboard_read: false,
  system_volume: false,
  system_screenshot: false,
  system_battery: false,
  system_wifi: false,
  write_file: true,
  delete_file: true,
  shell: true,
  git: true,
  computer_control: true,
  system_clipboard_write: true,
  system_notify: true,
  system_open_app: true,
  system_volume_set: true,
  system_media: true,
  system_trash: true,
};

/**
 * Execute a Tool through the fabric. Returns the ToolResult (back-compat)
 * and attaches the canonical execution record to the result as a hidden
 * symbol property for internal correlation.
 */
export async function executeTool(
  tool: Tool,
  args: Record<string, unknown>,
  opts: ToolAdapterOptions,
): Promise<ToolResult & { __execution?: ExecutionRecord }> {
  const service = opts.service;
  const actor = opts.actor ?? { kind: "system", component: "tool-adapter" };
  const inputSummary = redact(safeJson({ tool: tool.name, args }));
  const capability = { kind: "core_tool" as const, name: tool.name };
  const idempotency: IdempotencyClass = defaultIdempotency(capability);
  const idempotencyKey =
    idempotency === "idempotent_with_key"
      ? `${capability.kind}:${capability.name}:${hashInput(tool.name, args)}`
      : undefined;

  const intent: ExecutionIntent = {
    summary: `tool ${tool.name}`,
    origin: actor,
    constraints: {
      dryRun: !!opts.dryRun,
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
    },
  };

  // Build a ToolContext that routes through existing audit/approval but does NOT double-record.
  // Audit calls from inside tools go through the caller's audit sink directly (preserves existing behavior).
  const toolCtx: ToolContext = {
    cwd: opts.cwd,
    approve: async (req) => {
      // Fabric handles approval at the top-level; inner approval is passed through.
      if (!opts.approve) return true;
      return opts.approve(req);
    },
    audit: (event, detail) => {
      opts.audit?.(event, detail);
    },
    dryRun: !!opts.dryRun,
  };

  let result: ToolResult = { ok: false, output: "tool did not return a result" };

  const record = await service.execute({
    workspaceId: opts.workspaceId,
    sessionId: opts.sessionId,
    actor,
    intent,
    capability,
    placement: IN_PROCESS_PLACEMENT,
    idempotency,
    idempotencyKey,
    inputSummary,
    inputBytes: sizeBytes(inputSummary),
    timeoutMs: opts.timeoutMs,
    dryRun: !!opts.dryRun,
    maxAttempts: 1, // tools don't auto-retry in Phase 2 except explicit
    approve:
      (tool.requiresApproval ?? APPROVAL_REQUIRED[tool.name] ?? false) && opts.approve
        ? async (req) => {
            // Map normalized ApprovalRequest back to legacy ApprovalRequest and delegate.
            return opts.approve!({
              tool: tool.name,
              reason: req.reason,
              args,
              preview: req.preview,
            });
          }
        : undefined,
    checkBudget: opts.checkBudget,
    audit: opts.audit,
    run: async (ctx) => {
      let obs: ExecutionObservation;
      try {
        const tr = await tool.run(args, toolCtx);
        result = tr;
        obs = okObservation(tr.output.slice(0, 4000), {
          modelFeedback: tr.output,
          meta: tr.data as Record<string, unknown> | undefined,
          outputBytes: sizeBytes(tr.output),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result = { ok: false, output: `tool error: ${msg}` };
        obs = failObservation(msg, {
          logs: [msg],
          meta: { tool: tool.name },
        });
      }
      if (result.ok) {
        ctx.addEvidence({ kind: "tool_output", reference: `tool:${tool.name}`, meta: { ok: true } });
      }
      return obs;
    },
  });

  // Map outcome back to ToolResult.
  if (record.outcome?.kind === "succeeded" || record.outcome?.kind === "dry_run_simulated") {
    if (!result.ok) result = { ok: true, output: record.observation?.summary ?? "ok" };
  } else if (record.outcome?.kind === "denied") {
    result = { ok: false, output: "denied: approval was not granted" };
  } else if (record.outcome?.kind === "budget_stopped") {
    result = { ok: false, output: `budget stopped: ${record.outcome.message}` };
  } else if (record.outcome?.kind === "cancelled") {
    result = { ok: false, output: `cancelled: ${record.outcome.message}` };
  } else if (record.outcome?.kind === "timed_out") {
    result = { ok: false, output: `timed out: ${record.outcome.message}` };
  } else if (!result.ok) {
    result = { ok: false, output: record.outcome?.message ?? result.output };
  }

  return Object.assign(result, { __execution: record, [Symbol.for("xr.execution")]: record.id.runId });
}

function hashInput(tool: string, args: Record<string, unknown>): string {
  // Fast stable hash (Bun hashing) — do NOT use for security, only duplicate suppression.
  try {
    const s = `${tool}|${JSON.stringify(args, Object.keys(args).sort())}`;
    const n = (Bun as any).hash?.(s) as number | bigint | undefined;
    if (n != null) return String(n).slice(0, 16);
    // Fallback: FNV-1a 32-bit hash to stay deterministic.
    let h = 0x811c9dc5;
    const buf = Buffer.from(s, "utf8");
    for (let i = 0; i < buf.length; i++) {
      h ^= buf[i]!;
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, "0").slice(0, 16);
  } catch {
    return `${tool}|unknown`;
  }
}

// Ensure version is referenced so tree-shaking keeps the constant.
void EXECUTION_ADAPTER_VERSION;
