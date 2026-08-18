/**
 * XR Phase 2 · T2 — Tool registry contracts.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Before Phase 2, XR had FOUR disjoint registration sites:
 *
 *   src/tools/registry.ts    a module-level `const ALL: Tool[]` array literal
 *   src/plugins/registry.ts  PluginRegistry  + manager.pluginTools()
 *   src/mcp/registry.ts      McpRegistry     + manager.mcpTools()
 *   src/skills/registry.ts   SkillRegistry   + runtime.executionContext()
 *
 * Nothing unified them, nothing namespaced them, and nothing arbitrated a name
 * collision. The agent loop resolved a call with
 *
 *     getTool(call.tool) ?? extraToolMap.get(call.tool)
 *
 * — core first, contributions second — while advertising BOTH to the model.
 * A plugin contributing a tool called `shell` was therefore listed to the model
 * as an available capability but silently executed the CORE `shell`, and the
 * reverse ordering elsewhere could execute the plugin. That is collision-based
 * privilege confusion, and it is what the namespacing below removes.
 *
 * ── What is unified and what is NOT ─────────────────────────────────────────
 *
 * Unified: REGISTRATION and DISCOVERY. One service, one place to register, one
 * place to ask "what can this run?".
 *
 * NOT unified: RUNTIME SEMANTICS (Constitution Art. XIV/XV). A core tool is an
 * in-process function; a plugin tool is permissioned code in a worker sandbox;
 * an MCP tool is a remote JSON-RPC call; a skill is a PROMPT CONTRIBUTION and
 * is never callable as a tool at all. Each keeps its own `kind`, its own
 * invocation path, and its own contract test. Collapsing them into one runtime
 * abstraction is explicitly forbidden.
 */

import type { Mode, Tool } from "../core/types.ts";

/**
 * The four extension kinds XR supports. The discriminator is load-bearing: it
 * selects the invocation semantics and is asserted by the per-kind contract
 * tests in test/tools/semantics-contract.test.ts.
 */
export type ToolKind = "core" | "plugin" | "mcp" | "skill";

/** Namespace prefix owned by each kind. `core` is reserved and unforgeable. */
export const NAMESPACE: Record<ToolKind, string> = {
  core: "core",
  plugin: "plugin",
  mcp: "mcp",
  skill: "skill",
};

/**
 * Why an entry is not callable under its bare name.
 *
 *  · `none`        — the bare name is unambiguous and resolves to this entry.
 *  · `core_reserved` — a non-core entry tried to take a core tool's bare name.
 *                    The core tool keeps the bare name; this entry stays
 *                    callable ONLY by its qualified id. Nothing is silently
 *                    swapped in either direction.
 *  · `ambiguous`   — two or more non-core entries claim the same bare name, so
 *                    NEITHER gets it (fail closed, Art. IV.4). Both remain
 *                    callable by qualified id.
 */
export type ShadowReason = "none" | "core_reserved" | "ambiguous";

/**
 * Unified capability lifecycle — reused from capabilities plane to avoid
 * duplicate taxonomies. Must stay in sync with src/capabilities/types.ts
 * CAPABILITY_LIFECYCLE_STATES.
 */
export type CapabilityLifecycleState =
  | "discovered"
  | "verified"
  | "installed"
  | "enabled"
  | "disabled"
  | "quarantined"
  | "revoked"
  | "rolled_back"
  | "removed"
  | "error"
  | "unknown";

export type CapabilityTrustLevel = "official" | "verified" | "community" | "unknown" | "quarantined";
export type CapabilityScope = "workspace" | "session" | "agent" | "shared" | "host";
export type CapabilityRiskTier = "tier0" | "tier1" | "tier2" | "blocked" | "unknown";
export type CapabilityPermission = string;

/**
 * A registered, callable tool. `id` is always namespace-qualified and unique;
 * `name` is the bare name the model sees when (and only when) this entry owns it.
 *
 * Phase 08 — extended with unified capability metadata (lifecycle, trust,
 * scope, permissions, provider, version, provenance) to make the registry the
 * canonical capability discovery + binding boundary.
 */
export interface RegisteredTool {
  /** Namespace-qualified, globally unique: `core:read_file`, `plugin:acme:deploy`. */
  readonly id: string;
  /** Bare tool name as declared by the contribution. */
  readonly name: string;
  readonly kind: ToolKind;
  /** Contributing unit: plugin id, MCP server id, or "core". */
  readonly source: string;
  /** The executable contract. Its `run()` retains the kind's own semantics. */
  readonly tool: Tool;
  /** Whether the bare name resolves here, and if not, why. */
  readonly shadowed: ShadowReason;
  /**
   * The name presented to the model. Equals `name` when unshadowed, and the
   * qualified `id` when shadowed — so a shadowed tool is still reachable, but
   * never by a name that means something else.
   */
  readonly exposedName: string;

