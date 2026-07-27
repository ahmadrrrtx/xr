/**
 * XR 6.1 — Incident Response and Security Event Workflow
 *
 * Manages the full incident lifecycle: detected → triaged → contained →
 * quarantined → remediating → resolved → postmortem.
 * Supports incidents for capability abuse, credential exposure, isolation
 * failure, tenant/data leakage, provider compromise, malicious packages,
 * audit failure, and worker compromise.
 */

import { randomUUID } from "node:crypto";
import type {
  SecurityIncident,
  IncidentState,
  IncidentClass,
  IncidentSeverity,
  ContainmentAction,
  RemediationStep,
  PostmortemReport,
  IncidentEvent,
} from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Incident Response Service
// ═══════════════════════════════════════════════════════════════════════════

export interface IncidentResponseDeps {
  /** Callback to execute containment actions. */
  executeContainment?: (action: ContainmentAction) => Promise<boolean>;
  /** Audit callback. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class IncidentResponseService {
  private readonly incidents = new Map<string, SecurityIncident>();
  private readonly deps: IncidentResponseDeps;

  constructor(deps: IncidentResponseDeps = {}) {
    this.deps = deps;
  }

  // ── Incident Lifecycle ───────────────────────────────────────────────

  /** Create a new incident (state: detected). */
  createIncident(params: {
    title: string;
    class: IncidentClass;
    severity: IncidentSeverity;
    detectedBy: string;
    description: string;
    affectedWorkspaces?: string[];
    affectedCapabilities?: string[];
    affectedWorkers?: string[];
  }): SecurityIncident {
    const now = Date.now();
    const incident: SecurityIncident = {
      id: `inc_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      title: params.title,
      class: params.class,
      severity: params.severity,
      state: "detected",
      detectedAt: now,
      detectedBy: params.detectedBy,
      affectedWorkspaces: params.affectedWorkspaces ?? [],
      affectedCapabilities: params.affectedCapabilities ?? [],
      affectedWorkers: params.affectedWorkers ?? [],
      description: params.description,
      containmentActions: [],
      remediationSteps: [],
      timeline: [{
        timestamp: now,
        actor: params.detectedBy,
        action: "incident_created",
        detail: { class: params.class, severity: params.severity },
      }],
    };

    this.incidents.set(incident.id, incident);
    this.deps.audit?.("incident.created", {
      id: incident.id,
      class: params.class,
      severity: params.severity,
    });

    return incident;
  }

  /** Transition an incident to a new state. */
  transition(incidentId: string, toState: IncidentState, actor: string, detail: Record<string, unknown> = {}): boolean {
    const incident = this.incidents.get(incidentId);
    if (!incident) return false;

    const allowedTransitions = ALLOWED_TRANSITIONS[incident.state];
    if (!allowedTransitions.includes(toState)) {
      this.deps.audit?.("incident.transition_blocked", {
        id: incidentId,
        from: incident.state,
        to: toState,
        reason: "invalid_transition",
      });
      return false;
    }

    const timelineEntry: IncidentEvent = {
      timestamp: Date.now(),
      actor,
      action: `state_changed:${toState}`,
      detail: { ...detail, from: incident.state, to: toState },
    };

    const updated: SecurityIncident = {
      ...incident,
      state: toState,
      timeline: [...incident.timeline, timelineEntry],
    };

    this.incidents.set(incidentId, updated);
    this.deps.audit?.("incident.transitioned", {
      id: incidentId,
      from: incident.state,
      to: toState,
      by: actor,
    });

    return true;
  }

  // ── Containment ──────────────────────────────────────────────────────

  /** Add and optionally execute a containment action. */
  async contain(
    incidentId: string,
    action: ContainmentAction,
    execute: boolean = true,
  ): Promise<boolean> {
    const incident = this.incidents.get(incidentId);
    if (!incident) return false;

    // Add to containment actions.
    const updated: SecurityIncident = {
      ...incident,
      containmentActions: [...incident.containmentActions, action],
      timeline: [...incident.timeline, {
        timestamp: action.takenAt,
        actor: action.takenBy,
        action: `containment:${action.action}`,
        detail: { target: action.target, reversible: action.reversible },
      }],
    };
    this.incidents.set(incidentId, updated);

    // Optionally execute.
    if (execute && this.deps.executeContainment) {
      const success = await this.deps.executeContainment(action);
      if (!success) return false;
    }

    this.deps.audit?.("incident.containment_added", {
      id: incidentId,
      containmentAction: action.action,
      target: action.target,
    });

    return true;
  }

  /** Transition to contained state. */
  async containAndTransition(incidentId: string, actor: string): Promise<boolean> {
    this.transition(incidentId, "contained", actor, {});
    return this.transition(incidentId, "contained", actor, {});
  }

  // ── Remediation ──────────────────────────────────────────────────────

  /** Add a remediation step. */
  addRemediationStep(incidentId: string, step: Omit<RemediationStep, "id">): RemediationStep | undefined {
    const incident = this.incidents.get(incidentId);
    if (!incident) return undefined;

    const newStep: RemediationStep = {
      id: `rs_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      ...step,
    };

    const updated: SecurityIncident = {
      ...incident,
      remediationSteps: [...incident.remediationSteps, newStep],
    };
    this.incidents.set(incidentId, updated);

    return newStep;
  }

