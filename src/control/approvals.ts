/**
 * XR v0.8.1 — Unified approval queue for computer control.
 *
 * Approvals can be answered from TWO surfaces:
 *   1. the CLI prompt (existing behavior, sync `confirm()` in the terminal)
 *   2. the dashboard ("Approve" / "Deny" button posts /api/control/approve)
 *
 * Whichever responds first wins. The other is auto-cancelled.
 *
 * Why a singleton queue?
 *   • The dashboard process and the CLI process are the SAME process when the
 *     user runs `xr serve` then sends actions in another shell via the agent —
 *     no, actually they're separate processes. So the dashboard only sees
 *     approvals raised by tasks running INSIDE its own process (e.g. the
 *     agent tool `computer_control`, or `xr control plan ... --serve`).
 *   • For pure CLI flows (`xr control open …`), the CLI prompt is still used.
 *
 * Nothing here touches the OS. It's a tiny pure state machine.
 */

import { randomUUID } from "node:crypto";
import type { Action, RiskAssessment } from "./types.ts";

export interface PendingApproval {
  id: string;
  action: Action;
  risk: RiskAssessment;
  /** Human-readable preview (already redacted). */
  preview: string;
  createdAt: number;
  /** Resolves once the approval is answered or expires. */
  promise: Promise<boolean>;
  /** Internal: resolves the promise. */
  resolve(approved: boolean): void;
  /** True when answered. */
  done: boolean;
}

class ApprovalQueue {
  private pending = new Map<string, PendingApproval>();
  private listeners = new Set<(snapshot: PublicPending[]) => void>();

  /** Enqueue a new approval. Caller awaits .promise. */
  request(action: Action, risk: RiskAssessment, preview: string): PendingApproval {
    const id = `ap_${randomUUID().slice(0, 8)}`;
    let resolve!: (v: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    const entry: PendingApproval = {
      id,
      action,
      risk,
      preview,
      createdAt: Date.now(),
      promise,
      done: false,
      resolve: (approved) => {
        if (entry.done) return;
        entry.done = true;
        this.pending.delete(id);
        resolve(approved);
        this.notify();
      },
    };
    this.pending.set(id, entry);
    this.notify();
    return entry;
  }

  /** Snapshot of currently-pending approvals (safe to send over JSON). */
  list(): PublicPending[] {
    return Array.from(this.pending.values()).map((p) => ({
      id: p.id,
      action: p.action,
      risk: p.risk,
      preview: p.preview,
      createdAt: p.createdAt,
    }));
  }

  /** Answer an approval by id. Returns true if the id existed. */
  answer(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.resolve(approved);
    return true;
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

export interface PublicPending {
  id: string;
  action: Action;
  risk: RiskAssessment;
  preview: string;
  createdAt: number;
}

// Module-level singleton — there is only one approval queue per process.
export const approvals = new ApprovalQueue();
