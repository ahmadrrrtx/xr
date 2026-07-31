/**
 * XR 6.0 — Data Residency and Retention Policy
 *
 * Enforces data residency and retention rules across all deployment modes.
 *
 * Rules:
 *   - Classification determines where data can reside and transfer.
 *   - Restricted data never leaves the origin without explicit policy.
 *   - Retention rules are per-entity-type and enforceable.
 *   - Residency decisions are explainable and auditable.
 */

import type {
  ResidencyPolicy,
  ResidencyDecision,
  DataClassification,
  RetentionPolicy,
  RetentionRule,
  ClassificationRule,
  TaskCapsule,
} from "../types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Default Policies
// ═══════════════════════════════════════════════════════════════════════════

export function defaultResidencyPolicy(): ResidencyPolicy {
  return {
    allowedRegions: [], // Empty = all regions allowed
    forbiddenRegions: [],
    defaultRetention: defaultRetentionPolicy(),
    classificationRules: [
      {
        entityType: "execution_record",
        classification: "internal",
        residencyRequirement: "any_allowed",
        transferAllowed: true,
      },
      {
        entityType: "audit_record",
        classification: "confidential",
        residencyRequirement: "region_pinned",
        transferAllowed: true,
      },
      {
        entityType: "context_data",
        classification: "confidential",
        residencyRequirement: "region_pinned",
        transferAllowed: false,
      },
      {
        entityType: "artifact",
        classification: "internal",
        residencyRequirement: "any_allowed",
        transferAllowed: true,
      },
      {
        entityType: "checkpoint",
        classification: "internal",
        residencyRequirement: "any_allowed",
        transferAllowed: true,
      },
      {
        entityType: "credential",
        classification: "restricted",
        residencyRequirement: "origin_only",
        transferAllowed: false,
      },
      {
        entityType: "secret",
        classification: "restricted",
        residencyRequirement: "origin_only",
        transferAllowed: false,
      },
      {
        entityType: "task_capsule",
        classification: "internal",
        residencyRequirement: "any_allowed",
        transferAllowed: true,
      },
    ],
  };
}

