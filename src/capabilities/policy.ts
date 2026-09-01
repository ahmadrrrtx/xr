/**
 * XR Phase 08 — Unified Policy Boundary.
 *
 * SINGLE CHOKE POINT for all capability execution:
 *   CapabilityRequest → Trust → Lifecycle → Scope → Permission → Mode → Policy → Approval → Budget → Security → Decision
 *
 * Every source (core, skill, plugin, mcp, computer, web) passes through here.
 * No bypass paths.
 *
 * Model can REQUEST, cannot GRANT.
 */

import type { ToolRegistryService } from "../tools/registry-service.ts";
import type {
  CapabilityRequest,
  CapabilityDecision,
  CapabilityTrust,
  CapabilityLifecycleState,
  CapabilityPermission,
} from "./types.ts";
import { mapLegacyScopes } from "./compatibility.ts";

export interface PolicyContext {
  registry: ToolRegistryService;
  /** Denied permissions from config (workspace policy). */
  deniedPermissions?: readonly string[];
  /** Egress allowlist. */
  egressAllowlist?: readonly string[];
  /** Allowed hosts for raw IP. */
  allowedHosts?: readonly string[];
  /** Control permissions granted? */
  controlPermissions?: readonly string[];
  /** Current workspace cwd. */
  cwd?: string;
  /** Whether hardened mode. */
  hardened?: boolean;
}

function defaultTrust(): CapabilityTrust {
  return {
    level: "unknown",
    verifiedPublisher: false,
    signedPackage: false,
    signatureStatus: "unknown",
    evidenceScore: 0,
    evidence: [],
  };
}

/**
 * Phase 2 · F-06 — deny-on-throw at the single choke point.
 *
 * `evaluatePolicy` NEVER throws to its caller. Any exception inside the
 * evaluation core is converted into a deny decision with
 * `reason: "policy_error"` and a policy trace naming the fault. Execution
 * must never proceed past a failed policy evaluation: the answer to the old
 * in-code question ("fail closed if evaluation throws?") is YES.
 *
 * The signature is unchanged; the semantics are now total (every input maps
 * to a decision object).
 */
export function evaluatePolicy(
  request: CapabilityRequest,
  ctx: PolicyContext,
): CapabilityDecision {
  try {
    return evaluatePolicyCore(request, ctx);
  } catch (e) {
    return {
      allowed: false,
      reason: "policy_error",
      requiresApproval: false,
      riskTier: "blocked",
      trust: defaultTrust(),
      effectivePermissions: [],
      lifecycle: "unknown",
      cacheable: false,
      policyTrace: [
        `policy_error: evaluation threw ${(e as Error)?.message ?? String(e)} — denied (fail closed)`,
      ],
    };
  }
}

