/**
 * XR 6.1 — Phase 12 Tests: Release channels, support windows, compatibility, rollback.
 */
import { describe, expect, test } from "bun:test";
import {
  ReleaseRegistry,
  validateRollback,
  currentCompatibility,
  CHANNEL_SUPPORT_DAYS,
  RELEASE_CHANNELS,
  isReleaseChannel,
  type RollbackInvariantProbe,
} from "../../src/enterprise/index.ts";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const COMPAT_60 = currentCompatibility({
  pluginApiVersion: "3",
  capsuleSchemaVersion: "xr-6.0.0/capsule-v1",
  minUpgradeFrom: "5.0.0",
});

const COMPAT_61 = currentCompatibility({
  pluginApiVersion: "3",
  capsuleSchemaVersion: "xr-6.0.0/capsule-v1",
  minUpgradeFrom: "6.0.0",
});

function registry(now = NOW): ReleaseRegistry {
  return new ReleaseRegistry({ now: () => now });
}

const GOOD_PROBE: RollbackInvariantProbe = {
  localOperationAvailable: true,
  policySafetyIntact: true,
  auditChainVerifies: true,
  backupsReadable: true,
  incidentEvidenceIntact: true,
  revocationsEnforced: true,
};

describe("Release channels", () => {
  test("four channels are defined", () => {
    expect(RELEASE_CHANNELS).toEqual(["stable", "lts", "beta", "edge"]);
  });

  test("channel validation", () => {
    expect(isReleaseChannel("stable")).toBe(true);
    expect(isReleaseChannel("nightly")).toBe(false);
  });

  test("lts has the longest support window", () => {
    expect(CHANNEL_SUPPORT_DAYS.lts.active).toBeGreaterThan(CHANNEL_SUPPORT_DAYS.stable.active);
    expect(CHANNEL_SUPPORT_DAYS.stable.active).toBeGreaterThan(CHANNEL_SUPPORT_DAYS.beta.active);
  });

  test("registering derives the support window", () => {
    const r = registry();
    const rec = r.register({ version: "6.1.0", channel: "stable", releasedAt: NOW, compatibility: COMPAT_61 });
    expect(rec.supportedUntil).toBe(NOW + 180 * DAY);
    expect(rec.securityUntil).toBe(NOW + 365 * DAY);
    expect(rec.supportState).toBe("supported");
  });

  test("prerelease channels are marked prerelease", () => {
    const r = registry();
    expect(r.register({ version: "6.2.0-beta.1", channel: "beta", releasedAt: NOW, compatibility: COMPAT_61 }).supportState).toBe("prerelease");
  });
});

describe("Support windows", () => {
  test("a fresh release is fully supported", () => {
    const r = registry();
    r.register({ version: "6.1.0", channel: "stable", releasedAt: NOW, compatibility: COMPAT_61 });
    const w = r.supportWindow("6.1.0")!;
    expect(w.state).toBe("supported");
    expect(w.daysRemaining).toBe(180);
  });

  test("an older release moves to security-only", () => {
    const r = registry();
    r.register({ version: "6.1.0", channel: "stable", releasedAt: NOW - 200 * DAY, compatibility: COMPAT_61 });
    const w = r.supportWindow("6.1.0")!;
    expect(w.state).toBe("security_only");
    expect(w.message).toContain("Plan an upgrade");
  });

  test("a very old release is end of life", () => {
    const r = registry();
    r.register({ version: "5.0.0", channel: "stable", releasedAt: NOW - 500 * DAY, compatibility: COMPAT_60 });
    const w = r.supportWindow("5.0.0")!;
    expect(w.state).toBe("end_of_life");
    expect(w.daysRemaining).toBe(0);
  });

  test("an unknown version has no window", () => {
    expect(registry().supportWindow("9.9.9")).toBeUndefined();
  });

  test("prerelease channels report prerelease regardless of age", () => {
    const r = registry();
    r.register({ version: "6.2.0-beta.1", channel: "beta", releasedAt: NOW - 500 * DAY, compatibility: COMPAT_61 });
    expect(r.supportWindow("6.2.0-beta.1")!.state).toBe("prerelease");
  });
});

