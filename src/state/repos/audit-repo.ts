import type { WorkspaceStore } from "../workspace-store.ts";
export type AuditEntry = { id:number; session_id:string|null; event:string; detail:string; prev_hash:string; hash:string; created_at:number };
export class AuditRepo {
  constructor(public readonly store: WorkspaceStore) {}
  audit(event:string, detail:Record<string,unknown>, sessionId:string|null=null):string { return this.store.audit(event,detail,sessionId); }
  verifyChain():{valid:boolean;brokenAt?:number}{ return this.store.verifyChain(); }
  count():number { return this.store.auditCount(); }
  recent(limit=50):AuditEntry[] { return this.store.recentAudit(limit) as AuditEntry[]; }
}
