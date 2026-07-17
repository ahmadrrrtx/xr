import type { WorkspaceStore } from "../workspace-store.ts";
export type BudgetConfig = { monthly_cap:number; daily_cap:number|null; warnings_enabled:boolean; auto_fallback:boolean };
export class CostRepo {
  constructor(public readonly store: WorkspaceStore) {}
  recordCost(...args:Parameters<WorkspaceStore["recordCost"]>):void { this.store.recordCost(...args); }
  getBudgetConfig():BudgetConfig|null { return this.store.getBudgetConfig(); }
  setBudgetConfig(config:Partial<BudgetConfig> & {monthly_cap?:number}):void { this.store.setBudgetConfig(config as any); }
  getSpendForPeriod(start:number):number { return this.store.getSpendForPeriod(start); }
  costSummary():ReturnType<WorkspaceStore["costSummary"]> { return this.store.costSummary(); }
  clearCosts():void { this.store.clearCosts(); }
}