  /** Update a remediation step's status. */
  updateRemediationStep(
    incidentId: string,
    stepId: string,
    update: Partial<Pick<RemediationStep, "status" | "assignedTo" | "startedAt" | "completedAt">>,
  ): boolean {
    const incident = this.incidents.get(incidentId);
    if (!incident) return false;

    const steps = incident.remediationSteps.map(s =>
      s.id === stepId ? { ...s, ...update } : s
    );
    this.incidents.set(incidentId, { ...incident, remediationSteps: steps });
    return true;
  }

  /** Transition to remediating state. */
  startRemediation(incidentId: string, actor: string): boolean {
    return this.transition(incidentId, "remediating", actor, {});
  }

  // ── Resolution ───────────────────────────────────────────────────────

  /** Resolve an incident. */
  resolve(incidentId: string, actor: string, resolution: string): boolean {
    return this.transition(incidentId, "resolved", actor, { resolution });
  }

  /** Add a postmortem report. */
  addPostmortem(incidentId: string, report: PostmortemReport): boolean {
    const incident = this.incidents.get(incidentId);
    if (!incident) return false;

    const updated: SecurityIncident = {
      ...incident,
      postmortem: report,
      state: "postmortem",
      timeline: [...incident.timeline, {
        timestamp: report.publishedAt,
        actor: report.authoredBy,
        action: "postmortem_published",
        detail: { summary: report.summary },
      }],
    };
    this.incidents.set(incidentId, updated);

    this.deps.audit?.("incident.postmortem_added", {
      id: incidentId,
      authoredBy: report.authoredBy,
    });

    return true;
  }

  // ── Queries ──────────────────────────────────────────────────────────

  /** Get an incident by ID. */
  getIncident(incidentId: string): SecurityIncident | undefined {
    return this.incidents.get(incidentId);
  }

  /** List incidents, optionally filtered. */
  listIncidents(filter?: {
    state?: IncidentState;
    class?: IncidentClass;
    severity?: IncidentSeverity;
  }): SecurityIncident[] {
    let results = Array.from(this.incidents.values());

    if (filter?.state) results = results.filter(i => i.state === filter.state);
    if (filter?.class) results = results.filter(i => i.class === filter.class);
    if (filter?.severity) results = results.filter(i => i.severity === filter.severity);

    return results.sort((a, b) => b.detectedAt - a.detectedAt);
  }

  /** Get active (unresolved) incidents. */
  getActiveIncidents(): SecurityIncident[] {
    return Array.from(this.incidents.values())
      .filter(i => !TERMINAL_STATES.has(i.state))
      .sort((a, b) => b.detectedAt - a.detectedAt);
  }

  /** Count active incidents. */
  countActive(): number {
    return this.getActiveIncidents().length;
  }

  /** Add a timeline event to an incident. */
  addTimelineEvent(incidentId: string, event: IncidentEvent): boolean {
    const incident = this.incidents.get(incidentId);
    if (!incident) return false;

    this.incidents.set(incidentId, {
      ...incident,
      timeline: [...incident.timeline, event],
    });
    return true;
  }

  /** Get the incident timeline. */
  getTimeline(incidentId: string): readonly IncidentEvent[] {
    const incident = this.incidents.get(incidentId);
    return incident?.timeline ?? [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// State Machine
// ═══════════════════════════════════════════════════════════════════════════

const ALLOWED_TRANSITIONS: Record<IncidentState, readonly IncidentState[]> = {
  detected: ["triaged", "contained", "resolved"],
  triaged: ["contained", "resolved"],
  contained: ["quarantined", "remediating", "resolved"],
  quarantined: ["remediating", "resolved"],
  remediating: ["resolved"],
  resolved: ["postmortem"],
  postmortem: [], // Terminal.
};

const TERMINAL_STATES = new Set<IncidentState>(["resolved", "postmortem"]);
