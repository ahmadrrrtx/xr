import type { WorkspaceStore } from "../workspace-store.ts";
export class ProjectMemoryRepo {
  constructor(public readonly store: WorkspaceStore) {}
  remember(...args:Parameters<WorkspaceStore["remember"]>):void { this.store.remember(...args); }
  recall(...args:Parameters<WorkspaceStore["recall"]>):ReturnType<WorkspaceStore["recall"]>{ return this.store.recall(...args); }
  forget(...args:Parameters<WorkspaceStore["forget"]>):void { this.store.forget(...args); }
  count(...args:Parameters<WorkspaceStore["memoryCount"]>):number { return this.store.memoryCount(...args); }
  clearRag(...args:Parameters<WorkspaceStore["clearRag"]>):void { this.store.clearRag(...args); }
  insertChunk(...args:Parameters<WorkspaceStore["insertChunk"]>):void { this.store.insertChunk(...args); }
  allChunks(...args:Parameters<WorkspaceStore["allChunks"]>):ReturnType<WorkspaceStore["allChunks"]>{ return this.store.allChunks(...args); }
  ragCount(...args:Parameters<WorkspaceStore["ragCount"]>):number { return this.store.ragCount(...args); }
}
