/**
 * XR 4.2 — Tool-facing Trust helpers
 *
 * Small, reusable builders that let a capability (tool/MCP/plugin) declare its
 * objective risk facts and an isolated-execution form, so the trust subsystem
 * can place it correctly. A capability developer answers, in one place:
 *   - what risk tier this operation requires (derived from objective facts),
 *   - what resources/authority it needs,
 *   - the command form that runs inside an environment.
 *
 * The classifier — not the caller — decides the tier from these facts.
 */
import type { EnvironmentExecutable, TrustRequest } from "./types.ts";

export interface ShellTrustSpecOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Network destinations the command will touch (hostnames/URLs). */
  networkTargets?: string[];
  /** Whether the command needs credentials (drives task-scoped brokering). */
  needsCredentials?: boolean;
  /** Actor kind for the authority grant (default "user"). */
  actorKind?: string;
}

/**
 * Build the TrustRequest + EnvironmentExecutable for a shell command. The
 * command is treated as arbitrary code execution (Tier 2): it must run inside
 * an enforceable environment or be blocked — never silently in-process.
 */
export function shellTrustSpec(
  cmd: string,
  cwd: string,
  opts: ShellTrustSpecOptions = {},
): { request: TrustRequest; executable: EnvironmentExecutable } {
  const request: TrustRequest = {
    capability: { kind: "core_tool", name: "shell" },
    actorKind: opts.actorKind ?? "user",
    summary: `shell: ${cmd.slice(0, 120)}`,
    spawnsProcess: true,
    runsArbitraryCode: true,
    networkTargets: opts.networkTargets ?? [],
    fsPaths: [cwd],
    touchesOutsideWorkspace: false,
    needsCredentials: opts.needsCredentials ?? false,
    reversible: false,
    irreversibleExternalWrite: false,
    untrustedContent: false,
    dryRun: false,
    workspaceRoot: cwd,
  };
  const executable: EnvironmentExecutable = {
    argv: ["bash", "-lc", cmd],
    cwd,
    env: {},
    timeoutMs: opts.timeoutMs ?? 120_000,
    maxOutputBytes: opts.maxOutputBytes ?? 4 * 1024 * 1024,
  };
  return { request, executable };
}

function base(name: string, cwd: string, over: Partial<TrustRequest>): TrustRequest {
  return {
    capability: { kind: "core_tool", name },
    actorKind: "user",
    summary: `${name}`,
    spawnsProcess: false,
    runsArbitraryCode: false,
    networkTargets: [],
    fsPaths: [],
    touchesOutsideWorkspace: false,
    needsCredentials: false,
    reversible: true,
    irreversibleExternalWrite: false,
    untrustedContent: false,
    dryRun: false,
    workspaceRoot: cwd,
    ...over,
  };
}

/** Read-only in-workspace action → Tier 0 (fast path). */
export function readTrustRequest(name: string, cwd: string): TrustRequest {
  return base(name, cwd, { controlRisk: "safe" });
}

/** In-workspace filesystem mutation → Tier 1 (capability-confined). */
export function workspaceWriteTrustRequest(name: string, cwd: string, paths: string[]): TrustRequest {
  return base(name, cwd, { fsPaths: paths, reversible: false, controlRisk: "sensitive" });
}

/** Egress-gated network access → Tier 1 with a network allowlist. */
export function networkTrustRequest(name: string, cwd: string, targets: string[]): TrustRequest {
  return base(name, cwd, { networkTargets: targets, controlRisk: "sensitive" });
}

/** Local git mutation (commit/branch/stash) → Tier 1. */
export function gitMutateTrustRequest(name: string, cwd: string): TrustRequest {
  return base(name, cwd, { fsPaths: [cwd], reversible: false, controlRisk: "sensitive" });
}

