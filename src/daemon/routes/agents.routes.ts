/** XR Daemon — agents and workflow routes (live data, no fabricated agents). */

import { WorkflowRepo } from "../../state/repos/workflow-repo.ts";
import { route, sseResponse, type DaemonRoute, type DaemonState } from "./router.ts";
import { composeTeamView } from "./agents-view.ts";
import { Tokens } from "../../core/tokens.ts";
import type { MultiAgentService } from "../../services/multi-agent-service.ts";
import { CoreEvents } from "../../core/event-bus.ts";

/**
 * Phase 4 · team-run control plane — resolve the CANONICAL multi-agent service
 * through the kernel composition root. Routes never re-implement orchestration;
 * they forward verbs and render engine-composed snapshots (SEC-07).
 */
async function multiAgent(state: DaemonState): Promise<MultiAgentService | null> {
  if (!state.agentExecutor) return null;
  const app = await state.agentExecutor.ensureApp();
  return app.registry.resolve(Tokens.MultiAgents);
}

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
        const isView = path.endsWith("/view");
        const id = path.slice("/api/agents/workflows/".length, isView ? -"/view".length : undefined);
        const wfStore = new WorkflowRepo(state.store);
        const record = wfStore.getWorkflow(id);
        if (!record) return json({ error: "Workflow not found" }, 404);
        // /view = the engine-composed page snapshot (progress, cost roll-ups,
        // budget partitions per node, DAG tiers, control affordances).
        return isView ? json({ workflow: composeTeamView(record) }) : json(record);
      },
    }),
    route({
      id: "agents.workflow.create",
      path: "/api/agents/workflows",
      method: "POST",
      handle: async ({ json, req, state }) => {
        const svc = await multiAgent(state);
        if (!svc) return json({ error: "kernel unavailable" }, 503);
        const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
        const goal = String(body?.goal ?? "").trim();
        if (!goal) return json({ error: "goal is required" }, 400);
        const cwd = String((body as Record<string, unknown>)?.cwd ?? process.cwd());
        const planReq = {
          goal,
          cwd,
          kind: (body as Record<string, unknown>)?.kind as never,
          budget: Number((body as Record<string, unknown>)?.budget ?? 0) || undefined,
          maxTokens: Number((body as Record<string, unknown>)?.maxTokens ?? 0) || undefined,
          maxSteps: Number((body as Record<string, unknown>)?.maxSteps ?? 0) || undefined,
          dryRun: Boolean((body as Record<string, unknown>)?.dryRun ?? false),
        };
        const planned = svc.planWorkflow(planReq);
        if (planReq.dryRun) return json({ workflow: composeTeamView(planned) }, 201);
        // Detached execution: the run outlives the request; failures land in the
        // record's errors + audit trail, never in a dangling promise.
        void svc.runWorkflow(planReq).catch((err) => {
          const rec = svc.getWorkflow(planned.workflowId);
          if (rec) {
            rec.errors.push(`run.crashed: ${String((err as Error)?.message ?? err).slice(0, 300)}`);
            rec.status = rec.status === "completed" ? rec.status : "failed";
            rec.endedAt = Date.now();
          }
        });
        return json({ workflow: composeTeamView(svc.getWorkflow(planned.workflowId) ?? planned) }, 201);
      },
    }),
    route({
      id: "agents.workflow.control",
      prefix: "/api/agents/workflows/",
      method: "POST",
      handle: async ({ json, req, path, state }) => {
        if (!path.endsWith("/control")) return json({ error: "Not found" }, 404);
        const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
        const id = path.slice("/api/agents/workflows/".length, -"/control".length);
        const svc = await multiAgent(state);
        if (!svc) return json({ error: "kernel unavailable" }, 503);
        const action = String((body as Record<string, unknown>)?.action ?? "");
        const record = svc.getWorkflow(id);
        if (!record) return json({ error: "Workflow not found" }, 404);
        const view = composeTeamView(record);
        try {
          if (action === "pause") {
            if (!view.affordances.pause) return json({ error: `cannot pause a '${record.status}' workflow` }, 409);
            return json({ workflow: composeTeamView(svc.pauseWorkflow(id)) });
          }
          if (action === "resume") {
            if (!view.affordances.resume) return json({ error: `cannot resume a '${record.status}' workflow` }, 409);
            void svc.resumeWorkflow(id).catch(() => undefined);
            return json({ workflow: composeTeamView(svc.getWorkflow(id) ?? record) });
          }
          if (action === "cancel") {
            if (!view.affordances.cancel) return json({ error: `cannot cancel a '${record.status}' workflow` }, 409);
            return json({ workflow: composeTeamView(svc.stopWorkflow(id)) });
          }
          return json({ error: `unknown action '${action}'` }, 400);
        } catch (err) {
          return json({ error: String((err as Error)?.message ?? err) }, 409);
        }
      },
    }),
    route({
      id: "agents.events",
      path: "/api/agents/events",
      method: "GET",
      handle: async ({ state }) => {
        if (!state.agentExecutor) return sseResponse(new ReadableStream());
        const app = await state.agentExecutor.ensureApp();
        const events = app.registry.resolve(Tokens.Events);
        let cleanup: (() => void) | null = null;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const enc = new TextEncoder();
            const push = (payload: Record<string, unknown>) => {
              try {
                controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
              } catch {
                /* client gone */
              }
            };
            const offs = [
              CoreEvents.AgentTaskStarted,
              CoreEvents.AgentTaskReady,
              CoreEvents.AgentTaskBlocked,
              CoreEvents.AgentTaskCompleted,
              CoreEvents.AgentTaskFailed,
              CoreEvents.AgentTaskNote,
            ].map((name) => events.on(name, (payload: Record<string, unknown>) => push({ type: "task", name, ...payload })));
            const keepalive = setInterval(() => {
              try {
                controller.enqueue(enc.encode(": keepalive\n\n"));
              } catch {
                /* ignore */
              }
            }, 20_000);
            cleanup = () => {
              for (const off of offs) off();
              clearInterval(keepalive);
            };
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "hello" })}\n\n`));
          },
          cancel() {
            cleanup?.();
          },
        });
        return sseResponse(stream);
      },
    }),
  ];
}
