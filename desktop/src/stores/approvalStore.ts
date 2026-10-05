/*
 * Approval queue state (Phase 7) — one store, every surface.
 *
 * Pure state + promise resolvers; side effects (toasts, notifications, IPC
 * events, orb state) live in lib/approvalEvents.ts so the store never
 * imports its own callers. Queue semantics:
 *   - `pending` is oldest-first; the modal shows `activeId` (oldest by
 *     default, or any request surfaced via `activate`).
 *   - `requestApproval` returns a promise that resolves when the request is
 *     decided (modal buttons, bell popover inline actions, auto-deny
 *     countdown, or a rule-driven auto decision).
 *   - The pending queue is session-only by design; remember rules persist.
 *   - Phase 12: every request passes the Shield gate (lib/approvalGate.ts)
 *     BEFORE it is queued — paused / policy-blocked / low-risk-auto
 *     requests resolve synchronously and never open the modal. Observers
 *     (the audit log) hear every queue/gate/decide event from here, so no
 *     surface can decide without a record.
 */
import { create } from 'zustand';

import {
  nextActiveId,
  type ApprovalRequest,
  type ApprovalRule,
  type PendingDecision,
} from '@/lib/approvalCore';
import {
  emitApprovalEvent,
  runApprovalGate,
  type DecideMeta,
} from '@/lib/approvalGate';
import { loadRules, saveRules } from '@/lib/approvalRules';

/** Promise resolvers, keyed by request id (kept out of serializable state). */
const resolvers = new Map<string, (decision: PendingDecision) => void>();

interface ApprovalState {
  pending: ApprovalRequest[];
  activeId: string | null;
  rules: ApprovalRule[];
  /** Decisions this session (for history surfaces; not persisted). */
  decisions: Record<string, PendingDecision>;
  hydrated: boolean;
  /**
   * Phase 12: true while the Shield Approvals tab is on screen. The root
   * modal yields to the inline list (same queue, same promises) and its
   * away-countdown pauses — the user is looking at the queue.
   */
  inlineSurface: boolean;

  /**
   * Gate, then enqueue + register the decision promise. A gate decision
   * resolves immediately (nothing is queued). Effects live in approvalEvents.
   */
  requestApproval: (req: ApprovalRequest) => Promise<PendingDecision>;
  /** Apply a decision: state, optional new rule, resolve, advance the modal. */
  decide: (
    id: string,
    decision: PendingDecision,
    newRule?: ApprovalRule,
    meta?: DecideMeta
  ) => void;
  setInlineSurface: (active: boolean) => void;
  /** Bring a buried request to the front (bell popover / orb menu). */
  activate: (id: string) => void;
  /** Quietly resolve as denied (generation cancelled) — no toast/noise. */
  withdraw: (id: string, reason: string) => void;
  setRules: (rules: ApprovalRule[]) => void;
  hydrate: () => Promise<void>;
}

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  pending: [],
  activeId: null,
  rules: [],
  decisions: {},
  hydrated: false,
  inlineSurface: false,

  requestApproval: (req) => {
    const outcome = runApprovalGate(req);
    if (outcome.kind === 'decide') {
      const decision: PendingDecision = {
        status: outcome.status,
        auto: true,
        ruleId: outcome.ruleId,
        reason: outcome.reason,
      };
      set((st) => ({ decisions: { ...st.decisions, [req.id]: decision } }));
      emitApprovalEvent({ kind: 'gated', request: req, decision, outcome });
      return Promise.resolve(decision);
    }
    // A quarantined skill always prompts at high risk (Shield policy copy:
    // "each request prompts at high risk and ignores remember rules").
    const queued: ApprovalRequest =
      outcome.quarantined && req.risk !== 'high' ? { ...req, risk: 'high' } : req;
    return new Promise<PendingDecision>((resolve) => {
      resolvers.set(queued.id, resolve);
      set((st) => ({
        pending: [...st.pending, queued],
        activeId: st.activeId ?? queued.id,
      }));
      emitApprovalEvent({
        kind: 'queued',
        request: queued,
        quarantined: outcome.quarantined,
      });
    });
  },

  decide: (id, decision, newRule, meta) => {
    const st = get();
    const req = st.pending.find((r) => r.id === id);
    if (!req) return;
    const rules = newRule ? [...st.rules, newRule] : st.rules;
    set({
      pending: st.pending.filter((r) => r.id !== id),
      activeId:
        st.activeId === id ? nextActiveId(st.pending, id) : st.activeId,
      decisions: { ...st.decisions, [id]: decision },
      rules,
    });
    resolvers.get(id)?.(decision);
    resolvers.delete(id);
    if (newRule) void saveRules(rules);
    emitApprovalEvent({
      kind: 'decided',
      request: req,
      decision,
      decidedBy: meta?.decidedBy ?? 'user',
      remember:
        meta?.remember !== undefined
          ? meta.remember
          : (decision.remember ?? null),
      auditDecision: meta?.auditDecision,
    });
  },

  setInlineSurface: (active) => {
    if (get().inlineSurface !== active) set({ inlineSurface: active });
  },

  activate: (id) => {
    if (!get().pending.some((r) => r.id === id)) return;
    set({ activeId: id });
  },

  withdraw: (id, reason) => {
    get().decide(id, { status: 'denied', reason });
  },

  setRules: (rules) => set({ rules }),

  hydrate: async () => {
    if (get().hydrated) return;
    const rules = await loadRules();
    // hydrate once — a racing caller's result is dropped, not double-applied
    useApprovalStore.setState((st) =>
      st.hydrated ? st : { rules, hydrated: true }
    );
  },
}));
