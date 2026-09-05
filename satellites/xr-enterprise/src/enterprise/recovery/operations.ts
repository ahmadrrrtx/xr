/**
 * XR 6.1 — Backup verification and disaster recovery operations.
 *
 * Wraps the Phase 11 `BackupService` with the operational guarantees an
 * organization needs:
 *
 *   - Verification: recompute the manifest digest, check every component, and
 *     assert no raw credential material is present.
 *   - Preflight: a restore is REFUSED unless the backup verifies. This is the
 *     control against restore poisoning (roadmap §9 adversarial).
 *   - Partial restore: component-level outcome, with explicit consistency
 *     warnings when related components did not all apply.
 *   - Cross-deployment restore: profile/version/schema compatibility checks.
 *   - RPO/RTO: measured against the declared targets, not assumed.
 *   - Drills: a recorded test-restore so "tested backups" is evidence-backed.
 */

import { createHash, randomUUID } from "node:crypto";
import type { DeploymentProfileKind } from "../deployment/types.ts";
import type { BackupManifest } from "../deployment/backup/service.ts";
import type {
  BackupVerification,
  BackupVerificationStatus,
  RecoveryDrill,
  RecoveryTargetAssessment,
  RecoveryTargets,
  RestoreMode,
  RestoreOutcome,
  RestorePlan,
  RestorePreflight,
} from "../types.ts";

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

const MINUTE_MS = 60 * 1000;

/**
 * Components that must be restored together to stay consistent.
 * Restoring executions without their checkpoints, or workflows without their
 * executions, produces a state the runtime cannot reason about.
 */
export const CONSISTENCY_GROUPS: readonly (readonly string[])[] = Object.freeze([
  ["execution_records", "checkpoints"],
  ["workflow_states", "execution_records"],
  ["audit_records", "policy_records"],
]);

/** Field names that must never appear in a backup payload. */
const FORBIDDEN_CREDENTIAL_KEYS: readonly string[] = [
  "password",
  "secret",
  "apiKey",
  "api_key",
  "token",
  "privateKey",
  "private_key",
  "clientSecret",
  "client_secret",
];

// ═══════════════════════════════════════════════════════════════════════════
// Recovery operations
// ═══════════════════════════════════════════════════════════════════════════

export interface RecoveryOperationsDeps {
  readonly audit?: (event: string, detail: Record<string, unknown>) => void;
  readonly now?: () => number;
  /** Look up a backup manifest by id (bridges Phase 11 BackupService). */
  readonly getManifest: (backupId: string) => BackupManifest | undefined;
  /**
   * Recompute the integrity digest of the stored backup content.
   * Returning undefined means the content could not be read → unverified.
   */
  readonly recomputeIntegrityHash?: (backupId: string) => string | undefined;
  /** Inspect a backup for credential material. Returns offending key paths. */
  readonly scanForCredentials?: (backupId: string) => readonly string[];
  /** Apply one component. Returns records restored, or throws to fail it. */
  readonly applyComponent?: (
    backupId: string,
    component: string,
    mode: RestoreMode,
  ) => { ok: boolean; records: number; detail?: string };
  /** Current XR version, for compatibility checks. */
  readonly currentVersion: string;
  readonly currentProfile: DeploymentProfileKind;
  /** Declared recovery targets for the active profile. */
  readonly targets?: RecoveryTargets;
}

export class RecoveryOperations {
  private readonly deps: RecoveryOperationsDeps;
  private readonly verifications = new Map<string, BackupVerification>();
  private readonly outcomes = new Map<string, RestoreOutcome>();
  private readonly drills = new Map<string, RecoveryDrill>();

  constructor(deps: RecoveryOperationsDeps) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  // ── Verification ─────────────────────────────────────────────────────────