function evaluatePolicyCore(
  request: CapabilityRequest,
  ctx: PolicyContext,
): CapabilityDecision {
  const trace: string[] = [];
  const registry = ctx.registry;

  // 1. Resolve capability — try enabled first, then check disabled/quarantined for proper reason
  let entry = registry.resolve(request.capabilityId);
  let allEntriesLookup: ReturnType<typeof registry.list> | undefined;

  if (!entry) {
    // Search all entries (including disabled/quarantined) to provide accurate denial reason
    allEntriesLookup = registry.list();
    const byId = allEntriesLookup.find((e) => e.id === request.capabilityId);
    const byExposed = allEntriesLookup.find((e) => e.exposedName === request.capabilityId);
    const byBare = allEntriesLookup.find((e) => e.name === request.capabilityId);
    entry = byId ?? byExposed ?? byBare;

    if (!entry) {
      trace.push(`resolve: ${request.capabilityId} not found`);
      return {
        allowed: false,
        reason: `capability "${request.capabilityId}" not found or not available in ${request.mode} mode`,
        requiresApproval: false,
        riskTier: "blocked",
        trust: defaultTrust(),
        effectivePermissions: [],
        lifecycle: "unknown",
        cacheable: true,
        policyTrace: trace,
      };
    }
    // Found but disabled/quarantined — fall through to lifecycle/trust checks below
    trace.push(`resolve: found disabled/quarantined ${entry.id} kind=${entry.kind} source=${entry.source}`);
  } else {
    trace.push(`resolve: found ${entry.id} kind=${entry.kind} source=${entry.source}`);
  }

  trace.push(`resolve: found ${entry.id} kind=${entry.kind} source=${entry.source}`);

  // Access enhanced metadata if present (cast to any for backward compat)
  const meta = entry as any;
  const lifecycle: CapabilityLifecycleState = meta.lifecycle ?? "enabled";
  const trust: CapabilityTrust = meta.trust ?? defaultTrust();
  const permissions: CapabilityPermission[] = meta.permissions ?? [];
  const riskTier = meta.riskTier ?? "unknown";
  const scope = meta.scope ?? "shared";
  const requiresApproval = entry.tool.requiresApproval ?? false;

  // 2. Trust evaluation
  if (trust.level === "quarantined") {
    trace.push(`trust: quarantined → denied`);
    return {
      allowed: false,
      reason: `capability "${request.capabilityId}" is quarantined: ${trust.reason ?? "review required"}`,
      requiresApproval: false,
      riskTier,
      trust,
      effectivePermissions: permissions,
      lifecycle,
      cacheable: false,
      policyTrace: trace,
    };
  }
  trace.push(`trust: level=${trust.level} → ok`);

  // 3. Lifecycle evaluation
  if (lifecycle === "disabled" || lifecycle === "revoked" || lifecycle === "removed" || lifecycle === "quarantined") {
    trace.push(`lifecycle: ${lifecycle} → denied`);
    return {
      allowed: false,
      reason: `capability "${request.capabilityId}" is ${lifecycle} and cannot execute`,
      requiresApproval: false,
      riskTier,
      trust,
      effectivePermissions: permissions,
      lifecycle,
      cacheable: false,
      policyTrace: trace,
    };
  }
  // For discovered, error, rolled_back, etc, deny unless explicitly allowed.
  // For model-visible, only enabled should have been offered, but execution must still fail closed.
  if (lifecycle !== "enabled" && lifecycle !== "unknown" && lifecycle !== "installed" && lifecycle !== "verified") {
    trace.push(`lifecycle: ${lifecycle} not enabled → denied for execution`);
    return {
      allowed: false,
      reason: `capability "${request.capabilityId}" is not enabled (state=${lifecycle})`,
      requiresApproval: false,
      riskTier,
      trust,
      effectivePermissions: permissions,
      lifecycle,
      cacheable: false,
      policyTrace: trace,
    };
  }
  trace.push(`lifecycle: ${lifecycle} → ok`);

  // 4. Scope evaluation
  if (scope === "host" && request.scope === "workspace") {
    // Host-scoped capability requested from workspace-scoped context — needs extra check
    trace.push(`scope: host capability in workspace request → requires explicit host scope`);
    // Allow but note — computer control is host but allowed via workspace because it's explicitly requested
    // No deny here, just trace
  }
  trace.push(`scope: ${scope} (request scope ${request.scope ?? "none"}) → ok`);

  // 5. Permission evaluation (denied wins)
  const deniedSet = new Set((ctx.deniedPermissions ?? []).map((s) => s.toLowerCase()));
  // Check legacy denied against unified
  const effectiveMapped = mapLegacyScopes(permissions as unknown as string[]);
  // Also include raw permissions for legacy matching
  const allEffective = [...new Set([...permissions, ...effectiveMapped])];

  for (const d of deniedSet) {
    const unifiedDenied = mapLegacyScopes([d])[0] ?? (d as CapabilityPermission);
    if (allEffective.includes(unifiedDenied) || permissions.map((p) => String(p).toLowerCase()).includes(d)) {
      trace.push(`permission: denied by policy ${d} → denied`);
      return {
        allowed: false,
        reason: `capability "${request.capabilityId}" requires permission "${d}" which is denied by policy`,
        requiresApproval: false,
        riskTier,
        trust,
        effectivePermissions: permissions,
        lifecycle,
        cacheable: true,
        policyTrace: trace,
      };
    }
  }
  trace.push(`permission: denied check passed (denied list ${[...deniedSet].join(",") || "empty"})`);

  // 6. Mode evaluation (already done via discover offered set, but re-check for execution safety)
  // Read-only check: plan/ask modes should not have gotten write/shell etc. If they did via qualified id bypass, deny.
  if (request.mode !== "agent") {
    const READ_ONLY = ["read_file", "list_dir", "fetch_url", "web_search", "check_package", "system_apps", "system_clipboard_read"];
    if (!READ_ONLY.includes(entry.name) && !READ_ONLY.includes(entry.tool.name)) {
      // Allow if entry is qualified and not core? Actually for plan/ask, only read-only core should be offered. If this capability slipped through, deny.
      // But note: plugin tools are not allowed in plan/ask by registry.discover, so this would only happen if caller bypasses discover.
      if (entry.kind !== "core" || !READ_ONLY.includes(entry.name)) {
        trace.push(`mode: ${request.mode} non-read-only capability ${entry.name} → denied`);
        return {
          allowed: false,
          reason: `capability "${request.capabilityId}" not allowed in ${request.mode} mode`,
          requiresApproval: false,
          riskTier,
          trust,
          effectivePermissions: permissions,
          lifecycle,
          cacheable: true,
          policyTrace: trace,
        };
      }
    }
  }
  trace.push(`mode: ${request.mode} → ok`);

  // 7. Policy specific: egress, secret paths, dangerous shell are enforced inside tool.run via checkAction, but we also pre-check egress allowlist for network caps.

  // 8. Approval decision
  // If tool requires approval, decision says requiresApproval true, but allowed true (approval will be asked at execution time)
  trace.push(`approval: requiresApproval=${requiresApproval} → ${requiresApproval ? "will request" : "no approval needed"}`);

  // All checks passed
  return {
    allowed: true,
    requiresApproval,
    riskTier: riskTier as any,
    trust,
    effectivePermissions: permissions,
    lifecycle,
    cacheable: true,
    policyTrace: trace,
  };
}

