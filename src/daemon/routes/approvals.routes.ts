/**
 * XR Phase 2 · F-11 — daemon approval endpoints.
 *
 * GET  /api/approvals            → durable pending approvals (cross-process:
 *                                  raised by ANY surface sharing the
 *                                  workspace store, incl. CLI runs)
 * POST /api/approvals/:id/decision → decide an approval (bearer-authed, same
 *                                  auth as every daemon route)
 *
 * These are the canonical decision endpoints for headless/remote consent.
 * The legacy /api/control/pending + /api/control/approve pair remains for
 * backward compatibility and forwards to the same durable store.
 */

import { route, type DaemonRoute } from "./router.ts";
import { getApprovalStore } from "../../control/approval-store.ts";

export function approvalRoutes(): DaemonRoute[] {
  return [
    route({
      id: "approvals.list",
      path: "/api/approvals",
      method: "GET",
      handle: ({ json, state, config }) => {
        // Config is present via the router; `?.` keeps direct handler
        // invocations on the schema defaults.
        const approvalsCfg = config?.approvals;
        const store = getApprovalStore(state.store, {
          defaultTtlMs: approvalsCfg?.defaultTtlMs,
          perSurface: approvalsCfg?.perSurface,
        });
        const pending = store.listPending().map((r) => ({
          id: r.id,
          taskId: r.taskId,
          runId: r.runId,
          sessionId: r.sessionId,
          tool: r.tool,
          argsHash: r.argsHash,
          reason: r.reason,
          preview: r.preview,
          riskTier: r.riskTier,
          surface: r.surface,
          requestedAt: r.requestedAt,
          ttlMs: r.ttlMs,
          expiresAt: r.requestedAt + r.ttlMs,
          /**
           * Phase 8 · Step 6 — for a Tier-2 request the operator must type
           * this phrase back to approve. It is served with the PENDING record
           * (not the decision endpoint) on purpose: a client must have read
           * the request it is approving.
           */
          typedConfirmPhrase: store.typedConfirmFor(r.id)?.phrase,
          requiresTypedConfirm: store.needsTypedConfirm(r.id),
        }));
        return json({ pending });
      },
    }),
    route({
      id: "approvals.decide",
      prefix: "/api/approvals/",
      method: "POST",
      handle: async ({ req, json, path, state, config }) => {
        try {
          const match = path.match(/^\/api\/approvals\/([^/]+)\/decision$/);
          if (!match) return null;
          const id = decodeURIComponent(match[1]);
          const body = (await req.json().catch(() => ({}))) as {
            approved?: boolean;
            userId?: string;
            /** Phase 8 · Step 6 — required to APPROVE a Tier-2 request. */
            typedConfirm?: string;
          };
          if (typeof body?.approved !== "boolean") {
            return json({ error: "expected { approved: boolean }" }, 400);
          }
          const approvalsCfg = config?.approvals;
          const store = getApprovalStore(state.store, {
            defaultTtlMs: approvalsCfg?.defaultTtlMs,
            perSurface: approvalsCfg?.perSurface,
          });
          const record = store.get(id);
          if (!record) return json({ error: "approval not found" }, 404);
          const ok = store.decide(
            id,
            body.approved,
            {
              channel: "daemon",
              userId: typeof body.userId === "string" ? body.userId : null,
            },
            typeof body.typedConfirm === "string" ? body.typedConfirm : undefined,
          );
          if (!ok) {
            // Distinguish "needs the second factor" from "already gone": a 409
            // here would send an operator hunting a decided request that is
            // actually still pending and merely unconfirmed.
            if (record.decision === null && body.approved && store.needsTypedConfirm(id)) {
              return json(
                {
                  error: "typed confirmation required or incorrect",
                  hint: "re-read the pending request and POST { approved: true, typedConfirm: \"<phrase>\" }",
                  riskTier: record.riskTier,
                },
                428, // Precondition Required
              );
            }
            return json(
              { error: "approval already decided or timed out", decision: record.decision },
              409,
            );
          }
          return json({ ok: true, decision: body.approved ? "approved" : "denied" });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
  ];
}
