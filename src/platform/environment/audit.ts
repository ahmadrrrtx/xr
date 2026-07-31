/**
 * XR 5.1 — Environment audit events (durable via Store.audit).
 *
 * Every governed transition and decision emits an `env.*` event. Payloads are
 * already-redacted safe summaries — actions pass through redactEnvironmentAction
 * and observations carry path+hash references, never raw media.
 */
import type { Store } from "../../state/workspace-store.ts";
import type {
  EnvironmentActionRecord,
  EnvironmentAssessment,
  EnvironmentSession,
} from "./types.ts";
import { redactEnvironmentAction } from "./privacy.ts";

export function auditSessionTransition(
  store: Store | undefined,
  session: EnvironmentSession,
  to: string,
  reason?: string,
): void {
  store?.audit("env.session.transition", {
    sessionId: session.sessionId,
    environment: session.type,
    workspaceId: session.workspaceId,
    to,
    reason: reason ?? null,
    state: session.state,
  });
}

export function auditSessionCreated(store: Store | undefined, session: EnvironmentSession): void {
  store?.audit("env.session.created", {
    sessionId: session.sessionId,
    environment: session.type,
    workspaceId: session.workspaceId,
    taskId: session.taskId ?? null,
  });
}

export function auditSessionClosed(
  store: Store | undefined,
  session: EnvironmentSession,
  cleanupState: string,
  note?: string,
): void {
  store?.audit("env.session.closed", {
    sessionId: session.sessionId,
    environment: session.type,
    state: session.state,
    cleanupState,
    actionsPerformed: session.actionsPerformed,
    note: note ?? null,
  });
}

export function auditAssessed(store: Store | undefined, assessment: EnvironmentAssessment): void {
  store?.audit("env.action.assessed", {
    environment: assessment.request.environment,
    sourceActor: assessment.request.sourceActor,
    action: redactEnvironmentAction(assessment.request.action),
    interaction: assessment.interaction,
    risk: assessment.risk.level,
    reversibility: assessment.reversibility,
    approval: assessment.approval,
    blocked: assessment.blockedReason ?? null,
    uncertainty: assessment.uncertainty ?? null,
  });
}

export function auditRecord(store: Store | undefined, record: EnvironmentActionRecord): void {
  const event =
    record.outcome === "succeeded"
      ? "env.action.executed"
      : record.outcome === "denied"
        ? "env.action.denied"
        : record.outcome === "blocked"
          ? "env.action.blocked"
          : record.outcome === "uncertain"
            ? "env.action.uncertain"
            : record.outcome === "cancelled"
              ? "env.action.cancelled"
              : "env.action.failed";
  store?.audit(event, {
    recordId: record.recordId,
    sessionId: record.sessionId ?? null,
    environment: record.environment,
    sourceActor: record.sourceActor,
    action: record.actionSummary,
    interaction: record.interaction,
    target: record.target.kind === "resource" ? record.target : { kind: record.target.kind },
    risk: record.riskLevel,
    reversibility: record.reversibility,
    approval: record.approval,
    observation: record.observation ?? null,
    recovery: record.recovery ?? null,
    outcome: record.outcome,
    message: record.message.slice(0, 500),
    durationMs: record.durationMs,
  });
}

export function auditRecovery(
  store: Store | undefined,
  sessionId: string | undefined,
  detail: Record<string, unknown>,
): void {
  store?.audit("env.recovery", { sessionId: sessionId ?? null, ...detail });
}

export function auditCircuit(
  store: Store | undefined,
  sessionId: string,
  detail: Record<string, unknown>,
): void {
  store?.audit("env.circuit", { sessionId, ...detail });
}

export function auditPrivacyBlock(store: Store | undefined, kind: string, reason: string): void {
  store?.audit("env.privacy.blocked", { kind, reason });
}

export function auditQuarantine(
  store: Store | undefined,
  session: EnvironmentSession,
  reason: string,
): void {
  store?.audit("env.session.quarantined", {
    sessionId: session.sessionId,
    environment: session.type,
    reason,
  });
}
