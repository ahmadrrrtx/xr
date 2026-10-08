/**
 * Phase 19 — custom agents API (`$XR_HOME/agents/<id>.json`).
 *
 * Validation lives in src/agents/custom-store.ts so the CLI, the daemon and
 * imports all agree on what a valid agent is. There is deliberately no
 * `/test` endpoint: "Test" in the editor opens a real chat session pre-wired
 * with the agent (same path a user would take), nothing is simulated.
 */

import { CustomAgentNotFound, CustomAgentStore, CustomAgentValidationError, isCustomAgentId } from "../../agents/custom-store.ts";
import { allTools } from "../../tools/registry.ts";
import { problem, route, type DaemonRoute, type DaemonRouteContext } from "./router.ts";

const BASE = "/api/agents/custom";

let storeSingleton: CustomAgentStore | null = null;

/** One store per process (the directory follows XR_HOME at first use). */
export function customAgentStore(): CustomAgentStore {
  if (!storeSingleton) storeSingleton = new CustomAgentStore({ knownTools: allTools().map((t) => t.name) });
  return storeSingleton;
}

/** Test seam. */
export function resetCustomAgentStoreForTests(): void {
  storeSingleton = null;
}

function fail(err: unknown): Response {
  if (err instanceof CustomAgentValidationError) return problem(422, "Unprocessable Entity", "agent is not valid", err.problems);
  if (err instanceof CustomAgentNotFound) return problem(404, "Not Found", err.message);
  return problem(500, "Internal Server Error", err instanceof Error ? err.message : String(err));
}

async function body(req: Request): Promise<unknown> {
  return (await req.json().catch(() => null)) ?? {};
}

function idFrom(path: string, suffix = ""): string | null {
  const rest = decodeURIComponent(path.slice(BASE.length + 1, suffix ? -suffix.length : undefined));
  return rest && !rest.includes("/") && isCustomAgentId(rest) ? rest : null;
}

export function customAgentsRoutes(): DaemonRoute[] {
  return [
    route({
      id: "agents.custom.list",
      path: BASE,
      method: "GET",
      handle: ({ json }: DaemonRouteContext) => json({ agents: customAgentStore().list() }),
    }),
    route({
      id: "agents.custom.create",
      path: BASE,
      method: "POST",
      handle: async ({ req, json, state }: DaemonRouteContext) => {
        try {
          const agent = customAgentStore().create(await body(req));
          state.store.audit("agent.custom.created", { id: agent.id, name: agent.name, tools: agent.tools });
          return json({ agent }, 201);
        } catch (err) {
          return fail(err);
        }
      },
    }),
    route({
      id: "agents.custom.import",
      path: `${BASE}/import`,
      method: "POST",
      handle: async ({ req, json, state }: DaemonRouteContext) => {
        try {
          const agent = customAgentStore().import(await body(req));
          state.store.audit("agent.custom.imported", { id: agent.id, name: agent.name, tools: agent.tools });
          return json({ agent }, 201);
        } catch (err) {
          return fail(err);
        }
      },
    }),
    route({
      id: "agents.custom.get",
      prefix: `${BASE}/`,
      pattern: /^\/api\/agents\/custom\/[^/]+$/,
      method: "GET",
      handle: ({ json, path }: DaemonRouteContext) => {
        const id = idFrom(path);
        const agent = id ? customAgentStore().get(id) : undefined;
        if (!agent) return problem(404, "Not Found", "custom agent not found");
        return json({ agent });
      },
    }),
    route({
      id: "agents.custom.update",
      prefix: `${BASE}/`,
      pattern: /^\/api\/agents\/custom\/[^/]+$/,
      method: "PATCH",
      handle: async ({ req, json, path, state }: DaemonRouteContext) => {
        const id = idFrom(path);
        if (!id) return problem(404, "Not Found", "custom agent not found");
        try {
          const agent = customAgentStore().update(id, await body(req));
          state.store.audit("agent.custom.updated", { id: agent.id, version: agent.version, tools: agent.tools });
          return json({ agent });
        } catch (err) {
          return fail(err);
        }
      },
    }),
    route({
      id: "agents.custom.delete",
      prefix: `${BASE}/`,
      pattern: /^\/api\/agents\/custom\/[^/]+$/,
      method: "DELETE",
      handle: ({ json, path, state }: DaemonRouteContext) => {
        const id = idFrom(path);
        if (!id || !customAgentStore().remove(id)) return problem(404, "Not Found", "custom agent not found");
        state.store.audit("agent.custom.deleted", { id });
        return json({ ok: true });
      },
    }),
    route({
      id: "agents.custom.duplicate",
      prefix: `${BASE}/`,
      pattern: /^\/api\/agents\/custom\/[^/]+\/duplicate$/,
      method: "POST",
      handle: async ({ req, json, path, state }: DaemonRouteContext) => {
        const id = idFrom(path, "/duplicate");
        if (!id) return problem(404, "Not Found", "custom agent not found");
        try {
          const b = (await body(req)) as { name?: unknown };
          const agent = customAgentStore().duplicate(id, typeof b.name === "string" && b.name.trim() ? b.name.trim() : undefined);
          state.store.audit("agent.custom.created", { id: agent.id, name: agent.name, tools: agent.tools, duplicatedFrom: id });
          return json({ agent }, 201);
        } catch (err) {
          return fail(err);
        }
      },
    }),
  ];
}
