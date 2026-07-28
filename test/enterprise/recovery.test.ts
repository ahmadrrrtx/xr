/**
 * XR 6.1 — Phase 12 Tests: Backup verification and disaster recovery.
 */
import { describe, expect, test } from "bun:test";
import {
  RecoveryOperations,
  CONSISTENCY_GROUPS,
  isProfileRestoreCompatible,
  scanObjectForCredentials,
  digestBackupContent,
} from "../../src/enterprise/index.ts";
import type { BackupManifest } from "../../src/deployment/backup/service.ts";

const NOW = 1_800_000_000_000;
const MINUTE = 60 * 1000;

function manifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    backupId: "bk_1",
    createdAt: NOW - 60 * MINUTE,
    profile: "personal_local",
    version: "6.1.0",
    components: [
      { kind: "execution_records", recordCount: 100, sizeBytes: 1024, earliestRecord: NOW - 1000, latestRecord: NOW },
      { kind: "checkpoints", recordCount: 20, sizeBytes: 512, earliestRecord: NOW - 1000, latestRecord: NOW },
      { kind: "audit_records", recordCount: 500, sizeBytes: 4096, earliestRecord: NOW - 1000, latestRecord: NOW },
    ],
    totalSizeBytes: 5632,
    integrityHash: "a".repeat(64),
    encrypted: true,
    metadata: {},
    ...overrides,
  };
}

function ops(overrides: Partial<ConstructorParameters<typeof RecoveryOperations>[0]> = {}): RecoveryOperations {
  return new RecoveryOperations({
    now: () => NOW,
    currentVersion: "6.1.0",
    currentProfile: "personal_local",
    getManifest: () => manifest(),
    recomputeIntegrityHash: () => "a".repeat(64),
    applyComponent: (_b, _c) => ({ ok: true, records: 10 }),
    ...overrides,
  });
}

describe("Backup verification", () => {
  test("a matching digest verifies", () => {
    const v = ops().verify("bk_1");
    expect(v.status).toBe("verified");
    expect(v.manifestHashMatches).toBe(true);
    expect(v.componentsOk).toBe(3);
    expect(v.errors.length).toBe(0);
  });

  test("a mismatched digest reports corrupt", () => {
    const v = ops({ recomputeIntegrityHash: () => "b".repeat(64) }).verify("bk_1");
    expect(v.status).toBe("corrupt");
    expect(v.manifestHashMatches).toBe(false);
    expect(v.errors[0]).toContain("Integrity hash mismatch");
  });

  test("unreadable content reports unverified, not verified", () => {
    const v = ops({ recomputeIntegrityHash: () => undefined }).verify("bk_1");
    expect(v.status).not.toBe("verified");
    expect(v.errors.some((e) => e.includes("could not be read"))).toBe(true);
  });

  test("a missing backup reports corrupt", () => {
    const v = ops({ getManifest: () => undefined }).verify("missing");
    expect(v.status).toBe("corrupt");
  });

  test("inconsistent component metadata is detected", () => {
    const bad = manifest({
      components: [
        { kind: "execution_records", recordCount: 10, sizeBytes: 100, earliestRecord: NOW, latestRecord: NOW - 5000 },
      ],
    });
    const v = ops({ getManifest: () => bad }).verify("bk_1");
    expect(v.componentsOk).toBe(0);
    expect(v.status).toBe("incomplete");
  });

  test("credential material in a backup fails verification", () => {
    const v = ops({ scanForCredentials: () => ["config.apiKey", "worker.token"] }).verify("bk_1");
    expect(v.credentialSafetyChecked).toBe(true);
    expect(v.credentialSafetyOk).toBe(false);
    expect(v.status).not.toBe("verified");
    expect(v.errors.some((e) => e.includes("credential material"))).toBe(true);
  });

  test("a clean credential scan passes", () => {
    const v = ops({ scanForCredentials: () => [] }).verify("bk_1");
    expect(v.credentialSafetyOk).toBe(true);
    expect(v.status).toBe("verified");
  });
});

