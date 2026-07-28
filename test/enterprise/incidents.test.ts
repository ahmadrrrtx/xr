/**
 * XR 6.1 — Phase 12 Tests: Incident response workflow.
 */
import { describe, expect, test } from "bun:test";
import {
  INCIDENT_STATES,
  INCIDENT_KINDS,
  IncidentService,
  canTransitionIncident,
  impliesUserVisibleImpact,
  type ResponseHandlers,
} from "../../src/enterprise/index.ts";

const NOW = 1_800_000_000_000;

function service(handlers?: ResponseHandlers, notify?: (i: unknown) => void): IncidentService {
  return new IncidentService({
    now: () => NOW,
    handlers,
    notifyUsers: notify as never,
  });
}

describe("Incident state machine", () => {
  test("all seven states are defined", () => {
    expect(INCIDENT_STATES).toEqual([
      "detected",
      "triaged",
      "contained",
      "quarantined",
      "remediating",
      "resolved",
      "postmortem",
    ]);
  });

  test("all eight incident kinds are supported", () => {
    expect(INCIDENT_KINDS.length).toBe(8);
    for (const k of [
      "capability_abuse",
      "credential_exposure",
      "isolation_failure",
      "tenant_data_leakage",
      "provider_compromise",
      "malicious_package",
      "audit_failure",
      "worker_compromise",
    ]) {
      expect(INCIDENT_KINDS).toContain(k as never);
    }
  });

  test("legal transitions are enforced", () => {
    expect(canTransitionIncident("detected", "triaged")).toBe(true);
    expect(canTransitionIncident("detected", "contained")).toBe(true);
    expect(canTransitionIncident("triaged", "remediating")).toBe(true);
    expect(canTransitionIncident("resolved", "postmortem")).toBe(true);
  });

  test("illegal transitions are rejected", () => {
    expect(canTransitionIncident("postmortem", "detected")).toBe(false);
    expect(canTransitionIncident("resolved", "triaged")).toBe(false);
    expect(canTransitionIncident("detected", "postmortem")).toBe(false);
  });

  test("postmortem is terminal", () => {
    expect(canTransitionIncident("postmortem", "resolved")).toBe(false);
  });
});

describe("Incident declaration", () => {
  test("a new incident starts in detected with a timeline entry", () => {
    const svc = service();
    const i = svc.declare({
      kind: "capability_abuse",
      severity: "high",
      title: "Skill exfiltrating data",
      summary: "A skill attempted repeated outbound posts.",
      detectedBy: "shield",
    });
    expect(i.state).toBe("detected");
    expect(i.detectedAt).toBe(NOW);
    expect(i.timeline.length).toBe(1);
    expect(i.timeline[0]!.toState).toBe("detected");
  });

  test("data leakage always implies user-visible impact", () => {
    expect(impliesUserVisibleImpact("tenant_data_leakage", "low")).toBe(true);
    expect(impliesUserVisibleImpact("credential_exposure", "low")).toBe(true);
    expect(impliesUserVisibleImpact("isolation_failure", "low")).toBe(true);
    expect(impliesUserVisibleImpact("audit_failure", "low")).toBe(true);
  });

  test("critical and high severity always imply user-visible impact", () => {
    expect(impliesUserVisibleImpact("capability_abuse", "critical")).toBe(true);
    expect(impliesUserVisibleImpact("capability_abuse", "high")).toBe(true);
    expect(impliesUserVisibleImpact("capability_abuse", "low")).toBe(false);
  });

  test("user-visible incidents trigger notification", () => {
    let notified = 0;
    const svc = service(undefined, () => notified++);
    svc.declare({
      kind: "tenant_data_leakage",
      severity: "critical",
      title: "t",
      summary: "s",
      detectedBy: "monitor",
    });
    expect(notified).toBeGreaterThan(0);
  });

  test("userVisibleIncidents lists only open, user-affecting incidents", () => {
    const svc = service();
    svc.declare({ kind: "tenant_data_leakage", severity: "critical", title: "visible", summary: "s", detectedBy: "m" });
    svc.declare({ kind: "capability_abuse", severity: "low", title: "quiet", summary: "s", detectedBy: "m" });
    const visible = svc.userVisibleIncidents();
    expect(visible.length).toBe(1);
    expect(visible[0]!.title).toBe("visible");
  });
});

