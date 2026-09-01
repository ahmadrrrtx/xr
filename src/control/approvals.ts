/**
 * XR Phase 2 · F-11 — Unified approval queue (durable).
 *
 * This module replaces the old in-memory `ApprovalQueue` with a facade over
 * the SQLite-backed `ApprovalStore`:
 *
 *   • every approval is a durable record (survives restarts — a killed
 *     process never orphans a pending consent prompt),
 *   • TTL default-deny on EVERY surface (an unanswered approval is a denied
 *     action, not a stuck process),
 *   • cross-process: the dashboard (daemon process) can answer an approval
 *     raised by a CLI/control task in another process, because both read and
 *     write the same workspace store.
 *
 * The public surface (`request` / `list` / `answer` / `subscribe`) is kept
 * compatible with the Phase-08 shape so existing control-plane call sites
 * migrate without churn. `request()` FAILS CLOSED when no workspace store is
 * bound: the returned promise resolves `false` (denied) immediately — an
 * un-durable approval is never allowed to become a silent approval.
 *
 * Nothing here touches the OS. The heavy lifting lives in
 * `control/approval-store.ts`; this is the binding layer.
 */

import type { Action, RiskAssessment } from "./types.ts";
import {
  ApprovalStore,
  getApprovalStore,
  type ApprovalOutcome,
  type ApprovalRecord,
} from "./approval-store.ts";
import type { WorkspaceStore } from "../state/workspace-store.ts";

export interface PendingApproval {
  id: string;
  action: Action;
  risk: RiskAssessment;
  /** Human-readable preview (already redacted). */
  preview: string;
  createdAt: number;
  /** Resolves once the approval is answered or expires (TTL default-deny). */
  promise: Promise<boolean>;
  /** Internal: resolves the promise. */
  resolve(approved: boolean): void;
  /** True when answered. */
  done: boolean;
}

export interface PublicPending {
  id: string;
  action: Action;
  risk: RiskAssessment;
  preview: string;
  createdAt: number;
}

class ApprovalQueue {
  private store: WorkspaceStore | null = null;
  private approvalStore: ApprovalStore | null = null;
  private listeners = new Set<(snapshot: PublicPending[]) => void>();
  /** In-process map of legacy-shaped entries for list()/subscribe(). */
  private entries = new Map<string, PendingApproval>();

  /**
   * Bind the queue to a workspace store. Called by surfaces that own one
   * (daemon, control CLI). Without a store the queue fails closed.
   */
  bind(store: WorkspaceStore): void {
    this.store = store;
    this.approvalStore = getApprovalStore(store);
    void this.approvalStore; // binding above is the real effect
  }

  /** True when a durable backing exists. */
  isBound(): boolean {
    return this.store !== null;
  }

  /** Enqueue a new approval. Caller awaits .promise. */
  request(action: Action, risk: RiskAssessment, preview: string): PendingApproval {
    const id = `ap_${Math.random().toString(36).slice(2, 10)}`;
    let resolvePromise!: (v: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolvePromise = r));

    // ── Fail closed: no durable backing ⇒ immediate denial (never a hang,
    // never a silent approval). ─────────────────────────────────────────────
    if (!this.approvalStore) {
      const denied: PendingApproval = {
        id,
        action,
        risk,
        preview,
        createdAt: Date.now(),
        promise,
        done: true,
        resolve: (approved) => resolvePromise(approved),
      };
      console.warn(
        `[xr] approval queue is not bound to a workspace store — ` +
          `approval for action ${JSON.stringify(action.type)} DENIED (fail closed).`,
      );
      queueMicrotask(() => resolvePromise(false));
      return denied;
    }

    let resolved = false;
    const entry: PendingApproval = {
      id,
      action,
      risk,
      preview,
      createdAt: Date.now(),
      promise,
      done: false,
      resolve: (approved) => {
        if (resolved) return;
        resolved = true;
        entry.done = true;
        // Record the decision durably — first writer wins.
        this.approvalStore?.decide(entry.id, approved, { channel: "control", userId: "local" });
        resolvePromise(approved);
        // entry.id is the store id once the durable request returned; also
        // clear the pre-request placeholder key if it differs.
        this.entries.delete(entry.id);
        this.entries.delete(id);
        this.notify();
      },
    };
    this.entries.set(id, entry);

    // Durable record + TTL default-deny via the store.
    const handle = this.approvalStore.request({
      tool: action.type === "app" ? "system_open_app" : action.type,
      reason: risk.reason,
      args: action as unknown as Record<string, unknown>,
      riskTier: risk.level,
      surface: "control",
    });
    // The store's id wins (it is the durable identity) — keep the local map
    // keyed by the same id so answer() can find it.
    entry.id = handle.id;
    this.entries.delete(id);
    this.entries.set(handle.id, entry);

    void handle.outcome.then((outcome: ApprovalOutcome) => {
      entry.resolve(outcome.approved);
      if (!outcome.approved && outcome.timedOut) {
        entry.done = true;
      }
    });
    this.notify();
    return entry;
  }

  /** Snapshot of currently-pending approvals (safe to send over JSON). */
  list(): PublicPending[] {
    return Array.from(this.entries.values()).map((p) => ({
      id: p.id,
      action: p.action,
      risk: p.risk,
      preview: p.preview,
      createdAt: p.createdAt,
    }));
  }

  /** Durable pending records (the canonical list for cross-process views). */
  listRecords(): ApprovalRecord[] {
    return this.approvalStore?.listPending() ?? [];
  }

  /** Answer an approval by id. Returns true if the id existed. */
  answer(id: string, approved: boolean): boolean {
    const entry = this.entries.get(id);
    if (entry) {
      entry.resolve(approved);
      return true;
    }
    // Cross-process answer: the record exists durably even if this process
    // never saw the entry object.
    return this.approvalStore?.decide(id, approved, { channel: "control", userId: "local" }) ?? false;
  }

  /** Subscribe to changes (used by /api/control/events SSE-like polling). */
  subscribe(fn: (snapshot: PublicPending[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const snap = this.list();
    for (const fn of this.listeners) {
      try { fn(snap); } catch { /* listener errors must never break the queue */ }
    }
  }
}

// Module-level singleton — there is only one approval queue per process.
export const approvals = new ApprovalQueue();

/**
 * Phase 2 · F-11 — bind the process-wide queue to the active workspace store.
 * Surfaces that own a store MUST call this before raising/answering
 * approvals (daemon boot, control CLI boot).
 */
export function bindApprovals(store: WorkspaceStore): void {
  approvals.bind(store);
}
