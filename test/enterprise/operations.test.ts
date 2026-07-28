/**
 * XR 6.1 — Phase 12 Tests: SLOs and operational status.
 */
import { describe, expect, test } from "bun:test";
import {
  SLO_IDS,
  SLO_CATALOG,
  SloRegistry,
  computeSlo,
  listSloDefinitions,
  getSloDefinition,
  buildOperationalStatus,
  alertsAtOrAbove,
  summarizeStatus,
  IncidentService,
  type SloSample,
} from "../../src/enterprise/index.ts";

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("SLO catalog", () => {
  test("all ten SLOs are defined", () => {
    expect(SLO_IDS.length).toBe(10);
    expect(listSloDefinitions().length).toBe(10);
  });

  test("every definition declares a measurable flag and a source", () => {
    for (const def of listSloDefinitions()) {
      expect(typeof def.measurable).toBe("boolean");
      expect(def.source.length).toBeGreaterThan(0);
      expect(def.appliesToProfiles.length).toBeGreaterThan(0);
      if (!def.measurable) {
        expect(def.unmeasurableReason).toBeDefined();
        expect(def.unmeasurableReason!.length).toBeGreaterThan(20);
      }
    }
  });

  test("the roadmap's required SLOs are all present", () => {
    for (const id of [
      "runtime_availability",
      "task_completion",
      "task_recovery",
      "approval_delivery",
      "worker_health",
      "provider_routing_availability",
      "backup_success",
      "audit_export",
      "security_event_response",
      "upgrade_rollback",
    ] as const) {
      expect(getSloDefinition(id)).toBeDefined();
    }
  });

  test("objectives are plausible", () => {
    for (const def of listSloDefinitions()) {
      if (def.unit === "ratio") {
        expect(def.objective).toBeGreaterThan(0);
        expect(def.objective).toBeLessThanOrEqual(1);
      } else {
        expect(def.objective).toBeGreaterThan(0);
      }
    }
  });

  test("worker_health does not apply to personal_local", () => {
    expect(SLO_CATALOG.worker_health.appliesToProfiles).not.toContain("personal_local");
  });
});

