/**
 * XR 5.2.0 — Capability Ecosystem: Common Descriptor Schema
 *
 * Defines a shared metadata descriptor that does NOT collapse execution
 * semantics. Plugin, skill, MCP, provider, tool, workflow, integration,
 * and artifact transformation remain distinct in how they execute,
 * but share this inspectable descriptor for provenance, authority,
 * dependency, and lifecycle visibility.
 */
import { z } from "zod";

// ── Capability identity ────────────────────────────────────────────────────────

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

export const CapabilityIdSchema = z
  .string()
  .min(2)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._:@\-/]*$/i, "invalid capability id");

export const CapabilityVersionSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/i, "invalid semver");

// ── Publisher / provenance ────────────────────────────────────────────────────

export const PublisherSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(200).optional(),
  kind: z.enum(["user", "system", "official", "third_party", "unknown"]).default("unknown"),
  sourceUrl: z.string().url().optional(),
  referenceUrl: z.string().url().optional(),
  publicKeyRef: z.string().max(240).optional(),
  contact: z.string().max(400).optional(),
  organization: z.string().max(200).optional(),
});
export type Publisher = z.infer<typeof PublisherSchema>;

export const ProvenanceSchema = z.object({
  capabilityId: CapabilityIdSchema,
  capabilityType: z.enum(CAPABILITY_TYPES),
  version: CapabilityVersionSchema,
  packageHash: z.string().min(1).max(128), // sha256 hex
  manifestHash: z.string().min(1).max(128),
  source: z.string().min(1).max(500),
  buildTimestamp: z.number().int().optional(),
  buildEnvironment: z.string().max(200).optional(),
  packageFileName: z.string().max(300).optional(),
  verifiedAt: z.number().int().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

// ── Permissions / authority ────────────────────────────────────────────────────

export const PermissionScopeSchema = z.string().min(1).max(60);
export type PermissionScope = string;

export const ResourceRequirementSchema = z.object({
  kind: z.enum(["memory", "cpu", "disk", "network", "credential", "model", "ui", "storage"]).optional(),
  scope: z.string().max(400).optional(),
  limit: z.string().max(200).optional(),
  required: z.boolean().default(true),
});
export type ResourceRequirement = z.infer<typeof ResourceRequirementSchema>;

export const DataScopeSchema = z.object({
  read: z.array(z.string().max(400)).default([]),
  write: z.array(z.string().max(400)).default([]),
  delete: z.array(z.string().max(400)).default([]),
  scope: z.string().max(400).optional(),
});
export type DataScope = z.infer<typeof DataScopeSchema>;

export const DeclaredAuthoritySchema = z.object({
  permissions: z.array(PermissionScopeSchema).default([]),
  resourceRequirements: z.array(ResourceRequirementSchema).default([]),
  dataScopes: DataScopeSchema.default({ read: [], write: [], delete: [] }),
  networkRequirements: z.array(z.string().max(400)).default([]),
  credentialRequirements: z.array(z.string().max(200)).default([]),
  modelRequirements: z.array(z.string().max(200)).default([]),
  placementRequirement: z.enum(["tier0_in_process", "tier1_restricted", "tier2_isolated", "any"]).optional(),
  riskTier: z.enum(["low", "medium", "high", "critical"]).optional(),
});
export type DeclaredAuthority = z.infer<typeof DeclaredAuthoritySchema>;

export const EffectiveAuthoritySchema = z.object({
  grantedPermissions: z.array(PermissionScopeSchema).default([]),
  grantedResourceRequirements: z.array(ResourceRequirementSchema).default([]),
  grantedDataScopes: DataScopeSchema.default({ read: [], write: [], delete: [] }),
  grantedNetworkRequirements: z.array(z.string().max(400)).default([]),
  grantedCredentialRequirements: z.array(z.string().max(200)).default([]),
  grantedModelRequirements: z.array(z.string().max(200)).default([]),
  grantedPlacement: z.enum(["tier0_in_process", "tier1_restricted", "tier2_isolated"]).optional(),
  deniedPermissions: z.array(PermissionScopeSchema).default([]),
  deniedDataScopes: DataScopeSchema.default({ read: [], write: [], delete: [] }),
  denialReason: z.string().max(800).optional(),
  reviewStatus: z.enum(["approved", "pending_review", "denied", "revoked"]).default("pending_review"),
});
export type EffectiveAuthority = z.infer<typeof EffectiveAuthoritySchema>;

// ── Dependency / compatibility ─────────────────────────────────────────────────

export const DependencySchema = z.object({
  kind: z.enum(["plugin", "skill", "mcp", "provider", "tool", "workflow", "integration", "artifact", "npm", "python", "binary", "model", "memory-template"]),
  id: z.string().min(1).max(160),
  version: z.string().min(1).max(120).optional(),
  optional: z.boolean().default(false),
  reason: z.string().max(800).optional(),
  hash: z.string().max(128).optional(),
  verified: z.boolean().optional(),
});
export type Dependency = z.infer<typeof DependencySchema>;

export const CompatibilitySchema = z.object({
  xrVersionMin: z.string().max(20).optional(),
  xrVersionMax: z.string().max(20).optional(),
  runtimeRequirements: z.array(z.string().max(200)).default([]),
  platformRequirements: z.array(z.string().max(200)).default([]),
  capabilityRequirements: z.array(z.string().max(200)).default([]),
  conflictsWith: z.array(z.string().max(200)).default([]),
});
export type Compatibility = z.infer<typeof CompatibilitySchema>;

// ── Certification / contract test ─────────────────────────────────────────────

export const CertificationStatusSchema = z.enum([
  "unknown",
  "self_tested",
  "xr_tested",
  "verified",
  "quarantined",
  "legacy",
]);
export type CertificationStatus = z.infer<typeof CertificationStatusSchema>;

export const CertificationSchema = z.object({
  status: CertificationStatusSchema,
  contractTests: z.array(z.object({
    name: z.string().max(200),
    passed: z.boolean(),
    timestamp: z.number().int(),
    details: z.string().max(2000).optional(),
  })).default([]),
  securityBoundaryVerified: z.boolean().optional(),
  permissionHonestyVerified: z.boolean().optional(),
  executionContractVerified: z.boolean().optional(),
  contextScopeVerified: z.boolean().optional(),
  durableBehaviorVerified: z.boolean().optional(),
  errorCleanupVerified: z.boolean().optional(),
  versionCompatibilityVerified: z.boolean().optional(),
  certifiedBy: z.string().max(200).optional(),
  certifiedAt: z.number().int().optional(),
});
export type Certification = z.infer<typeof CertificationSchema>;

// ── Lifecycle / update / rollback ─────────────────────────────────────────────

export const LifecycleStateSchema = z.enum([
  "discovered",
  "inspected",
  "verified",
  "installed",
  "approved",
  "enabled",
  "loaded",
  "executed",
  "disabled",
  "updated",
  "quarantined",
  "roll_back",
  "removed",
]);
export type LifecycleState = z.infer<typeof LifecycleStateSchema>;

export const UpdatePolicySchema = z.object({
  allowAutoUpdate: z.boolean().default(false),
  requireReviewOnNewPermissions: z.boolean().default(true),
  maxAgeDays: z.number().int().optional(),
  rollbackWindowHours: z.number().int().default(72),
});
export type UpdatePolicy = z.infer<typeof UpdatePolicySchema>;

export const LifecycleEventSchema = z.object({
  at: z.number().int(),
  action: z.enum([
    "discover", "inspect", "verify", "install", "approve", "enable",
    "load", "execute", "disable", "update", "quarantine", "rollback", "remove",
  ]),
  detail: z.string().max(1200).optional(),
  versionBefore: z.string().optional(),
  versionAfter: z.string().optional(),
  permissionsBefore: z.array(PermissionScopeSchema).optional(),
  permissionsAfter: z.array(PermissionScopeSchema).optional(),
  auditRecordId: z.string().max(200).optional(),
});
export type LifecycleEvent = z.infer<typeof LifecycleEventSchema>;

// ── Marketplace / trust signals ───────────────────────────────────────────────

export const TrustSignalSchema = z.object({
  publisherVerified: z.boolean().optional(),
  packageVerified: z.boolean().optional(),
  signed: z.boolean().optional(),
  certified: z.boolean().optional(),
  vulnerabilityStatus: z.enum(["clean", "known_issues", "critical", "unknown"]).optional(),
  abuseStatus: z.enum(["clean", "reported", "revoked", "unknown"]).optional(),
  maintenanceStatus: z.enum(["active", "stale", "abandoned", "unknown"]).optional(),
  downloadCount: z.number().int().optional(),
  official: z.boolean().optional(),
});
export type TrustSignal = z.infer<typeof TrustSignalSchema>;

export const CostEstimateSchema = z.object({
  modelCallsEstimate: z.number().int().optional(),
  tokenEstimate: z.number().int().optional(),
  timeEstimateSeconds: z.number().int().optional(),
  resourceEstimate: z.string().max(200).optional(),
});
export type CostEstimate = z.infer<typeof CostEstimateSchema>;

// ── Common descriptor (top-level) ─────────────────────────────────────────────

export const CapabilityDescriptorSchema = z.object({
  descriptorVersion: z.literal("xr-5.2.0/capability-v1").default("xr-5.2.0/capability-v1"),
  capabilityId: CapabilityIdSchema,
  capabilityType: z.enum(CAPABILITY_TYPES),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000).optional(),
  version: CapabilityVersionSchema,
  publisher: PublisherSchema,
  provenance: ProvenanceSchema.optional(),
  declaredAuthority: DeclaredAuthoritySchema.default({ permissions: [], resourceRequirements: [], dataScopes: { read: [], write: [], delete: [] } }),
  effectiveAuthority: EffectiveAuthoritySchema.optional(),
  dependencies: z.array(DependencySchema).default([]),
  compatibility: CompatibilitySchema.default({ runtimeRequirements: [], platformRequirements: [], capabilityRequirements: [], conflictsWith: [] }),
  certification: CertificationSchema.default({ status: "unknown", contractTests: [] }),
  trustSignals: TrustSignalSchema.default({}),
  lifecycleState: LifecycleStateSchema.default("discovered"),
  lifecycleHistory: z.array(LifecycleEventSchema).default([]),
  interfaces: z.object({
    workflow: z.any().optional(),
    tool: z.any().optional(),
    mcp: z.any().optional(),
    plugin: z.any().optional(),
    skill: z.any().optional(),
    provider: z.any().optional(),
    integration: z.any().optional(),
    artifact: z.any().optional(),
  }).optional(),
  costEstimate: CostEstimateSchema.optional(),
  support: z.object({
    status: z.enum(["supported", "deprecated", "end_of_life"]).optional(),
    maintainedUntil: z.string().max(20).optional(),
    supportContact: z.string().max(400).optional(),
  }).optional(),
  metadata: z.record(z.any()).optional(),
});
export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptorSchema>;

/** Build descriptor with safe defaults. */
export function buildDescriptor(partial: Partial<z.infer<typeof CapabilityDescriptorSchema>>): CapabilityDescriptor {
  const base: CapabilityDescriptor = {
    descriptorVersion: "xr-5.2.0/capability-v1",
    capabilityId: partial.capabilityId ?? "unknown",
    capabilityType: (partial.capabilityType as CapabilityType) ?? "plugin",
    name: partial.name ?? partial.capabilityId ?? "unknown",
    description: partial.description,
    version: partial.version ? partial.version : "0.0.0",
    publisher: partial.publisher ?? { id: "unknown", kind: "unknown" },
    provenance: partial.provenance,
    declaredAuthority: partial.declaredAuthority ?? { permissions: [], resourceRequirements: [], dataScopes: { read: [], write: [], delete: [] } },
    effectiveAuthority: partial.effectiveAuthority,
    dependencies: partial.dependencies ?? [],
    compatibility: partial.compatibility ?? { runtimeRequirements: [], platformRequirements: [], capabilityRequirements: [], conflictsWith: [] },
    certification: partial.certification ?? { status: "unknown", contractTests: [] },
    trustSignals: partial.trustSignals ?? {},
    lifecycleState: partial.lifecycleState ?? "discovered",
    lifecycleHistory: partial.lifecycleHistory ?? [],
    interfaces: partial.interfaces,
    costEstimate: partial.costEstimate,
    support: partial.support,
    metadata: partial.metadata,
  };
  return CapabilityDescriptorSchema.parse(base);
}
