import type { WorkspaceStore } from "../workspace-store.ts";
export type BudgetConfig = { monthly_cap:number; daily_cap:number|null; warnings_enabled:boolean; auto_fallback:boolean };
export class CostRepo {
  constructor(public readonly store: WorkspaceStore) {}
  recordCost(...args:Parameters<WorkspaceStore["recordCost"]>):void { this.store.recordCost(...args); }
  getBudgetConfig():BudgetConfig|null { return this.store.getBudgetConfig(); }
  setBudgetConfig(config:Partial<BudgetConfig> & {monthly_cap?:number}):void { this.store.setBudgetConfig(config as any); }
  getSpendForPeriod(start:number):number { return this.store.getSpendForPeriod(start); }
  spendBreakdown(start:number):SpendBreakdown { return spendBreakdown(this.store, start); }
  costSummary():ReturnType<WorkspaceStore["costSummary"]> { return this.store.costSummary(); }
  clearCosts():void { this.store.clearCosts(); }
}

/**
 * B7 — one documented rule: admission (`getSpendForPeriod`) counts ALL recorded spend, estimated usage
 * included, so a provider that reports no usage can never let a cap be overshot; reporting splits the
 * part priced from estimated token counts (usage_source='estimated': providers that omit usage, voice)
 * from provider-reported usage, so an estimate is never presented as reported spend.
 */
export interface SpendBreakdown { reported: number; estimated: number }
export function spendBreakdown(store: Pick<WorkspaceStore, "query">, startMs: number): SpendBreakdown {
  const row = store.query(`SELECT COALESCE(SUM(CASE WHEN usage_source = 'estimated' THEN 0 ELSE usd END), 0) AS reported, COALESCE(SUM(CASE WHEN usage_source = 'estimated' THEN usd ELSE 0 END), 0) AS estimated FROM cost_events WHERE created_at >= ?1`).get(startMs) as SpendBreakdown | null;
  return { reported: row?.reported ?? 0, estimated: row?.estimated ?? 0 };
}
