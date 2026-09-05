/**
 * XR 6.1 — Versioned, reversible policy bundles.
 *
 * A bundle is an immutable, hashed set of policy rules with a lineage.
 * Activation supersedes the previous bundle; rollback restores it.
 *
 * Roadmap §15 requires policy bundles to be versioned and reversible, and
 * requires that rollback never bypasses safety controls — enforced here by
 * validating every bundle (including rollback targets) against the invariants.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  ENTERPRISE_BOUNDS,
  ENTERPRISE_SCHEMA_VERSION,
  isPolicyLayer,
  type PolicyBundle,
  type PolicyBundleState,
  type PolicyBundleValidation,
  type PolicyOverrideAttempt,
  type PolicyRule,
} from "../types.ts";
import { canAuthorLayer, getSafetyKeySpec, isVisibilitySuppression } from "./layers.ts";
import { resolvePolicy } from "./engine.ts";

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function hashRules(rules: readonly PolicyRule[]): string {
  const canonical = rules
    .map((r) => `${r.layer}|${r.key}|${String(r.value)}|${r.organizationId ?? ""}|${r.workspaceId ?? ""}|${r.capabilityId ?? ""}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidateBundleOptions {
  /** The layer the author is entitled to write at. */
  readonly authorLayer?: PolicyRule["layer"];
  readonly now?: number;
}

/**
 * Validate a candidate rule set BEFORE it can be activated.
 *
 * Catches visibility suppression and privilege violations at authoring time so
 * an admin gets an immediate, explicit rejection rather than a silent no-op.
 */