  /**
   * Verify a backup's integrity and credential safety.
   * This must pass before any restore is allowed.
   */
  verify(backupId: string): BackupVerification {
    const now = this.now();
    const manifest = this.deps.getManifest(backupId);
    const errors: string[] = [];

    if (!manifest) {
      const v: BackupVerification = {
        verificationId: id("ver"),
        backupId,
        verifiedAt: now,
        status: "corrupt",
        manifestHashMatches: false,
        componentsChecked: 0,
        componentsOk: 0,
        errors: [`Backup manifest not found: ${backupId}`],
        credentialSafetyChecked: false,
        credentialSafetyOk: false,
      };
      this.verifications.set(v.verificationId, v);
      this.deps.audit?.("enterprise.recovery.verify", { backupId, status: v.status, errors: v.errors.length });
      return v;
    }

    // Integrity digest.
    const recomputed = this.deps.recomputeIntegrityHash?.(backupId);
    const manifestHashMatches = recomputed === undefined ? false : recomputed === manifest.integrityHash;
    if (recomputed === undefined) {
      errors.push("Backup content could not be read to recompute the integrity hash.");
    } else if (!manifestHashMatches) {
      errors.push(
        `Integrity hash mismatch: manifest declares ${manifest.integrityHash.slice(0, 16)}… but content hashes to ${recomputed.slice(0, 16)}….`,
      );
    }

    // Component sanity.
    let componentsOk = 0;
    for (const c of manifest.components) {
      const bad =
        c.recordCount < 0 ||
        c.sizeBytes < 0 ||
        (c.recordCount > 0 && c.latestRecord < c.earliestRecord);
      if (bad) errors.push(`Component '${c.kind}' has inconsistent metadata.`);
      else componentsOk++;
    }

    // Credential safety.
    let credentialSafetyChecked = false;
    let credentialSafetyOk = true;
    if (this.deps.scanForCredentials) {
      credentialSafetyChecked = true;
      const found = this.deps.scanForCredentials(backupId);
      if (found.length > 0) {
        credentialSafetyOk = false;
        errors.push(
          `Backup contains ${found.length} field(s) that look like credential material: ${found.slice(0, 5).join(", ")}. ` +
            "Backups must reference credentials, never embed them.",
        );
      }
    }

    const status: BackupVerificationStatus = errors.length === 0
      ? "verified"
      : !manifestHashMatches && recomputed !== undefined
        ? "corrupt"
        : componentsOk < manifest.components.length
          ? "incomplete"
          : "unverified";

    const v: BackupVerification = {
      verificationId: id("ver"),
      backupId,
      verifiedAt: now,
      status,
      manifestHashMatches,
      componentsChecked: manifest.components.length,
      componentsOk,
      errors,
      credentialSafetyChecked,
      credentialSafetyOk,
    };

    this.verifications.set(v.verificationId, v);
    this.deps.audit?.("enterprise.recovery.verify", {
      backupId,
      verificationId: v.verificationId,
      status: v.status,
      manifestHashMatches,
      componentsChecked: v.componentsChecked,
      componentsOk: v.componentsOk,
      credentialSafetyOk: v.credentialSafetyOk,
      errors: errors.length,
    });

    return v;
  }

  latestVerification(backupId: string): BackupVerification | undefined {
    return [...this.verifications.values()]
      .filter((v) => v.backupId === backupId)
      .sort((a, b) => b.verifiedAt - a.verifiedAt)[0];
  }

  // ── Preflight ────────────────────────────────────────────────────────────