describe("Compatibility checks", () => {
  test("a normal minor upgrade is compatible", () => {
    const r = registry();
    r.register({ version: "6.0.0", channel: "stable", releasedAt: NOW - 100 * DAY, compatibility: COMPAT_60 });
    r.register({ version: "6.1.0", channel: "stable", releasedAt: NOW, compatibility: COMPAT_61 });

    const c = r.checkCompatibility("6.0.0", "6.1.0");
    expect(c.ok).toBe(true);
    expect(c.direction).toBe("upgrade");
    expect(c.breaking.length).toBe(0);
  });

  test("a major version change is breaking", () => {
    const r = registry();
    r.register({ version: "5.9.0", channel: "stable", releasedAt: NOW - 300 * DAY, compatibility: COMPAT_60 });
    r.register({ version: "6.1.0", channel: "stable", releasedAt: NOW, compatibility: COMPAT_61 });

    const c = r.checkCompatibility("5.9.0", "6.1.0");
    expect(c.ok).toBe(false);
    expect(c.breaking.some((b) => b.includes("Major version change"))).toBe(true);
  });

  test("an upgrade below the minimum floor is blocked", () => {
    const r = registry();
    r.register({ version: "6.0.0", channel: "stable", releasedAt: NOW - 100 * DAY, compatibility: COMPAT_60 });
    r.register({
      version: "6.5.0",
      channel: "stable",
      releasedAt: NOW,
      compatibility: currentCompatibility({
        pluginApiVersion: "3",
        capsuleSchemaVersion: "xr-6.0.0/capsule-v1",
        minUpgradeFrom: "6.2.0",
      }),
    });
    const c = r.checkCompatibility("6.0.0", "6.5.0");
    expect(c.ok).toBe(false);
    expect(c.breaking.some((b) => b.includes("requires at least 6.2.0"))).toBe(true);
  });

  test("schema deltas produce migration warnings", () => {
    const r = registry();
    r.register({ version: "6.0.0", channel: "stable", releasedAt: NOW - 100 * DAY, compatibility: COMPAT_60 });
    r.register({
      version: "6.1.0",
      channel: "stable",
      releasedAt: NOW,
      compatibility: { ...COMPAT_61, capsuleSchemaVersion: "xr-6.1.0/capsule-v2" },
    });
    const c = r.checkCompatibility("6.0.0", "6.1.0");
    expect(c.migrationRequired).toBe(true);
    expect(c.warnings.some((w) => w.includes("capsule schema"))).toBe(true);
  });

  test("an unregistered target fails the check", () => {
    const r = registry();
    r.register({ version: "6.0.0", channel: "stable", releasedAt: NOW, compatibility: COMPAT_60 });
    const c = r.checkCompatibility("6.0.0", "7.0.0");
    expect(c.ok).toBe(false);
    expect(c.breaking[0]).toContain("not registered");
  });

  test("a same-major downgrade supports rollback", () => {
    const r = registry();
    r.register({ version: "6.0.0", channel: "stable", releasedAt: NOW - 30 * DAY, compatibility: COMPAT_60 });
    r.register({ version: "6.1.0", channel: "stable", releasedAt: NOW, compatibility: COMPAT_61 });
    const c = r.checkCompatibility("6.1.0", "6.0.0");
    expect(c.direction).toBe("downgrade");
    expect(c.rollbackSupported).toBe(true);
  });

  test("rollback to an end-of-life version is not supported", () => {
    const r = registry();
    r.register({ version: "5.0.0", channel: "stable", releasedAt: NOW - 500 * DAY, compatibility: COMPAT_60 });
    r.register({ version: "5.9.0", channel: "stable", releasedAt: NOW, compatibility: COMPAT_60 });
    const c = r.checkCompatibility("5.9.0", "5.0.0");
    expect(c.rollbackSupported).toBe(false);
  });
});