describe("Credential scanning", () => {
  test("finds raw credential values", () => {
    const found = scanObjectForCredentials({ config: { apiKey: "sk-live-12345", name: "prod" } });
    expect(found).toContain("config.apiKey");
  });

  test("allows references and digests", () => {
    expect(scanObjectForCredentials({ token: "ref:cred_abc" }).length).toBe(0);
    expect(scanObjectForCredentials({ token: "sha256:deadbeef" }).length).toBe(0);
  });

  test("walks arrays and nested objects", () => {
    const found = scanObjectForCredentials({ workers: [{ secrets: { password: "hunter2" } }] });
    expect(found.length).toBeGreaterThan(0);
  });

  test("digestBackupContent is stable", () => {
    expect(digestBackupContent("abc")).toBe(digestBackupContent("abc"));
    expect(digestBackupContent("abc")).not.toBe(digestBackupContent("abd"));
  });
});

describe("Restore preflight", () => {
  test("a verified backup passes preflight", () => {
    const o = ops();
    const plan = o.createPlan({ backupId: "bk_1", mode: "full", requestedBy: "admin" });
    const pre = o.preflight(plan);
    expect(pre.ok).toBe(true);
    expect(pre.integrityVerified).toBe(true);
    expect(pre.blockers.length).toBe(0);
  });

  test("RESTORE IS REFUSED WHEN VERIFICATION FAILS (anti restore-poisoning)", () => {
    const o = ops({ recomputeIntegrityHash: () => "deadbeef".repeat(8) });
    const plan = o.createPlan({ backupId: "bk_1", mode: "full", requestedBy: "attacker" });
    const pre = o.preflight(plan);
    expect(pre.ok).toBe(false);
    expect(pre.integrityVerified).toBe(false);
    expect(pre.blockers.some((b) => b.includes("did not verify"))).toBe(true);
  });

  test("a credential-carrying backup is blocked", () => {
    const o = ops({ scanForCredentials: () => ["secrets.token"] });
    const plan = o.createPlan({ backupId: "bk_1", mode: "full", requestedBy: "admin" });
    const pre = o.preflight(plan);
    expect(pre.ok).toBe(false);
    expect(pre.blockers.some((b) => b.includes("credential-safety"))).toBe(true);
  });

  test("a major version mismatch blocks restore", () => {
    const o = ops({ getManifest: () => manifest({ version: "5.0.0" }) });
    const plan = o.createPlan({ backupId: "bk_1", mode: "full", requestedBy: "admin" });
    const pre = o.preflight(plan);
    expect(pre.versionCompatible).toBe(false);
    expect(pre.ok).toBe(false);
  });

  test("a minor version difference warns but does not block", () => {
    const o = ops({ getManifest: () => manifest({ version: "6.0.0" }) });
    const plan = o.createPlan({ backupId: "bk_1", mode: "full", requestedBy: "admin" });
    const pre = o.preflight(plan);
    expect(pre.versionCompatible).toBe(true);
    expect(pre.ok).toBe(true);
    expect(pre.warnings.some((w) => w.includes("migrations may run"))).toBe(true);
  });

  test("a missing component blocks restore", () => {
    const o = ops();
    const plan = { ...o.createPlan({ backupId: "bk_1", mode: "partial", requestedBy: "a" }), components: ["nonexistent"] };
    const pre = o.preflight(plan);
    expect(pre.schemaCompatible).toBe(false);
    expect(pre.ok).toBe(false);
  });

  test("partial restore of a consistency group warns", () => {
    const o = ops();
    const plan = { ...o.createPlan({ backupId: "bk_1", mode: "partial", requestedBy: "a" }), components: ["execution_records"] };
    const pre = o.preflight(plan);
    expect(pre.warnings.some((w) => w.includes("inconsistent"))).toBe(true);
  });

  test("a multi-user backup cannot be restored into personal_local", () => {
    const o = ops({ getManifest: () => manifest({ profile: "team_private" }) });
    const plan = o.createPlan({ backupId: "bk_1", mode: "full", requestedBy: "admin", targetProfile: "personal_local" });
    const pre = o.preflight(plan);
    expect(pre.profileCompatible).toBe(false);
    expect(pre.ok).toBe(false);
  });

  test("cross-deployment restore into a richer profile warns", () => {
    const o = ops({ currentProfile: "team_private", getManifest: () => manifest({ profile: "personal_local" }) });
    const plan = o.createPlan({ backupId: "bk_1", mode: "full", requestedBy: "admin", targetProfile: "team_private" });
    const pre = o.preflight(plan);
    expect(pre.profileCompatible).toBe(true);
    expect(pre.warnings.some((w) => w.includes("Cross-deployment"))).toBe(true);
  });
});