/**
 * MCP tool/resource/prompt risk facts. The MCP client already confines the
 * stdio child environment (allow-listed env, no shell metacharacters), so an
 * MCP *call* is classified by its side-effect class, not as arbitrary process
 * spawning: tools → Tier 1 (sensitive), resource/prompt reads → Tier 0.
 * (Full Tier-2 sandboxing of arbitrary external MCP servers is future work.)
 */
export function mcpTrustRequest(
  capKind: "mcp_tool" | "mcp_resource" | "mcp_prompt",
  name: string,
  serverId: string,
  transport: string | undefined,
  cwd: string,
): TrustRequest {
  const isTool = capKind === "mcp_tool";
  const isNetwork = transport !== undefined && transport !== "stdio";
  return base(`mcp:${capKind}:${name}`, cwd, {
    capability: { kind: capKind, name, owner: serverId },
    spawnsProcess: false, // the MCP server is pre-spawned + env-confined by the client
    networkTargets: isNetwork ? [serverId] : [],
    reversible: !isTool,
    controlRisk: isTool ? "sensitive" : "safe",
  });
}

/**
 * Control / computer-use / browser action risk facts. The control plane already
 * classifies safe/sensitive/destructive and the browser already enforces its
 * own sandbox/root policy; here we map that to a trust tier and record it.
 * Destructive control actions drive the real host display/browser, so they are
 * flagged requiresHostAuthority (Tier 2 admitted with an elevated gate, never
 * treated as low-risk, and never wrongly blocked).
 */
export function controlTrustRequest(
  actionType: string,
  riskLevel: "safe" | "sensitive" | "destructive",
  cwd: string,
): TrustRequest {
  return base(`control:${actionType}`, cwd, {
    capability: { kind: "control_action", name: actionType },
    controlRisk: riskLevel,
    reversible: riskLevel === "safe",
    requiresHostAuthority: riskLevel === "destructive",
  });
}

/**
 * Plugin operation risk facts. The plugin VM/worker is a process-level membrane,
 * NOT a hard OS boundary; plugin operations are classified Tier 1 (recorded,
 * capability-confined). Routing high-risk plugin code into a Tier-2 sandbox is
 * future work — declared permissions are NOT treated as authority.
 */
export function pluginTrustRequest(pluginId: string, operation: string, cwd: string): TrustRequest {
  return base(`plugin:${pluginId}:${operation}`, cwd, {
    capability: { kind: "plugin_operation", name: operation, owner: pluginId },
    controlRisk: "sensitive",
    reversible: false,
  });
}

/** Skill operation risk facts (Tier 1, capability-confined, recorded). */
export function skillTrustRequest(skillId: string, operation: string, cwd: string): TrustRequest {
  return base(`skill:${skillId}:${operation}`, cwd, {
    capability: { kind: "skill_operation", name: operation, owner: skillId },
    controlRisk: "sensitive",
    reversible: false,
  });
}

// ── Plugin capability tier model ──────────────────────────────────────────

/**
 * Plugin permissions that REQUIRE a hard kernel boundary (arbitrary process /
 * GUI / web authority). The plugin VM membrane BLOCKS these (no child_process,
 * net, http, or Bun.spawn), so a plugin that merely DECLARES them cannot
 * exercise them — declared permission is NOT authority. XR 4.2 cannot run
 * plugin VM code inside a namespace sandbox, so these capabilities are denied
 * rather than silently allowed in-process.
 */
export const PLUGIN_HARD_BOUNDARY_PERMS = ["shell", "control", "browser"] as const;

/** Plugin permissions that handle credentials (Tier 2, mediated by the host). */
export const PLUGIN_CREDENTIAL_PERMS = ["secrets"] as const;

export type PluginPermTier = "tier0_in_process" | "tier1_restricted" | "tier2_isolated";

/** Map a single plugin permission scope to a risk tier. */
export function pluginCapabilityTier(perm: string): PluginPermTier {
  if ((PLUGIN_HARD_BOUNDARY_PERMS as readonly string[]).includes(perm)) return "tier2_isolated";
  if ((PLUGIN_CREDENTIAL_PERMS as readonly string[]).includes(perm)) return "tier2_isolated";
  if (perm === "net") return "tier1_restricted"; // egress-gated by the host
  if (perm === "fs:write" || perm === "memory:write" || perm === "provider" || perm === "mcp") return "tier1_restricted";
  return "tier0_in_process"; // fs:read, memory:read, ui, voice
}

