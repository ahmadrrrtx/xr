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

import { route, type DaemonRoute, type DaemonRouteContext } from "./router.ts";
import { getApprovalStore } from "../../control/approval-store.ts";

/**
 * V1-P5-001 — the ONE decide path, shared by the desktop decision route and
 * the mobile companion route (first decision wins from ANY surface; the same
 * durable store, the same audit trail, the same actor derived at the auth
 * seam). Each surface parses its own wire form and hands the boolean here, so
 * approval semantics cannot fork between surfaces.
 */
export async function decideApproval(
  ctx: Pick<DaemonRouteContext, "json" | "state" | "config" | "actor">,
  id: string,
  approved: boolean,
): Promise<Response> {
  const approvalsCfg = ctx.config?.approvals;
  const store = getApprovalStore(ctx.state.store, {
    defaultTtlMs: approvalsCfg?.defaultTtlMs,
    perSurface: approvalsCfg?.perSurface,
  });
  const record = store.get(id);
  if (!record) return ctx.json({ error: "approval not found" }, 404);
  const ok = store.decide(id, approved, {
    channel: "daemon",
    userId: ctx.actor ?? "anonymous",
  });
  if (!ok) {
    return ctx.json(
      { error: "approval already decided or timed out", decision: record.decision },
      409,
    );
  }
  return ctx.json({ ok: true, decision: approved ? "approved" : "denied" });
}

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
        }));
        return json({ pending });
      },
    }),
    route({
      id: "approvals.decide",
      prefix: "/api/approvals/",
      method: "POST",
      handle: async ({ req, json, path, state, config, actor }) => {
        try {
          const match = path.match(/^\/api\/approvals\/([^/]+)\/decision$/);
          if (!match) return null;
          const id = decodeURIComponent(match[1]);
          // XR-LAUNCH-030: a body `userId` is accepted for compatibility and ignored.
          const body = (await req.json().catch(() => ({}))) as { approved?: boolean; phrase?: string };
          if (typeof body?.approved !== "boolean") {
            return json({ error: "expected { approved: boolean }" }, 400);
          }
          return await decideApproval({ json, state, config, actor }, id, body.approved);
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
  ];
}
