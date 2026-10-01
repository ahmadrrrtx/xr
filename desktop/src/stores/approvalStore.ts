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
 */
import { create } from 'zustand';

import {
  nextActiveId,
  type ApprovalRequest,
  type ApprovalRule,
  type PendingDecision,
} from '@/lib/approvalCore';
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

  /** Enqueue + register the decision promise. Effects live in approvalEvents. */
  requestApproval: (req: ApprovalRequest) => Promise<PendingDecision>;
  /** Apply a decision: state, optional new rule, resolve, advance the modal. */
  decide: (
    id: string,
    decision: PendingDecision,
    newRule?: ApprovalRule
  ) => void;
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

  requestApproval: (req) =>
    new Promise<PendingDecision>((resolve) => {
      resolvers.set(req.id, resolve);
      set((st) => ({
        pending: [...st.pending, req],
        activeId: st.activeId ?? req.id,
      }));
    }),

  decide: (id, decision, newRule) => {
    const st = get();
    if (!st.pending.some((r) => r.id === id)) return;
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
