/** Workflow save (parent + tasks) in one transaction; crash before commit. */
import { WorkspaceStore } from "../../../src/state/workspace-store.ts";
const store = new WorkspaceStore("crash-wf", process.env.XR_DB!);
store.saveWorkflow({
  workflowId: "wf_crash", kind: "single", goal: "g", status: "running",
  reviewState: "none", approvalState: "none", cancellationState: "none",
  planSummary: "p",
  tasks: [
    { taskId: "t1", workflowId: "wf_crash", agentId: "a1", role: "r", name: "n",
      status: "pending", reviewState: "none", approvalState: "none",
      dependencies: [], createdAt: Date.now(), updatedAt: Date.now() },
  ],
  createdAt: Date.now(), updatedAt: Date.now(),
} as never);
store.close();
