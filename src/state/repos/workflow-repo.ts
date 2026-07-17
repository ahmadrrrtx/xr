import type { WorkspaceStore } from "../workspace-store.ts";
import type { MultiAgentHealth, WorkflowRecord, WorkflowSummary } from "../../agents/types.ts";
export class WorkflowRepo {
  constructor(public readonly store: WorkspaceStore) {}
  saveWorkflow(...a:Parameters<WorkspaceStore["saveWorkflow"]>):void { this.store.saveWorkflow(...a); }
  getWorkflow(...a:Parameters<WorkspaceStore["getWorkflow"]>):WorkflowRecord|null{return this.store.getWorkflow(...a)}
  listWorkflowSummaries(...a:Parameters<WorkspaceStore["listWorkflowSummaries"]>):WorkflowSummary[]{return this.store.listWorkflowSummaries(...a)}
  health():MultiAgentHealth{return this.store.workflowHealth()}
}
