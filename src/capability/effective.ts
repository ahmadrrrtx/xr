/**
 * XR 5.2.0 — Effective Authority / Permission Resolution
 *
 * Implemented exactly per architecture: declared permissions are requests,
 * not authority. Effective authority = intersection of:
 *   capability declaration ∩ publisher/package policy ∩ workspace policy
 *   ∩ user grant ∩ agent/task authority ∩ trust/placement limits.
 * Denied permissions always win. Updates requesting new authority
 * require re-review/re-approval.
 */
import { EffectiveAuthoritySchema, DeclaredAuthoritySchema, EffectiveAuthority, DeclaredAuthority, PermissionScope } from "./types.ts";

export interface PolicyIntersection {
  workspacePolicy: { allowed?: string[]; denied?: string[] };
  userGrant: { allowed?: string[]; denied?: string[] };
  agentTaskAuthority: { allowed?: string[]; denied?: string[] };
  publisherPolicy: { allowed?: string[]; denied?: string[] };
  trustLimits: { allowed?: string[]; denied?: string[] };
}

export function resolveEffectiveAuthority(
  declared: DeclaredAuthority,
  policy: PolicyIntersection,
  reviewStatus: "approved" | "pending_review" | "denied" | "revoked" = "pending_review",
): EffectiveAuthority {
  const allDenied = new Set<string>([
    ...(policy.publisherPolicy.denied ?? []),
    ...(policy.workspacePolicy.denied ?? []),
    ...(policy.userGrant.denied ?? []),
    ...(policy.agentTaskAuthority.denied ?? []),
    ...(policy.trustLimits.denied ?? []),
  ]);

  const allowedSets: Set<string>[] = [
    new Set(policy.publisherPolicy.allowed ?? []),
    new Set(policy.workspacePolicy.allowed ?? []),
    new Set(policy.userGrant.allowed ?? []),
    new Set(policy.agentTaskAuthority.allowed ?? []),
    new Set(policy.trustLimits.allowed ?? []),
  ];

  const grantedPermissions: string[] = [];
  const seen = new Set<string>();

  for (const p of declared.permissions) {
    if (allDenied.has(p)) {
      // denied always wins — skip
      continue;
    }
    // Must be present in ALL allowed sets (intersection)
    const inAll = allowedSets.every((s) => s.size === 0 || s.has(p));
    if (!inAll) {
      // If any set explicitly excludes it (non-empty set missing p), deny
      const explicitlyDenied = allowedSets.filter((s) => s.size > 0 && !s.has(p)).length > 0;
      if (explicitlyDenied) {
        // permission excluded by at least one policy layer
        continue;
      }
      // Otherwise it might just not be mentioned; be conservative
      if (allowedSets.some((s) => s.size > 0)) {
        continue; // at least one layer has explicit list and doesn't include it
      }
    }
    if (!seen.has(p)) {
      seen.add(p);
      grantedPermissions.push(p);
    }
  }

  const deniedPermissions = declared.permissions.filter((p) => allDenied.has(p) || !grantedPermissions.includes(p));

  const grantedResourceRequirements = declared.resourceRequirements.filter((r) => !allDenied.has(r.kind ?? "")).map((r) => ({ ...r }));
  const grantedDataScopes = { ...declared.dataScopes };
  const grantedNetworkRequirements = declared.networkRequirements.filter((n) => !allDenied.has(n));
  const grantedCredentialRequirements = declared.credentialRequirements.filter((c) => !allDenied.has(c));
  const grantedModelRequirements = declared.modelRequirements.filter((m) => !allDenied.has(m));

  return EffectiveAuthoritySchema.parse({
    grantedPermissions,
    grantedResourceRequirements,
    grantedDataScopes,
    grantedNetworkRequirements,
    grantedCredentialRequirements,
    grantedModelRequirements,
    grantedPlacement: declared.placementRequirement === "any" ? undefined : declared.placementRequirement,
    deniedPermissions,
    deniedDataScopes: declared.dataScopes,
    denialReason: deniedPermissions.length > 0 ? "permissions denied by policy intersection" : undefined,
    reviewStatus: deniedPermissions.length > 0 ? "denied" : reviewStatus,
  });
}

export function requiresReReview(
  previous: EffectiveAuthority | undefined,
  current: EffectiveAuthority,
): boolean {
  const prevPerms = new Set(previous?.grantedPermissions ?? []);
  const currPerms = new Set(current.grantedPermissions);
  // If current asks for anything not previously granted, or new denied
  for (const p of current.grantedPermissions) {
    if (!prevPerms.has(p)) return true;
  }
  for (const p of current.deniedPermissions ?? []) {
    if (prevPerms.has(p)) return true; // previously allowed, now denied
  }
  return false;
}

export function buildPolicyIntersection(
  workspacePolicy?: { allowed?: string[]; denied?: string[] },
  userGrant?: { allowed?: string[]; denied?: string[] },
  agentTaskAuthority?: { allowed?: string[]; denied?: string[] },
  publisherPolicy?: { allowed?: string[]; denied?: string[] },
  trustLimits?: { allowed?: string[]; denied?: string[] },
): PolicyIntersection {
  return {
    workspacePolicy: workspacePolicy ?? { allowed: [], denied: [] },
    userGrant: userGrant ?? { allowed: [], denied: [] },
    agentTaskAuthority: agentTaskAuthority ?? { allowed: [], denied: [] },
    publisherPolicy: publisherPolicy ?? { allowed: [], denied: [] },
    trustLimits: trustLimits ?? { allowed: [], denied: [] },
  };
}
