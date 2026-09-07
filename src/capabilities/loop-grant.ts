/**
 * XR Phase 8 — agent-loop grant gate.
 *
 * Extracted from src/core/agent.ts so the waived loop does not grow: policy
 * evaluation + grant mint live here; the loop only renders deny/execute.
 */
import type { Mode } from "../core/types.ts";
import type { ToolRegistryService } from "../tools/registry-service.ts";
import { evaluatePolicy } from "./policy.ts";
import { mintGrant, type CapabilityGrant } from "./grant.ts";

export type LoopGrantGate =
  | { kind: "allow"; grant: CapabilityGrant }
  | { kind: "deny"; reason: string; denyError?: boolean }
  | { kind: "unknown" };

export function evaluateLoopGrant(input: {
  toolName: string;
  args: Record<string, unknown>;
  mode: Mode;
  cwd: string;
  runId: string;
  sessionId: string;
  registry?: ToolRegistryService;
  deniedPermissions?: readonly string[];
  denyListAbsent: boolean;
  audit: (event: string, detail: Record<string, unknown>) => void;
  egressAllowlist: readonly string[];
  allowedHosts: readonly string[];
  hardened: boolean;
  agentId?: string;
}): { gate: LoopGrantGate; denyListAbsentAudited: boolean } {
  let denyListAbsentAudited = input.denyListAbsent;
  const mint = (note?: string): CapabilityGrant => {
    const grant = mintGrant({
      capabilityId: input.toolName,
      args: input.args,
      runId: input.runId,
      taskId: input.runId,
      agentId: input.agentId,
    });
    input.audit("grant.minted", {
      grantId: grant.grantId,
      capabilityId: input.toolName,
      argsHash: grant.argsHash,
      ttlMs: grant.ttlMs,
      ...(note ? { issuedBy: note } : {}),
    });
    return grant;
  };

  if (!input.registry) {
    return { gate: { kind: "allow", grant: mint("loop") }, denyListAbsentAudited };
  }

  try {
    const deniedPermissions = input.deniedPermissions ?? [];
    if (!input.deniedPermissions && !denyListAbsentAudited) {
      denyListAbsentAudited = true;
      input.audit("capability.policy.deny_list_absent", {
        tool: input.toolName,
        note: "no workspace config provided; denying by config is disabled for this run",
      });
    }
    const decision = evaluatePolicy(
      {
        capabilityId: input.toolName,
        requestedBy: "model",
        runId: input.runId,
        sessionId: input.sessionId,
        workspaceId: input.cwd,
        arguments: input.args,
        reason: "tool call from model",
        mode: input.mode,
        cwd: input.cwd,
      },
      {
        registry: input.registry,
        deniedPermissions,
        egressAllowlist: input.egressAllowlist,
        allowedHosts: input.allowedHosts,
        cwd: input.cwd,
        hardened: input.hardened,
      },
    );
    if (!decision.allowed) {
      if (decision.reason?.includes("not found")) {
        return { gate: { kind: "unknown" }, denyListAbsentAudited };
      }
      const denyError = decision.reason === "policy_error";
      input.audit("capability.denied", {
        tool: input.toolName,
        reason: decision.reason,
        policyTrace: decision.policyTrace,
      });
      if (denyError) {
        input.audit("capability.deny_error", {
          tool: input.toolName,
          error: decision.policyTrace?.join(" ") ?? "policy evaluation failed",
          note: "denied (fail closed)",
        });
      }
      input.audit("tool.blocked", { tool: input.toolName, mode: input.mode, reason: decision.reason });
      return { gate: { kind: "deny", reason: decision.reason ?? "denied", denyError }, denyListAbsentAudited };
    }
    const grant = decision.grant ?? mint();
    if (decision.grant) {
      input.audit("grant.minted", {
        grantId: grant.grantId,
        capabilityId: input.toolName,
        argsHash: grant.argsHash,
        ttlMs: grant.ttlMs,
      });
    }
    return { gate: { kind: "allow", grant }, denyListAbsentAudited };
  } catch (e) {
    input.audit("capability.deny_error", {
      tool: input.toolName,
      error: (e as Error).message,
      note: "evaluation threw — denied (fail closed)",
    });
    input.audit("capability.denied", { tool: input.toolName, reason: "policy_error" });
    return { gate: { kind: "deny", reason: "policy_error", denyError: true }, denyListAbsentAudited };
  }
}
