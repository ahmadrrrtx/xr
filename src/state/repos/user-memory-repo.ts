import type { WorkspaceStore, MemoryRow, SummaryRow } from "../workspace-store.ts";
export type UserMemoryRow = MemoryRow;
export class UserMemoryRepo {
  constructor(public readonly store: WorkspaceStore) {}
  insertMemory(...args:Parameters<WorkspaceStore["insertMemory"]>):void { this.store.insertMemory(...args); }
  setMemoryEmbedding(...args:Parameters<WorkspaceStore["setMemoryEmbedding"]>):void { this.store.setMemoryEmbedding(...args); }
  findMemoryByContent(...args:Parameters<WorkspaceStore["findMemoryByContent"]>):MemoryRow|null { return this.store.findMemoryByContent(...args); }
  getMemory(...args:Parameters<WorkspaceStore["getMemory"]>):MemoryRow|null { return this.store.getMemory(...args); }
  findMemoryByPrefix(...args:Parameters<WorkspaceStore["findMemoryByPrefix"]>):MemoryRow[] { return this.store.findMemoryByPrefix(...args); }
  listMemory(...args:Parameters<WorkspaceStore["listMemory"]>):MemoryRow[] { return this.store.listMemory(...args); }
  updateMemory(...args:Parameters<WorkspaceStore["updateMemory"]>):boolean { return this.store.updateMemory(...args); }
  deleteMemory(...args:Parameters<WorkspaceStore["deleteMemory"]>):boolean { return this.store.deleteMemory(...args); }
  clearMemory(...args:Parameters<WorkspaceStore["clearMemory"]>):number { return this.store.clearMemory(...args); }
  count():number { return this.store.userMemoryCount(); }
  stats(){ return this.store.userMemoryStats(); }
  recall(...args:Parameters<WorkspaceStore["recallUserMemory"]>):ReturnType<WorkspaceStore["recallUserMemory"]>{ return this.store.recallUserMemory(...args); }
  recallSemantic(...args:Parameters<WorkspaceStore["recallUserMemorySemantic"]>):ReturnType<WorkspaceStore["recallUserMemorySemantic"]>{ return this.store.recallUserMemorySemantic(...args); }
  insertSessionSummary(...args:Parameters<WorkspaceStore["insertSessionSummary"]>):void { this.store.insertSessionSummary(...args); }
  listSessionSummaries(...args:Parameters<WorkspaceStore["listSessionSummaries"]>):SummaryRow[] { return this.store.listSessionSummaries(...args); }
  deleteSessionSummary(...args:Parameters<WorkspaceStore["deleteSessionSummary"]>):boolean { return this.store.deleteSessionSummary(...args); }
  clearSessionSummaries(...args:Parameters<WorkspaceStore["clearSessionSummaries"]>):number { return this.store.clearSessionSummaries(...args); }
}
