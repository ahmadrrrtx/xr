import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listAgents, getAgentDefinition } from "../src/agents/registry.ts";
import { compileWorkflowPlan } from "../src/agents/planner.ts";
// 0.2 Storage Unification: repos are views over the single WorkspaceStore.
import { WorkspaceStore } from "../src/state/workspace-store.ts";
import { WorkflowRepo } from "../src/state/repos/workflow-repo.ts";
import { AuditRepo } from "../src/state/repos/audit-repo.ts";
// 0.6 Runtime/DI cleanup: typed ServiceRegistry replaces the legacy Container.
import { ServiceRegistry } from "../src/core/service-registry.ts";
import { Tokens } from "../src/core/tokens.ts";
import { EventBus } from "../src/core/event-bus.ts";
import { MultiAgentService } from "../src/services/multi-agent-service.ts";

let HOME: string;

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "xr-ma-"));
});

test("multi-agent registry exposes the required core roles", () => {
  const agents = listAgents({ includeDisabled: true });
  const ids = new Set(agents.map((a) => a.id));
  for (const id of [
    "supervisor",
    "planner",
    "researcher",
    "builder",
    "reviewer",
    "executor",
    "synthesizer",
    "memory-manager",
    "router",
    "model-selector",
    "security-checker",
  ]) {
    expect(ids.has(id)).toBe(true);
  }
  expect(getAgentDefinition("builder")?.toolScope.tools).toContain("write_file");
  expect(getAgentDefinition("reviewer")?.toolScope.tools).not.toContain("write_file");
});

test("workflow compiler creates explicit review + synthesis stages for build work", () => {
  const plan = compileWorkflowPlan({
    goal: "Implement a new TypeScript feature in this repository",
    cwd: process.cwd(),
  });
  expect(plan.kind).toBe("build");
  expect(plan.tasks.some((t) => t.role === "builder")).toBe(true);
  expect(plan.tasks.some((t) => t.role === "reviewer")).toBe(true);
  expect(plan.tasks.some((t) => t.role === "security_checker")).toBe(true);
  expect(plan.tasks.some((t) => t.role === "synthesizer")).toBe(true);

  const parallel = plan.tasks.filter((t) => t.parallelKey === "analysis");
  expect(parallel.length).toBe(2);

  const synth = plan.tasks.find((t) => t.role === "synthesizer");
  expect(synth).toBeDefined();
  expect(synth!.dependencies.length).toBeGreaterThan(0);
});

test("workflow store persists and reloads task graphs", () => {
  const store = new WorkspaceStore(join(HOME, "workflows.db"));
  const workflows = new WorkflowRepo(store);
  try {
    const plan = compileWorkflowPlan({
      goal: "Research package choices for this repo",
      cwd: process.cwd(),
    });
    workflows.saveWorkflow(plan);
    const loaded = workflows.getWorkflow(plan.workflowId);
    expect(loaded).not.toBeNull();
    expect(loaded!.workflowId).toBe(plan.workflowId);
    expect(loaded!.tasks.length).toBe(plan.tasks.length);

    const rows = workflows.listWorkflowSummaries(10);
    expect(rows.some((r) => r.workflowId === plan.workflowId)).toBe(true);
  } finally {
    store.close();
  }
});

test("multi-agent service can plan and request cancellation without execution", () => {
  const registry = new ServiceRegistry();
  // One unified store; the repos and services are views over it.
  const store = new WorkspaceStore(join(HOME, "service.db"));
  const workflowStore = new WorkflowRepo(store);
  const auditStore = new AuditRepo(store);
  const events = new EventBus();
  registry.registerValue(Tokens.Store, store);
  registry.registerValue(Tokens.WorkflowStore, workflowStore);
  registry.registerValue(Tokens.AuditStore, auditStore);
  registry.registerValue(Tokens.Events, events);

  try {
    const svc = new MultiAgentService(registry);
    const record = svc.planWorkflow({ goal: "Refactor the repo safely", cwd: process.cwd() });
    expect(record.status).toBe("planned");
    const stopped = svc.stopWorkflow(record.workflowId);
    expect(stopped.cancellationState).toBe("requested");
  } finally {
    store.close();
  }
});
