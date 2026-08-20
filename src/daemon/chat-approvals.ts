/**
 * Phase 12 — in-flight chat tool-approval waiters.
 *
 * The chat route's `approve()` callback MUST block on a human decision and
 * MUST NOT let the model approve itself. Timeouts and stream aborts fail
 * closed (deny). Resolving a waiter is the only path to `true`.
 *
 * The HTTP surface (`POST /api/chat/approve`) is an authenticated adapter
 * over this map — it does not execute tools.
 */

export interface ChatApprovalWaiter {
  runId: string;
  tool: string;
  resolve: (approved: boolean) => void;
}

const waiters = new Map<string, ChatApprovalWaiter>();

/** Default fail-closed timeout (ms). The loop must not hang forever. */
export const CHAT_APPROVAL_TIMEOUT_MS = 120_000;

export function waitForChatApproval(
  id: string,
  runId: string,
  tool: string,
  signal: AbortSignal | undefined,
  timeoutMs = CHAT_APPROVAL_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      waiters.delete(id);
      signal?.removeEventListener("abort", onAbort);
      resolve(approved);
    };
    const onAbort = () => finish(false);
    waiters.set(id, { runId, tool, resolve: finish });
    if (signal) {
      if (signal.aborted) {
        finish(false);
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    const t = setTimeout(() => finish(false), timeoutMs);
    (t as unknown as { unref?: () => void }).unref?.();
  });
}

/** Human decision. Returns false if the id is unknown or already settled. */
export function resolveChatApproval(id: string, approved: boolean): boolean {
  const w = waiters.get(id);
  if (!w) return false;
  w.resolve(approved);
  return true;
}

/** Fail-closed: every waiter for this run becomes a denial. */
export function cancelChatApprovals(runId: string): void {
  for (const [id, w] of [...waiters.entries()]) {
    if (w.runId === runId) {
      w.resolve(false);
      waiters.delete(id);
    }
  }
}

/** Test helper. */
export function pendingChatApprovalCount(): number {
  return waiters.size;
}
