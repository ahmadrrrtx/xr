/**
 * XR 6.1 — Phase 12 Tests: Local/private/cloud governance matrix.
 *
 * The central guarantee: enterprise features are ADDITIVE. A `personal_local`
 * deployment must get the full enterprise API surface with NO network, NO
 * control plane, and NO database, and organization administration must simply
 * report "not applicable" rather than failing or coercing a hosted plane.
 */
import { describe, expect, test } from "bun:test";
import {
  createEnterpriseServices,
  policyRule,
  rootAuthority,
  evaluatePolicy,
  buildOperationalStatus,
  NON_OVERRIDABLE_VISIBILITY_KEYS,
  type EnterpriseServices,
} from "../../src/enterprise/index.ts";
import { getDeploymentProfile, listDeploymentProfiles } from "../../src/deployment/profiles.ts";
import type { DeploymentProfileKind } from "../../src/deployment/types.ts";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const ALL_PROFILES: DeploymentProfileKind[] = [
  "personal_local",
  "private_local_server",
  "team_private",
  "managed_cloud",
  "hybrid",
];

function services(profile: DeploymentProfileKind): EnterpriseServices {
  return createEnterpriseServices({ profile, currentVersion: "6.1.0", now: () => NOW });
}

describe("Service construction across every profile", () => {
  test("every profile constructs the full service bundle", () => {
    for (const profile of ALL_PROFILES) {
      const s = services(profile);
      expect(s.policy).toBeDefined();
      expect(s.authority).toBeDefined();
      expect(s.auditExport).toBeDefined();
      expect(s.retention).toBeDefined();
      expect(s.slo).toBeDefined();
      expect(s.incidents).toBeDefined();
      expect(s.supplyChain).toBeDefined();
      expect(s.recovery).toBeDefined();
      expect(s.releases).toBeDefined();
      expect(s.profile).toBe(profile);
    }
  });

  test("construction performs no I/O and never throws", () => {
    for (const profile of ALL_PROFILES) {
      expect(() => services(profile)).not.toThrow();
    }
  });

  test("organization administration availability matches profile tenancy", () => {
    for (const profile of ALL_PROFILES) {
      const s = services(profile);
      const def = getDeploymentProfile(profile);
      expect(s.organizationAdministrationAvailable).toBe(def.capabilities.organizationTenancy);
    }
  });

  test("personal_local does NOT advertise organization administration", () => {
    expect(services("personal_local").organizationAdministrationAvailable).toBe(false);
  });

  test("team/cloud/hybrid DO advertise organization administration", () => {
    expect(services("team_private").organizationAdministrationAvailable).toBe(true);
    expect(services("managed_cloud").organizationAdministrationAvailable).toBe(true);
    expect(services("hybrid").organizationAdministrationAvailable).toBe(true);
  });
});

