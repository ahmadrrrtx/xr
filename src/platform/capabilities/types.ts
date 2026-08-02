/**
 * XR 5.2 — Capability Ecosystem shared descriptor types.
 *
 * This is an inspection and policy metadata model. It deliberately does NOT
 * collapse execution semantics: plugins, skills, MCP servers, providers, tools,
 * workflows, integrations, and artifact transforms still run through their
 * existing hosts/runtimes/contracts.
 */
import { z } from "zod";

export const CAPABILITY_DESCRIPTOR_SCHEMA_VERSION = "xr-5.2.0/capability-v1" as const;

export const CAPABILITY_TYPES = [
  "plugin",
  "skill",
  "mcp",
  "provider",
  "tool",
  "workflow",
  "integration",
  "artifact",
] as const;
export type CapabilityType = (typeof CAPABILITY_TYPES)[number];

export const CAPABILITY_LIFECYCLE_STATES = [
  "discovered",
  "inspected",
  "verified",
  "installed",
  "approved",
  "enabled",
  "loaded",
  "disabled",
  "update_pending_review",
  "quarantined",
  "rolled_back",
  "removed",
  "error",
  "unknown",
] as const;
export type CapabilityLifecycleState = (typeof CAPABILITY_LIFECYCLE_STATES)[number];

export const CAPABILITY_SIGNATURE_STATUSES = ["valid", "invalid", "unsigned", "unknown", "unverified"] as const;
export type CapabilitySignatureStatus = (typeof CAPABILITY_SIGNATURE_STATUSES)[number];

export const CAPABILITY_CERTIFICATION_STATUSES = [
  "unknown",
  "self-tested",
  "xr-tested",
  "verified",
  "quarantined",
  "legacy",
] as const;
export type CapabilityCertificationStatus = (typeof CAPABILITY_CERTIFICATION_STATUSES)[number];

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

export interface CapabilityPublisherIdentity {
  id: string;
  name: string;
  verified: boolean;
  trustLevel: string;
  website?: string;
  keyId?: string;
}

export interface CapabilityProvenance {
  source: "builtin" | "bundled" | "local" | "git" | "url" | "registry" | "marketplace" | "plugin" | "mcp" | "config" | "manual" | "unknown";
  sourceUrl?: string;
  registry?: string;
  ref?: string;
  installedAt?: number;
  updatedAt?: number;
  builtAt?: number;
  observedAt: number;
}

export interface CapabilityPackageIntegrity {
  packageSha256?: string;
  treeSha256?: string;
  signatureStatus: CapabilitySignatureStatus;
  signatureKeyId?: string;
  signatureReason?: string;
  verifiedAt?: number;
}

export interface CapabilityCompatibility {
  xr?: string;
  apiVersion?: number;
  os?: string[];
  runtimes?: string[];
  providers?: string[];
  models?: string[];
  modes?: string[];
  notes?: string[];
}

export interface CapabilityDependency {
  type: CapabilityType | "binary" | "npm" | "python" | "model" | "memory-template" | "unknown";
  id: string;
  version?: string;
  optional?: boolean;
  hash?: string;
  status: "satisfied" | "missing" | "unknown";
  reason?: string;
}

export interface CapabilityPermissionDeclaration {
  scope: string;
  reason?: string;
  optional?: boolean;
  dangerous?: boolean;
  paths?: string[];
  domains?: string[];
  declaredBy: "manifest" | "registry" | "adapter" | "policy" | "unknown";
}

export interface CapabilityAuthorityVector {
  declared: string[];
  publisherPolicy: string[];
  packagePolicy: string[];
  workspacePolicy: string[];
  userGrant: string[];
  agentTaskGrant: string[];
  trustPlacementLimit: string[];
  denied: string[];
  effective: string[];
  undetermined: boolean;
  reason?: string;
}

export interface CapabilityDataScope {
  kind: "filesystem" | "memory" | "context" | "artifact" | "credential" | "network" | "provider" | "unknown";
  access: "read" | "write" | "read_write" | "none" | "unknown";
  scope?: string;
  retention?: string;
  notes?: string;
}