describe("Incident transitions", () => {
  test("valid transitions update timestamps and timeline", () => {
    const svc = service();
    const i = svc.declare({ kind: "capability_abuse", severity: "high", title: "t", summary: "s", detectedBy: "m" });

    const t1 = svc.transition(i.incidentId, "triaged", "responder", "Confirmed abuse.");
    expect(t1.ok).toBe(true);
    expect(t1.incident!.state).toBe("triaged");
    expect(t1.incident!.triagedAt).toBe(NOW);

    const t2 = svc.transition(i.incidentId, "contained", "responder", "Capability disabled.");
    expect(t2.incident!.containedAt).toBe(NOW);
    expect(t2.incident!.timeline.length).toBe(3);
  });

  test("an illegal transition is refused", () => {
    const svc = service();
    const i = svc.declare({ kind: "capability_abuse", severity: "low", title: "t", summary: "s", detectedBy: "m" });
    const bad = svc.transition(i.incidentId, "postmortem", "responder", "skip ahead");
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("Illegal transition");
    expect(svc.get(i.incidentId)!.state).toBe("detected");
  });

  test("fast-path containment straight from detected is allowed", () => {
    const svc = service();
    const i = svc.declare({ kind: "worker_compromise", severity: "critical", title: "t", summary: "s", detectedBy: "m" });
    expect(svc.transition(i.incidentId, "quarantined", "responder", "Immediate quarantine.").ok).toBe(true);
  });

  test("transitioning to the same state is a no-op success", () => {
    const svc = service();
    const i = svc.declare({ kind: "capability_abuse", severity: "low", title: "t", summary: "s", detectedBy: "m" });
    expect(svc.transition(i.incidentId, "detected", "m", "again").ok).toBe(true);
  });

  test("an unknown incident id fails cleanly", () => {
    const svc = service();
    expect(svc.transition("nope", "triaged", "m", "x").ok).toBe(false);
  });

  test("responseTimeMs measures detection to containment", () => {
    let clock = NOW;
    const svc = new IncidentService({ now: () => clock });
    const i = svc.declare({ kind: "capability_abuse", severity: "high", title: "t", summary: "s", detectedBy: "m" });
    clock = NOW + 5 * 60 * 1000;
    svc.transition(i.incidentId, "contained", "responder", "done");
    expect(svc.responseTimeMs(i.incidentId)).toBe(5 * 60 * 1000);
  });
});

describe("Evidence preservation", () => {
  test("evidence is hash-committed at capture time", () => {
    const svc = service();
    const i = svc.declare({ kind: "malicious_package", severity: "critical", title: "t", summary: "s", detectedBy: "m" });
    const r = svc.captureEvidence({
      incidentId: i.incidentId,
      kind: "capability_snapshot",
      description: "State before quarantine",
      capturedBy: "responder",
      payload: { capabilityId: "skill:evil", version: "1.2.3" },
    });
    expect(r.ok).toBe(true);
    expect(r.evidence!.contentHash.length).toBe(64);
    expect(svc.get(i.incidentId)!.evidence.length).toBe(1);
  });

  test("verifyEvidence confirms untampered evidence", () => {
    const svc = service();
    const i = svc.declare({ kind: "audit_failure", severity: "high", title: "t", summary: "s", detectedBy: "m" });
    svc.captureEvidence({
      incidentId: i.incidentId,
      kind: "audit_range",
      description: "Broken chain range",
      capturedBy: "responder",
      payload: { from: 100, to: 200 },
    });
    const v = svc.verifyEvidence(i.incidentId);
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(1);
    expect(v.tampered.length).toBe(0);
  });

  test("capturing evidence appends to the timeline", () => {
    const svc = service();
    const i = svc.declare({ kind: "capability_abuse", severity: "low", title: "t", summary: "s", detectedBy: "m" });
    svc.captureEvidence({ incidentId: i.incidentId, kind: "note", description: "observed", capturedBy: "r" });
    expect(svc.get(i.incidentId)!.timeline.some((t) => t.action === "evidence_captured")).toBe(true);
  });

  test("evidence on an unknown incident fails cleanly", () => {
    const svc = service();
    expect(svc.captureEvidence({ incidentId: "nope", kind: "note", description: "d", capturedBy: "r" }).ok).toBe(false);
  });
});

