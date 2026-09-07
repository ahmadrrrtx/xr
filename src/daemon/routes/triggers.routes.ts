/** XR Phase 9 — daemon trigger routes (list/create/pause). */
import { route, type DaemonRoute } from "./router.ts";
import { TriggerService } from "../../automation/triggers.ts";
import type { TriggerInput } from "../../automation/trigger-spec.ts";

export function triggerRoutes(): DaemonRoute[] {
  return [
    route({
      id: "triggers.list",
      path: "/api/triggers",
      method: "GET",
      handle: ({ json, state, config }) => {
        const svc = new TriggerService(state.store);
        const paused = Boolean(config.triggers?.pauseAll) || svc.isPausedAll();
        return json({
          pauseAll: paused,
          inflight: svc.inflightCount(),
          triggers: svc.list(),
        });
      },
    }),
    route({
      id: "triggers.create",
      path: "/api/triggers",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = (await req.json()) as TriggerInput;
          const svc = new TriggerService(state.store);
          const created = svc.create(body);
          return json({ ok: true, trigger: created });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "triggers.pause",
      path: "/api/triggers/pause",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = (await req.json().catch(() => ({}))) as { pauseAll?: boolean; actor?: string };
          const svc = new TriggerService(state.store);
          const pause = body.pauseAll !== false;
          if (pause) svc.pauseAll(body.actor ?? "daemon");
          else svc.resumeAll(body.actor ?? "daemon");
          return json({ ok: true, pauseAll: pause });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "triggers.get",
      prefix: "/api/triggers/",
      method: "GET",
      handle: ({ json, path, state }) => {
        const match = path.match(/^\/api\/triggers\/([^/]+)$/);
        if (!match) return null;
        const svc = new TriggerService(state.store);
        const t = svc.get(decodeURIComponent(match[1]!));
        if (!t) return json({ error: "not found" }, 404);
        return json({ trigger: t });
      },
    }),
  ];
}
