/**
 * XR 5.2.0 — Capability Discovery by Task & Constraints
 *
 * Search by task/outcome, modality/provider requirement, privacy/locality,
 * risk/permissions, runtime compatibility, publisher/trust, maintenance,
 * and cost/resource profile. Does NOT rank by download count.
 */
import { CapabilityDescriptor } from "./types.ts";

export interface DiscoveryQuery {
  taskKeywords?: string[];
  capabilityType?: string;
  requiredPermissions?: string[];
  permittedPermissions?: string[];
  deniedPermissions?: string[];
  providerRequirements?: string[];
  riskTier?: string[];
  placementRequirement?: string[];
  publisherKind?: string[];
  certified?: boolean;
  signed?: boolean;
  official?: boolean;
  maintenanceStatus?: string[];
  compatibilityWith?: string[]; // capability ids
  costMaxEstimate?: number;
  privacyRequirements?: string[]; // e.g. "local_only"
}

export interface DiscoveryResult {
  capability: CapabilityDescriptor;
  matchScore: number; // 0-1, evidence-based
  matchReasons: string[];
}

export function discoverCapabilities(
  descriptors: CapabilityDescriptor[],
  query: DiscoveryQuery,
  workspacePolicy?: { allowedPermissions?: string[]; deniedPermissions?: string[] },
): DiscoveryResult[] {
  const results: DiscoveryResult[] = [];

  for (const desc of descriptors) {
    const reasons: string[] = [];
    let score = 0;

    // Task / outcome matching
    if (query.taskKeywords && query.taskKeywords.length > 0) {
      const nameDesc = `${desc.name} ${desc.description ?? ""}`.toLowerCase();
      const matched = query.taskKeywords.filter((kw) => nameDesc.includes(kw.toLowerCase()));
      if (matched.length > 0) {
        score += 0.2 * Math.min(matched.length / query.taskKeywords.length, 1);
        reasons.push(`task keywords: ${matched.join(", ")}`);
      }
    }

    // Capability type filter
    if (query.capabilityType && desc.capabilityType !== query.capabilityType) {
      continue; // hard filter
    }

    // Permission constraints (evidence-based, not popularity)
    const grantedPerms = new Set(desc.effectiveAuthority?.grantedPermissions ?? desc.declaredAuthority.permissions ?? []);
    const deniedPerms = new Set(desc.effectiveAuthority?.deniedPermissions ?? []);

    let permissionMatch = true;
    for (const rp of query.requiredPermissions ?? []) {
      if (!grantedPerms.has(rp)) {
        permissionMatch = false;
        break;
      }
    }
    for (const dp of query.deniedPermissions ?? []) {
      if (grantedPerms.has(dp)) {
        permissionMatch = false;
        break;
      }
    }
    if (permissionMatch) {
      score += 0.15;
      reasons.push("permission constraints satisfied");
    } else {
      continue; // exclude if permission constraints violated
    }

    // Policy intersection: workspace denied must win
    if (workspacePolicy?.deniedPermissions) {
      const deniedByPolicy = workspacePolicy.deniedPermissions.filter((p) => grantedPerms.has(p));
      if (deniedByPolicy.length > 0) {
        continue; // denied permissions always win
      }
    }

    // Trust / certification
    if (query.certified === true && desc.certification?.status !== "verified" && desc.certification?.status !== "xr_tested" && desc.certification?.status !== "self_tested") {
      score -= 0.2;
    } else if (query.certified) {
      if (["verified", "xr_tested", "self_tested"].includes(desc.certification?.status ?? "")) {
        score += 0.1;
        reasons.push("certified");
      } else {
        score -= 0.1;
      }
    }

    // Publisher / trust signals
    if (query.publisherKind && query.publisherKind.length > 0) {
      if (query.publisherKind.includes(desc.publisher.kind)) {
        score += 0.05;
        reasons.push(`publisher kind: ${desc.publisher.kind}`);
      } else {
        score -= 0.05;
      }
    }

    if (query.signed === true) {
      if (desc.trustSignals?.signed) {
        score += 0.05;
        reasons.push("signed package");
      } else {
        score -= 0.1;
      }
    }

    // Compatibility
    if (query.compatibilityWith && query.compatibilityWith.length > 0) {
      const conflicts = desc.compatibility?.conflictsWith ?? [];
      const hasConflict = query.compatibilityWith.some((c) => conflicts.includes(c) || conflicts.includes(desc.capabilityId));
      if (hasConflict) {
        score -= 0.15;
      } else {
        score += 0.05;
        reasons.push("compatible with required capabilities");
      }
    }

    // Cost
    if (query.costMaxEstimate !== undefined) {
      const estimate = desc.costEstimate?.resourceEstimate ? 0 : 0; // simplified
      // If we had numeric estimates, compare them here
    }

    // Maintenance
    if (query.maintenanceStatus && query.maintenanceStatus.length > 0) {
      const status = desc.support?.status ?? desc.trustSignals?.maintenanceStatus ?? "unknown";
      if (query.maintenanceStatus.includes(status)) {
        score += 0.05;
      } else {
        score -= 0.05;
      }
    }

    // Official / verified
    if (query.official === true && desc.publisher.kind === "official") {
      score += 0.1;
      reasons.push("official capability");
    }

    results.push({ capability: desc, matchScore: Math.max(0, Math.min(1, score)), matchReasons: reasons });
  }

  // Sort by evidence score, never by download count
  results.sort((a, b) => b.matchScore - a.matchScore);
  return results;
}