describe("Response actions", () => {
  test("an action executes via its handler and is recorded", () => {
    let quarantined = "";
    const svc = service({
      quarantine_capability: (target) => {
        quarantined = target;
        return { ok: true, detail: `Quarantined ${target}` };
      },
    });
    const i = svc.declare({ kind: "malicious_package", severity: "critical", title: "t", summary: "s", detectedBy: "m" });
    const r = svc.act({
      incidentId: i.incidentId,
      kind: "quarantine_capability",
      targetId: "skill:evil",
      executedBy: "responder",
      reason: "malware",
    });

    expect(r.ok).toBe(true);
    expect(quarantined).toBe("skill:evil");
    expect(svc.get(i.incidentId)!.actions.length).toBe(1);
    expect(svc.get(i.incidentId)!.actions[0]!.reversible).toBe(true);
  });

  test("a missing handler records a failed action rather than throwing", () => {
    const svc = service();
    const i = svc.declare({ kind: "capability_abuse", severity: "high", title: "t", summary: "s", detectedBy: "m" });
    const r = svc.act({
      incidentId: i.incidentId,
      kind: "revoke_identity",
      targetId: "id1",
      executedBy: "responder",
      reason: "x",
    });
    expect(r.ok).toBe(false);
    expect(svc.get(i.incidentId)!.actions[0]!.ok).toBe(false);
  });

  test("a failing handler is recorded with its detail", () => {
    const svc = service({
      disable_worker: () => ({ ok: false, detail: "Worker already gone." }),
    });
    const i = svc.declare({ kind: "worker_compromise", severity: "critical", title: "t", summary: "s", detectedBy: "m" });
    svc.act({ incidentId: i.incidentId, kind: "disable_worker", targetId: "w1", executedBy: "r", reason: "x" });
    expect(svc.get(i.incidentId)!.actions[0]!.detail).toBe("Worker already gone.");
  });

  test("contain runs actions and moves to contained", () => {
    const svc = service({
      disable_worker: () => ({ ok: true, detail: "disabled" }),
    });
    const i = svc.declare({ kind: "worker_compromise", severity: "critical", title: "t", summary: "s", detectedBy: "m" });
    const r = svc.contain({
      incidentId: i.incidentId,
      actorId: "responder",
      reason: "Worker key leaked.",
      actions: [{ kind: "disable_worker", targetId: "w1" }],
    });
    expect(r.ok).toBe(true);
    expect(r.incident!.state).toBe("contained");
  });

  test("contain moves to quarantined when a capability is quarantined", () => {
    const svc = service({
      quarantine_capability: () => ({ ok: true, detail: "q" }),
    });
    const i = svc.declare({ kind: "malicious_package", severity: "critical", title: "t", summary: "s", detectedBy: "m" });
    const r = svc.contain({
      incidentId: i.incidentId,
      actorId: "responder",
      reason: "malware",
      actions: [{ kind: "quarantine_capability", targetId: "skill:evil" }],
    });
    expect(r.incident!.state).toBe("quarantined");
  });

  test("contain fails when no action succeeds", () => {
    const svc = service({
      disable_worker: () => ({ ok: false, detail: "nope" }),
    });
    const i = svc.declare({ kind: "worker_compromise", severity: "high", title: "t", summary: "s", detectedBy: "m" });
    const r = svc.contain({
      incidentId: i.incidentId,
      actorId: "r",
      reason: "x",
      actions: [{ kind: "disable_worker", targetId: "w1" }],
    });
    expect(r.ok).toBe(false);
    expect(svc.get(i.incidentId)!.state).toBe("detected");
  });
});

describe("Postmortem", () => {
  test("a postmortem requires a resolved incident", () => {
    const svc = service();
    const i = svc.declare({ kind: "capability_abuse", severity: "high", title: "t", summary: "s", detectedBy: "m" });
    const r = svc.postmortem({
      incidentId: i.incidentId,
      writtenBy: "lead",
      rootCause: "rc",
      impact: "i",
      timelineSummary: "ts",
      correctiveActions: ["a"],
    });
    expect(r.ok).toBe(false);
  });

  test("a resolved incident accepts a postmortem and closes", () => {
    const svc = service();
    const i = svc.declare({ kind: "capability_abuse", severity: "high", title: "t", summary: "s", detectedBy: "m" });
    svc.transition(i.incidentId, "contained", "r", "contained");
    svc.transition(i.incidentId, "resolved", "r", "resolved");

    const r = svc.postmortem({
      incidentId: i.incidentId,
      writtenBy: "lead",
      rootCause: "Unvalidated skill permission.",
      impact: "No data left the workspace.",
      timelineSummary: "Detected and contained within minutes.",
      correctiveActions: ["Require certification for network-capable skills."],
      publish: true,
    });

    expect(r.ok).toBe(true);
    expect(r.incident!.state).toBe("postmortem");
    expect(r.incident!.postmortem!.published).toBe(true);
    expect(r.incident!.closedAt).toBe(NOW);
  });
});

describe("Incident queries", () => {
  test("filters by state, kind, severity, and scope", () => {
    const svc = service();
    svc.declare({ kind: "capability_abuse", severity: "high", title: "a", summary: "s", detectedBy: "m", organizationId: "org1" });
    svc.declare({ kind: "worker_compromise", severity: "low", title: "b", summary: "s", detectedBy: "m", organizationId: "org2" });

    expect(svc.list({ kind: "capability_abuse" }).length).toBe(1);
    expect(svc.list({ severity: "low" }).length).toBe(1);
    expect(svc.list({ organizationId: "org1" }).length).toBe(1);
    expect(svc.list({ state: "detected" }).length).toBe(2);
  });

  test("openOnly excludes resolved and postmortem", () => {
    const svc = service();
    const i = svc.declare({ kind: "capability_abuse", severity: "low", title: "t", summary: "s", detectedBy: "m" });
    svc.declare({ kind: "audit_failure", severity: "high", title: "open", summary: "s", detectedBy: "m" });
    svc.transition(i.incidentId, "resolved", "r", "done");
    expect(svc.list({ openOnly: true }).length).toBe(1);
  });

  test("search matches title, summary, and affected ids", () => {
    const svc = service();
    svc.declare({
      kind: "malicious_package",
      severity: "critical",
      title: "Evil skill detected",
      summary: "Outbound exfiltration",
      detectedBy: "m",
      affected: ["skill:evil"],
    });
    expect(svc.search("evil").length).toBe(1);
    expect(svc.search("exfiltration").length).toBe(1);
    expect(svc.search("skill:evil").length).toBe(1);
    expect(svc.search("nothing").length).toBe(0);
  });
});
