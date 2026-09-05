/**
 * XR 6.1 — Incident response workflow.
 *
 * Seven states: detected → triaged → contained → quarantined → remediating →
 * resolved → postmortem, with fast paths so an operator can contain first and
 * triage afterwards.
 *
 * Guarantees:
 *   - Evidence is immutable once captured (hash-committed at capture time).
 *   - Every state change and response action is recorded on the timeline.
 *   - Incidents affecting user data set `userVisibleImpact` and that flag
 *     cannot be cleared by an administrator (roadmap §11).
 *   - Response actions are executed through injected handlers so this module
 *     stays free of side effects and testable offline.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  ENTERPRISE_BOUNDS,
  ENTERPRISE_SCHEMA_VERSION,
  canTransitionIncident,
  type Incident,
  type IncidentEvidence,
  type IncidentKind,
  type IncidentPostmortem,
  type IncidentResponseAction,
  type IncidentSeverity,
  type IncidentState,
  type IncidentTimelineEntry,
  type IncidentTransitionResult,
} from "../types.ts";

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

/**
 * Incident kinds that always imply user-visible impact.
 * An administrator cannot suppress notification for these.
 */
const ALWAYS_USER_VISIBLE: readonly IncidentKind[] = [
  "tenant_data_leakage",
  "credential_exposure",
  "isolation_failure",
  "audit_failure",
];

export function impliesUserVisibleImpact(kind: IncidentKind, severity: IncidentSeverity): boolean {
  if (ALWAYS_USER_VISIBLE.includes(kind)) return true;
  return severity === "critical" || severity === "high";
}

// ═══════════════════════════════════════════════════════════════════════════
// Response action handlers
// ═══════════════════════════════════════════════════════════════════════════

export type ResponseActionKind = IncidentResponseAction["kind"];

export interface ResponseHandlerResult {
  readonly ok: boolean;
  readonly detail: string;
  readonly reversible?: boolean;
}

/**
 * Injected side-effect handlers. Each maps to an existing XR subsystem:
 *   quarantine_capability → CapabilityService.quarantine
 *   revoke_publisher      → SupplyChainResponseService.revokePublisher
 *   revoke_delegation     → DelegationRegistry.revoke
 *   revoke_identity       → IdentityService.revokeIdentity (Phase 11)
 *   disable_worker        → WorkerRegistry (Phase 11)
 *   restore_backup        → RecoveryOperations.restore
 */
export type ResponseHandlers = Partial<
  Record<ResponseActionKind, (targetId: string, context: { incidentId: string; actorId: string; reason: string }) => ResponseHandlerResult>
>;

// ═══════════════════════════════════════════════════════════════════════════
// Incident service
// ═══════════════════════════════════════════════════════════════════════════

export interface IncidentServiceDeps {
  readonly audit?: (event: string, detail: Record<string, unknown>) => void;
  readonly now?: () => number;
  readonly handlers?: ResponseHandlers;
  /** Notified when an incident with user-visible impact is created/updated. */
  readonly notifyUsers?: (incident: Incident) => void;
}

export interface DeclareIncidentParams {
  readonly kind: IncidentKind;
  readonly severity: IncidentSeverity;
  readonly title: string;
  readonly summary: string;
  readonly detectedBy: string;
  readonly organizationId?: string;
  readonly workspaceId?: string;
  readonly affected?: readonly string[];
}

export class IncidentService {
  private readonly incidents = new Map<string, Incident>();
  private readonly deps: IncidentServiceDeps;

