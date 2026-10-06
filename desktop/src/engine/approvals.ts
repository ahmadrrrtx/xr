/*
 * Engine approvals bridge (Phase 14).
 *
 * The engine owns consent: a tool that needs a human emits
 * `approval_required{id, tool, reason, args, riskTier, preview, ttlMs}` and
 * the run BLOCKS until `POST /api/v1/approvals/:id/decision {approved}` or
 * the TTL (default-deny, 300 s). The desktop's existing approval queue (modal,
 * bell, Shield tab, remember rules, auto-deny countdown) is reused unchanged:
 * the request enters it under the ENGINE's id, so whatever decides it — the
 * modal buttons, a remember rule, Shield's pause, the timeout — lands on the
 * engine through the single `decideOnEngine` path.
 *
 * The desktop never computes risk here: `riskTier` comes from the engine's
 * tool registry and is only mapped onto the modal's three-step scale.
 */
import type { PendingDecision } from '@/lib/approvalCore';
import { requestApproval, withdrawRequest } from '@/lib/approvalEvents';
import { engineJson, enginePost, EngineHttpError } from './transport';
import type { EngineApprovalRequired, EnginePendingApproval } from './types';
import { riskFromTier, toApprovalRequest } from './wire';

// Pure mappers (engine request → ApprovalRequest, tier → risk) live in
// ./wire.ts so they can be unit-tested without the UI dependency graph.
export { riskFromTier, toApprovalRequest };

/** `GET /api/v1/approvals` → the engine's still-pending requests. */
export async function listPendingEngineApprovals(): Promise<EnginePendingApproval[]> {
  const j = await engineJson<{ pending?: EnginePendingApproval[] }>('/approvals');
  return j.pending ?? [];
}

/**
 * Forward a decision. `gone` = the engine had already decided (TTL expiry,
 * another surface) — the caller shows the engine's outcome, not ours.
 */
export async function decideOnEngine(
  id: string,
  approved: boolean,
): Promise<'ok' | 'gone' | 'unreachable'> {
  try {
    await enginePost(`/approvals/${encodeURIComponent(id)}/decision`, { approved });
    return 'ok';
  } catch (e) {
    if (e instanceof EngineHttpError && (e.status === 404 || e.status === 409)) return 'gone';
    return 'unreachable';
  }
}

export interface EngineApprovalOutcome {
  approved: boolean;
  reason?: string;
  /** XR Shield (desktop policy) answered before the human could. */
  blocked?: boolean;
  /** The engine had already resolved it (expired / decided elsewhere). */
  gone?: boolean;
}

/**
 * Park on the human for ONE engine approval. Resolves when a decision has
 * been forwarded to the engine. Aborting `signal` (Stop) withdraws the modal
 * and denies on the engine so the run cannot proceed on a stale consent.
 */
export async function bridgeEngineApproval(
  a: EngineApprovalRequired,
  signal: AbortSignal,
): Promise<EngineApprovalOutcome> {
  const req = toApprovalRequest(a);
  let aborted = false;
  const decision = await Promise.race([
    requestApproval(req),
    new Promise<PendingDecision>((resolve) => {
      const onAbort = () => {
        aborted = true;
        resolve({ status: 'denied', reason: 'Generation cancelled' });
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }),
  ]);
  if (aborted) withdrawRequest(req.id, 'Generation cancelled');

  const approved = decision.status === 'approved';
  const sent = await decideOnEngine(req.id, approved);
  return {
    approved,
    reason: decision.reason,
    blocked:
      decision.status === 'denied' &&
      decision.auto === true &&
      decision.ruleId?.startsWith('policy.') === true,
    gone: sent === 'gone',
  };
}

/* ── Pending-approval sync (Phase 14) ──────────────────────────────────── */

const syncing = new Set<string>();
let syncTimer: number | null = null;
let syncRefs = 0;
const SYNC_MS = 5_000;

/**
 * Approvals the engine is holding that did NOT arrive over a stream this
 * window owns (another client, a reload mid-turn, a CLI run): bridge them
 * into the same queue so the modal / Bell / Shield Approvals show them and
 * a decision here resolves them on the engine. Each id is bridged once.
 */
export async function syncPendingEngineApprovals(): Promise<number> {
  const { useEngineStore } = await import('@/stores/engineStore');
  if (useEngineStore.getState().status !== 'up') return 0;
  const { useApprovalStore } = await import('@/stores/approvalStore');
  let pending: EnginePendingApproval[];
  try {
    pending = await listPendingEngineApprovals();
  } catch {
    return 0;
  }
  const known = new Set(useApprovalStore.getState().pending.map((r) => r.id));
  let bridged = 0;
  for (const p of pending) {
    if (known.has(p.id) || syncing.has(p.id)) continue;
    if (p.expiresAt && p.expiresAt <= Date.now()) continue;
    syncing.add(p.id);
    bridged += 1;
    const required: EngineApprovalRequired = {
      id: p.id,
      tool: p.tool,
      reason: p.reason,
      preview: p.preview,
      riskTier: p.riskTier,
      ttlMs: p.ttlMs,
    };
    void bridgeEngineApproval(required, new AbortController().signal).finally(() => syncing.delete(p.id));
  }
  return bridged;
}

/** Ref-counted poller — mount once per window (AppShell). */
export function startEngineApprovalSync(): () => void {
  syncRefs += 1;
  if (syncTimer === null) {
    void syncPendingEngineApprovals();
    syncTimer = window.setInterval(() => void syncPendingEngineApprovals(), SYNC_MS);
  }
  return () => {
    syncRefs -= 1;
    if (syncRefs <= 0 && syncTimer !== null) {
      window.clearInterval(syncTimer);
      syncTimer = null;
      syncRefs = 0;
    }
  };
}
