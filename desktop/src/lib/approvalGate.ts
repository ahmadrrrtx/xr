/*
 * Approval gate registry (Phase 12) — the one seam between the Phase 7
 * approval queue and XR Shield.
 *
 * The approval store calls `runApprovalGate(req)` before it queues anything,
 * so a request from ANY surface (chat, Brain, bell, future bots/CLI) is
 * gated unconditionally. Shield registers the policy (`shield/enforce.ts`);
 * with nothing registered every request simply prompts, exactly as Phase 7
 * shipped. Observers hear every outcome (`queued` / `gated` / `decided`) —
 * that is how the audit log records a decision no matter which button
 * made it.
 *
 * Deliberately dependency-free (types only) so the store stays pure and
 * headless tests can drive it.
 */
import type { ApprovalRequest, PendingDecision } from '@/lib/approvalCore';
import type {
  AuditDecision,
  DecidedBy,
  GateOutcome,
  RememberChoice,
} from '@/shield/types';

export type GateFn = (req: ApprovalRequest) => GateOutcome;

export type ApprovalEvent =
  | { kind: 'queued'; request: ApprovalRequest; quarantined: boolean }
  | {
      kind: 'gated';
      request: ApprovalRequest;
      decision: PendingDecision;
      outcome: Extract<GateOutcome, { kind: 'decide' }>;
    }
  | {
      kind: 'decided';
      request: ApprovalRequest;
      decision: PendingDecision;
      decidedBy: DecidedBy;
      remember: RememberChoice | null;
      /** Override for the audit row (e.g. `blocked` for a paused-deny). */
      auditDecision?: AuditDecision;
    };

export interface DecideMeta {
  decidedBy?: DecidedBy;
  remember?: RememberChoice | null;
  auditDecision?: AuditDecision;
}

const PROMPT: GateOutcome = { kind: 'prompt', quarantined: false };

let gate: GateFn | null = null;
const listeners = new Set<(e: ApprovalEvent) => void>();

/** Install (or clear with null) the policy gate. Last writer wins. */
export function setApprovalGate(fn: GateFn | null): void {
  gate = fn;
}

/** Ask the installed gate; no gate → prompt the human (Phase 7 behaviour). */
export function runApprovalGate(req: ApprovalRequest): GateOutcome {
  if (!gate) return PROMPT;
  try {
    return gate(req);
  } catch {
    // A broken gate must not grant anything: fail closed to the prompt.
    return PROMPT;
  }
}

export function onApprovalEvent(fn: (e: ApprovalEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitApprovalEvent(e: ApprovalEvent): void {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch {
      /* one observer failing must not break the decision path */
    }
  }
}