export function validateBundleRules(
  rules: readonly PolicyRule[],
  options: ValidateBundleOptions = {},
): PolicyBundleValidation {
  const now = options.now ?? Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  const rejectedOverrides: PolicyOverrideAttempt[] = [];

  if (rules.length > ENTERPRISE_BOUNDS.MAX_POLICY_RULES_PER_BUNDLE) {
    errors.push(
      `Bundle exceeds MAX_POLICY_RULES_PER_BUNDLE (${rules.length} > ${ENTERPRISE_BOUNDS.MAX_POLICY_RULES_PER_BUNDLE}).`,
    );
  }

  for (const rule of rules) {
    if (!rule.key || typeof rule.key !== "string") {
      errors.push("Rule is missing a key.");
      continue;
    }
    if (!isPolicyLayer(rule.layer)) {
      errors.push(`Rule '${rule.key}' has invalid layer '${rule.layer}'.`);
      continue;
    }
    if (!rule.reason || rule.reason.trim().length === 0) {
      // Reasons are mandatory because they are shown to affected users.
      errors.push(`Rule '${rule.key}' must include a reason (it is surfaced to affected users).`);
    }
    if (rule.reason && rule.reason.length > ENTERPRISE_BOUNDS.MAX_REASON_CHARS) {
      errors.push(`Rule '${rule.key}' reason exceeds ${ENTERPRISE_BOUNDS.MAX_REASON_CHARS} characters.`);
    }
    if (!rule.authoredBy) {
      errors.push(`Rule '${rule.key}' must record authoredBy.`);
    }

    // Privilege: an author may not write above their own layer.
    if (options.authorLayer && !canAuthorLayer(options.authorLayer, rule.layer)) {
      errors.push(
        `Author at layer '${options.authorLayer}' may not write rules at layer '${rule.layer}' (insufficient privilege).`,
      );
    }

    // Visibility suppression is always rejected, at any layer.
    if (isVisibilitySuppression(rule.key, rule.value)) {
      rejectedOverrides.push({
        key: rule.key,
        layer: rule.layer,
        attemptedValue: rule.value,
        rejectedBecause:
          "User-visibility invariants cannot be disabled. This rule was rejected at authoring time.",
        authoredBy: rule.authoredBy,
        at: now,
        severity: "critical",
      });
      errors.push(
        `Rule '${rule.key}' attempts to suppress a user-visibility invariant and cannot be included in a bundle.`,
      );
    }

    // Safety key sanity.
    const spec = getSafetyKeySpec(rule.key);
    if (spec && spec.kind === "enum_order" && spec.order && !spec.order.includes(String(rule.value))) {
      errors.push(
        `Rule '${rule.key}' value '${String(rule.value)}' is not one of: ${spec.order.join(", ")}.`,
      );
    }
  }

  // Duplicate (layer, key, scope) pairs are ambiguous.
  const seen = new Set<string>();
  for (const rule of rules) {
    const sig = `${rule.layer}|${rule.key}|${rule.organizationId ?? ""}|${rule.workspaceId ?? ""}|${rule.capabilityId ?? ""}`;
    if (seen.has(sig)) {
      warnings.push(`Duplicate rule for key '${rule.key}' at layer '${rule.layer}' — last one wins.`);
    }
    seen.add(sig);
  }

  // Dry-run resolution surfaces weakening attempts across layers.
  const dryRun = resolvePolicy(rules, { now });
  for (const attempt of dryRun.rejectedOverrides) {
    if (!rejectedOverrides.some((r) => r.key === attempt.key && r.layer === attempt.layer)) {
      rejectedOverrides.push(attempt);
    }
    if (attempt.severity === "warning") {
      warnings.push(
        `Rule '${attempt.key}' at layer '${attempt.layer}' is weaker than the effective value and will not take effect.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings, rejectedOverrides };
}

// ═══════════════════════════════════════════════════════════════════════════
// Bundle store
// ═══════════════════════════════════════════════════════════════════════════

export interface PolicyBundleStoreDeps {
  readonly audit?: (event: string, detail: Record<string, unknown>) => void;
  readonly now?: () => number;
}

export interface CreateBundleParams {
  readonly name: string;
  readonly description?: string;
  readonly rules: readonly PolicyRule[];
  readonly createdBy: string;
  readonly organizationId?: string;
  readonly workspaceId?: string;
  readonly authorLayer?: PolicyRule["layer"];
}

export interface BundleOperationResult {
  readonly ok: boolean;
  readonly bundle?: PolicyBundle;
  readonly validation?: PolicyBundleValidation;
  readonly error?: string;
}

/**
 * In-memory, deterministic bundle store.
 *
 * Persistence is intentionally injected by the caller (workspace store or
 * business DB) so this stays usable in `personal_local` with no database.
 */
export class PolicyBundleStore {
  private readonly bundles = new Map<string, PolicyBundle>();
  private readonly deps: PolicyBundleStoreDeps;

  constructor(deps: PolicyBundleStoreDeps = {}) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Create a draft bundle. Drafts are validated but not yet in effect. */
  create(params: CreateBundleParams): BundleOperationResult {
    const now = this.now();
    const validation = validateBundleRules(params.rules, { authorLayer: params.authorLayer, now });
    if (!validation.ok) {
      this.deps.audit?.("enterprise.policy.bundle.rejected", {
        name: params.name,
        createdBy: params.createdBy,
        errors: validation.errors.length,
        rejectedOverrides: validation.rejectedOverrides.length,
      });
      return { ok: false, validation, error: validation.errors.join("; ") };
    }

    const lineage = this.lineageFor(params.organizationId, params.workspaceId);
    const version = lineage.length === 0 ? 1 : Math.max(...lineage.map((b) => b.version)) + 1;
    const active = lineage.find((b) => b.state === "active");

    const bundle: PolicyBundle = {
      bundleId: id("pb"),
      schemaVersion: ENTERPRISE_SCHEMA_VERSION,
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
      name: params.name,
      description: params.description ?? "",
      version,
      state: "draft",
      rules: [...params.rules],
      createdBy: params.createdBy,
      createdAt: now,
      previousBundleId: active?.bundleId,
      contentHash: hashRules(params.rules),
    };

    this.bundles.set(bundle.bundleId, bundle);
    this.deps.audit?.("enterprise.policy.bundle.created", {
      bundleId: bundle.bundleId,
      name: bundle.name,
      version: bundle.version,
      rules: bundle.rules.length,
      createdBy: bundle.createdBy,
      contentHash: bundle.contentHash,
    });

    return { ok: true, bundle, validation };
  }

  /** Activate a draft. Supersedes the currently active bundle in the lineage. */
  activate(bundleId: string, actorId: string): BundleOperationResult {
    const bundle = this.bundles.get(bundleId);
    if (!bundle) return { ok: false, error: `Bundle not found: ${bundleId}` };
    if (bundle.state === "active") return { ok: true, bundle };
    if (bundle.state !== "draft" && bundle.state !== "rolled_back") {
      return { ok: false, error: `Bundle ${bundleId} is ${bundle.state} and cannot be activated.` };
    }

    const now = this.now();

    // Re-validate at activation time — never activate an unsafe bundle.
    const validation = validateBundleRules(bundle.rules, { now });
    if (!validation.ok) {
      this.deps.audit?.("enterprise.policy.bundle.activation_blocked", {
        bundleId,
        actorId,
        errors: validation.errors.length,
      });
      return { ok: false, validation, error: `Activation blocked: ${validation.errors.join("; ")}` };
    }

    // Supersede the current active bundle in this lineage.
    for (const other of this.lineageFor(bundle.organizationId, bundle.workspaceId)) {
      if (other.state === "active" && other.bundleId !== bundleId) {
        this.bundles.set(other.bundleId, { ...other, state: "superseded", supersededAt: now });
      }
    }

    const activated: PolicyBundle = { ...bundle, state: "active", activatedAt: now };
    this.bundles.set(bundleId, activated);

    this.deps.audit?.("enterprise.policy.bundle.activated", {
      bundleId,
      version: activated.version,
      actorId,
      contentHash: activated.contentHash,
      previousBundleId: activated.previousBundleId,
    });

    return { ok: true, bundle: activated, validation };
  }

  /**
   * Roll a lineage back to its previous bundle.
   *
   * The rollback target is re-validated: rollback may disable administrative
   * changes but may never reinstate a bundle that violates safety invariants.
   */
  rollback(bundleId: string, actorId: string, reason: string): BundleOperationResult {
    const bundle = this.bundles.get(bundleId);
    if (!bundle) return { ok: false, error: `Bundle not found: ${bundleId}` };
    if (bundle.state !== "active") {
      return { ok: false, error: `Only an active bundle can be rolled back (state: ${bundle.state}).` };
    }
    if (!bundle.previousBundleId) {
      return { ok: false, error: `Bundle ${bundleId} has no previous version to roll back to.` };
    }
    const target = this.bundles.get(bundle.previousBundleId);
    if (!target) return { ok: false, error: `Rollback target ${bundle.previousBundleId} not found.` };

    const now = this.now();
    const validation = validateBundleRules(target.rules, { now });
    if (!validation.ok) {
      this.deps.audit?.("enterprise.policy.bundle.rollback_blocked", {
        bundleId,
        targetBundleId: target.bundleId,
        actorId,
        errors: validation.errors.length,
      });
      return {
        ok: false,
        validation,
        error: `Rollback blocked — target bundle violates safety invariants: ${validation.errors.join("; ")}`,
      };
    }

    this.bundles.set(bundleId, {
      ...bundle,
      state: "rolled_back",
      rolledBackAt: now,
      rolledBackReason: reason,
    });
    const restored: PolicyBundle = { ...target, state: "active", activatedAt: now };
    this.bundles.set(target.bundleId, restored);

    this.deps.audit?.("enterprise.policy.bundle.rolled_back", {
      bundleId,
      restoredBundleId: target.bundleId,
      actorId,
      reason,
    });

    return { ok: true, bundle: restored, validation };
  }

  get(bundleId: string): PolicyBundle | undefined {
    return this.bundles.get(bundleId);
  }

  /** The active bundle for a scope, if any. */
  active(organizationId?: string, workspaceId?: string): PolicyBundle | undefined {
    return this.lineageFor(organizationId, workspaceId).find((b) => b.state === "active");
  }

  /**
   * All rules currently in force for a scope: the active organization bundle
   * plus the active workspace bundle (if a workspace is given).
   */
  effectiveRules(organizationId?: string, workspaceId?: string): readonly PolicyRule[] {
    const out: PolicyRule[] = [];
    const org = this.active(organizationId, undefined);
    if (org) out.push(...org.rules);
    if (workspaceId) {
      const ws = this.active(organizationId, workspaceId);
      if (ws) out.push(...ws.rules);
    }
    return out;
  }

  list(filter?: { organizationId?: string; workspaceId?: string; state?: PolicyBundleState }): readonly PolicyBundle[] {
    let rows = [...this.bundles.values()];
    if (filter?.organizationId !== undefined) rows = rows.filter((b) => b.organizationId === filter.organizationId);
    if (filter?.workspaceId !== undefined) rows = rows.filter((b) => b.workspaceId === filter.workspaceId);
    if (filter?.state) rows = rows.filter((b) => b.state === filter.state);
    return rows.sort((a, b) => b.version - a.version);
  }

  /** History for a lineage, newest first, capped by MAX_BUNDLE_HISTORY. */
  history(organizationId?: string, workspaceId?: string): readonly PolicyBundle[] {
    return this.lineageFor(organizationId, workspaceId)
      .sort((a, b) => b.version - a.version)
      .slice(0, ENTERPRISE_BOUNDS.MAX_BUNDLE_HISTORY);
  }

  private lineageFor(organizationId?: string, workspaceId?: string): PolicyBundle[] {
    return [...this.bundles.values()].filter(
      (b) => b.organizationId === organizationId && b.workspaceId === workspaceId,
    );
  }
}

/** Convenience constructor for a policy rule with required provenance. */
export function policyRule(params: {
  key: string;
  value: PolicyRule["value"];
  layer: PolicyRule["layer"];
  reason: string;
  authoredBy: string;
  authoredAt?: number;
  organizationId?: string;
  workspaceId?: string;
  capabilityId?: string;
}): PolicyRule {
  return {
    key: params.key,
    value: params.value,
    layer: params.layer,
    reason: params.reason,
    authoredBy: params.authoredBy,
    authoredAt: params.authoredAt ?? Date.now(),
    organizationId: params.organizationId,
    workspaceId: params.workspaceId,
    capabilityId: params.capabilityId,
  };
}