  constructor(deps: IncidentServiceDeps = {}) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Declare a new incident in the `detected` state. */
  declare(params: DeclareIncidentParams): Incident {
    const now = this.now();
    const userVisibleImpact = impliesUserVisibleImpact(params.kind, params.severity);

    const incident: Incident = {
      incidentId: id("inc"),
      schemaVersion: ENTERPRISE_SCHEMA_VERSION,
      kind: params.kind,
      severity: params.severity,
      state: "detected",
      title: params.title,
      summary: params.summary,
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
      detectedAt: now,
      detectedBy: params.detectedBy,
      affected: params.affected ?? [],
      evidence: [],
      actions: [],
      timeline: [
        {
          at: now,
          actorId: params.detectedBy,
          toState: "detected",
          action: "declared",
          detail: params.summary,
        },
      ],
      userVisibleImpact,
    };

    this.incidents.set(incident.incidentId, incident);

    this.deps.audit?.("enterprise.incident.declared", {
      incidentId: incident.incidentId,
      kind: incident.kind,
      severity: incident.severity,
      detectedBy: incident.detectedBy,
      organizationId: incident.organizationId,
      workspaceId: incident.workspaceId,
      userVisibleImpact,
      affected: incident.affected.length,
    });

    if (userVisibleImpact) this.deps.notifyUsers?.(incident);

    return incident;
  }

  get(incidentId: string): Incident | undefined {
    return this.incidents.get(incidentId);
  }

  /** Transition state, enforcing the legal transition table. */
  transition(
    incidentId: string,
    to: IncidentState,
    actorId: string,
    detail: string,
  ): IncidentTransitionResult {
    const incident = this.incidents.get(incidentId);
    if (!incident) return { ok: false, error: `Incident not found: ${incidentId}` };

    if (incident.state === to) return { ok: true, incident };

    if (!canTransitionIncident(incident.state, to)) {
      this.deps.audit?.("enterprise.incident.transition_rejected", {
        incidentId,
        from: incident.state,
        to,
        actorId,
      });
      return { ok: false, error: `Illegal transition ${incident.state} → ${to}.` };
    }

    const now = this.now();
    const entry: IncidentTimelineEntry = {
      at: now,
      actorId,
      fromState: incident.state,
      toState: to,
      action: "state_change",
      detail,
    };

    const updated: Incident = {
      ...incident,
      state: to,
      triagedAt: to === "triaged" ? now : incident.triagedAt,
      containedAt: to === "contained" || to === "quarantined" ? incident.containedAt ?? now : incident.containedAt,
      resolvedAt: to === "resolved" ? now : incident.resolvedAt,
      closedAt: to === "postmortem" ? now : incident.closedAt,
      timeline: this.appendTimeline(incident.timeline, entry),
    };

    this.incidents.set(incidentId, updated);

    this.deps.audit?.("enterprise.incident.transitioned", {
      incidentId,
      from: incident.state,
      to,
      actorId,
      detail,
    });

    if (updated.userVisibleImpact) this.deps.notifyUsers?.(updated);

    return { ok: true, incident: updated };
  }

  /**
   * Capture evidence. Content is hashed at capture time and never mutated —
   * the record is preserved even if the underlying subject changes later.
   */
  captureEvidence(params: {
    incidentId: string;
    kind: IncidentEvidence["kind"];
    description: string;
    capturedBy: string;
    payload?: Record<string, unknown>;
    ref?: string;
  }): { ok: boolean; evidence?: IncidentEvidence; error?: string } {
    const incident = this.incidents.get(params.incidentId);
    if (!incident) return { ok: false, error: `Incident not found: ${params.incidentId}` };
    if (incident.evidence.length >= ENTERPRISE_BOUNDS.MAX_INCIDENT_EVIDENCE_ITEMS) {
      return { ok: false, error: "Incident evidence limit reached." };
    }

    const now = this.now();
    const evidence: IncidentEvidence = {
      evidenceId: id("ev"),
      kind: params.kind,
      capturedAt: now,
      capturedBy: params.capturedBy,
      description: params.description,
      contentHash: hashPayload(params.payload ?? params.ref ?? params.description),
      payload: params.payload,
      ref: params.ref,
    };

    const updated: Incident = {
      ...incident,
      evidence: [...incident.evidence, evidence],
      timeline: this.appendTimeline(incident.timeline, {
        at: now,
        actorId: params.capturedBy,
        action: "evidence_captured",
        detail: `${params.kind}: ${params.description}`,
      }),
    };

    this.incidents.set(params.incidentId, updated);

    this.deps.audit?.("enterprise.incident.evidence_captured", {
      incidentId: params.incidentId,
      evidenceId: evidence.evidenceId,
      kind: evidence.kind,
      capturedBy: evidence.capturedBy,
      contentHash: evidence.contentHash,
    });

    return { ok: true, evidence };
  }

