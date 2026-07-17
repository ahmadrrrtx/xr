import type { WorkspaceStore } from "../workspace-store.ts";
export type Session = { id:string; title:string; mode:string; status:string; created_at:number };
export type Step = { id:string; session_id:string; idx:number; phase:string; tool:string|null; detail:string; created_at:number };
export class SessionRepo {
  constructor(public readonly store: WorkspaceStore) {}
  createSession(id:string,title:string,mode:string):void { this.store.createSession(id,title,mode); }
  endSession(id:string,status:"done"|"error"|"stopped"):void { this.store.endSession(id,status); }
  addStep(id:string,sessionId:string,idx:number,phase:string,tool:string|null,detail:unknown):void { this.store.addStep(id,sessionId,idx,phase,tool,detail); }
  recentSessions(limit=50):Session[] { return this.store.recentSessions(limit); }
}