describe("SLO computation", () => {
  test("no samples reports unmeasurable, NOT meeting", () => {
    const r = computeSlo(SLO_CATALOG.task_completion, [], { now: NOW });
    expect(r.status).toBe("unmeasurable");
    expect(r.measured).toBeUndefined();
    expect(r.detail).toContain("not assumed healthy");
  });

  test("an explicitly unmeasurable SLO never reports a number", () => {
    const samples: SloSample[] = [{ sloId: "upgrade_rollback", at: NOW, good: 10, total: 10 }];
    const r = computeSlo(SLO_CATALOG.upgrade_rollback, samples, { now: NOW });
    expect(r.status).toBe("unmeasurable");
    expect(r.measured).toBeUndefined();
  });

  test("an SLO outside the active profile reports not_applicable", () => {
    const samples: SloSample[] = [{ sloId: "worker_health", at: NOW, good: 1, total: 1 }];
    const r = computeSlo(SLO_CATALOG.worker_health, samples, { now: NOW, profile: "personal_local" });
    expect(r.status).toBe("not_applicable");
  });

  test("a ratio meeting its objective reports meeting", () => {
    const samples: SloSample[] = [{ sloId: "task_completion", at: NOW - HOUR, good: 999, total: 1000 }];
    const r = computeSlo(SLO_CATALOG.task_completion, samples, { now: NOW });
    expect(r.status).toBe("meeting");
    expect(r.measured).toBeCloseTo(0.999, 5);
  });

  test("a ratio below the objective reports breaching", () => {
    const samples: SloSample[] = [{ sloId: "task_completion", at: NOW - HOUR, good: 900, total: 1000 }];
    const r = computeSlo(SLO_CATALOG.task_completion, samples, { now: NOW });
    expect(r.status).toBe("breaching");
    expect(r.errorBudgetRemaining).toBe(0);
  });

  test("error budget is computed correctly", () => {
    // Objective 0.98 → allowed failure 0.02. Actual failure 0.01 → half budget left.
    const samples: SloSample[] = [{ sloId: "task_completion", at: NOW - HOUR, good: 990, total: 1000 }];
    const r = computeSlo(SLO_CATALOG.task_completion, samples, { now: NOW });
    expect(r.errorBudgetRemaining).toBeCloseTo(0.5, 3);
  });

  test("a nearly-exhausted budget reports at_risk", () => {
    // Objective 0.98, actual 0.9805 → ~2.5% budget left.
    const samples: SloSample[] = [{ sloId: "task_completion", at: NOW - HOUR, good: 9805, total: 10000 }];
    const r = computeSlo(SLO_CATALOG.task_completion, samples, { now: NOW });
    expect(r.status).toBe("at_risk");
  });

  test("samples outside the window are excluded", () => {
    const samples: SloSample[] = [{ sloId: "task_completion", at: NOW - 60 * DAY, good: 0, total: 1000 }];
    const r = computeSlo(SLO_CATALOG.task_completion, samples, { now: NOW });
    expect(r.status).toBe("unmeasurable");
  });

  test("latency SLOs use p95", () => {
    const samples: SloSample[] = Array.from({ length: 100 }, (_, i) => ({
      sloId: "approval_delivery" as const,
      at: NOW - HOUR,
      good: 1,
      total: 1,
      valueMs: i < 95 ? 1000 : 20000,
    }));
    const r = computeSlo(SLO_CATALOG.approval_delivery, samples, { now: NOW });
    expect(r.measured).toBeGreaterThanOrEqual(1000);
    expect(r.sampleCount).toBe(100);
  });

  test("a latency SLO within budget is meeting", () => {
    const samples: SloSample[] = Array.from({ length: 20 }, () => ({
      sloId: "approval_delivery" as const,
      at: NOW - HOUR,
      good: 1,
      total: 1,
      valueMs: 1200,
    }));
    expect(computeSlo(SLO_CATALOG.approval_delivery, samples, { now: NOW }).status).toBe("meeting");
  });

  test("a zero denominator is unmeasurable, not a division error", () => {
    const samples: SloSample[] = [{ sloId: "task_completion", at: NOW, good: 0, total: 0 }];
    const r = computeSlo(SLO_CATALOG.task_completion, samples, { now: NOW });
    expect(r.status).toBe("unmeasurable");
  });
});

describe("SLO registry", () => {
  test("observe records ratio samples", () => {
    const reg = new SloRegistry({ now: () => NOW });
    reg.observe("task_completion", 99, 100);
    expect(reg.samplesFor("task_completion").length).toBe(1);
    expect(reg.report("task_completion").measured).toBeCloseTo(0.99, 5);
  });

  test("observeOutcome accumulates successes and failures", () => {
    const reg = new SloRegistry({ now: () => NOW });
    for (let i = 0; i < 98; i++) reg.observeOutcome("task_completion", true);
    reg.observeOutcome("task_completion", false);
    reg.observeOutcome("task_completion", false);
    expect(reg.report("task_completion").measured).toBeCloseTo(0.98, 5);
  });

  test("observeLatency feeds latency SLOs", () => {
    const reg = new SloRegistry({ now: () => NOW });
    reg.observeLatency("approval_delivery", 800);
    expect(reg.report("approval_delivery").measured).toBe(800);
  });

  test("reportAll covers every SLO", () => {
    const reg = new SloRegistry({ now: () => NOW });
    expect(reg.reportAll().length).toBe(10);
  });

  test("breaching returns only problem SLOs", () => {
    const reg = new SloRegistry({ now: () => NOW });
    reg.observe("task_completion", 50, 100);
    const bad = reg.breaching();
    expect(bad.some((r) => r.definition.id === "task_completion")).toBe(true);
  });

  test("profile filtering marks inapplicable SLOs", () => {
    const reg = new SloRegistry({ now: () => NOW, profile: "personal_local" });
    expect(reg.report("worker_health").status).toBe("not_applicable");
  });

  test("sample storage is bounded", () => {
    const reg = new SloRegistry({ now: () => NOW, maxSamplesPerSlo: 10 });
    for (let i = 0; i < 50; i++) reg.observeOutcome("task_completion", true);
    expect(reg.samplesFor("task_completion").length).toBe(10);
  });
});

