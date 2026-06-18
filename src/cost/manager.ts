/**
 * XR — Global Budget Manager.
 * Handles monthly/daily spend caps and usage accounting.
 * (TRD §3.1 / Spend Cap & Governance)
 */
import type { BudgetConfig } from "../state/stores/cost-store.ts";
import { colors as C } from "../interfaces/cli.ts";


export interface BudgetStore {
  getBudgetConfig(): { monthly_cap: number; daily_cap: number | null; warnings_enabled: boolean; auto_fallback: boolean } | null;
  setBudgetConfig(config: Partial<BudgetConfig> & { monthly_cap?: number }): void;
  getSpendForPeriod(startMs: number): number;
  clearCosts(): void;
}

export interface BudgetStatus {
  monthlySpend: number;
  monthlyCap: number;
  dailySpend: number;
  dailyCap: number | null;
  remainingMonthly: number;
  remainingDaily: number | null;
  percentUsed: number;
  isOverBudget: boolean;
  isNearCap: boolean;
}

export type BudgetCheckResult = 
  | { allow: true; warning?: string }
  | { allow: false; reason: string; suggestLocal: boolean };

export class BudgetManager {
  constructor(private store: BudgetStore) {}

  /**
   * Get the current global budget configuration.
   * Fallback to safe defaults if not set.
   */
  getConfig() {
    const cfg = this.store.getBudgetConfig();
    return cfg ?? {
      monthly_cap: 10.0,
      daily_cap: null,
      warnings_enabled: true,
      auto_fallback: true,
    };
  }

  /**
   * Check if a request with the estimated cost is allowed.
   */
  checkBudget(estCostUsd: number): BudgetCheckResult {
    const cfg = this.getConfig();
    const status = this.getStatus();

    // If local model, cost is 0, always allow.
    if (estCostUsd <= 0) return { allow: true };

    // Check hard caps
    if (status.monthlySpend + estCostUsd > status.monthlyCap) {
      return { 
        allow: false, 
        reason: `Monthly cap of $${status.monthlyCap} reached (Current: $${status.monthlySpend.toFixed(4)})`,
        suggestLocal: cfg.auto_fallback 
      };
    }

    if (status.dailyCap !== null && status.dailySpend + estCostUsd > status.dailyCap) {
      return { 
        allow: false, 
        reason: `Daily cap of $${status.dailyCap} reached (Current: $${status.dailySpend.toFixed(4)})`,
        suggestLocal: cfg.auto_fallback 
      };
    }

    // Check warnings
    if (cfg.warnings_enabled) {
      const thresholds = [0.95, 0.8, 0.5];
      for (const t of thresholds) {
        if (status.percentUsed >= t) {
          return { 
            allow: true, 
            warning: `Budget warning: ${Math.round(t * 100)}% of monthly cap used ($${status.monthlySpend.toFixed(4)} / $${status.monthlyCap})` 
          };
        }
      }
    }

    return { allow: true };
  }

  /**
   * Calculate current spending and budget status.
   */
  getStatus(): BudgetStatus {
    const cfg = this.getConfig();
    
    const now = Date.now();
    const startOfDay = new Date().setHours(0,0,0,0);
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

    const monthlySpend = this.store.getSpendForPeriod(startOfMonth);
    const dailySpend = this.store.getSpendForPeriod(startOfDay);

    return {
      monthlySpend,
      monthlyCap: cfg.monthly_cap,
      dailySpend,
      dailyCap: cfg.daily_cap,
      remainingMonthly: cfg.monthly_cap - monthlySpend,
      remainingDaily: cfg.daily_cap ? cfg.daily_cap - dailySpend : null,
      percentUsed: (monthlySpend / cfg.monthly_cap) * 100,
      isOverBudget: monthlySpend >= cfg.monthly_cap,
      isNearCap: monthlySpend >= cfg.monthly_cap * 0.8,
    };
  }

  /**
   * Update budget settings.
   */
  setMonthlyCap(amount: number): void {
    const cfg = this.getConfig();
    this.store.setBudgetConfig({ ...cfg, monthly_cap: amount });
  }

  setDailyCap(amount: number | null): void {
    const cfg = this.getConfig();
    this.store.setBudgetConfig({ ...cfg, daily_cap: amount });
  }

  setWarnings(enabled: boolean): void {
    const cfg = this.getConfig();
    this.store.setBudgetConfig({ ...cfg, warnings_enabled: enabled });
  }

  setAutoFallback(enabled: boolean): void {
    const cfg = this.getConfig();
    this.store.setBudgetConfig({ ...cfg, auto_fallback: enabled });
  }

  /**
   * Reset the budget.
   */
  resetSpending(): void {
    this.store.clearCosts(); 
  }
}
