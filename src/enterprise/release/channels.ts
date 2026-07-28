/**
 * XR 6.1 — Release channels, support windows, compatibility, rollback validation.
 *
 * This is the "supportability" half of enterprise trust: an organization needs
 * to know how long a version is supported, what may break on upgrade, and
 * whether a rollback is safe.
 *
 * Roadmap §15 rollback invariants are encoded in `validateRollback`:
 * administrative features may be disabled by a rollback, but local operation,
 * policy safety, audit integrity, backups, incident evidence, and capability
 * revocation must all survive it.
 */

import { createHash } from "node:crypto";
import {
  AUDIT_EXPORT_FORMAT_VERSION,
  ENTERPRISE_SCHEMA_VERSION,
  type CompatibilityCheck,
  type CompatibilityDeclaration,
  type ReleaseArtifactEvidence,
  type ReleaseChannel,
  type ReleaseRecord,
  type RollbackValidation,
  type SupportState,
  type SupportWindow,
} from "../types.ts";
import { compareSemver, parseSemver } from "../supplychain/response.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Support duration per channel, from release date. */
export const CHANNEL_SUPPORT_DAYS: Readonly<Record<ReleaseChannel, { active: number; security: number }>> =
  Object.freeze({
    stable: { active: 180, security: 365 },
    lts: { active: 545, security: 730 },
    beta: { active: 60, security: 60 },
    edge: { active: 30, security: 30 },
  });

export const CHANNEL_DESCRIPTIONS: Readonly<Record<ReleaseChannel, string>> = Object.freeze({
  stable: "Recommended for production. Full support, then security-only maintenance.",
  lts: "Long-term support for organizations with slow upgrade cycles.",
  beta: "Preview of the next release. Not covered by support commitments.",
  edge: "Continuous builds. No compatibility or support guarantees.",
});

/**
 * Compatibility declaration for the current XR release.
 * Kept in one place so upgrade/rollback checks have a single source of truth.
 */