describe("Operational status", () => {
  test("a bare local deployment still produces valid status", () => {
    const s = buildOperationalStatus({ profile: "personal_local", now: NOW });
    expect(s.profile).toBe("personal_local");
    expect(s.overall).toBeDefined();
    expect(Array.isArray(s.alerts)).toBe(true);
  });

  test("no backup produces a warning alert", () => {
    const s = buildOperationalStatus({ profile: "personal_local", now: NOW });
    expect(s.alerts.some((a) => a.conditionId === "backup.none")).toBe(true);
    expect(s.backup.healthy).toBe(false);
  });

  test("backups that exist but were never verified are flagged", () => {
    const s = buildOperationalStatus({
      profile: "personal_local",
      now: NOW,
      backup: { lastBackupAt: NOW - HOUR },
    });
    expect(s.alerts.some((a) => a.conditionId === "backup.unverified")).toBe(true);
  });

  test("no restore drill is flagged", () => {
    const s = buildOperationalStatus({ profile: "personal_local", now: NOW });
    expect(s.alerts.some((a) => a.conditionId === "recovery.no_drill")).toBe(true);
  });

  test("breaching SLOs become error alerts", () => {
    const reg = new SloRegistry({ now: () => NOW });
    reg.observe("task_completion", 50, 100);
    const s = buildOperationalStatus({ profile: "personal_local", now: NOW, sloReports: reg.reportAll() });
    const alert = s.alerts.find((a) => a.sloId === "task_completion");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("error");
    expect(s.overall).not.toBe("healthy");
  });

  test("a critical open incident makes the status critical", () => {
    const inc = new IncidentService({ now: () => NOW });
    inc.declare({
      kind: "tenant_data_leakage",
      severity: "critical",
      title: "Cross-tenant read",
      summary: "A workspace read another tenant's records.",
      detectedBy: "monitor",
    });
    const s = buildOperationalStatus({ profile: "team_private", now: NOW, incidents: inc.list() });
    expect(s.overall).toBe("critical");
    expect(s.security.criticalIncidents).toBe(1);
    expect(s.security.openIncidents).toBe(1);
  });

  test("resolved incidents do not count as open", () => {
    const inc = new IncidentService({ now: () => NOW });
    const i = inc.declare({
      kind: "capability_abuse",
      severity: "medium",
      title: "t",
      summary: "s",
      detectedBy: "monitor",
    });
    inc.transition(i.incidentId, "resolved", "admin", "fixed");
    const s = buildOperationalStatus({ profile: "team_private", now: NOW, incidents: inc.list() });
    expect(s.security.openIncidents).toBe(0);
  });

  test("degraded workers raise an alert", () => {
    const s = buildOperationalStatus({
      profile: "team_private",
      now: NOW,
      deployment: {
        profile: "team_private",
        profileName: "Team Private",
        version: "6.1.0",
        localPlane: { planeId: "p1", kind: "local", reachable: true },
        dataPlanes: [],
        workers: [
          { workerId: "w1", state: "active", activeTasks: 0, lastHeartbeatAt: NOW, healthOk: true },
          { workerId: "w2", state: "offline", activeTasks: 0, lastHeartbeatAt: NOW, healthOk: false },
        ],
        sync: { state: "idle", pendingOps: 0, conflicts: 0, errors: 0 },
        residency: { policyVersion: "v1", entitiesInViolation: 0, lastCheckAt: NOW },
        offline: { isOffline: false, queuedTasks: 0, availableLocalTasks: 0, blockedRemoteTasks: 0 },
        health: { overall: "degraded", issues: [] },
      },
    });
    expect(s.workers.total).toBe(2);
    expect(s.workers.degraded).toBe(1);
    expect(s.alerts.some((a) => a.conditionId === "workers.degraded")).toBe(true);
  });

  test("deployment issues become alerts", () => {
    const s = buildOperationalStatus({
      profile: "hybrid",
      now: NOW,
      deployment: {
        profile: "hybrid",
        profileName: "Hybrid",
        version: "6.1.0",
        localPlane: { planeId: "p1", kind: "local", reachable: true },
        dataPlanes: [],
        workers: [],
        sync: { state: "idle", pendingOps: 0, conflicts: 0, errors: 0 },
        residency: { policyVersion: "v1", entitiesInViolation: 0, lastCheckAt: NOW },
        offline: { isOffline: false, queuedTasks: 0, availableLocalTasks: 0, blockedRemoteTasks: 0 },
        health: {
          overall: "degraded",
          issues: [
            { severity: "error", component: "sync", message: "Sync backlog growing.", since: NOW - HOUR, remediation: "Check connectivity." },
          ],
        },
      },
    });
    expect(s.alerts.some((a) => a.component === "sync")).toBe(true);
  });

  test("offline deployment reports offline overall", () => {
    const s = buildOperationalStatus({
      profile: "hybrid",
      now: NOW,
      deployment: {
        profile: "hybrid",
        profileName: "Hybrid",
        version: "6.1.0",
        localPlane: { planeId: "p1", kind: "local", reachable: false },
        dataPlanes: [],
        workers: [],
        sync: { state: "idle", pendingOps: 0, conflicts: 0, errors: 0 },
        residency: { policyVersion: "v1", entitiesInViolation: 0, lastCheckAt: NOW },
        offline: { isOffline: true, queuedTasks: 3, availableLocalTasks: 1, blockedRemoteTasks: 2 },
        health: { overall: "offline", issues: [] },
      },
    });
    expect(s.overall).toBe("offline");
  });

  test("alerts are sorted by severity", () => {
    const inc = new IncidentService({ now: () => NOW });
    inc.declare({ kind: "credential_exposure", severity: "critical", title: "t", summary: "s", detectedBy: "m" });
    const s = buildOperationalStatus({ profile: "team_private", now: NOW, incidents: inc.list() });
    expect(s.alerts[0]!.severity).toBe("critical");
  });

  test("alertsAtOrAbove filters correctly", () => {
    const inc = new IncidentService({ now: () => NOW });
    inc.declare({ kind: "credential_exposure", severity: "critical", title: "t", summary: "s", detectedBy: "m" });
    const s = buildOperationalStatus({ profile: "team_private", now: NOW, incidents: inc.list() });
    expect(alertsAtOrAbove(s, "critical").length).toBeGreaterThan(0);
    expect(alertsAtOrAbove(s, "critical").every((a) => a.severity === "critical")).toBe(true);
  });

  test("summarizeStatus renders a one-line summary", () => {
    const s = buildOperationalStatus({ profile: "personal_local", now: NOW });
    const line = summarizeStatus(s);
    expect(line).toContain("overall=");
    expect(line).toContain("slos=");
  });

  test("backup success rate below target raises an error alert", () => {
    const s = buildOperationalStatus({
      profile: "personal_local",
      now: NOW,
      backup: { lastBackupAt: NOW - HOUR, lastVerifiedAt: NOW - HOUR, successRate: { good: 8, total: 10 } },
    });
    expect(s.backup.successRate).toBeCloseTo(0.8, 5);
    expect(s.alerts.some((a) => a.conditionId === "backup.failures")).toBe(true);
  });
});