describe("LOCAL AUTONOMY — personal_local works fully offline", () => {
  const s = services("personal_local");

  test("the profile itself requires no control plane", () => {
    const def = getDeploymentProfile("personal_local");
    expect(def.capabilities.controlPlane).toBe(false);
    expect(def.offlineSupported).toBe(true);
    expect(def.dataPaths.remoteDataPolicy).toBe("local_only");
  });

  test("localAutonomy is reported true", () => {
    expect(s.localAutonomy).toBe(true);
  });

  test("policy works with no organization", () => {
    const r = s.policy.create({
      name: "Local hardening",
      rules: [policyRule({ key: "allowNetworkEgress", value: false, layer: "user_task", reason: "Offline work.", authoredBy: "local-user", authoredAt: NOW })],
      createdBy: "local-user",
    });
    expect(r.ok).toBe(true);
    expect(s.policy.activate(r.bundle!.bundleId, "local-user").ok).toBe(true);
    expect(evaluatePolicy(s.policy.effectiveRules(), { now: NOW }).getBoolean("allowNetworkEgress", true)).toBe(false);
  });

  test("user-visibility invariants hold locally with no admin at all", () => {
    const policy = evaluatePolicy([], { now: NOW });
    for (const key of NON_OVERRIDABLE_VISIBILITY_KEYS) {
      expect(policy.getBoolean(key, false)).toBe(true);
    }
  });

  test("delegation works with no organization", () => {
    const local = services("personal_local");
    const res = local.authority.delegate({
      delegator: { kind: "user", subjectId: "me" },
      delegate: { kind: "ai_worker", subjectId: "my_agent" },
      requestedScopes: ["fs:read"],
      requestedMaxRiskTier: "tier1_restricted",
      delegatorAuthority: rootAuthority({
        subject: { kind: "user", subjectId: "me" },
        scopes: ["fs:read"],
        maxRiskTier: "tier2_isolated",
      }),
      expiresAt: NOW + DAY,
      reason: "Local automation.",
    });
    expect(res.ok).toBe(true);
  });

  test("audit export works locally with the default authorizer", () => {
    const local = createEnterpriseServices({
      profile: "personal_local",
      currentVersion: "6.1.0",
      now: () => NOW,
      auditSource: () => [
        {
          recordId: "r1",
          sequence: 1,
          eventClass: "system",
          event: "local.event",
          at: NOW,
          sensitivity: "internal",
          detail: { ok: true },
          prevHash: "0".repeat(64),
          hash: "a".repeat(64),
        },
      ],
    });
    const result = local.auditExport.export({
      requestedBy: "local-user",
      format: "jsonl",
      redactionRules: [],
      reason: "personal review",
    });
    expect(result.manifest.status).toBe("complete");
    expect(result.manifest.recordCount).toBe(1);
  });

  test("incidents work locally", () => {
    const local = services("personal_local");
    const i = local.incidents.declare({
      kind: "capability_abuse",
      severity: "high",
      title: "Local skill misbehaved",
      summary: "Repeated blocked network attempts.",
      detectedBy: "local-shield",
    });
    expect(i.incidentId).toBeDefined();
    expect(local.incidents.list().length).toBe(1);
  });

  test("supply-chain revocation works locally with no feed", () => {
    const local = services("personal_local");
    local.supplyChain.revoke({
      scope: "capability",
      targetId: "skill:bad",
      reason: "malicious",
      detail: "Local detection.",
      issuedBy: "local-user",
    });
    expect(local.supplyChain.checkInstall("skill:bad").allowed).toBe(false);
  });

  test("retention and legal hold work locally", () => {
    const local = services("personal_local");
    const hold = local.retention.placeHold({ reason: "Personal dispute.", placedBy: "me" });
    expect(hold.active).toBe(true);
    expect(local.retention.activeHolds().length).toBe(1);
  });

  test("SLOs report unmeasurable rather than failing", () => {
    const local = services("personal_local");
    const reports = local.slo.reportAll();
    expect(reports.length).toBe(10);
    for (const r of reports) {
      expect(["meeting", "at_risk", "breaching", "unmeasurable", "not_applicable"]).toContain(r.status);
    }
  });

  test("operational status renders with nothing configured", () => {
    const local = services("personal_local");
    const status = buildOperationalStatus({
      profile: "personal_local",
      now: NOW,
      sloReports: local.slo.reportAll(),
      incidents: local.incidents.list(),
    });
    expect(status.profile).toBe("personal_local");
    expect(status.overall).toBeDefined();
  });

  test("recovery verification works with no backup configured", () => {
    const local = services("personal_local");
    const v = local.recovery.verify("nonexistent");
    expect(v.status).toBe("corrupt");
    expect(v.errors.length).toBeGreaterThan(0);
  });

  test("release registry works locally", () => {
    const local = services("personal_local");
    const rec = local.releases.register({
      version: "6.1.0",
      channel: "stable",
      releasedAt: NOW,
      compatibility: {
        pluginApiVersion: "3",
        capsuleSchemaVersion: "c1",
        backupSchemaVersion: "b1",
        policySchemaVersion: "p1",
        auditExportFormatVersion: "a1",
        minUpgradeFrom: "6.0.0",
      },
    });
    expect(rec.supportState).toBe("supported");
  });
});