  /**
   * Evaluate whether a restore may proceed.
   * `ok: false` means the restore MUST NOT run.
   */
  preflight(plan: RestorePlan): RestorePreflight {
    const blockers: string[] = [];
    const warnings: string[] = [];

    const manifest = this.deps.getManifest(plan.backupId);
    if (!manifest) {
      return {
        ok: false,
        planId: plan.planId,
        integrityVerified: false,
        schemaCompatible: false,
        profileCompatible: false,
        versionCompatible: false,
        blockers: [`Backup not found: ${plan.backupId}`],
        warnings,
      };
    }

    // 1. Integrity — the anti-poisoning gate.
    const verification = this.verify(plan.backupId);
    const integrityVerified = verification.status === "verified";
    if (!integrityVerified) {
      blockers.push(
        `Backup did not verify (status: ${verification.status}). Restore is refused to prevent restoring corrupted or tampered data.`,
      );
    }
    if (verification.credentialSafetyChecked && !verification.credentialSafetyOk) {
      blockers.push("Backup failed the credential-safety check and must not be restored.");
    }

    // 2. Version compatibility.
    const backupVersion = manifest.version;
    const versionCompatible = majorOf(backupVersion) === majorOf(this.deps.currentVersion);
    if (!versionCompatible) {
      blockers.push(
        `Backup was created by XR ${backupVersion}; current runtime is ${this.deps.currentVersion}. Major versions must match for restore.`,
      );
    } else if (backupVersion !== this.deps.currentVersion) {
      warnings.push(`Backup version ${backupVersion} differs from current ${this.deps.currentVersion}; migrations may run.`);
    }

    // 3. Profile compatibility for cross-deployment restore.
    const profileCompatible = isProfileRestoreCompatible(plan.sourceProfile, plan.targetProfile);
    if (!profileCompatible) {
      blockers.push(
        `Restoring a '${plan.sourceProfile}' backup into a '${plan.targetProfile}' deployment is not supported: the target lacks required capabilities.`,
      );
    } else if (plan.crossDeployment) {
      warnings.push(
        `Cross-deployment restore ${plan.sourceProfile} → ${plan.targetProfile}. Residency and tenancy settings must be re-reviewed after restore.`,
      );
    }

    // 4. Requested components must exist in the backup.
    const available = new Set(manifest.components.map((c) => String(c.kind)));
    const schemaCompatible = plan.components.every((c) => available.has(c));
    for (const c of plan.components) {
      if (!available.has(c)) blockers.push(`Component '${c}' is not present in backup ${plan.backupId}.`);
    }

    // 5. Consistency warnings for partial restores.
    if (plan.mode === "partial") {
      const selected = new Set(plan.components);
      for (const group of CONSISTENCY_GROUPS) {
        const present = group.filter((c) => selected.has(c));
        if (present.length > 0 && present.length < group.length) {
          warnings.push(
            `Partial restore selects ${present.join(", ")} without ${group.filter((c) => !selected.has(c)).join(", ")}. Restored state may be inconsistent.`,
          );
        }
      }
    }

    const ok = blockers.length === 0;

    this.deps.audit?.("enterprise.recovery.preflight", {
      planId: plan.planId,
      backupId: plan.backupId,
      ok,
      integrityVerified,
      versionCompatible,
      profileCompatible,
      schemaCompatible,
      blockers: blockers.length,
      warnings: warnings.length,
    });

    return {
      ok,
      planId: plan.planId,
      integrityVerified,
      verification,
      schemaCompatible,
      profileCompatible,
      versionCompatible,
      blockers,
      warnings,
    };
  }

  // ── Restore ──────────────────────────────────────────────────────────────

  createPlan(params: {
    backupId: string;
    mode: RestoreMode;
    components?: readonly string[];
    requestedBy: string;
    targetProfile?: DeploymentProfileKind;
  }): RestorePlan {
    const manifest = this.deps.getManifest(params.backupId);
    const targetProfile = params.targetProfile ?? this.deps.currentProfile;
    const sourceProfile = manifest?.profile ?? targetProfile;
    return {
      planId: id("plan"),
      backupId: params.backupId,
      mode: params.mode,
      components: params.components ?? (manifest?.components.map((c) => String(c.kind)) ?? []),
      targetProfile,
      sourceProfile,
      crossDeployment: sourceProfile !== targetProfile,
      requestedBy: params.requestedBy,
      createdAt: this.now(),
    };
  }

