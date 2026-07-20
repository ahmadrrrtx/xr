/** XR Daemon — agents and workflow routes. */

import { WorkflowRepo } from "../../state/repos/workflow-repo.ts";
import { route, type DaemonRoute } from "./router.ts";

export function agentsRoutes(): DaemonRoute[] {
  return [
    route({
      id: "agents.list",
      path: "/api/agents",
      method: "GET",
      handle: ({ json, state }) => {
        const wfStore = new WorkflowRepo(state.store);
        const health = wfStore.health();
        return json({
          agents: [
            { id: "supervisor", name: "Multi-Agent Supervisor" },
            { id: "planner", name: "Strategic Planner" },
            { id: "executor", name: "Action Executor" },
          ],
          workflows: health.workflows,
        });
      },
    }),
    route({
      id: "agents.workflow.get",
      prefix: "/api/agents/workflows/",
      method: "GET",
      handle: ({ json, path, state }) => {
        const id = path.slice("/api/agents/workflows/".length);
        const wfStore = new WorkflowRepo(state.store);
        const record = wfStore.getWorkflow(id);
        if (!record) return json({ error: "Workflow not found" }, 404);
        return json(record);
      },
    }),
  ];
}
