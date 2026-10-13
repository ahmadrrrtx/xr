import { create } from 'zustand';
import { api, isOfflineError } from '../api/client';
import { cacheApprovals, readApprovals } from '../lib/idb';
import { haptic } from '../lib/haptics';
import { uid } from '../lib/format';
import { useConnection } from './connection';
import { useQueue } from './queue';
import type { Approval } from '../types';

interface ApprovalsState {
  items: Approval[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  showResolved: boolean;

  toggleResolved: () => void;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  decide: (id: string, decision: 'approve' | 'deny') => Promise<void>;
  replay: (id: string, decision: 'approve' | 'deny') => Promise<void>;
}

export const useApprovals = create<ApprovalsState>((set, get) => ({
  items: [],
  loading: false,
  refreshing: false,
  error: null,
  showResolved: false,

  toggleResolved: () => set((state) => ({ showResolved: !state.showResolved })),

  load: async () => {
    set({ loading: true });
    try {
      const { approvals } = await api.approvals('all');
      set({ items: approvals, loading: false, error: null });
      await cacheApprovals(approvals);
    } catch (error) {
      const cached = await readApprovals();
      set({
        items: cached,
        loading: false,
        error: isOfflineError(error) ? null : 'Could not load approvals.',
      });
    }
  },

  refresh: async () => {
    set({ refreshing: true });
    await get().load();
    set({ refreshing: false });
  },

  decide: async (id, decision) => {
    // Optimistic: the card leaves the pending list immediately, everywhere.
    set((state) => ({
      items: state.items.map((a) =>
        a.id === id
          ? { ...a, status: decision === 'approve' ? 'approved' : 'denied', resolvedAt: Date.now() }
          : a,
      ),
    }));
    haptic(decision === 'approve' ? 'success' : 'medium');

    if (useConnection.getState().status === 'offline') {
      void useQueue.getState().add({
        id: uid('q'),
        url: `/api/v1/approvals/${id}`,
        method: 'POST',
        body: { decision },
        createdAt: Date.now(),
        localId: id,
        kind: 'approval',
        attempts: 0,
      });
      return;
    }
    await submit(id, decision);
  },

  replay: (id, decision) => submit(id, decision, true),
}));

async function submit(
  id: string,
  decision: 'approve' | 'deny',
  isReplay = false,
): Promise<void> {
  try {
    await api.decide(id, decision);
  } catch (error) {
    if (isOfflineError(error)) {
      await useQueue.getState().add({
        id: uid('q'),
        url: `/api/v1/approvals/${id}`,
        method: 'POST',
        body: { decision },
        createdAt: Date.now(),
        localId: id,
        kind: 'approval',
        attempts: 0,
      });
      return;
    }
    // Roll the optimistic change back and say so.
    useApprovals.setState((state) => ({
      items: state.items.map((a) =>
        a.id === id ? { ...a, status: 'pending' as const, resolvedAt: undefined } : a,
      ),
    }));
    haptic('error');
    if (!isReplay) {
      useApprovals.setState({
        error:
          decision === 'approve'
            ? "Couldn't approve — XR didn't respond."
            : "Couldn't deny — XR didn't respond.",
      });
    }
  }
}

export function pendingApprovals(items: Approval[]): Approval[] {
  return items.filter((a) => a.status === 'pending');
}

export function resolvedApprovals(items: Approval[]): Approval[] {
  return items
    .filter((a) => a.status !== 'pending')
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
}
