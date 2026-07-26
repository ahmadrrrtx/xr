/**
 * XR 5.2.0 — Capability SDK Lifecycle
 *
 * Provides creation, validation, testing, packaging, signing,
 * inspection, publishing, compatibility, and diagnostics paths.
 * Does NOT require developers to understand internal kernel code.
 */
import { buildDescriptor, CapabilityDescriptor } from "./types.ts";
import { parseDescriptorObject } from "./descriptor.ts";
import { buildProvenance, provenanceFromPackage, Provenance } from "./provenance.ts";
import { resolveEffectiveAuthority, buildPolicyIntersection } from "./effective.ts";
import { resolveDependencies } from "./dependencies.ts";
import { checkCompatibility } from "./dependencies.ts";

export interface SDKLifecycleOptions {
  workspacePolicy?: { allowedPermissions?: string[]; deniedPermissions?: string[] };
  userGrant?: { allowedPermissions?: string[]; deniedPermissions?: string[] };
  agentTaskAuthority?: { allowedPermissions?: string[]; deniedPermissions?: string[] };
  publisherPolicy?: { allowedPermissions?: string[]; deniedPermissions?: string[] };
  trustLimits?: { allowedPermissions?: string[]; deniedPermissions?: string[] };
  reviewStatus?: "approved" | "pending_review" | "denied" | "revoked";
}

export interface SDKLifecycleResult {
  descriptor: CapabilityDescriptor;
  provenance: Provenance;
  effectiveAuthority: any;
  dependencyResolution: any;
  compatibility: { ok: boolean; errors: string[]; warnings: string[] };
  validationErrors: string[];
  validationWarnings: string[];
  diagnostics: string[];
}

export function runSDKLifecycle(
  descriptor: CapabilityDescriptor,
  packagePath?: string,
  manifestPath?: string,
  options?: SDKLifecycleOptions,
): SDKLifecycleResult {
  const diagnostics: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validation
  diagnostics.push(`descriptor: ${descriptor.capabilityId}@${descriptor.version}`);
  if (!descriptor.publisher || !descriptor.publisher.id) {
    errors.push("publisher identity missing");
  }
  if (!descriptor.provenance) {
    warnings.push("provenance missing; consider adding package hash and manifest hash");
  }

  // Provenance
  const provenance = descriptor.provenance || (packagePath ? provenanceFromPackage(packagePath, manifestPath, descriptor.capabilityId, descriptor.capabilityType, descriptor.version) : undefined);

  // Effective authority
  const policy = buildPolicyIntersection(
    options?.workspacePolicy,
    options?.userGrant,
    options?.agentTaskAuthority,
    options?.publisherPolicy,
    options?.trustLimits,
  );
  const effectiveAuthority = descriptor.effectiveAuthority || resolveEffectiveAuthority(
    descriptor.declaredAuthority,
    policy,
    options?.reviewStatus ?? "pending_review",
  );

  // Dependencies
  const dependencyResolution = resolveDependencies(
    descriptor.dependencies ?? [],
    {}, // available registry — caller can inject
  );

  // Compatibility
  const compatibility = checkCompatibility(
    descriptor.compatibility ?? { runtimeRequirements: [], platformRequirements: [], capabilityRequirements: [], conflictsWith: [] },
    [descriptor.capabilityType, ...(descriptor.compatibility?.runtimeRequirements ?? [])],
    "5.1.0",
  );

  if (dependencyResolution.errors.length > 0) errors.push(...dependencyResolution.errors);
  if (compatibility.errors.length > 0) errors.push(...compatibility.errors);
  warnings.push(...dependencyResolution.errors.filter((e) => e.includes("optional")));
  warnings.push(...compatibility.warnings);

  return {
    descriptor,
    provenance: provenance ?? descriptor.provenance ?? buildProvenance({ capabilityId: descriptor.capabilityId, capabilityType: descriptor.capabilityType, version: descriptor.version }),
    effectiveAuthority,
    dependencyResolution,
    compatibility,
    validationErrors: errors,
    validationWarnings: warnings,
    diagnostics,
  };
}

export function inspectDescriptorDescriptor(desc: CapabilityDescriptor): Record<string, unknown> {
  return {
    capabilityId: desc.capabilityId,
    capabilityType: desc.capabilityType,
    version: desc.version,
    publisher: desc.publisher,
    lifecycleState: desc.lifecycleState,
    declaredPermissions: desc.declaredAuthority.permissions,
    grantedPermissions: desc.effectiveAuthority?.grantedPermissions ?? [],
    deniedPermissions: desc.effectiveAuthority?.deniedPermissions ?? [],
    dependencies: desc.dependencies,
    certificationStatus: desc.certification?.status,
    trustSignals: desc.trustSignals,
    provenanceAvailable: !!desc.provenance,
    interfaces: desc.interfaces ? Object.keys(desc.interfaces).filter((k) => !!desc.interfaces?.[k as keyof typeof desc.interfaces]) : [],
  };
}