describe("Rollback validation", () => {
  function compat(rollbackSupported: boolean, breaking: string[] = []) {
    return {
      ok: breaking.length === 0,
      fromVersion: "6.1.0",
      toVersion: "6.0.0",
      direction: "downgrade" as const,
      breaking,
      warnings: [],
      rollbackSupported,
      migrationRequired: false,
    };
  }

  test("a clean rollback passes every invariant", () => {
    const v = validateRollback({
      fromVersion: "6.1.0",
      toVersion: "6.0.0",
      compatibility: compat(true),
      probe: GOOD_PROBE,
    });
    expect(v.ok).toBe(true);
    expect(v.blockers.length).toBe(0);
    expect(v.checks.every((c) => c.passed)).toBe(true);
  });

  test("ROLLBACK IS BLOCKED IF LOCAL OPERATION WOULD BE LOST", () => {
    const v = validateRollback({
      fromVersion: "6.1.0",
      toVersion: "6.0.0",
      compatibility: compat(true),
      probe: { ...GOOD_PROBE, localOperationAvailable: false },
    });
    expect(v.ok).toBe(false);
    expect(v.preservesLocalOperation).toBe(false);
    expect(v.blockers.some((b) => b.includes("local_operation"))).toBe(true);
  });

  test("ROLLBACK IS BLOCKED IF POLICY SAFETY WOULD BE WEAKENED", () => {
    const v = validateRollback({
      fromVersion: "6.1.0",
      toVersion: "6.0.0",
      compatibility: compat(true),
      probe: { ...GOOD_PROBE, policySafetyIntact: false },
    });
    expect(v.ok).toBe(false);
    expect(v.preservesPolicySafety).toBe(false);
  });

  test("ROLLBACK IS BLOCKED IF AUDIT INTEGRITY WOULD BREAK", () => {
    const v = validateRollback({
      fromVersion: "6.1.0",
      toVersion: "6.0.0",
      compatibility: compat(true),
      probe: { ...GOOD_PROBE, auditChainVerifies: false },
    });
    expect(v.ok).toBe(false);
    expect(v.preservesAuditIntegrity).toBe(false);
  });

  test("ROLLBACK IS BLOCKED IF BACKUPS WOULD BE ORPHANED", () => {
    const v = validateRollback({
      fromVersion: "6.1.0",
      toVersion: "6.0.0",
      compatibility: compat(true),
      probe: { ...GOOD_PROBE, backupsReadable: false },
    });
    expect(v.ok).toBe(false);
    expect(v.preservesBackups).toBe(false);
  });

  test("ROLLBACK IS BLOCKED IF INCIDENT EVIDENCE WOULD BE LOST", () => {
    const v = validateRollback({
      fromVersion: "6.1.0",
      toVersion: "6.0.0",
      compatibility: compat(true),
      probe: { ...GOOD_PROBE, incidentEvidenceIntact: false },
    });
    expect(v.ok).toBe(false);
    expect(v.preservesIncidentEvidence).toBe(false);
  });

  test("ROLLBACK IS BLOCKED IF CAPABILITY REVOCATION WOULD STOP", () => {
    const v = validateRollback({
      fromVersion: "6.1.0",
      toVersion: "6.0.0",
      compatibility: compat(true),
      probe: { ...GOOD_PROBE, revocationsEnforced: false },
    });
    expect(v.ok).toBe(false);
    expect(v.preservesCapabilityRevocation).toBe(false);
  });

  test("an unsupported rollback range is blocked", () => {
    const v = validateRollback({
      fromVersion: "6.1.0",
      toVersion: "5.0.0",
      compatibility: compat(false),
      probe: GOOD_PROBE,
    });
    expect(v.ok).toBe(false);
  });

  test("breaking changes block rollback", () => {
    const v = validateRollback({
      fromVersion: "6.1.0",
      toVersion: "5.0.0",
      compatibility: compat(true, ["Major version change 6 → 5."]),
      probe: GOOD_PROBE,
    });
    expect(v.ok).toBe(false);
  });

  test("all eight checks are reported", () => {
    const v = validateRollback({
      fromVersion: "6.1.0",
      toVersion: "6.0.0",
      compatibility: compat(true),
      probe: GOOD_PROBE,
    });
    expect(v.checks.length).toBe(8);
  });
});

describe("Release artifact integrity", () => {
  test("a matching artifact verifies", () => {
    const r = registry();
    const content = "binary-content-here";
    const sha256 = require("node:crypto").createHash("sha256").update(content).digest("hex");
    r.recordArtifact({
      version: "6.1.0",
      artifactName: "xr-6.1.0.tgz",
      sha256,
      sizeBytes: content.length,
      builtAt: NOW,
      reproducible: true,
      sbomPresent: true,
      sbomRef: "sbom/xr-6.1.0.spdx.json",
      dependencyCount: 4,
    });
    const v = r.verifyArtifact("6.1.0", "xr-6.1.0.tgz", content);
    expect(v.ok).toBe(true);
  });

  test("a tampered artifact fails verification", () => {
    const r = registry();
    const sha256 = require("node:crypto").createHash("sha256").update("original").digest("hex");
    r.recordArtifact({
      version: "6.1.0",
      artifactName: "xr.tgz",
      sha256,
      sizeBytes: 8,
      builtAt: NOW,
      reproducible: true,
      sbomPresent: true,
    });
    const v = r.verifyArtifact("6.1.0", "xr.tgz", "tampered");
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("does NOT match");
  });

  test("an unknown artifact fails cleanly", () => {
    const r = registry();
    expect(r.verifyArtifact("6.1.0", "missing.tgz", "x").ok).toBe(false);
  });

  test("artifacts are listed per version", () => {
    const r = registry();
    r.recordArtifact({ version: "6.1.0", artifactName: "a", sha256: "x", sizeBytes: 1, builtAt: NOW, reproducible: true, sbomPresent: true });
    r.recordArtifact({ version: "6.1.0", artifactName: "b", sha256: "y", sizeBytes: 1, builtAt: NOW, reproducible: true, sbomPresent: true });
    expect(r.artifactsFor("6.1.0").length).toBe(2);
    expect(r.artifactsFor("6.0.0").length).toBe(0);
  });
});

describe("Compatibility declaration", () => {
  test("carries all schema versions", () => {
    const c = currentCompatibility({ pluginApiVersion: "3", capsuleSchemaVersion: "cap-v1" });
    expect(c.pluginApiVersion).toBe("3");
    expect(c.policySchemaVersion).toContain("enterprise");
    expect(c.auditExportFormatVersion).toContain("audit-export");
    expect(c.minUpgradeFrom).toBe("6.0.0");
  });
});
