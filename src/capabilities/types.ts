/**
 * XR Phase 08 — Unified Capability System: core domain types.
 *
 * This module defines the ONE semantic capability model that XR's
 * execution fabric uses regardless of whether a capability originates
 * from CORE, SKILL, PLUGIN, MCP, COMPUTER CONTROL, or WEB.
 *
 * Design constraints:
 * - Reuse existing XR trust/verification concepts where possible (no duplicate taxonomies).
 * - Do NOT collapse runtime semantics: a skill prompt-pack never becomes callable.
 * - Keep ToolRegistryService as canonical registration/discovery boundary (enhanced).
 * - Model REQUESTS but never GRANTS.
 * - Every state change auditable via hash-chained audit + provenance graph.
 */

import type { Tool, Mode } from "../core/types.ts";
import type { ToolKind } from "../tools/registry-types.ts";

// ---------------------------------------------------------------------------
// Provider — who provides the capability, unforgeable, derived from kind.
// ---------------------------------------------------------------------------

export type CapabilityProviderKind =
  | "core"
  | "skill"
  | "plugin"
  | "mcp"
  | "computer"
  | "web"
  | "provider"
  | "workflow"
  | "integration"
  | "artifact";

export interface CapabilityProvider {
  /** Kind of provider (unforgeable, derived from ToolKind). */
  readonly kind: CapabilityProviderKind;
  /** Provider id: e.g. "core", "skill:academic-research", "plugin:acme", "mcp:github" */
  readonly id: string;
  /** Human readable name. */
  readonly name?: string;
  /** Version of provider, if applicable. */
  readonly version?: string;
}

// ---------------------------------------------------------------------------
// Permission — single semantic permission scope, denied-wins.
// ---------------------------------------------------------------------------

/**
 * Unified permission scope strings.
 * Canonical set — legacy enums map into these via compatibility layer.
 */
export const CAPABILITY_PERMISSIONS = [
  // filesystem
  "filesystem.read",
  "filesystem.write",
  "filesystem.delete",
  // runtime
  "runtime.shell",
  "runtime.execute",
  // network / web
  "network.fetch",
  "network.search",
  "network.package",
  // browser / computer control
  "browser.control",
  "computer.input",
  "computer.desktop",
  "computer.browser",
  "computer.system",
  "computer.file_read",
  "computer.file_write",
  // control (legacy, compat)
  "control",
  // MCP
  "mcp.execute",
  // provider / model
  "provider.chat",
  "provider.embedding",
  // memory / context
  "memory.read",
  "memory.write",
  "context.read",
  // secrets
  "secrets.read",
  // workflow / integration
  "workflow.run",
  "integration.execute",
  // generic
  "unknown",
] as const;

export type CapabilityPermission = (typeof CAPABILITY_PERMISSIONS)[number];

export interface CapabilityPermissionDeclaration {
  /** Unified scope, e.g. "filesystem.read" */
  readonly scope: CapabilityPermission;
  /** Human reason. */
  readonly reason?: string;
  /** Whether dangerous (requires approval). */
  readonly dangerous?: boolean;
  /** Optional paths/domains that scope is limited to. */
  readonly paths?: string[];
  readonly domains?: string[];
  /** Where declaration originated. */
  readonly declaredBy: "manifest" | "registry" | "adapter" | "policy" | "tool" | "unknown";
}