  // ── Phase 08 — unified capability metadata (additive, optional for backward compat) ──

  /** Lifecycle state — enabled means runnable, disabled/quarantined means blocked. */
  readonly lifecycle?: CapabilityLifecycleState;
  /** Trust level. */
  readonly trustLevel?: CapabilityTrustLevel;
  /** Where authority applies. */
  readonly scope?: CapabilityScope;
  /** Unified permission scopes required. */
  readonly permissions?: CapabilityPermission[];
  /** Risk tier. */
  readonly riskTier?: CapabilityRiskTier;
  /** Provider id (e.g. "core", "plugin:acme"). */
  readonly providerId?: string;
  /** Version string. */
  readonly version?: string;
  /** Source hash / checksum, if any. */
  readonly sourceHash?: string;
  /** Provenance actor/reason. */
  readonly provenance?: {
    source?: string;
    sourceUrl?: string;
    installedAt?: number;
    trustDecision?: string;
    reason?: string;
  };
}

/**
 * A skill contribution. Deliberately NOT a `Tool`: a prompt-pack skill has no
 * `run()`, contributes system-prompt guidance, and must never be invocable.
 * The registry stores it in a separate collection with a separate accessor so
 * the type system prevents it from reaching a tool-call path.
 */
export interface RegisteredSkill {
  readonly id: string;
  readonly kind: "skill";
  readonly source: string;
  /** System-prompt text this skill contributes when selected. */
  readonly prompt: string;
  /** Tool names the skill's manifest declares it guides the use of. */
  readonly declaredTools: readonly string[];
}

/** What a contribution source hands to the registry. */
export interface ToolContribution {
  readonly kind: Exclude<ToolKind, "skill">;
  readonly source: string;
  readonly tools: readonly Tool[];
}

export interface SkillContribution {
  readonly kind: "skill";
  readonly source: string;
  readonly prompt: string;
  readonly declaredTools?: readonly string[];
}

/** Discovery filter — Phase 08 extends with trust/lifecycle/scope/permission. */
export interface DiscoveryOptions {
  readonly mode: Mode;
  /** Allow-list of bare or qualified names; when set, nothing else is offered. */
  readonly allow?: readonly string[];
  /** Deny-list of bare or qualified names, applied after `allow`. */
  readonly deny?: readonly string[];
  /** Phase 08 — only these lifecycle states (default: enabled). */
  readonly lifecycle?: readonly CapabilityLifecycleState[];
  /** Phase 08 — only these trust levels. */
  readonly trustLevels?: readonly CapabilityTrustLevel[];
  /** Phase 08 — only these scopes. */
  readonly scopes?: readonly CapabilityScope[];
  /** Phase 08 — must have all these permissions. */
  readonly requiresPermissions?: readonly CapabilityPermission[];
  /** Phase 08 — must have none of these permissions. */
  readonly excludesPermissions?: readonly CapabilityPermission[];
  /** Phase 08 — max risk tier. */
  readonly maxRiskTier?: CapabilityRiskTier;
  /** Phase 08 — enabledOnly default true for model-visible. */
  readonly enabledOnly?: boolean;
}

export interface CapabilityMetadata {
  lifecycle?: CapabilityLifecycleState;
  trustLevel?: CapabilityTrustLevel;
  scope?: CapabilityScope;
  permissions?: CapabilityPermission[];
  riskTier?: CapabilityRiskTier;
  providerId?: string;
  version?: string;
  sourceHash?: string;
  provenance?: {
    source?: string;
    sourceUrl?: string;
    installedAt?: number;
    trustDecision?: string;
    reason?: string;
  };
}

export interface EnhancedToolContribution extends ToolContribution {
  readonly metadata?: Record<string, CapabilityMetadata>;
}

export interface LifecycleAuditEvent {
  capabilityId: string;
  provider: string;
  version: string;
  source: string;
  sourceHash?: string;
  trustLevel: CapabilityTrustLevel;
  previousState: CapabilityLifecycleState;
  newState: CapabilityLifecycleState;
  actor: string;
  timestamp: number;
  scope: CapabilityScope;
  reason?: string;
  runId?: string;
  sessionId?: string;
}

/** A collision the registry arbitrated, surfaced for diagnostics and audit. */
export interface ToolCollision {
  readonly name: string;
  readonly winner: string | null;
  readonly shadowed: readonly string[];
  readonly reason: Exclude<ShadowReason, "none">;
}
