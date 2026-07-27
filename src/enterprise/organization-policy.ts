/**
 * XR 6.1 — Organization Policy Administration
 *
 * Manages policy layers: platform defaults → deployment → organization →
 * workspace → project → user/task → capability. Resolves precedence and
 * conflicts. More privileged policy must not silently hide user-visible
 * actions, approvals, or data access.
 */

import { randomUUID, createHash } from "node:crypto";
import type {
  PolicyTarget,
  PolicyRule,
  PolicySubject,
  PolicyEffect,
  PolicyTier,
  PolicyBundle,
  PolicyEvaluation,
  DeploymentProfileKind,
} from "./types.ts";
import { POLICY_PRECEDENCE, ENTERPRISE_BOUNDS } from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Default Platform Policies
// ═══════════════════════════════════════════════════════════════════════════

const PLATFORM_DEFAULTS: readonly PolicyRule[] = [
  {
    id: "default.deny_credential_read_unapproved",
    tier: "platform_default",
    target: { kind: "organization", id: "*", label: "All Organizations" },
    subjects: ["credential.read"],
    effect: "require_approval",
    reason: "Credential reads require explicit approval by default",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    createdBy: "system",
  },
  {
    id: "default.audit_retention_min",
    tier: "platform_default",
    target: { kind: "organization", id: "*", label: "All Organizations" },
    subjects: ["audit.retention"],
    effect: "allow",
    conditions: { minimumDays: 90, maximumDays: ENTERPRISE_BOUNDS.MAX_RETENTION_DAYS },
    reason: "Audit records must be retained at least 90 days by default",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    createdBy: "system",
  },
  {
    id: "default.deny_approval_override_silent",
    tier: "platform_default",
    target: { kind: "organization", id: "*", label: "All Organizations" },
    subjects: ["approval.override"],
    effect: "audit_only",
    reason: "Approval overrides are always audited, never silent",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    createdBy: "system",
  },
  {
    id: "default.allow_local_autonomy",
    tier: "platform_default",
    target: { kind: "organization", id: "*", label: "All Organizations" },
    subjects: ["deployment.place", "deployment.transfer"],
    effect: "allow",
    conditions: { profile: ["personal_local", "private_local_server"] },
    reason: "Local/private deployments retain full placement autonomy",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    createdBy: "system",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Pre-built Policy Bundles
// ═══════════════════════════════════════════════════════════════════════════

export const ENTERPRISE_POLICY_BUNDLES: Record<string, PolicyBundle> = {
  enterprise_baseline: {
    id: "bundle.enterprise_baseline",
    name: "Enterprise Baseline",
    version: "6.1.0",
    description: "Standard enterprise security and operational policies for team/cloud/hybrid deployments",
    applicableProfiles: ["team_private", "managed_cloud", "hybrid"],
    rules: [
      {
        id: "enterprise.require_approval_capability_install",
        tier: "organization",
        target: { kind: "organization", id: "*", label: "Organization-wide" },
        subjects: ["capability.install", "capability.update"],
        effect: "require_approval",
        reason: "Capability installation and updates require security review",
        enabled: true,
        createdAt: 0, updatedAt: 0, createdBy: "system",
      },
      {
        id: "enterprise.audit_all_credential_operations",
        tier: "organization",
        target: { kind: "organization", id: "*", label: "Organization-wide" },
        subjects: ["credential.create", "credential.read", "credential.revoke"],
        effect: "audit_only",
        reason: "All credential operations are fully audited",
        enabled: true,
        createdAt: 0, updatedAt: 0, createdBy: "system",
      },
      {
        id: "enterprise.require_approval_data_export",
        tier: "organization",
        target: { kind: "organization", id: "*", label: "Organization-wide" },
        subjects: ["data.export"],
        effect: "require_approval",
        reason: "Bulk data exports require admin approval",
        enabled: true,
        createdAt: 0, updatedAt: 0, createdBy: "system",
      },
      {
        id: "enterprise.deny_network_egress_untrusted",
        tier: "organization",
        target: { kind: "organization", id: "*", label: "Organization-wide" },
        subjects: ["network.egress"],
        effect: "deny",
        conditions: { egressTier: "untrusted" },
        reason: "Untrusted network egress is blocked by default",
        enabled: true,
        createdAt: 0, updatedAt: 0, createdBy: "system",
      },
    ],
    metadata: { type: "security", autoApply: "false" },
  },

  compliance_baseline: {
    id: "bundle.compliance_baseline",
    name: "Compliance Baseline",
    version: "6.1.0",
    description: "Policies for regulated environments requiring strict audit, retention, and access controls",
    applicableProfiles: ["team_private", "managed_cloud", "hybrid"],
    rules: [
      {
        id: "compliance.retention_365_days",
        tier: "organization",
        target: { kind: "organization", id: "*", label: "Organization-wide" },
        subjects: ["audit.retention"],
        effect: "allow",
        conditions: { minimumDays: 365 },
        reason: "Audit records retained minimum 365 days for compliance",
        enabled: true,
        createdAt: 0, updatedAt: 0, createdBy: "system",
      },
      {
        id: "compliance.require_mfa_admin",
        tier: "organization",
        target: { kind: "organization", id: "*", label: "Organization-wide" },
        subjects: ["organization.admin"],
        effect: "require_approval",
        conditions: { requireMfa: true },
        reason: "Administrative operations require MFA verification",
        enabled: true,
        createdAt: 0, updatedAt: 0, createdBy: "system",
      },
    ],
    metadata: { type: "compliance", autoApply: "false" },
  },

  local_autonomy: {
    id: "bundle.local_autonomy",
    name: "Local Autonomy Guard",
    version: "6.1.0",
    description: "Guarantees that local deployments retain full autonomy — no cloud policy can override",
    applicableProfiles: ["personal_local", "private_local_server"],
    rules: [
      {
        id: "local.deny_remote_policy_override",
        tier: "deployment",
        target: { kind: "organization", id: "*", label: "All" },
        subjects: ["deployment.place", "deployment.transfer", "release.channel"],
        effect: "deny",
        conditions: { overrideSource: "remote" },
        reason: "Remote control planes cannot override local deployment policy",
        enabled: true,
        createdAt: 0, updatedAt: 0, createdBy: "system",
      },
    ],
    metadata: { type: "guard", autoApply: "true" },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Organization Policy Service
// ═══════════════════════════════════════════════════════════════════════════

export interface OrganizationPolicyDeps {
  /** Current deployment profile. */
  profile: DeploymentProfileKind;
  /** Audit callback. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class OrganizationPolicyService {
  private readonly rules = new Map<string, PolicyRule>();
  private readonly bundles = new Map<string, PolicyBundle>();
  private readonly deps: OrganizationPolicyDeps;

  // Track policy changes for audit.
  private changeLog: Array<{ timestamp: number; action: string; ruleId: string; by: string }> = [];

  constructor(deps: OrganizationPolicyDeps) {
    this.deps = deps;

    // Register platform defaults.
    for (const rule of PLATFORM_DEFAULTS) {
      this.rules.set(rule.id, rule);
    }

    // Register built-in bundles.
    for (const bundle of Object.values(ENTERPRISE_POLICY_BUNDLES)) {
      this.bundles.set(bundle.id, bundle);
    }
  }

  // ── Policy Bundle Management ─────────────────────────────────────────

  /** Apply a policy bundle, auto-applying only if the profile matches. */
  applyBundle(bundleId: string, appliedBy: string): { ok: boolean; rulesApplied: number; error?: string } {
    const bundle = this.bundles.get(bundleId);
    if (!bundle) return { ok: false, rulesApplied: 0, error: `Bundle ${bundleId} not found` };

    if (!bundle.applicableProfiles.includes(this.deps.profile)) {
      return { ok: false, rulesApplied: 0, error: `Bundle not applicable to profile ${this.deps.profile}` };
    }

    let applied = 0;
    for (const rule of bundle.rules) {
      if (!this.rules.has(rule.id)) {
        this.rules.set(rule.id, { ...rule, createdAt: Date.now(), updatedAt: Date.now(), createdBy: appliedBy });
        applied++;
      }
    }

    this.changeLog.push({ timestamp: Date.now(), action: "bundle_applied", ruleId: bundleId, by: appliedBy });
    this.deps.audit?.("policy.bundle_applied", { bundleId, rulesApplied: applied, by: appliedBy });

    return { ok: true, rulesApplied: applied };
  }

  /** List all available policy bundles. */
  listBundles(): PolicyBundle[] {
    return Array.from(this.bundles.values());
  }

  getBundle(bundleId: string): PolicyBundle | undefined {
    return this.bundles.get(bundleId);
  }

  /** Register a custom policy bundle (organization-defined). */
  registerBundle(bundle: PolicyBundle, registeredBy: string): { ok: boolean; error?: string } {
    if (bundle.rules.length > ENTERPRISE_BOUNDS.MAX_BUNDLE_RULES) {
      return { ok: false, error: `Bundle exceeds maximum ${ENTERPRISE_BOUNDS.MAX_BUNDLE_RULES} rules` };
    }
    this.bundles.set(bundle.id, bundle);
    this.deps.audit?.("policy.bundle_registered", { bundleId: bundle.id, by: registeredBy });
    return { ok: true };
  }

  // ── Rule Management ──────────────────────────────────────────────────

  /** Add or update a policy rule. */
  upsertRule(rule: PolicyRule, updatedBy: string): PolicyRule {
    this.rules.set(rule.id, rule);
    this.changeLog.push({ timestamp: Date.now(), action: "rule_upserted", ruleId: rule.id, by: updatedBy });
    this.deps.audit?.("policy.rule_upserted", { ruleId: rule.id, subjects: rule.subjects.length, by: updatedBy });
    return rule;
  }

  /** Remove a rule. Platform defaults cannot be removed. */
  removeRule(ruleId: string, removedBy: string): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;
    if (rule.tier === "platform_default") {
      this.deps.audit?.("policy.remove_blocked", { ruleId, reason: "platform_default_immutable", by: removedBy });
      return false;
    }
    const deleted = this.rules.delete(ruleId);
    if (deleted) {
      this.changeLog.push({ timestamp: Date.now(), action: "rule_removed", ruleId, by: removedBy });
      this.deps.audit?.("policy.rule_removed", { ruleId, by: removedBy });
    }
    return deleted;
  }

  /** Enable or disable a rule. */
  setRuleEnabled(ruleId: string, enabled: boolean, changedBy: string): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;
    this.rules.set(ruleId, { ...rule, enabled, updatedAt: Date.now() });
    this.deps.audit?.("policy.rule_toggled", { ruleId, enabled, by: changedBy });
    return true;
  }

  /** Get a specific rule. */
  getRule(ruleId: string): PolicyRule | undefined {
    return this.rules.get(ruleId);
  }

  /** List all rules, optionally filtered by tier. */
  listRules(tierFilter?: PolicyTier): PolicyRule[] {
    const all = Array.from(this.rules.values());
    return tierFilter ? all.filter(r => r.tier === tierFilter) : all;
  }

  // ── Policy Evaluation ────────────────────────────────────────────────

  /**
   * Evaluate a policy request against all applicable rules.
   * Resolves precedence: the most specific DENY always wins.
   * More privileged policy must not silently hide user-visible actions.
   */
  evaluate(request: {
    subject: PolicySubject;
    target: PolicyTarget;
    context?: Record<string, unknown>;
  }): PolicyEvaluation {
    const requestId = `pe_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const matched: PolicyRule[] = [];

    // Collect all enabled rules matching this subject.
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      if (!rule.subjects.includes(request.subject)) continue;

      // Check target match (exact ID or wildcard).
      if (rule.target.id !== "*" && rule.target.id !== request.target.id) continue;

      // Check conditions if present.
      if (rule.conditions && request.context) {
        if (!this.matchConditions(rule.conditions, request.context)) continue;
      }

      matched.push(rule);
    }

    // Sort by precedence (lower number = higher priority).
    matched.sort((a, b) => POLICY_PRECEDENCE[a.tier] - POLICY_PRECEDENCE[b.tier]);

    // Resolve: explicit DENY at any tier wins. Then highest-priority allow/require_approval.
    let effectiveEffect: PolicyEffect = "allow";
    let denialReason: string | undefined;

    for (const rule of matched) {
      if (rule.effect === "deny") {
        effectiveEffect = "deny";
        denialReason = rule.reason;
        break; // DENY always wins — stop evaluation.
      }
      if (rule.effect === "require_approval") {
        effectiveEffect = "require_approval";
      }
      // audit_only doesn't change the effective effect — it's additive.
    }

    // Build integrity hash.
    const hashInput = `${requestId}:${request.subject}:${request.target.id}:${effectiveEffect}:${Date.now()}`;
    const integrityHash = createHash("sha256").update(hashInput).digest("hex").slice(0, 16);

    const evaluation: PolicyEvaluation = {
      requestId,
      subject: request.subject,
      target: request.target,
      matchedRules: matched,
      effectiveEffect,
      denialReason,
      evaluatedAt: Date.now(),
      integrityHash,
    };

    this.deps.audit?.("policy.evaluated", {
      requestId,
      subject: request.subject,
      effect: effectiveEffect,
      matchedRules: matched.length,
    });

    return evaluation;
  }

  /** Check if an action is explicitly allowed (not denied, not requiring approval). */
  isAllowed(subject: PolicySubject, target: PolicyTarget, context?: Record<string, unknown>): boolean {
    const result = this.evaluate({ subject, target, context });
    return result.effectiveEffect === "allow";
  }

  /** Check if an action requires approval. */
  requiresApproval(subject: PolicySubject, target: PolicyTarget, context?: Record<string, unknown>): boolean {
    const result = this.evaluate({ subject, target, context });
    return result.effectiveEffect === "require_approval";
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private matchConditions(conditions: Record<string, unknown>, context: Record<string, unknown>): boolean {
    for (const [key, expected] of Object.entries(conditions)) {
      const actual = context[key];
      if (actual === undefined) {
        // If condition key is absent in context, check for null/undefined expected.
        if (expected !== null && expected !== undefined) return false;
        continue;
      }
      if (Array.isArray(expected)) {
        if (!expected.includes(actual)) return false;
      } else if (expected !== actual) {
        return false;
      }
    }
    return true;
  }

  /** Get the policy change log for audit purposes. */
  getChangeLog(limit?: number) {
    const log = [...this.changeLog].reverse();
    return limit ? log.slice(0, limit) : log;
  }
}