  /** Verify preserved evidence has not been altered. */
  verifyEvidence(incidentId: string): { ok: boolean; checked: number; tampered: readonly string[] } {
    const incident = this.incidents.get(incidentId);
    if (!incident) return { ok: false, checked: 0, tampered: [] };
    const tampered: string[] = [];
    for (const e of incident.evidence) {
      const expected = hashPayload(e.payload ?? e.ref ?? e.description);
      if (expected !== e.contentHash) tampered.push(e.evidenceId);
    }
    return { ok: tampered.length === 0, checked: incident.evidence.length, tampered };
  }

  /**
   * Execute a containment/remediation action via an injected handler.
   * Records the outcome whether it succeeded or failed.
   */
  act(params: {
    incidentId: string;
    kind: ResponseActionKind;
    targetId: string;
    executedBy: string;
    reason: string;
  }): { ok: boolean; action?: IncidentResponseAction; error?: string } {
    const incident = this.incidents.get(params.incidentId);
    if (!incident) return { ok: false, error: `Incident not found: ${params.incidentId}` };

    const now = this.now();
    const handler = this.deps.handlers?.[params.kind];

    const result: ResponseHandlerResult = handler
      ? handler(params.targetId, {
          incidentId: params.incidentId,
          actorId: params.executedBy,
          reason: params.reason,
        })
      : { ok: false, detail: `No handler registered for action '${params.kind}'.` };

    const action: IncidentResponseAction = {
      actionId: id("act"),
      kind: params.kind,
      targetId: params.targetId,
      executedAt: now,
      executedBy: params.executedBy,
      ok: result.ok,
      detail: result.detail,
      reversible: result.reversible ?? defaultReversible(params.kind),
    };

    const updated: Incident = {
      ...incident,
      actions: [...incident.actions, action],
      timeline: this.appendTimeline(incident.timeline, {
        at: now,
        actorId: params.executedBy,
        action: `response:${params.kind}`,
        detail: `${params.targetId} — ${result.detail}`,
      }),
    };

    this.incidents.set(params.incidentId, updated);

    this.deps.audit?.("enterprise.incident.action_executed", {
      incidentId: params.incidentId,
      actionId: action.actionId,
      kind: action.kind,
      targetId: action.targetId,
      executedBy: action.executedBy,
      ok: action.ok,
      reversible: action.reversible,
    });

    return { ok: result.ok, action, error: result.ok ? undefined : result.detail };
  }

  /**
   * Convenience: contain an incident by executing one or more actions and
   * moving to `contained` when at least one succeeds.
   */
  contain(params: {
    incidentId: string;
    actorId: string;
    reason: string;
    actions: readonly { kind: ResponseActionKind; targetId: string }[];
  }): IncidentTransitionResult {
    const incident = this.incidents.get(params.incidentId);
    if (!incident) return { ok: false, error: `Incident not found: ${params.incidentId}` };

    let anySucceeded = false;
    for (const a of params.actions) {
      const r = this.act({
        incidentId: params.incidentId,
        kind: a.kind,
        targetId: a.targetId,
        executedBy: params.actorId,
        reason: params.reason,
      });
      if (r.ok) anySucceeded = true;
    }

    if (!anySucceeded) {
      return { ok: false, incident: this.incidents.get(params.incidentId), error: "No containment action succeeded." };
    }

    const hasQuarantine = params.actions.some(
      (a) => a.kind === "quarantine_capability" || a.kind === "revoke_publisher",
    );
    return this.transition(
      params.incidentId,
      hasQuarantine ? "quarantined" : "contained",
      params.actorId,
      params.reason,
    );
  }