export interface CapabilityNetworkRequirement {
  required: boolean;
  domains: string[];
  locality: "local" | "private" | "internet" | "unknown";
  reason?: string;
}

export interface CapabilityCredentialRequirement {
  required: boolean;
  refs: string[];
  reason?: string;
}

export interface CapabilityProviderRequirement {
  providerIds: string[];
  modelCapabilities: string[];
  locality?: "local" | "private" | "cloud" | "any";
  reason?: string;
}

export interface CapabilityPlacementRequirement {
  requested: CapabilityPlacement;
  riskTier: CapabilityRiskTier;
  requiresHostAuthority: boolean;
  reason?: string;
}

export interface CapabilityInterface {
  kind: "tool" | "command" | "prompt" | "mcp_tool" | "mcp_resource" | "mcp_prompt" | "workflow" | "provider" | "ui" | "artifact" | "integration" | "skill" | "unknown";
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface CapabilityTestEvidence {
  id: string;
  kind: "manifest" | "permission" | "execution" | "trust" | "context" | "durability" | "cleanup" | "compatibility" | "security" | "self" | "xr";
  status: "passed" | "failed" | "skipped" | "unknown";
  message: string;
  at?: number;
  source?: string;
}

export interface CapabilityCertification {
  status: CapabilityCertificationStatus;
  tests: CapabilityTestEvidence[];
  certifiedAt?: number;
  certifiedBy?: string;
  expiresAt?: number;
  reason?: string;
}

export interface CapabilityLifecycleEvent {
  at: number;
  action: string;
  actor?: string;
  detail?: string;
}

export interface CapabilityLifecycle {
  state: CapabilityLifecycleState;
  enabled: boolean;
  installed: boolean;
  loaded?: boolean;
  quarantineReason?: string;
  rollbackAvailable: boolean;
  updateAvailable?: boolean;
  pendingReview?: boolean;
  history: CapabilityLifecycleEvent[];
}

export interface CapabilityTrustSignals {
  trustLevel: string;
  verifiedPublisher: boolean;
  signedPackage: boolean;
  signatureStatus: CapabilitySignatureStatus;
  certificationStatus: CapabilityCertificationStatus;
  vulnerabilityStatus: "none-known" | "unknown" | "flagged" | "quarantined";
  maintenanceStatus: "active" | "unknown" | "deprecated" | "abandoned";
  evidenceScore: number;
  evidence: string[];
}

export interface CapabilityCostEstimate {
  moneyUsd?: number;
  tokens?: number;
  networkBytes?: number;
  diskBytes?: number;
  cpu?: "low" | "medium" | "high" | "unknown";
  notes?: string;
}

/**
 * Phase 7 · T4 — additive manifest-security fields.
 * All optional: pre-existing manifests keep validating unchanged.
 */
export interface CapabilitySbom {
  /** Reference (path/URL) to the bill-of-materials for the capability. */
  ref: string;
  /** SBOM format, e.g. "spdx-json", "cyclonedx". */
  format?: string;
  /** Verified by XR (hash of the SBOM file matches manifest). */
  verified?: boolean;
}

export interface CapabilityDependencyLock {
  id: string;
  version: string;
  hash?: string;
  type?: CapabilityType | "binary" | "npm" | "python" | "model" | "unknown";
}

export interface CapabilityManifestSecurity {
  /** Bill of materials reference (Phase 7 · T4). */
  sbom?: CapabilitySbom;
  /** Dependency locks: id → version → hash (Phase 7 · T4). */
  dependencyLocks?: CapabilityDependencyLock[];
  /** Capability statement: what the capability does and what it needs. */
  capabilityStatement?: string;
}

export interface CapabilityDescriptor {
  schemaVersion: typeof CAPABILITY_DESCRIPTOR_SCHEMA_VERSION;
  id: string;
  nativeId: string;
  type: CapabilityType;
  name: string;
  version: string;
  description?: string;
  publisher: CapabilityPublisherIdentity;
  provenance: CapabilityProvenance;
  package: CapabilityPackageIntegrity;
  compatibility: CapabilityCompatibility;
  dependencies: CapabilityDependency[];
  permissions: {
    declared: CapabilityPermissionDeclaration[];
    effective: CapabilityAuthorityVector;
  };
  dataScopes: CapabilityDataScope[];
  network: CapabilityNetworkRequirement;
  credentials: CapabilityCredentialRequirement;
  providerRequirements: CapabilityProviderRequirement;
  placement: CapabilityPlacementRequirement;
  interfaces: CapabilityInterface[];
  certification: CapabilityCertification;
  lifecycle: CapabilityLifecycle;
  trust: CapabilityTrustSignals;
  support: {
    homepage?: string;
    repository?: string;
    license?: string;
    maintenance: CapabilityTrustSignals["maintenanceStatus"];
  };
  cost: CapabilityCostEstimate;
  /** Phase 7 · T4 — additive manifest-security evidence. */
  security?: CapabilityManifestSecurity;
  tags: string[];
  keywords: string[];
}

const strArr = z.array(z.string()).default([]);

export const CapabilityDescriptorSchema = z.object({
  schemaVersion: z.literal(CAPABILITY_DESCRIPTOR_SCHEMA_VERSION),
  id: z.string().min(1),
  nativeId: z.string().min(1),
  type: z.enum(CAPABILITY_TYPES),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  publisher: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    verified: z.boolean(),
    trustLevel: z.string(),
    website: z.string().optional(),
    keyId: z.string().optional(),
  }),
  provenance: z.object({
    source: z.enum(["builtin", "bundled", "local", "git", "url", "registry", "marketplace", "plugin", "mcp", "config", "manual", "unknown"]),
    sourceUrl: z.string().optional(),
    registry: z.string().optional(),
    ref: z.string().optional(),
    installedAt: z.number().optional(),
    updatedAt: z.number().optional(),
    builtAt: z.number().optional(),
    observedAt: z.number(),
  }),
  package: z.object({
    packageSha256: z.string().optional(),
    treeSha256: z.string().optional(),
    signatureStatus: z.enum(CAPABILITY_SIGNATURE_STATUSES),
    signatureKeyId: z.string().optional(),
    signatureReason: z.string().optional(),
    verifiedAt: z.number().optional(),
  }),
  compatibility: z.object({
    xr: z.string().optional(),
    apiVersion: z.number().optional(),
    os: strArr.optional(),
    runtimes: strArr.optional(),
    providers: strArr.optional(),
    models: strArr.optional(),
    modes: strArr.optional(),
    notes: strArr.optional(),
  }),
  dependencies: z.array(z.object({
    type: z.union([z.enum(CAPABILITY_TYPES), z.enum(["binary", "npm", "python", "model", "memory-template", "unknown"])]),
    id: z.string().min(1),
    version: z.string().optional(),
    optional: z.boolean().optional(),
    hash: z.string().optional(),
    status: z.enum(["satisfied", "missing", "unknown"]),
    reason: z.string().optional(),
  })),
  permissions: z.object({
    declared: z.array(z.object({
      scope: z.string().min(1),
      reason: z.string().optional(),
      optional: z.boolean().optional(),
      dangerous: z.boolean().optional(),
      paths: strArr.optional(),
      domains: strArr.optional(),
      declaredBy: z.enum(["manifest", "registry", "adapter", "policy", "unknown"]),
    })),
    effective: z.object({
      declared: strArr,
      publisherPolicy: strArr,
      packagePolicy: strArr,
      workspacePolicy: strArr,
      userGrant: strArr,
      agentTaskGrant: strArr,
      trustPlacementLimit: strArr,
      denied: strArr,
      effective: strArr,
      undetermined: z.boolean(),
      reason: z.string().optional(),
    }),
  }),
  dataScopes: z.array(z.object({
    kind: z.enum(["filesystem", "memory", "context", "artifact", "credential", "network", "provider", "unknown"]),
    access: z.enum(["read", "write", "read_write", "none", "unknown"]),
    scope: z.string().optional(),
    retention: z.string().optional(),
    notes: z.string().optional(),
  })),
  network: z.object({ required: z.boolean(), domains: strArr, locality: z.enum(["local", "private", "internet", "unknown"]), reason: z.string().optional() }),
  credentials: z.object({ required: z.boolean(), refs: strArr, reason: z.string().optional() }),
  providerRequirements: z.object({ providerIds: strArr, modelCapabilities: strArr, locality: z.enum(["local", "private", "cloud", "any"]).optional(), reason: z.string().optional() }),
  placement: z.object({ requested: z.enum(CAPABILITY_PLACEMENTS), riskTier: z.enum(CAPABILITY_RISK_TIERS), requiresHostAuthority: z.boolean(), reason: z.string().optional() }),
  interfaces: z.array(z.object({ kind: z.enum(["tool", "command", "prompt", "mcp_tool", "mcp_resource", "mcp_prompt", "workflow", "provider", "ui", "artifact", "integration", "skill", "unknown"]), name: z.string(), description: z.string().optional(), inputSchema: z.unknown().optional(), outputSchema: z.unknown().optional() })),
  certification: z.object({
    status: z.enum(CAPABILITY_CERTIFICATION_STATUSES),
    tests: z.array(z.object({ id: z.string(), kind: z.enum(["manifest", "permission", "execution", "trust", "context", "durability", "cleanup", "compatibility", "security", "self", "xr"]), status: z.enum(["passed", "failed", "skipped", "unknown"]), message: z.string(), at: z.number().optional(), source: z.string().optional() })),
    certifiedAt: z.number().optional(),
    certifiedBy: z.string().optional(),
    expiresAt: z.number().optional(),
    reason: z.string().optional(),
  }),
  lifecycle: z.object({
    state: z.enum(CAPABILITY_LIFECYCLE_STATES),
    enabled: z.boolean(),
    installed: z.boolean(),
    loaded: z.boolean().optional(),
    quarantineReason: z.string().optional(),
    rollbackAvailable: z.boolean(),
    updateAvailable: z.boolean().optional(),
    pendingReview: z.boolean().optional(),
    history: z.array(z.object({ at: z.number(), action: z.string(), actor: z.string().optional(), detail: z.string().optional() })),
  }),
  trust: z.object({
    trustLevel: z.string(),
    verifiedPublisher: z.boolean(),
    signedPackage: z.boolean(),
    signatureStatus: z.enum(CAPABILITY_SIGNATURE_STATUSES),
    certificationStatus: z.enum(CAPABILITY_CERTIFICATION_STATUSES),
    vulnerabilityStatus: z.enum(["none-known", "unknown", "flagged", "quarantined"]),
    maintenanceStatus: z.enum(["active", "unknown", "deprecated", "abandoned"]),
    evidenceScore: z.number(),
    evidence: strArr,
  }),
  support: z.object({ homepage: z.string().optional(), repository: z.string().optional(), license: z.string().optional(), maintenance: z.enum(["active", "unknown", "deprecated", "abandoned"]) }),
  cost: z.object({ moneyUsd: z.number().optional(), tokens: z.number().optional(), networkBytes: z.number().optional(), diskBytes: z.number().optional(), cpu: z.enum(["low", "medium", "high", "unknown"]).optional(), notes: z.string().optional() }),
  security: z.object({
    sbom: z.object({ ref: z.string(), format: z.string().optional(), verified: z.boolean().optional() }).optional(),
    dependencyLocks: z.array(z.object({ id: z.string(), version: z.string(), hash: z.string().optional(), type: z.string().optional() })).optional(),
    capabilityStatement: z.string().optional(),
  }).default({}),
  tags: strArr,
  keywords: strArr,
});

export function validateCapabilityDescriptor(descriptor: CapabilityDescriptor): { ok: boolean; errors: string[] } {
  const parsed = CapabilityDescriptorSchema.safeParse(descriptor);
  if (parsed.success) return { ok: true, errors: [] };
  return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
}

export function capabilityId(type: CapabilityType, nativeId: string): string {
  return `${type}:${nativeId}`;
}