export interface CapabilityAuthorityVector {
  readonly declared: CapabilityPermission[];
  readonly granted: CapabilityPermission[];
  readonly denied: CapabilityPermission[];
  readonly effective: CapabilityPermission[];
  readonly undetermined: boolean;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Trust — how trustworthy the provider/capability is.
// Reuses existing XR trust/verification concepts.
// ---------------------------------------------------------------------------

export const TRUST_LEVELS = [
  "official",   // XR core, verified publisher, signed, builtin
  "verified",   // Marketplace verified
  "community",  // Unverified but hash recorded, community
  "unknown",    // First seen, no verification
  "quarantined",// Security alert, untrusted
] as const;

export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const SIGNATURE_STATUSES = ["valid", "invalid", "unsigned", "unknown", "unverified"] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

export interface CapabilityTrust {
  /** Trust level. */
  readonly level: TrustLevel;
  /** Publisher verified. */
  readonly verifiedPublisher: boolean;
  /** Package signed. */
  readonly signedPackage: boolean;
  /** Signature status. */
  readonly signatureStatus: SignatureStatus;
  /** Key id that signed, if any. */
  readonly keyId?: string;
  /** Evidence score (higher = more evidence). */
  readonly evidenceScore: number;
  /** Human readable evidence list. */
  readonly evidence: string[];
  /** Certification status, if any. */
  readonly certificationStatus?: "unknown" | "self-tested" | "xr-tested" | "verified" | "quarantined" | "legacy";
  /** Vulnerability status. */
  readonly vulnerabilityStatus?: "none-known" | "unknown" | "flagged" | "quarantined";
  /** Maintenance status. */
  readonly maintenanceStatus?: "active" | "unknown" | "deprecated" | "abandoned";
  /** Additional reason/detail. */
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Scope — where authority applies.
// ---------------------------------------------------------------------------

export const CAPABILITY_SCOPES = ["workspace", "session", "agent", "shared", "host"] as const;
export type CapabilityScope = (typeof CAPABILITY_SCOPES)[number];

// ---------------------------------------------------------------------------
// Lifecycle — honest lifecycle with valid transitions.
// ---------------------------------------------------------------------------

export const CAPABILITY_LIFECYCLE_STATES = [
  "discovered",
  "verified",
  "installed",
  "enabled",
  "disabled",
  "quarantined",
  "revoked",
  "rolled_back",
  "removed",
  "error",
  "unknown",
] as const;

export type CapabilityLifecycleState = (typeof CAPABILITY_LIFECYCLE_STATES)[number];

export interface CapabilityLifecycleTransition {
  readonly from: CapabilityLifecycleState;
  readonly to: CapabilityLifecycleState;
  readonly allowed: boolean;
  readonly requiresApproval?: boolean;
  readonly reason?: string;
}

/**
 * Valid lifecycle transitions.
 * Only trusted control-plane operations may perform these.
 * Model cannot transition.
 */
export const LIFECYCLE_TRANSITIONS: CapabilityLifecycleTransition[] = [
  { from: "discovered", to: "verified", allowed: true },
  { from: "verified", to: "installed", allowed: true },
  { from: "installed", to: "enabled", allowed: true },
  { from: "installed", to: "disabled", allowed: true },
  { from: "discovered", to: "installed", allowed: true },
  { from: "discovered", to: "enabled", allowed: true },
  { from: "enabled", to: "disabled", allowed: true },
  { from: "disabled", to: "enabled", allowed: true },
  { from: "enabled", to: "quarantined", allowed: true, requiresApproval: true, reason: "security alert" },
  { from: "disabled", to: "quarantined", allowed: true, requiresApproval: true },
  { from: "quarantined", to: "disabled", allowed: true, requiresApproval: true, reason: "clear quarantine, review required" },
  { from: "quarantined", to: "enabled", allowed: false, reason: "must clear quarantine first" },
  { from: "enabled", to: "revoked", allowed: true, requiresApproval: true },
  { from: "disabled", to: "revoked", allowed: true, requiresApproval: true },
  { from: "quarantined", to: "revoked", allowed: true, requiresApproval: true },
  { from: "installed", to: "revoked", allowed: true, requiresApproval: true },
  { from: "enabled", to: "rolled_back", allowed: true },
  { from: "disabled", to: "rolled_back", allowed: true },
  { from: "rolled_back", to: "disabled", allowed: true },
  { from: "rolled_back", to: "enabled", allowed: false, reason: "permissions require review after rollback" },
  { from: "installed", to: "removed", allowed: true },
  { from: "disabled", to: "removed", allowed: true },
  { from: "revoked", to: "removed", allowed: true },
  { from: "unknown", to: "discovered", allowed: true },
  { from: "error", to: "discovered", allowed: true },
  { from: "error", to: "disabled", allowed: true },
];

export function isValidTransition(from: CapabilityLifecycleState, to: CapabilityLifecycleState): boolean {
  return LIFECYCLE_TRANSITIONS.some((t) => t.from === from && t.to === to && t.allowed);
}

// ---------------------------------------------------------------------------
// Provenance — WHAT, WHO, WHEN, WHERE, version, hash, trust, policy, scope.
// ---------------------------------------------------------------------------

export interface CapabilityProvenance {
  /** WHAT capability? */
  readonly capabilityId: string;
  /** WHO provided it? */
  readonly provider: CapabilityProvider;
  /** WHO enabled it? */
  readonly actor?: string;
  /** WHEN? */
  readonly timestamp: number;
  /** FROM WHERE? source url/path/registry */
  readonly source?: string;
  /** WHICH version? */
  readonly version?: string;
  /** WHICH hash/signature? */
  readonly sourceHash?: string;
  readonly signature?: string;
  /** WHICH trust decision? */
  readonly trustDecision?: string;
  /** WHICH policy decision? */
  readonly policyDecision?: string;
  /** WHICH scope? */
  readonly scope?: CapabilityScope;
  /** Which execution/run? */
  readonly runId?: string;
  readonly sessionId?: string;
  /** Reason/detail. */
  readonly reason?: string;
  /** Previous/new lifecycle for transitions. */
  readonly previousState?: CapabilityLifecycleState;
  readonly newState?: CapabilityLifecycleState;
}

// ---------------------------------------------------------------------------
// Capability — atomic authorized action.
// ---------------------------------------------------------------------------

export type CapabilitySource =
  | "builtin"
  | "bundled"
  | "local"
  | "git"
  | "url"
  | "registry"
  | "marketplace"
  | "plugin"
  | "mcp"
  | "config"
  | "manual"
  | "unknown";

export const CAPABILITY_RISK_TIERS = ["tier0", "tier1", "tier2", "blocked", "unknown"] as const;
export type CapabilityRiskTier = (typeof CAPABILITY_RISK_TIERS)[number];

export const CAPABILITY_PLACEMENTS = [
  "in_process",
  "restricted_process",
  "namespace_sandbox",
  "container",
  "remote_service",
  "provider_api",
  "workflow_engine",
  "prompt_runtime",
  "unknown",
] as const;
export type CapabilityPlacement = (typeof CAPABILITY_PLACEMENTS)[number];

export interface Capability {
  /** Namespace-qualified globally unique id: core:read_file, plugin:acme:deploy, mcp:github:create_issue */
  readonly id: string;
  /** Bare name: read_file, deploy, create_issue */
  readonly name: string;
  /** Version string. */
  readonly version: string;
  /** Human description. */
  readonly description: string;
  /** Who provides it. */
  readonly provider: CapabilityProvider;
  /** Where it came from. */
  readonly source: CapabilitySource;
  readonly sourceUrl?: string;
  /** Permission requirements. */
  readonly permissions: CapabilityPermissionDeclaration[];
  /** Effective authority vector (computed). */
  readonly effective: CapabilityAuthorityVector;
  /** Trust signals. */
  readonly trust: CapabilityTrust;
  /** Where authority applies. */
  readonly scope: CapabilityScope;
  /** Lifecycle state. */
  readonly lifecycle: CapabilityLifecycleState;
  /** Provenance. */
  readonly provenance: CapabilityProvenance;
  /** Execution binding kind. */
  readonly kind: ToolKind;
  /** Underlying tool or prompt. */
  readonly execution: Tool | { prompt: string; declaredTools: string[] };
  /** Placement. */
  readonly placement: CapabilityPlacement;
  /** Risk tier. */
  readonly riskTier: CapabilityRiskTier;
  /** Whether requires approval. */
  readonly requiresApproval: boolean;
  /** Shadowed reason (collision arbitration). */
  readonly shadowed?: "none" | "core_reserved" | "ambiguous";
  /** Name exposed to model (qualified when shadowed). */
  readonly exposedName: string;
}

// ---------------------------------------------------------------------------
// Capability Request — what model requests, not grants.
// ---------------------------------------------------------------------------

export interface CapabilityRequest {
  /** Which capability? qualified id or bare name. */
  readonly capabilityId: string;
  /** Who requested? e.g. "model", "agent:primary" */
  readonly requestedBy: string;
  /** Run/session context. */
  readonly runId?: string;
  readonly sessionId?: string;
  /** Scope context. */
  readonly scope?: CapabilityScope;
  readonly workspaceId?: string;
  /** Arguments for tool. */
  readonly arguments: Record<string, unknown>;
  /** Human reason/explanation. */
  readonly reason?: string;
  /** Mode: agent, plan, ask */
  readonly mode: Mode;
  /** Workspace path for scope check. */
  readonly cwd?: string;
}

// ---------------------------------------------------------------------------
// Capability Decision — policy evaluation outcome.
// ---------------------------------------------------------------------------

export interface CapabilityDecision {
  /** Allowed to execute? */
  readonly allowed: boolean;
  /** If not allowed, why. */
  readonly reason?: string;
  /** If allowed but requires approval, what kind. */
  readonly requiresApproval: boolean;
  /** Approval preview. */
  readonly approvalPreview?: string;
  /** Risk tier of capability. */
  readonly riskTier: CapabilityRiskTier;
  /** Trust of capability. */
  readonly trust: CapabilityTrust;
  /** Effective permissions. */
  readonly effectivePermissions: CapabilityPermission[];
  /** Lifecycle state. */
  readonly lifecycle: CapabilityLifecycleState;
  /** Whether this decision is cacheable. */
  readonly cacheable: boolean;
  /** Policy evaluation steps for audit. */
  readonly policyTrace: string[];
}

// ---------------------------------------------------------------------------
// Capability Discovery Query — safe discovery pipeline filters.
// ---------------------------------------------------------------------------

export interface CapabilityDiscoveryQuery {
  readonly mode: Mode;
  readonly task?: string;
  /** Allow-list of bare or qualified names; when set, nothing else offered. */
  readonly allow?: readonly string[];
  /** Deny-list of bare or qualified names, applied after allow. */
  readonly deny?: readonly string[];
  /** Trust filter: only these levels. */
  readonly trustLevels?: readonly TrustLevel[];
  /** Exclude quarantined/revoked by default. */
  readonly excludeQuarantined?: boolean;
  readonly excludeRevoked?: boolean;
  /** Scope filter. */
  readonly scopes?: readonly CapabilityScope[];
  /** Permission filter: must have all. */
  readonly requiresPermissions?: readonly CapabilityPermission[];
  /** Exclude permissions. */
  readonly excludesPermissions?: readonly CapabilityPermission[];
  /** Risk tier max. */
  readonly maxRiskTier?: CapabilityRiskTier;
  /** Locality. */
  readonly locality?: "local" | "private" | "internet" | "any";
  /** Enabled only? default true for model-visible. */
  readonly enabledOnly?: boolean;
  /** Limit. */
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Audit event for capability lifecycle transitions.
// ---------------------------------------------------------------------------

export interface CapabilityLifecycleAudit {
  readonly capabilityId: string;
  readonly provider: CapabilityProvider;
  readonly version: string;
  readonly source: string;
  readonly sourceHash?: string;
  readonly trustLevel: TrustLevel;
  readonly previousState: CapabilityLifecycleState;
  readonly newState: CapabilityLifecycleState;
  readonly actor: string;
  readonly timestamp: number;
  readonly scope: CapabilityScope;
  readonly reason?: string;
  readonly runId?: string;
  readonly sessionId?: string;
}

