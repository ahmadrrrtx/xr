import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listAgents, getAgentDefinition } from "../src/agents/registry.ts";
import { compileWorkflowPlan } from "../src/agents/planner.ts";
import { WorkflowStore } from "../src/state/stores/workflow-store.ts";
import { MultiAgentService } from "../src/services/multi-agent-service.ts";
import { Container } from "../src/core/container.ts";
import { EventBus } from "../src/core/event-bus.ts";
import { AuditStore } from "../src/state/stores/audit-store.ts";
import { Store } from "../src/state/db.ts";

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
  const store = new WorkflowStore(join(HOME, "workflows.db"));
  try {
    const plan = compileWorkflowPlan({
      goal: "Research package choices for this repo",
      cwd: process.cwd(),
    });
    store.saveWorkflow(plan);
    const loaded = store.getWorkflow(plan.workflowId);
    expect(loaded).not.toBeNull();
    expect(loaded!.workflowId).toBe(plan.workflowId);
    expect(loaded!.tasks.length).toBe(plan.tasks.length);

    const rows = store.listWorkflowSummaries(10);
    expect(rows.some((r) => r.workflowId === plan.workflowId)).toBe(true);
  } finally {
    store.close();
  }
});

test("multi-agent service can plan and request cancellation without execution", () => {
  const container = new Container();
  const workflowStore = new WorkflowStore(join(HOME, "service-workflows.db"));
  const auditStore = new AuditStore(join(HOME, "service-audit.db"));
  const legacyStore = new Store(join(HOME, "service-legacy.db"));
  const events = new EventBus();
  container.register("workflowStore", workflowStore);
  container.register("auditStore", auditStore);
  container.register("legacyStore", legacyStore);
  container.register("events", events);

  try {
    const svc = new MultiAgentService(container);
    const record = svc.planWorkflow({ goal: "Refactor the repo safely", cwd: process.cwd() });
    expect(record.status).toBe("planned");
    const stopped = svc.stopWorkflow(record.workflowId);
    expect(stopped.cancellationState).toBe("requested");
  } finally {
    workflowStore.close();
    auditStore.close();
    legacyStore.close();
  }
});