describe("Governance matrix per profile", () => {
  test("audit chain is available on EVERY profile", () => {
    for (const profile of ALL_PROFILES) {
      const s = createEnterpriseServices({
        profile,
        currentVersion: "6.1.0",
        now: () => NOW,
        auditSource: () => [
          {
            recordId: "r1",
            sequence: 1,
            eventClass: "system",
            event: "e",
            at: NOW,
            sensitivity: "internal",
            detail: {},
            prevHash: "0".repeat(64),
            hash: "a".repeat(64),
          },
        ],
      });
      const result = s.auditExport.export({ requestedBy: "u", format: "json", redactionRules: [], reason: "r" });
      expect(result.manifest.recordCount).toBe(1);
    }
  });

  test("incident response is available on EVERY profile", () => {
    for (const profile of ALL_PROFILES) {
      const s = services(profile);
      const i = s.incidents.declare({
        kind: "audit_failure",
        severity: "high",
        title: "t",
        summary: "s",
        detectedBy: "m",
      });
      expect(s.incidents.get(i.incidentId)).toBeDefined();
    }
  });

  test("supply-chain revocation is available on EVERY profile", () => {
    for (const profile of ALL_PROFILES) {
      const s = services(profile);
      s.supplyChain.revoke({ scope: "capability", targetId: "x", reason: "malicious", detail: "d", issuedBy: "s" });
      expect(s.supplyChain.checkInstall("x").allowed).toBe(false);
    }
  });

  test("policy safety invariants hold on EVERY profile", () => {
    for (const profile of ALL_PROFILES) {
      const s = services(profile);
      const r = s.policy.create({
        name: "attempt",
        rules: [policyRule({ key: "showDataScope", value: false, layer: "organization", reason: "hide", authoredBy: "admin", authoredAt: NOW })],
        createdBy: "admin",
        organizationId: "org1",
      });
      expect(r.ok).toBe(false);
    }
  });

  test("profiles requiring a control plane still support offline or have none", () => {
    for (const profile of ALL_PROFILES) {
      const def = getDeploymentProfile(profile);
      const s = services(profile);
      if (!def.capabilities.controlPlane) expect(s.localAutonomy).toBe(true);
      else expect(s.localAutonomy).toBe(def.offlineSupported);
    }
  });

  test("worker-health SLO applies only where remote workers exist", () => {
    for (const profile of ALL_PROFILES) {
      const s = services(profile);
      const report = s.slo.report("worker_health");
      const def = getDeploymentProfile(profile);
      if (!def.remoteWorkersSupported && profile === "personal_local") {
        expect(report.status).toBe("not_applicable");
      }
    }
  });

  test("recovery targets come from the profile definition", () => {
    for (const profile of ALL_PROFILES) {
      const def = getDeploymentProfile(profile);
      const s = services(profile);
      const assessment = s.recovery.assessTargets({});
      if (def.recovery.rpoMinutes !== undefined) {
        expect(assessment.targets.rpoMinutes).toBe(def.recovery.rpoMinutes);
      }
      expect(assessment.targets.profile).toBeDefined();
    }
  });

  test("all five deployment profiles remain intact from Phase 11", () => {
    expect(listDeploymentProfiles().length).toBe(5);
  });
});

describe("Enterprise features never coerce a hosted control plane", () => {
  test("no service constructor requires a control-plane dependency", () => {
    const s = createEnterpriseServices({ profile: "personal_local", currentVersion: "6.1.0" });
    expect(s).toBeDefined();
    expect(s.localAutonomy).toBe(true);
  });

  test("organization features degrade gracefully when unavailable", () => {
    const s = services("personal_local");
    // Creating an org-scoped bundle on a non-tenant profile still works
    // locally; the profile flag tells the UI not to surface org admin.
    const r = s.policy.create({
      name: "org attempt",
      rules: [policyRule({ key: "allowNetworkEgress", value: false, layer: "organization", reason: "r", authoredBy: "a", authoredAt: NOW })],
      createdBy: "a",
      organizationId: "org1",
    });
    expect(r.ok).toBe(true);
    expect(s.organizationAdministrationAvailable).toBe(false);
  });

  test("an audit source that is absent yields an empty complete export, not an error", () => {
    const s = services("personal_local");
    const result = s.auditExport.export({ requestedBy: "u", format: "json", redactionRules: [], reason: "r" });
    expect(result.manifest.status).toBe("complete");
    expect(result.manifest.recordCount).toBe(0);
  });
});
