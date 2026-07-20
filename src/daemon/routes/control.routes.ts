/** XR Daemon — computer-control and plan-memory routes. */

import { approvals } from "../../control/approvals.ts";
import { listPermissions } from "../../control/permissions.ts";
import { isDisabled } from "../../control/service.ts";
import { planActions } from "../../control/planner.ts";
import { browserStatus } from "../../control/browser.ts";
import { buildProvider } from "../../providers/factory.ts";
import { listRemembered, forgetPlan, clearAllMemory } from "../../control/memory.ts";
import { route, type DaemonRoute } from "./router.ts";

export function controlRoutes(): DaemonRoute[] {
  return [
    route({
      id: "control.status",
      path: "/api/control/status",
      method: "GET",
      handle: async ({ json }) => {
        const kill = isDisabled();
        const { detectCapabilitiesAsync } = await import("../../control/adapter.ts");
        const caps = await detectCapabilitiesAsync();
        return json({
          enabled: !kill.disabled,
          disabledReason: kill.reason ?? null,
          capabilities: caps,
          browser: browserStatus(),
          pending: approvals.list().length,
        });
      },
    }),
    route({
      id: "control.events",
      path: "/api/control/events",
      method: "GET",
      handle: ({ json, url, state }) => {
        const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
        const all = state.store.recentAudit(limit * 4);
        const events = all
          .filter((e) => e.event.startsWith("control.") || e.event.startsWith("computer_control."))
          .slice(0, limit);
        return json({ events });
      },
    }),
    route({
      id: "control.pending",
      path: "/api/control/pending",
      method: "GET",
      handle: ({ json }) => json({ pending: approvals.list() }),
    }),
    route({
      id: "control.approve",
      path: "/api/control/approve",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = await req.json() as { id?: string; approved?: boolean };
          if (typeof body?.id !== "string" || typeof body?.approved !== "boolean") {
            return json({ error: "expected { id: string, approved: boolean }" }, 400);
          }
          const handled = approvals.answer(body.id, body.approved);
          state.store.audit(`control.approve.${body.approved ? "granted" : "denied"}`, { id: body.id });
          return json({ ok: handled });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "control.plan",
      path: "/api/control/plan",
      method: "POST",
      handle: async ({ req, json, state, config }) => {
        try {
          const body = await req.json() as { task?: string; noMemory?: boolean };
          if (!body?.task) return json({ error: "expected { task: string }" }, 400);
          const provider = buildProvider(config, {});
          const result = await planActions(provider, body.task, { store: state.store, noMemory: body.noMemory === true });
          if ("error" in result) return json({ error: result.error }, 422);
          return json({ plan: result.plan, source: result.source });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "control.memory.list",
      path: "/api/control/memory",
      method: "GET",
      handle: ({ json, state, config }) => json({
        enabled: config.control?.memory?.enabled !== false,
        entries: listRemembered(state.store).map((e) => ({
          baselineId: e.baselineId,
          skillId: e.skillId,
          task: e.task,
          steps: e.actions.length,
          hits: e.hits,
          rememberedAt: e.rememberedAt,
        })),
      }),
    }),
    route({
      id: "control.memory.delete",
      prefix: "/api/control/memory/",
      method: "DELETE",
      handle: ({ json, path, state }) => {
        const key = decodeURIComponent(path.slice("/api/control/memory/".length));
        if (key === "*" || key === "all") {
          const n = clearAllMemory(state.store);
          state.store.audit("control.memory.clear_all", { removed: n });
          return json({ ok: true, removed: n });
        }
        const r = forgetPlan(state.store, key);
        return json({ ok: r.ok, reason: r.reason }, r.ok ? 200 : 404);
      },
    }),
    route({
      id: "control.history.legacy",
      path: "/api/control/history",
      method: "GET",
      handle: ({ json, state }) => {
        const rows = state.store.recentAudit(120).filter((entry) => entry.event.startsWith("control."));
        return json({ rows });
      },
    }),
    route({
      id: "control.permissions.legacy",
      path: "/api/control/permissions",
      method: "GET",
      handle: ({ json }) => json({ granted: listPermissions() }),
    }),
  ];
}