describe("Profile restore compatibility", () => {
  test("same profile is always compatible", () => {
    expect(isProfileRestoreCompatible("personal_local", "personal_local")).toBe(true);
    expect(isProfileRestoreCompatible("managed_cloud", "managed_cloud")).toBe(true);
  });

  test("multi-user into single-user is refused", () => {
    expect(isProfileRestoreCompatible("team_private", "personal_local")).toBe(false);
    expect(isProfileRestoreCompatible("managed_cloud", "private_local_server")).toBe(false);
    expect(isProfileRestoreCompatible("hybrid", "personal_local")).toBe(false);
  });

  test("single-user into multi-user is allowed", () => {
    expect(isProfileRestoreCompatible("personal_local", "team_private")).toBe(true);
    expect(isProfileRestoreCompatible("private_local_server", "managed_cloud")).toBe(true);
  });
});

describe("Restore execution", () => {
  test("a full restore applies every component", () => {
    const o = ops();
    const plan = o.createPlan({ backupId: "bk_1", mode: "full", requestedBy: "admin" });
    const { outcome } = o.restore(plan);
    expect(outcome.ok).toBe(true);
    expect(outcome.componentsRestored.length).toBe(3);
    expect(outcome.recordsRestored).toBe(30);
    expect(outcome.partial).toBe(false);
  });

  test("a refused restore applies nothing", () => {
    let applied = 0;
    const o = ops({
      recomputeIntegrityHash: () => "bad".repeat(20),
      applyComponent: () => {
        applied++;
        return { ok: true, records: 1 };
      },
    });
    const plan = o.createPlan({ backupId: "bk_1", mode: "full", requestedBy: "attacker" });
    const { outcome } = o.restore(plan);
    expect(outcome.ok).toBe(false);
    expect(applied).toBe(0);
    expect(outcome.error).toContain("refused by preflight");
  });

  test("a dry run applies nothing but validates", () => {
    let applied = 0;
    const o = ops({
      applyComponent: () => {
        applied++;
        return { ok: true, records: 1 };
      },
    });
    const plan = o.createPlan({ backupId: "bk_1", mode: "dry_run", requestedBy: "admin" });
    const { outcome, preflight } = o.restore(plan);
    expect(preflight.ok).toBe(true);
    expect(applied).toBe(0);
    expect(outcome.componentsSkipped.length).toBe(3);
  });

  test("a partial failure is reported with consistency warnings", () => {
    const o = ops({
      applyComponent: (_b, c) => (c === "checkpoints" ? { ok: false, records: 0 } : { ok: true, records: 5 }),
    });
    const plan = o.createPlan({ backupId: "bk_1", mode: "full", requestedBy: "admin" });
    const { outcome } = o.restore(plan);

    expect(outcome.ok).toBe(false);
    expect(outcome.partial).toBe(true);
    expect(outcome.componentsFailed).toContain("checkpoints");
    expect(outcome.componentsRestored).toContain("execution_records");
    expect(outcome.consistencyWarnings.some((w) => w.includes("Consistency risk"))).toBe(true);
  });

  test("a throwing component handler is caught and recorded as failed", () => {
    const o = ops({
      applyComponent: (_b, c) => {
        if (c === "audit_records") throw new Error("disk error");
        return { ok: true, records: 1 };
      },
    });
    const plan = o.createPlan({ backupId: "bk_1", mode: "full", requestedBy: "admin" });
    const { outcome } = o.restore(plan);
    expect(outcome.componentsFailed).toContain("audit_records");
    expect(outcome.ok).toBe(false);
  });

  test("rtoMs is recorded", () => {
    const o = ops();
    const plan = o.createPlan({ backupId: "bk_1", mode: "full", requestedBy: "admin" });
    const { outcome } = o.restore(plan);
    expect(typeof outcome.rtoMs).toBe("number");
    expect(outcome.rtoMs).toBeGreaterThanOrEqual(0);
  });

  test("consistency groups pair related components", () => {
    expect(CONSISTENCY_GROUPS.some((g) => g.includes("execution_records") && g.includes("checkpoints"))).toBe(true);
  });
});