export function defaultRetentionPolicy(): RetentionPolicy {
  return {
    executionRecords: {
      retentionDays: 90,
      archiveAfterDays: 30,
      deleteOnExpiry: true,
      legalHoldCapable: true,
    },
    auditRecords: {
      retentionDays: 365,
      archiveAfterDays: 90,
      deleteOnExpiry: false, // Audit records are never auto-deleted
      legalHoldCapable: true,
    },
    artifacts: {
      retentionDays: 180,
      archiveAfterDays: 60,
      deleteOnExpiry: true,
      legalHoldCapable: true,
    },
    contextData: {
      retentionDays: 365,
      archiveAfterDays: 90,
      deleteOnExpiry: true,
      legalHoldCapable: false,
    },
    checkpoints: {
      retentionDays: 7,
      archiveAfterDays: undefined,
      deleteOnExpiry: true,
      legalHoldCapable: false,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Residency Policy Engine
// ═══════════════════════════════════════════════════════════════════════════

export class ResidencyPolicyEngine {
  private policy: ResidencyPolicy;
  private readonly policyVersion: string;

  constructor(policy?: ResidencyPolicy) {
    this.policy = policy ?? defaultResidencyPolicy();
    this.policyVersion = "xr-6.0.0/residency-v1";
  }

  // ── Residency Decisions ──────────────────────────────────────────────

  /**
   * Check if a capsule can be transferred to a target region.
   */
  checkCapsuleTransfer(
    capsule: TaskCapsule,
    targetRegion: string,
  ): ResidencyDecision {
    // Check capsule's own residency constraints first
    if (capsule.residency.mustNotLeaveOrigin) {
      const originRegion = capsule.provenance.originInstanceId;
      if (targetRegion !== originRegion) {
        return {
          allowed: false,
          reason: "Capsule is marked mustNotLeaveOrigin — cannot transfer to " + targetRegion,
          classification: capsule.residency.dataClassification,
          applicableRegion: targetRegion,
          policyVersion: this.policyVersion,
        };
      }
    }

    // Check capsule's allowed regions
    if (capsule.residency.allowedRegions.length > 0) {
      if (!capsule.residency.allowedRegions.includes(targetRegion)) {
        return {
          allowed: false,
          reason: `Target region ${targetRegion} not in capsule's allowed regions`,
          classification: capsule.residency.dataClassification,
          applicableRegion: targetRegion,
          policyVersion: this.policyVersion,
        };
      }
    }

    // Check capsule's forbidden regions
    if (capsule.residency.forbiddenRegions.includes(targetRegion)) {
      return {
        allowed: false,
        reason: `Target region ${targetRegion} is forbidden by capsule residency`,
        classification: capsule.residency.dataClassification,
        applicableRegion: targetRegion,
        policyVersion: this.policyVersion,
      };
    }

    // Check global policy
    const classification = this.getClassificationForEntityType("task_capsule");
    return this.checkRegionAllowed(targetRegion, classification);
  }

  /**
   * Check if a region is allowed for a given data classification.
   */
  checkRegionAllowed(
    region: string,
    classification: DataClassification,
  ): ResidencyDecision {
    // Forbidden regions always blocked
    if (this.policy.forbiddenRegions.includes(region)) {
      return {
        allowed: false,
        reason: `Region ${region} is in the forbidden list`,
        classification,
        applicableRegion: region,
        policyVersion: this.policyVersion,
      };
    }

    // If allowed regions are specified, must be in list
    if (this.policy.allowedRegions.length > 0) {
      if (!this.policy.allowedRegions.includes(region)) {
        return {
          allowed: false,
          reason: `Region ${region} not in allowed regions list`,
          classification,
          applicableRegion: region,
          policyVersion: this.policyVersion,
        };
      }
    }

    // Restricted classification requires explicit allowlist
    if (classification === "restricted") {
      if (this.policy.allowedRegions.length === 0) {
        // No explicit allowed list = restricted data cannot be placed
        return {
          allowed: false,
          reason: "Restricted data requires explicit allowed regions",
          classification,
          applicableRegion: region,
          policyVersion: this.policyVersion,
        };
      }
    }

    return {
      allowed: true,
      reason: "Region allowed by residency policy",
      classification,
      applicableRegion: region,
      policyVersion: this.policyVersion,
    };
  }

  /**
   * Check if data transfer is allowed for a given entity type.
   */
  checkTransferAllowed(entityType: string): { allowed: boolean; reason: string } {
    const rule = this.policy.classificationRules.find(r => r.entityType === entityType);
    if (!rule) {
      return { allowed: true, reason: "No classification rule found — default allow" };
    }
    return {
      allowed: rule.transferAllowed,
      reason: rule.transferAllowed
        ? `Transfer allowed for ${entityType} (${rule.classification})`
        : `Transfer NOT allowed for ${entityType} (${rule.classification})`,
    };
  }

  // ── Classification ───────────────────────────────────────────────────

  /**
   * Get the data classification for an entity type.
   */
  getClassificationForEntityType(entityType: string): DataClassification {
    const rule = this.policy.classificationRules.find(r => r.entityType === entityType);
    return rule?.classification ?? "public";
  }

  /**
   * Get the classification rule for an entity type.
   */
  getClassificationRule(entityType: string): ClassificationRule | undefined {
    return this.policy.classificationRules.find(r => r.entityType === entityType);
  }

  // ── Retention ────────────────────────────────────────────────────────

  /**
   * Get the retention rule for an entity type.
   */
  getRetentionRule(entityType: string): RetentionRule {
    switch (entityType) {
      case "execution_record":
        return this.policy.defaultRetention.executionRecords;
      case "audit_record":
        return this.policy.defaultRetention.auditRecords;
      case "artifact":
        return this.policy.defaultRetention.artifacts;
      case "context_data":
        return this.policy.defaultRetention.contextData;
      case "checkpoint":
        return this.policy.defaultRetention.checkpoints;
      default:
        return this.policy.defaultRetention.executionRecords;
    }
  }

  /**
   * Check if an entity has exceeded its retention period.
   */
  isRetentionExpired(entityType: string, createdAt: number): boolean {
    const rule = this.getRetentionRule(entityType);
    const ageMs = Date.now() - createdAt;
    const retentionMs = rule.retentionDays * 24 * 60 * 60 * 1000;
    return ageMs > retentionMs;
  }

  /**
   * Check if an entity should be archived.
   */
  shouldArchive(entityType: string, createdAt: number): boolean {
    const rule = this.getRetentionRule(entityType);
    if (!rule.archiveAfterDays) return false;
    const ageMs = Date.now() - createdAt;
    const archiveMs = rule.archiveAfterDays * 24 * 60 * 60 * 1000;
    return ageMs > archiveMs;
  }

  // ── Policy Management ────────────────────────────────────────────────

  /**
   * Update the residency policy. Additive only — cannot weaken existing constraints.
   */
  updatePolicy(updates: Partial<ResidencyPolicy>): void {
    if (updates.allowedRegions && updates.allowedRegions.length > 0) {
      // Adding more allowed regions is fine
      this.policy = {
        ...this.policy,
        allowedRegions: [...new Set([...this.policy.allowedRegions, ...updates.allowedRegions])],
      };
    }

    if (updates.forbiddenRegions && updates.forbiddenRegions.length > 0) {
      // Can always add more forbidden regions
      this.policy = {
        ...this.policy,
        forbiddenRegions: [...new Set([...this.policy.forbiddenRegions, ...updates.forbiddenRegions])],
      };
    }

    if (updates.classificationRules) {
      // Merge classification rules — new rules override by entity type
      const existingRules = new Map(this.policy.classificationRules.map(r => [r.entityType, r]));
      for (const rule of updates.classificationRules) {
        const existing = existingRules.get(rule.entityType);
        if (existing) {
          // Cannot weaken classification
          if (this.classificationStrength(rule.classification) < this.classificationStrength(existing.classification)) {
            continue; // Skip weakening
          }
        }
        existingRules.set(rule.entityType, rule);
      }
      this.policy = {
        ...this.policy,
        classificationRules: Array.from(existingRules.values()),
      };
    }
  }

  getPolicy(): ResidencyPolicy {
    return this.policy;
  }

  getPolicyVersion(): string {
    return this.policyVersion;
  }

  private classificationStrength(c: DataClassification): number {
    const order: Record<DataClassification, number> = {
      public: 0,
      internal: 1,
      confidential: 2,
      restricted: 3,
    };
    return order[c];
  }
}
