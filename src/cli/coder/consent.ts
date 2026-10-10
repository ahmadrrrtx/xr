/**
 * Consent for the coding CLI goes through the workspace's durable approval
 * store, like every other surface (Phase 2 · F-11). The coder's prompt is the
 * surface UI: `makeApprover` records the request, asks the prompt, and
 * default-denies on TTL. The session never resolves consent on its own.
 */
import type { ApprovalRequest } from "../../core/types.ts";
import { makeApprover } from "../../control/approval-store.ts";
import type { WorkspaceStore } from "../../state/workspace-store.ts";

export type ApproveFn = (req: ApprovalRequest) => Promise<boolean>;
/** Wraps the coder's interactive approve function with the durable store. */
export type ConsentWrap = (ask: ApproveFn) => ApproveFn;

export function storeConsent(store: WorkspaceStore, surface = "cli"): ConsentWrap {
  return (ask) => {
    // Approvals arrive one at a time (the engine loop waits on each), so the
    // in-flight request is the one the store's prompt is answering.
    let current: ApprovalRequest | null = null;
    const gate = makeApprover(store, {
      surface,
      prompt: async (_record, decide) => {
        if (!current) {
          decide(false);
          return;
        }
        decide(await ask(current));
      },
    });
    return async (req) => {
      current = req;
      return gate(req);
    };
  };
}
