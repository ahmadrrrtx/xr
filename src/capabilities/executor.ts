/**
 * XR Phase 08 — Unified Capability Execution.
 *
 * Executes a capability request through the single policy boundary.
 * This is the choke point for all capability execution.
 */

import type { Tool, ToolContext } from "../core/types.ts";
import type { ToolRegistryService } from "../tools/registry-service.ts";
import type {
  CapabilityRequest,
  CapabilityDecision,
} from "./types.ts";
import { evaluatePolicy, type PolicyContext } from "./policy.ts";

export interface ExecutionContext extends PolicyContext {
  /** Tool context for execution (approve, audit, etc). */
  toolContext: ToolContext;
  /** Optional: run id for provenance. */
  runId?: string;
  /** Optional: session id. */
  sessionId?: string;
}

export interface ExecutionResult {
  readonly decision: CapabilityDecision;
  readonly result?: Awaited<ReturnType<Tool["run"]>>;
  readonly blocked: boolean;
}

/**
 * Execute a capability request through unified policy boundary.
 *
 * Flow:
 *   CapabilityRequest → Policy evaluation → Approval → Security → Execution → Audit
 *
 * Returns ExecutionResult. If blocked, result is undefined.
 */
export async function executeCapability(
  request: CapabilityRequest,
  execCtx: ExecutionContext,
): Promise<ExecutionResult> {
  const decision = evaluatePolicy(request, execCtx);

  if (!decision.allowed) {
    execCtx.toolContext.audit("capability.denied", {
      capabilityId: request.capabilityId,
      reason: decision.reason,
      requestedBy: request.requestedBy,
      runId: request.runId,
      policyTrace: decision.policyTrace,
    });
    return { decision, blocked: true };
  }

  // Approval gate
  if (decision.requiresApproval) {
    const approved = await execCtx.toolContext.approve({
      tool: request.capabilityId,
      reason: decision.reason ?? `execute ${request.capabilityId}`,
      args: request.arguments,
      preview: decision.approvalPreview,
    });
    if (!approved) {
      execCtx.toolContext.audit("capability.approval.denied", {
        capabilityId: request.capabilityId,
        requestedBy: request.requestedBy,
        runId: request.runId,
      });
      return {
        decision: { ...decision, allowed: false, reason: "approval denied by user" },
        blocked: true,
      };
    }
  }

  // Resolve and execute
  const entry = execCtx.registry.resolve(request.capabilityId);
  if (!entry) {
    execCtx.toolContext.audit("capability.resolve.failed", {
      capabilityId: request.capabilityId,
      reason: "resolve returned undefined after policy allowed",
    });
    return {
      decision: { ...decision, allowed: false, reason: "capability not resolvable after policy" },
      blocked: true,
    };
  }

  try {
    const result = await entry.tool.run(request.arguments, execCtx.toolContext);
    execCtx.toolContext.audit("capability.executed", {
      capabilityId: request.capabilityId,
      ok: result.ok,
      runId: request.runId,
      trust: decision.trust.level,
      lifecycle: decision.lifecycle,
      permissions: decision.effectivePermissions,
    });
    // Record provenance use if onToolUse present
    execCtx.toolContext.onToolUse?.({ tool: request.capabilityId, ok: result.ok });
    return { decision, result, blocked: false };
  } catch (e) {
    execCtx.toolContext.audit("capability.error", {
      capabilityId: request.capabilityId,
      error: (e as Error).message,
      runId: request.runId,
    });
    execCtx.toolContext.onToolUse?.({ tool: request.capabilityId, ok: false, error: (e as Error).message });
    return {
      decision: { ...decision, allowed: false, reason: `execution error: ${(e as Error).message}` },
      blocked: true,
    };
  }
}
