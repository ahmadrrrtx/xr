/**
 * XR 4.1 — Core Tool Adapter
 *
 * Wraps an existing `Tool` (from src/core/types.ts) so that it runs through
 * the execution fabric while preserving the existing ToolContext contract.
 * Existing callers keep receiving ToolResult; the fabric gets a canonical record.
 */
import { randomUUID } from "node:crypto";
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
  /** Phase 4 · T1 — hardened mode: high-risk tools refuse host-authority fallbacks. */
  hardened?: boolean;
  /** Phase 4 · T4 — explicit raw-IP/loopback destinations (local runtimes). */
  allowedHosts?: string[];
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
  write_file: true,
  delete_file: true,
  shell: true,
  git: true,
  computer_control: true,
  system_clipboard_write: true,
  system_notify: true,
  system_open_app: true,
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
      // Phase 2 · F-06 — fail-closed: with no approval authority wired, an
      // approval-requiring tool is DENIED. The fabric handles approval at
      // the top level and passes the surface's approver through; an absent
      // approver can never silently auto-approve (no-bypass invariant).
      if (!opts.approve) return false;
      return opts.approve(req);
    },
    audit: (event, detail) => {
      opts.audit?.(event, detail);
    },
    dryRun: !!opts.dryRun,
    hardened: opts.hardened ?? true,
    allowedHosts: opts.allowedHosts ?? [],
    // XR 4.2 / Phase 4 · T1 — when a Trust service is wired, expose an
    // isolated runner so high-risk tools (e.g. shell) execute inside a
    // verified environment and FAIL CLOSED when required isolation is
    // unavailable. When no Trust service is wired, `hardened` (default true)
    // still prevents the legacy host-authority fallback.
    runIsolated: service.trust
      ? async (req, exec) => {
          const trustSvc = service.trust!;
          // Phase 4 · T1 — the run identity spans the session/workspace so the
          // escalate-only lattice persists across tool calls within a run.
          const runId = opts.sessionId ?? opts.workspaceId;
          const ev = await trustSvc.evaluate({
            request: req,
            runId,
            correlationId: runId,
            workspaceId: opts.workspaceId,
            actor: `${actor.kind}`,
            capability: `${capability.kind}:${capability.name}`,
            executable: exec,
          });
          if (ev.outcome.kind === "blocked") {
            return { ok: false, exitCode: null, stdout: "", stderr: ev.outcome.reason, timedOut: false, blocked: true, reason: ev.outcome.reason };
          }
          if (ev.outcome.kind === "ran_in_environment") {
            const o = ev.outcome.observation;
            return {
              ok: o.transportOk,
              exitCode: typeof o.statusCode === "number" ? o.statusCode : null,
              stdout: String(o.meta?.stdout ?? ""),
              stderr: (o.logs ?? []).join("\n"),
              timedOut: Boolean(o.meta?.timedOut),
              blocked: false,
              placement: ev.trust.decision.placement,
              verified: ev.trust.verification?.verified ?? false,
            };
          }
          // A tool that asked for isolation must not be served in-process.
          return { ok: false, exitCode: null, stdout: "", stderr: "expected isolated placement for high-risk tool", timedOut: false, blocked: true, reason: "expected isolated placement" };
        }
      : undefined,
  };

  let result: ToolResult = { ok: false, output: "tool did not return a result" };

  // XR 4.2 — let the tool declare its objective risk facts for the trust gate.
  // Tools that isolate themselves (e.g. shell via runIsolated) return undefined
  // here; the rest get classified/placed/recorded by the fabric.
  const declaredTrust = tool.trustRequest ? tool.trustRequest(args, toolCtx) : undefined;

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
    trust: declaredTrust ? { request: declaredTrust } : undefined,
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