describe("RPO/RTO assessment", () => {
  test("unmeasured values are reported as unknown, not assumed", () => {
    const a = ops().assessTargets({});
    expect(a.measuredRpoMinutes).toBeUndefined();
    expect(a.measuredRtoMinutes).toBeUndefined();
    expect(a.rpoMet).toBeUndefined();
    expect(a.basis).toContain("not measured");
  });

  test("RPO is measured from the last backup", () => {
    const a = ops().assessTargets({
      lastBackupAt: NOW - 30 * MINUTE,
      targets: { rpoMinutes: 60, rtoMinutes: 120, profile: "personal_local" },
    });
    expect(a.measuredRpoMinutes).toBe(30);
    expect(a.rpoMet).toBe(true);
  });

  test("a stale backup misses the RPO target", () => {
    const a = ops().assessTargets({
      lastBackupAt: NOW - 300 * MINUTE,
      targets: { rpoMinutes: 60, rtoMinutes: 120, profile: "personal_local" },
    });
    expect(a.rpoMet).toBe(false);
  });

  test("RTO is measured from the last restore", () => {
    const a = ops().assessTargets({
      lastRestoreRtoMs: 45 * MINUTE,
      targets: { rpoMinutes: 60, rtoMinutes: 120, profile: "personal_local" },
    });
    expect(a.measuredRtoMinutes).toBe(45);
    expect(a.rtoMet).toBe(true);
  });
});

describe("Recovery drills", () => {
  test("a dry-run drill records evidence without applying", () => {
    let applied = 0;
    const o = ops({
      applyComponent: () => {
        applied++;
        return { ok: true, records: 1 };
      },
    });
    const d = o.drill({ backupId: "bk_1", executedBy: "ops", lastBackupAt: NOW - 10 * MINUTE });
    expect(d.ok).toBe(true);
    expect(applied).toBe(0);
    expect(d.preflight.ok).toBe(true);
    expect(d.assessment!.measuredRpoMinutes).toBe(10);
    expect(o.lastDrill()!.drillId).toBe(d.drillId);
  });

  test("an applied drill really restores", () => {
    let applied = 0;
    const o = ops({
      applyComponent: () => {
        applied++;
        return { ok: true, records: 1 };
      },
    });
    const d = o.drill({ backupId: "bk_1", executedBy: "ops", apply: true });
    expect(applied).toBe(3);
    expect(d.outcome!.componentsRestored.length).toBe(3);
  });

  test("a drill on a corrupt backup fails and records why", () => {
    const o = ops({ recomputeIntegrityHash: () => "z".repeat(64) });
    const d = o.drill({ backupId: "bk_1", executedBy: "ops" });
    expect(d.ok).toBe(false);
    expect(d.preflight.blockers.length).toBeGreaterThan(0);
  });

  test("backupSuccessRate reflects verification history", () => {
    const o = ops();
    o.verify("bk_1");
    o.verify("bk_1");
    const rate = o.backupSuccessRate();
    expect(rate.total).toBe(2);
    expect(rate.good).toBe(2);
  });

  test("failed verifications lower the success rate", () => {
    let good = true;
    const o = ops({ recomputeIntegrityHash: () => (good ? "a".repeat(64) : "b".repeat(64)) });
    o.verify("bk_1");
    good = false;
    o.verify("bk_1");
    const rate = o.backupSuccessRate();
    expect(rate.total).toBe(2);
    expect(rate.good).toBe(1);
  });
});