  /**
   * Execute a restore. Always runs preflight first and refuses on blockers.
   * `dry_run` mode validates and reports without applying.
   */
  restore(plan: RestorePlan): { outcome: RestoreOutcome; preflight: RestorePreflight } {
    const startedAt = this.now();
    const pre = this.preflight(plan);

    if (!pre.ok) {
      const outcome: RestoreOutcome = {
        outcomeId: id("out"),
        planId: plan.planId,
        backupId: plan.backupId,
        startedAt,
        completedAt: this.now(),
        ok: false,
        mode: plan.mode,
        componentsRestored: [],
        componentsFailed: [],
        componentsSkipped: plan.components,
        recordsRestored: 0,
        partial: false,
        consistencyWarnings: pre.warnings,
        rtoMs: this.now() - startedAt,
        error: `Restore refused by preflight: ${pre.blockers.join(" ")}`,
      };
      this.outcomes.set(outcome.outcomeId, outcome);
      this.deps.audit?.("enterprise.recovery.restore_refused", {
        planId: plan.planId,
        backupId: plan.backupId,
        blockers: pre.blockers,
      });
      return { outcome, preflight: pre };
    }

    const restored: string[] = [];
    const failed: string[] = [];
    const skipped: string[] = [];
    let records = 0;

    for (const component of plan.components) {
      if (plan.mode === "dry_run") {
        skipped.push(component);
        continue;
      }
      try {
        const r = this.deps.applyComponent?.(plan.backupId, component, plan.mode);
        if (!r) {
          skipped.push(component);
          continue;
        }
        if (r.ok) {
          restored.push(component);
          records += r.records;
        } else {
          failed.push(component);
        }
      } catch {
        failed.push(component);
      }
    }

    // Consistency warnings for what actually applied.
    const consistencyWarnings = [...pre.warnings];
    const restoredSet = new Set(restored);
    for (const group of CONSISTENCY_GROUPS) {
      const inPlan = group.filter((c) => plan.components.includes(c));
      if (inPlan.length < 2) continue;
      const applied = inPlan.filter((c) => restoredSet.has(c));
      if (applied.length > 0 && applied.length < inPlan.length) {
        consistencyWarnings.push(
          `Consistency risk: ${applied.join(", ")} restored but ${inPlan.filter((c) => !restoredSet.has(c)).join(", ")} did not.`,
        );
      }
    }

    const completedAt = this.now();
    const partial = failed.length > 0 || (plan.mode !== "dry_run" && restored.length < plan.components.length);

    const outcome: RestoreOutcome = {
      outcomeId: id("out"),
      planId: plan.planId,
      backupId: plan.backupId,
      startedAt,
      completedAt,
      ok: failed.length === 0,
      mode: plan.mode,
      componentsRestored: restored,
      componentsFailed: failed,
      componentsSkipped: skipped,
      recordsRestored: records,
      partial,
      consistencyWarnings,
      rtoMs: completedAt - startedAt,
      error: failed.length > 0 ? `Components failed to restore: ${failed.join(", ")}` : undefined,
    };

    this.outcomes.set(outcome.outcomeId, outcome);

    this.deps.audit?.("enterprise.recovery.restore", {
      outcomeId: outcome.outcomeId,
      planId: plan.planId,
      backupId: plan.backupId,
      mode: plan.mode,
      ok: outcome.ok,
      partial: outcome.partial,
      restored: restored.length,
      failed: failed.length,
      records,
      rtoMs: outcome.rtoMs,
      consistencyWarnings: consistencyWarnings.length,
    });

    return { outcome, preflight: pre };
  }

  // ── RPO/RTO assessment ───────────────────────────────────────────────────

  /**
   * Assess measured recovery against declared targets.
   * Returns undefined measurements rather than guessing when data is absent.
   */
  assessTargets(params: {
    lastBackupAt?: number;
    lastRestoreRtoMs?: number;
    targets?: RecoveryTargets;
  }): RecoveryTargetAssessment {
    const now = this.now();
    const targets = params.targets ??
      this.deps.targets ?? { rpoMinutes: 1440, rtoMinutes: 240, profile: this.deps.currentProfile };

    const measuredRpoMinutes =
      params.lastBackupAt === undefined ? undefined : Math.max(0, Math.round((now - params.lastBackupAt) / MINUTE_MS));
    const measuredRtoMinutes =
      params.lastRestoreRtoMs === undefined ? undefined : Math.round(params.lastRestoreRtoMs / MINUTE_MS);

    const basisParts: string[] = [];
    basisParts.push(
      measuredRpoMinutes === undefined
        ? "RPO not measured: no backup recorded."
        : `RPO measured as time since last successful backup (${measuredRpoMinutes} min).`,
    );
    basisParts.push(
      measuredRtoMinutes === undefined
        ? "RTO not measured: no restore or drill recorded."
        : `RTO measured from the most recent restore/drill (${measuredRtoMinutes} min).`,
    );

    return {
      targets,
      measuredRpoMinutes,
      measuredRtoMinutes,
      rpoMet: measuredRpoMinutes === undefined ? undefined : measuredRpoMinutes <= targets.rpoMinutes,
      rtoMet: measuredRtoMinutes === undefined ? undefined : measuredRtoMinutes <= targets.rtoMinutes,
      assessedAt: now,
      basis: basisParts.join(" "),
    };
  }

