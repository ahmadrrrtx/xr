/** XR Daemon — XR Shield routes. */

import { route, type DaemonRoute } from "./router.ts";

export function shieldRoutes(): DaemonRoute[] {
  return [
    route({
      id: "shield.status",
      path: "/api/shield/status",
      method: "GET",
      handle: async ({ json, state }) => json({
        state: state.shield.getState(),
        score: await state.shield.getPrivacyScore(),
        activeModules: ["Process Inspector", "Startup & Persist", "Privacy Advisor", "Ad & Tracker Filter", "Forensic Quarantine"],
      }),
    }),
    route({
      id: "shield.scan",
      path: "/api/shield/scan",
      method: "GET",
      handle: async ({ json, url, state }) => {
        const mode = url.searchParams.get("mode") === "full" ? "full" : "quick";
        return json({ threats: await state.shield.runScan(mode) });
      },
    }),
    route({ id: "shield.processes", path: "/api/shield/processes", method: "GET", handle: async ({ json, state }) => json({ processes: await state.shield.getSystemProcesses() }) }),
    route({ id: "shield.startup", path: "/api/shield/startup", method: "GET", handle: async ({ json, state }) => json({ startup: await state.shield.getStartupEntries() }) }),
    route({
      id: "shield.privacy",
      path: "/api/shield/privacy",
      method: "GET",
      handle: async ({ json, state }) => json({
        score: await state.shield.getPrivacyScore(),
        telemetry: await state.shield.checkTelemetry(),
        adBlock: state.shield.getHostsAdBlockData(),
      }),
    }),
    route({ id: "shield.downloads", path: "/api/shield/downloads", method: "GET", handle: async ({ json, state }) => json({ downloads: await state.shield.getDownloads() }) }),
    route({ id: "shield.browser", path: "/api/shield/browser", method: "GET", handle: async ({ json, state }) => json({ browser: await state.shield.getBrowserSecurity() }) }),
    route({
      id: "shield.explain",
      path: "/api/shield/explain",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = await req.json() as { id?: string };
          if (!body?.id) return json({ error: "id parameter required" }, 400);
          const threats = await state.shield.runScan("full");
          const threat = threats.find((t) => t.id === body.id);
          if (!threat) return json({ error: "threat not found" }, 404);
          return json({ analysis: state.shield.analyzeThreatWithAgent(threat.agent, threat) });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "shield.quarantine",
      path: "/api/shield/quarantine",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = await req.json() as { action: "isolate" | "restore" | "delete"; id: string; threat?: any };
          if (!body?.action || !body?.id) return json({ error: "action and id required" }, 400);
          if (body.action === "isolate") return json({ ok: state.shield.quarantineItem(body.id, body.threat) });
          if (body.action === "restore") return json({ ok: state.shield.restoreQuarantinedItem(body.id) });
          if (body.action === "delete") {
            const shieldState = state.shield.getState();
            shieldState.quarantined = shieldState.quarantined.filter((q) => q.id !== body.id);
            state.shield["saveState"]();
            return json({ ok: true });
          }
          return json({ error: "invalid action" }, 400);
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "shield.whitelist",
      path: "/api/shield/whitelist",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = await req.json() as { action: "add" | "remove"; type: string; value: string };
          if (!body?.action || !body?.type || !body?.value) return json({ error: "action, type, and value required" }, 400);
          if (body.action === "add") return json({ ok: state.shield.whitelistItem(body.type, body.value) });
          if (body.action === "remove") return json({ ok: state.shield.removeWhitelistItem(body.value) });
          return json({ error: "invalid action" }, 400);
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "shield.adblock",
      path: "/api/shield/adblock",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = await req.json() as { enable: boolean };
          const success = await state.shield.toggleAdBlock(body.enable);
          return json({ ok: success, active: state.shield.getState().adBlockEnabled });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
  ];
}