  /** Attach a postmortem. Only valid once resolved. */
  postmortem(params: {
    incidentId: string;
    writtenBy: string;
    rootCause: string;
    impact: string;
    timelineSummary: string;
    correctiveActions: readonly string[];
    publish?: boolean;
  }): IncidentTransitionResult {
    const incident = this.incidents.get(params.incidentId);
    if (!incident) return { ok: false, error: `Incident not found: ${params.incidentId}` };
    if (incident.state !== "resolved" && incident.state !== "postmortem") {
      return { ok: false, error: `Postmortem requires a resolved incident (state: ${incident.state}).` };
    }

    const now = this.now();
    const pm: IncidentPostmortem = {
      writtenBy: params.writtenBy,
      writtenAt: now,
      rootCause: params.rootCause,
      impact: params.impact,
      timelineSummary: params.timelineSummary,
      correctiveActions: [...params.correctiveActions],
      published: params.publish ?? false,
    };

    const withPm: Incident = {
      ...incident,
      postmortem: pm,
      timeline: this.appendTimeline(incident.timeline, {
        at: now,
        actorId: params.writtenBy,
        action: "postmortem_written",
        detail: params.rootCause,
      }),
    };
    this.incidents.set(params.incidentId, withPm);

    this.deps.audit?.("enterprise.incident.postmortem", {
      incidentId: params.incidentId,
      writtenBy: params.writtenBy,
      published: pm.published,
      correctiveActions: pm.correctiveActions.length,
    });

    if (incident.state === "resolved") {
      return this.transition(params.incidentId, "postmortem", params.writtenBy, "Postmortem completed.");
    }
    return { ok: true, incident: withPm };
  }

  list(filter?: {
    state?: IncidentState;
    kind?: IncidentKind;
    severity?: IncidentSeverity;
    organizationId?: string;
    workspaceId?: string;
    openOnly?: boolean;
  }): readonly Incident[] {
    let rows = [...this.incidents.values()];
    if (filter?.state) rows = rows.filter((i) => i.state === filter.state);
    if (filter?.kind) rows = rows.filter((i) => i.kind === filter.kind);
    if (filter?.severity) rows = rows.filter((i) => i.severity === filter.severity);
    if (filter?.organizationId) rows = rows.filter((i) => i.organizationId === filter.organizationId);
    if (filter?.workspaceId) rows = rows.filter((i) => i.workspaceId === filter.workspaceId);
    if (filter?.openOnly) rows = rows.filter((i) => i.state !== "resolved" && i.state !== "postmortem");
    return rows.sort((a, b) => b.detectedAt - a.detectedAt);
  }

  /** Open incidents that users in scope must be told about. */
  userVisibleIncidents(scope?: { organizationId?: string; workspaceId?: string }): readonly Incident[] {
    return this.list({ ...scope, openOnly: true }).filter((i) => i.userVisibleImpact);
  }

  /** Time from detection to first containment, for the response-time SLO. */
  responseTimeMs(incidentId: string): number | undefined {
    const i = this.incidents.get(incidentId);
    if (!i?.containedAt) return undefined;
    return i.containedAt - i.detectedAt;
  }

  /** Full-text-ish search across title/summary/affected, for operator triage. */
  search(query: string): readonly Incident[] {
    const q = query.toLowerCase();
    return [...this.incidents.values()]
      .filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q) ||
          i.affected.some((a) => a.toLowerCase().includes(q)) ||
          i.incidentId.toLowerCase().includes(q),
      )
      .sort((a, b) => b.detectedAt - a.detectedAt);
  }

  private appendTimeline(
    timeline: readonly IncidentTimelineEntry[],
    entry: IncidentTimelineEntry,
  ): readonly IncidentTimelineEntry[] {
    const next = [...timeline, entry];
    if (next.length > ENTERPRISE_BOUNDS.MAX_INCIDENT_TIMELINE_ENTRIES) {
      // Keep the first entry (declaration) and the most recent window.
      return [next[0]!, ...next.slice(next.length - ENTERPRISE_BOUNDS.MAX_INCIDENT_TIMELINE_ENTRIES + 1)];
    }
    return next;
  }
}

function defaultReversible(kind: ResponseActionKind): boolean {
  switch (kind) {
    case "quarantine_capability":
    case "disable_worker":
    case "block_provider":
    case "revoke_delegation":
      return true;
    case "revoke_publisher":
    case "revoke_identity":
    case "rotate_credential":
    case "restore_backup":
    case "notify":
      return false;
  }
}