  // ── Drills ───────────────────────────────────────────────────────────────

  /**
   * Run a recorded restore drill (dry-run by default).
   * This is the evidence that backups are actually tested.
   */
  drill(params: {
    backupId: string;
    executedBy: string;
    notes?: string;
    apply?: boolean;
    lastBackupAt?: number;
  }): RecoveryDrill {
    const plan = this.createPlan({
      backupId: params.backupId,
      mode: params.apply ? "full" : "dry_run",
      requestedBy: params.executedBy,
    });

    const { outcome, preflight } = this.restore(plan);
    const assessment = this.assessTargets({
      lastBackupAt: params.lastBackupAt,
      lastRestoreRtoMs: outcome.rtoMs,
    });

    const drill: RecoveryDrill = {
      drillId: id("drill"),
      executedAt: this.now(),
      executedBy: params.executedBy,
      backupId: params.backupId,
      ok: preflight.ok && outcome.ok,
      preflight,
      outcome,
      assessment,
      notes: params.notes ?? (params.apply ? "Applied restore drill." : "Dry-run restore drill."),
    };

    this.drills.set(drill.drillId, drill);

    this.deps.audit?.("enterprise.recovery.drill", {
      drillId: drill.drillId,
      backupId: params.backupId,
      executedBy: params.executedBy,
      ok: drill.ok,
      applied: params.apply ?? false,
      rtoMs: outcome.rtoMs,
    });

    return drill;
  }

  drills_(): readonly RecoveryDrill[] {
    return [...this.drills.values()].sort((a, b) => b.executedAt - a.executedAt);
  }

  lastDrill(): RecoveryDrill | undefined {
    return this.drills_()[0];
  }

  outcomes_(): readonly RestoreOutcome[] {
    return [...this.outcomes.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  verifications_(): readonly BackupVerification[] {
    return [...this.verifications.values()].sort((a, b) => b.verifiedAt - a.verifiedAt);
  }

  /** Backup success rate over the recorded verifications — feeds the SLO. */
  backupSuccessRate(): { good: number; total: number } {
    const all = this.verifications_();
    return { good: all.filter((v) => v.status === "verified").length, total: all.length };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function majorOf(version: string): string {
  return version.split(".")[0] ?? version;
}

/**
 * Whether a backup from `source` may be restored into `target`.
 *
 * The rule: you may always restore "down" into a richer profile, and you may
 * restore a single-user backup anywhere. You may NOT restore a multi-user or
 * organization-scoped backup into a single-user local profile, because that
 * profile has no tenancy model to enforce the boundaries the data assumes.
 */
export function isProfileRestoreCompatible(
  source: DeploymentProfileKind,
  target: DeploymentProfileKind,
): boolean {
  if (source === target) return true;

  const multiUser: readonly DeploymentProfileKind[] = ["team_private", "managed_cloud", "hybrid"];
  const singleUser: readonly DeploymentProfileKind[] = ["personal_local", "private_local_server"];

  if (multiUser.includes(source) && singleUser.includes(target)) return false;
  return true;
}

/** Utility for callers that need a credential scanner over arbitrary JSON. */
export function scanObjectForCredentials(value: unknown, path = ""): readonly string[] {
  const found: string[] = [];
  const walk = (node: unknown, p: string, depth: number): void => {
    if (depth > 12 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${p}[${i}]`, depth + 1));
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const childPath = p ? `${p}.${k}` : k;
        const lower = k.toLowerCase();
        if (FORBIDDEN_CREDENTIAL_KEYS.some((f) => lower === f.toLowerCase())) {
          // A reference is fine; a raw value is not.
          if (typeof v === "string" && v.length > 0 && !v.startsWith("ref:") && !v.startsWith("sha256:")) {
            found.push(childPath);
          }
        }
        walk(v, childPath, depth + 1);
      }
    }
  };
  walk(value, path, 0);
  return found;
}

/** Compute a stable digest for backup content, for integrity recomputation. */
export function digestBackupContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
