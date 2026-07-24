/**
 * XR 4.2 — Daemon Trust & Isolation routes.
 *
 * Exposes secret-free trust status so users can understand risk tier,
 * placement, and isolation availability BEFORE a consequential action:
 *   GET  /api/trust           — backend availability + health (no secrets)
 *   POST /api/trust/classify  — classify an action and show the placement
 *                               decision (accepts a TrustRequest or {cmd,cwd})
 */
import { route, type DaemonRoute } from "./router.ts";
import { shellTrustSpec } from "../../trust/tool-support.ts";
import type { TrustRequest } from "../../trust/types.ts";

export function trustRoutes(): DaemonRoute[] {
  return [
    route({
      id: "trust.get",
      path: "/api/trust",
      method: "GET",
      handle: async ({ json, state }) => {
        if (!state.trust) return json({ enabled: false, reason: "trust service not wired" });
        await state.trust.ensureReady();
        return json({ enabled: true, ...state.trust.health() });
      },
    }),
    route({
      id: "trust.classify.post",
      path: "/api/trust/classify",
      method: "POST",
      handle: async ({ json, req, state }) => {
        if (!state.trust) return json({ error: "trust service not wired" }, 503);
        await state.trust.ensureReady();
        let body: Record<string, unknown> = {};
        try {
          body = (await req.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        // Accept a full TrustRequest, or a simple {cmd, cwd} for a shell action.
        let request: TrustRequest;
        if (body && typeof body === "object" && "capability" in body) {
          request = body as unknown as TrustRequest;
        } else {
          const cmd = String(body.cmd ?? "true");
          const cwd = String(body.cwd ?? process.cwd());
          request = shellTrustSpec(cmd, cwd).request;
        }
        const { classification, decision } = state.trust.decide(request);
        return json({
          classification: {
            tier: classification.tier,
            reasons: classification.reasons,
            requiredApprovalLevel: classification.requiredApprovalLevel,
            requiredCredentialMode: classification.requiredCredentialMode,
            network: classification.net,
            resources: classification.resources,
          },
          decision,
        });
      },
    }),
  ];
}