export function currentCompatibility(params: {
  pluginApiVersion: string;
  capsuleSchemaVersion: string;
  backupSchemaVersion?: string;
  minUpgradeFrom?: string;
}): CompatibilityDeclaration {
  return {
    pluginApiVersion: params.pluginApiVersion,
    capsuleSchemaVersion: params.capsuleSchemaVersion,
    backupSchemaVersion: params.backupSchemaVersion ?? params.capsuleSchemaVersion,
    policySchemaVersion: ENTERPRISE_SCHEMA_VERSION,
    auditExportFormatVersion: AUDIT_EXPORT_FORMAT_VERSION,
    minUpgradeFrom: params.minUpgradeFrom ?? "6.0.0",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Release registry
// ═══════════════════════════════════════════════════════════════════════════

export interface ReleaseRegistryDeps {
  readonly now?: () => number;
  readonly audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class ReleaseRegistry {
  private readonly releases = new Map<string, ReleaseRecord>();
  private readonly artifacts = new Map<string, ReleaseArtifactEvidence[]>();
  private readonly deps: ReleaseRegistryDeps;

  constructor(deps: ReleaseRegistryDeps = {}) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Register a release, deriving its support window from the channel. */
  register(params: {
    version: string;
    channel: ReleaseChannel;
    releasedAt?: number;
    notes?: string;
    compatibility: CompatibilityDeclaration;
  }): ReleaseRecord {
    const releasedAt = params.releasedAt ?? this.now();
    const window = CHANNEL_SUPPORT_DAYS[params.channel];
    const supportedUntil = releasedAt + window.active * DAY_MS;
    const securityUntil = releasedAt + window.security * DAY_MS;

    const record: ReleaseRecord = {
      version: params.version,
      channel: params.channel,
      releasedAt,
      supportedUntil,
      securityUntil,
      supportState: params.channel === "beta" || params.channel === "edge" ? "prerelease" : "supported",
      notes: params.notes ?? "",
      compatibility: params.compatibility,
    };

    this.releases.set(params.version, record);
    this.deps.audit?.("enterprise.release.registered", {
      version: record.version,
      channel: record.channel,
      supportedUntil,
      securityUntil,
    });
    return record;
  }

  get(version: string): ReleaseRecord | undefined {
    return this.releases.get(version);
  }

  list(channel?: ReleaseChannel): readonly ReleaseRecord[] {
    let rows = [...this.releases.values()];
    if (channel) rows = rows.filter((r) => r.channel === channel);
    return rows.sort((a, b) => b.releasedAt - a.releasedAt);
  }

  /** Current support state of a version, computed against now. */
  supportWindow(version: string): SupportWindow | undefined {
    const r = this.releases.get(version);
    if (!r) return undefined;
    const now = this.now();

    let state: SupportState;
    let daysRemaining: number | undefined;
    let message: string;

    if (r.channel === "beta" || r.channel === "edge") {
      state = "prerelease";
      message = `${CHANNEL_DESCRIPTIONS[r.channel]} Not covered by a support window.`;
    } else if (r.supportedUntil !== undefined && now <= r.supportedUntil) {
      state = "supported";
      daysRemaining = Math.ceil((r.supportedUntil - now) / DAY_MS);
      message = `Fully supported for ${daysRemaining} more day(s).`;
    } else if (r.securityUntil !== undefined && now <= r.securityUntil) {
      state = "security_only";
      daysRemaining = Math.ceil((r.securityUntil - now) / DAY_MS);
      message = `Security fixes only for ${daysRemaining} more day(s). Plan an upgrade.`;
    } else {
      state = "end_of_life";
      daysRemaining = 0;
      message = "End of life. No further fixes will be issued. Upgrade required.";
    }

    return { version, channel: r.channel, state, daysRemaining, message };
  }

  /** Check an upgrade or downgrade between two registered versions. */
  checkCompatibility(fromVersion: string, toVersion: string): CompatibilityCheck {
    const from = this.releases.get(fromVersion);
    const to = this.releases.get(toVersion);
    const breaking: string[] = [];
    const warnings: string[] = [];

    const fv = parseSemver(fromVersion);
    const tv = parseSemver(toVersion);
    const direction: CompatibilityCheck["direction"] =
      !fv || !tv ? "same" : compareSemver(tv, fv) > 0 ? "upgrade" : compareSemver(tv, fv) < 0 ? "downgrade" : "same";

    if (!from) warnings.push(`Source version ${fromVersion} is not registered; compatibility is inferred.`);
    if (!to) {
      return {
        ok: false,
        fromVersion,
        toVersion,
        direction,
        breaking: [`Target version ${toVersion} is not registered.`],
        warnings,
        rollbackSupported: false,
        migrationRequired: false,
      };
    }

    // Major version changes are breaking by definition.
    if (fv && tv && fv.major !== tv.major) {
      breaking.push(`Major version change ${fv.major} → ${tv.major}.`);
    }

    // Minimum upgrade floor.
    if (direction === "upgrade" && fv) {
      const floor = parseSemver(to.compatibility.minUpgradeFrom);
      if (floor && compareSemver(fv, floor) < 0) {
        breaking.push(
          `Direct upgrade from ${fromVersion} is not supported; ${toVersion} requires at least ${to.compatibility.minUpgradeFrom}.`,
        );
      }
    }

    // Schema/API deltas.
    if (from) {
      const deltas: [string, string, string][] = [
        ["plugin API", from.compatibility.pluginApiVersion, to.compatibility.pluginApiVersion],
        ["capsule schema", from.compatibility.capsuleSchemaVersion, to.compatibility.capsuleSchemaVersion],
        ["backup schema", from.compatibility.backupSchemaVersion, to.compatibility.backupSchemaVersion],
        ["policy schema", from.compatibility.policySchemaVersion, to.compatibility.policySchemaVersion],
        ["audit export format", from.compatibility.auditExportFormatVersion, to.compatibility.auditExportFormatVersion],
      ];
      for (const [label, a, b] of deltas) {
        if (a !== b) warnings.push(`${label} changes ${a} → ${b}; migration may be required.`);
      }
    }

    const migrationRequired = warnings.some((w) => w.includes("migration may be required")) || breaking.length > 0;

    // Rollback is supported when going back within the same major version and
    // the target is not end-of-life.
    const targetWindow = this.supportWindow(toVersion);
    const rollbackSupported =
      direction === "downgrade" &&
      !!fv &&
      !!tv &&
      fv.major === tv.major &&
      targetWindow?.state !== "end_of_life";

    if (direction === "downgrade" && !rollbackSupported) {
      warnings.push("Rollback target is outside the supported rollback range.");
    }

    return {
      ok: breaking.length === 0,
      fromVersion,
      toVersion,
      direction,
      breaking,
      warnings,
      rollbackSupported: direction === "downgrade" ? rollbackSupported : true,
      migrationRequired,
    };
  }

  // ── Artifact evidence ────────────────────────────────────────────────────

  recordArtifact(evidence: ReleaseArtifactEvidence): void {
    const list = this.artifacts.get(evidence.version) ?? [];
    list.push(evidence);
    this.artifacts.set(evidence.version, list);
    this.deps.audit?.("enterprise.release.artifact_recorded", {
      version: evidence.version,
      artifactName: evidence.artifactName,
      sha256: evidence.sha256,
      reproducible: evidence.reproducible,
      sbomPresent: evidence.sbomPresent,
    });
  }

  artifactsFor(version: string): readonly ReleaseArtifactEvidence[] {
    return this.artifacts.get(version) ?? [];
  }

  /** Verify a downloaded artifact against the recorded digest. */
  verifyArtifact(version: string, artifactName: string, content: string | Buffer): {
    ok: boolean;
    expected?: string;
    actual: string;
    detail: string;
  } {
    const actual = createHash("sha256").update(content).digest("hex");
    const record = this.artifactsFor(version).find((a) => a.artifactName === artifactName);
    if (!record) {
      return { ok: false, actual, detail: `No recorded artifact '${artifactName}' for version ${version}.` };
    }
    const ok = record.sha256 === actual;
    return {
      ok,
      expected: record.sha256,
      actual,
      detail: ok ? "Artifact digest matches the release record." : "Artifact digest does NOT match the release record.",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Rollback validation
// ═══════════════════════════════════════════════════════════════════════════

export interface RollbackInvariantProbe {
  /** Can the deployment still operate with no control plane after rollback? */
  readonly localOperationAvailable: boolean;
  /** Do safety-relevant policies still resolve and enforce? */
  readonly policySafetyIntact: boolean;
  /** Does the audit hash chain still verify? */
  readonly auditChainVerifies: boolean;
  /** Are existing backups still readable and verifiable? */
  readonly backupsReadable: boolean;
  /** Is incident evidence still present and hash-consistent? */
  readonly incidentEvidenceIntact: boolean;
  /** Are capability revocations still enforced? */
  readonly revocationsEnforced: boolean;
}

/**
 * Validate a proposed rollback against the Phase 12 release invariants.
 *
 * Administrative features MAY be disabled by a rollback.
 * Safety controls MAY NOT be bypassed by one.
 */
export function validateRollback(params: {
  fromVersion: string;
  toVersion: string;
  compatibility: CompatibilityCheck;
  probe: RollbackInvariantProbe;
}): RollbackValidation {
  const checks: { name: string; passed: boolean; detail: string }[] = [];
  const blockers: string[] = [];

  const add = (name: string, passed: boolean, detail: string, blocking: boolean): void => {
    checks.push({ name, passed, detail });
    if (!passed && blocking) blockers.push(`${name}: ${detail}`);
  };

  add(
    "compatibility.rollback_supported",
    params.compatibility.rollbackSupported,
    params.compatibility.rollbackSupported
      ? "Target version is within the supported rollback range."
      : "Target version is outside the supported rollback range.",
    true,
  );

  add(
    "compatibility.no_breaking_changes",
    params.compatibility.breaking.length === 0,
    params.compatibility.breaking.length === 0
      ? "No breaking changes between versions."
      : `Breaking changes: ${params.compatibility.breaking.join("; ")}`,
    true,
  );

  add(
    "invariant.local_operation",
    params.probe.localOperationAvailable,
    params.probe.localOperationAvailable
      ? "Local operation remains available without a control plane."
      : "Rollback would leave local operation unavailable.",
    true,
  );

  add(
    "invariant.policy_safety",
    params.probe.policySafetyIntact,
    params.probe.policySafetyIntact
      ? "Safety-relevant policy still resolves and enforces after rollback."
      : "Rollback would weaken or disable policy safety enforcement.",
    true,
  );

  add(
    "invariant.audit_integrity",
    params.probe.auditChainVerifies,
    params.probe.auditChainVerifies
      ? "Audit hash chain verifies after rollback."
      : "Audit chain does not verify after rollback.",
    true,
  );

  add(
    "invariant.backups_preserved",
    params.probe.backupsReadable,
    params.probe.backupsReadable ? "Existing backups remain readable." : "Rollback would orphan existing backups.",
    true,
  );

  add(
    "invariant.incident_evidence",
    params.probe.incidentEvidenceIntact,
    params.probe.incidentEvidenceIntact
      ? "Incident evidence remains present and hash-consistent."
      : "Rollback would lose or alter incident evidence.",
    true,
  );

  add(
    "invariant.capability_revocation",
    params.probe.revocationsEnforced,
    params.probe.revocationsEnforced
      ? "Capability revocations remain enforced after rollback."
      : "Rollback would stop enforcing capability revocations.",
    true,
  );

  return {
    ok: blockers.length === 0,
    fromVersion: params.fromVersion,
    toVersion: params.toVersion,
    checks,
    preservesLocalOperation: params.probe.localOperationAvailable,
    preservesPolicySafety: params.probe.policySafetyIntact,
    preservesAuditIntegrity: params.probe.auditChainVerifies,
    preservesBackups: params.probe.backupsReadable,
    preservesIncidentEvidence: params.probe.incidentEvidenceIntact,
    preservesCapabilityRevocation: params.probe.revocationsEnforced,
    blockers,
  };
}
