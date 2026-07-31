/** XR 5.1 Daemon — Environment Interaction OS routes (inspection + session mgmt). */

import {
  environmentStatus,
  environmentHistory,
  environmentDisabled,
  listEnvironmentSessions,
  closeEnvironmentSession,
  detectEnvironmentCapabilities,
} from "../../platform/environment/service.ts";
import { environmentObservations } from "../../platform/environment/observations.ts";
import { route, type DaemonRoute } from "./router.ts";

export function environmentRoutes(): DaemonRoute[] {
  return [
    route({
      id: "environment.status",
      path: "/api/environment/status",
      method: "GET",
      handle: async ({ json }) => json(await environmentStatus()),
    }),
    route({
      id: "environment.capabilities",
      path: "/api/environment/capabilities",
      method: "GET",
      handle: async ({ json }) => json(await detectEnvironmentCapabilities()),
    }),
    route({
      id: "environment.sessions",
      path: "/api/environment/sessions",
      method: "GET",
      handle: ({ json }) =>
        json({
          sessions: listEnvironmentSessions().map((s) => ({
            sessionId: s.sessionId,
            type: s.type,
            state: s.state,
            workspaceId: s.workspaceId,
            taskId: s.taskId ?? null,
            actionsPerformed: s.actionsPerformed,
            consecutiveFailures: s.consecutiveFailures,
            circuitOpenUntil: s.circuitOpenUntil ?? null,
            cleanupState: s.cleanupState,
            quarantineReason: s.quarantineReason ?? null,
            policy: s.policy,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          })),
        }),
    }),
    route({
      id: "environment.close",
      path: "/api/environment/close",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = (await req.json()) as { sessionId?: string };
          if (typeof body?.sessionId !== "string" || !body.sessionId) {
            return json({ error: "expected { sessionId: string }" }, 400);
          }
          const res = await closeEnvironmentSession(state.store, body.sessionId, "dashboard close request");
          state.store.audit("env.session.close_requested", { sessionId: body.sessionId, ok: res.ok });
          return json(res, res.ok ? 200 : 404);
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "environment.history",
      path: "/api/environment/history",
      method: "GET",
      handle: ({ json, url }) => {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
        return json({ records: environmentHistory(limit) });
      },
    }),
    route({
      id: "environment.observations",
      path: "/api/environment/observations",
      method: "GET",
      handle: ({ json }) =>
        json({
          observations: environmentObservations.list().map((o) => ({
            observationId: o.observationId,
            source: o.source,
            provenance: o.provenance,
            confidence: o.confidence,
            sensitivity: o.sensitivity,
            sessionId: o.sessionId ?? null,
            capturedAt: o.capturedAt,
            staleAfterMs: o.staleAfterMs,
            summary: o.summary,
            artifact: o.artifact ? { path: o.artifact.path, bytes: o.artifact.bytes } : null,
          })),
        }),
    }),
    route({
      id: "environment.policy",
      path: "/api/environment/policy",
      method: "GET",
      handle: ({ json, config }) =>
        json({
          disabled: environmentDisabled(),
          environment: config.environment ?? null,
        }),
    }),
  ];
}