export interface PluginRiskAssessment {
  /** Highest tier among GRANTED permissions (what the plugin can actually do). */
  effectiveTier: PluginPermTier;
  /** Declared permissions that require a hard boundary the VM cannot provide. */
  requiresHardBoundary: string[];
  /**
   * Declared hard-boundary permissions that are effectively DENIED by the VM
   * membrane (declared ≠ authority). These are the "or blocked" outcome.
   */
  membraneBlocked: string[];
  /** Declared but not granted. */
  declaredNotGranted: string[];
  /** True if any granted permission is Tier 2 (credentials). */
  grantedCredentialAccess: boolean;
}

const TIER_RANK: Record<PluginPermTier, number> = { tier0_in_process: 0, tier1_restricted: 1, tier2_isolated: 2 };

/**
 * Assess a plugin's effective risk from its DECLARED vs GRANTED permissions.
 * Makes "declared permission is not authority" explicit: hard-boundary
 * capabilities (shell/control/browser) are membrane-blocked regardless of
 * declaration; only granted capabilities contribute to the effective tier.
 */
export function assessPluginRisk(declared: readonly string[], granted: readonly string[]): PluginRiskAssessment {
  const grantedSet = new Set(granted);
  let effectiveTier: PluginPermTier = "tier0_in_process";
  for (const g of granted) {
    const t = pluginCapabilityTier(g);
    if (TIER_RANK[t] > TIER_RANK[effectiveTier]) effectiveTier = t;
  }
  const requiresHardBoundary = declared.filter((p) => (PLUGIN_HARD_BOUNDARY_PERMS as readonly string[]).includes(p));
  // The membrane denies raw process/GUI/web authority even if granted/declared.
  const membraneBlocked = requiresHardBoundary.slice();
  const declaredNotGranted = declared.filter((p) => !grantedSet.has(p));
  const grantedCredentialAccess = granted.some((p) => (PLUGIN_CREDENTIAL_PERMS as readonly string[]).includes(p));
  return { effectiveTier, requiresHardBoundary, membraneBlocked, declaredNotGranted, grantedCredentialAccess };
}

/**
 * Build a plugin TrustRequest reflecting its EFFECTIVE (granted) risk and
 * recording declared-vs-authority. Hard-boundary declarations are noted as
 * membrane-blocked. Used by the plugin adapter to record trust metadata.
 */
export function pluginTrustRequestFromPerms(
  pluginId: string,
  operation: string,
  granted: readonly string[],
  declared: readonly string[],
  cwd: string,
): TrustRequest {
  const assessment = assessPluginRisk(declared, granted);
  const controlRisk: "safe" | "sensitive" | "destructive" =
    assessment.effectiveTier === "tier2_isolated"
      ? "destructive"
      : assessment.effectiveTier === "tier1_restricted"
        ? "sensitive"
        : "safe";
  return base(`plugin:${pluginId}:${operation}`, cwd, {
    capability: { kind: "plugin_operation", name: operation, owner: pluginId },
    needsCredentials: assessment.grantedCredentialAccess,
    controlRisk,
    reversible: assessment.effectiveTier === "tier0_in_process",
  });
}

/**
 * A capability that legitimately requires HOST authority and cannot be isolated
 * (GUI/computer-use, host browser). Tier 2 + requiresHostAuthority → admitted
 * with an explicit elevated-gate decision rather than blocked.
 */
export function hostAuthorityTrustRequest(name: string, cwd: string, over: Partial<TrustRequest> = {}): TrustRequest {
  return base(name, cwd, {
    controlRisk: "destructive",
    reversible: false,
    requiresHostAuthority: true,
    ...over,
  });
}
