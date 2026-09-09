/** XR Daemon — agents and workflow routes (live data, no fabricated agents). */

import { WorkflowRepo } from "../../state/repos/workflow-repo.ts";
import { route, type DaemonRoute } from "./router.ts";

/**
 * The built-in orchestration ROLES XR ships (static, honest product facts —
 * clearly labelled as built-ins, never presented as user-created agents).
 * Live multi-agent WORK is represented by workflow records below.
 */
const BUILTIN_ROLES = [
  {
    id: "supervisor",
    name: "Supervisor",
    purpose: "Plans a workflow, delegates tasks to workers, aggregates results.",
    builtin: true,
  },
  {
    id: "planner",
    name: "Planner",
    purpose: "Decomposes a goal into an executable task graph (plan mode).",
    builtin: true,
  },
  {
    id: "executor",
    name: "Executor",
    purpose: "Runs delegated tasks with the agent loop under the same approvals, budget and audit gates.",
    builtin: true,
  },
] as const;

export function agentsRoutes(): DaemonRoute[] {
  return [
    route({
      id: "agents.list",
      path: "/api/agents",
      method: "GET",
      handle: ({ json, state }) => {
        const wfStore = new WorkflowRepo(state.store);
        const health = wfStore.health();
        const workflows = wfStore.listWorkflowSummaries(25).map((w) => ({
          id: w.workflowId,
          kind: w.kind,
          goal: w.goal,
          status: w.status,
          reviewState: w.reviewState,
          approvalState: w.approvalState,
          createdAt: w.createdAt,
          updatedAt: w.updatedAt,
          tasks: {
            total: w.tasksTotal,
            completed: w.tasksCompleted,
            failed: w.tasksFailed,
            blocked: w.tasksBlocked,
            awaitingReview: w.tasksAwaitingReview,
          },
        }));
        return json({
          // Static, honest product facts (built-in roles — not user agents).
          roles: BUILTIN_ROLES,
          // Live multi-agent work.
          workflows,
          health,
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
