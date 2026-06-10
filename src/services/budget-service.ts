/**
 * XR — Budget Service
 * Manages spending caps, cost accounting, and governs per-task usage.
 */

import { CostStore } from "../state/stores/cost-store.ts";
import { BudgetManager, BudgetStatus } from "../cost/manager.ts";
import { CostGovernor, Budget, Pricing, CostSnapshot, GovernorDecision } from "../cost/governor.ts";
import { Container } from "../core/container.ts";
import { LifecycleHook } from "../core/lifecycle.ts";

export class BudgetService implements LifecycleHook {
  private container: Container;
  private budgetManager: BudgetManager;

  constructor(container: Container) {
    this.container = container;
    const costStore = this.container.resolve<CostStore>("costStore");
    this.budgetManager = new BudgetManager(costStore as any); 
    // Note: BudgetManager was written against old Store, cast to any for now 
    // but we'll fix the BudgetManager to use CostStore.
  }

  /**
   * Create a governor for a specific task.
   */
  createGovernor(budget: Budget, pricing: Pricing): CostGovernor {
    return new CostGovernor(budget, pricing, this.budgetManager);
  }

  /**
   * Get current global budget status.
   */
  getStatus(): BudgetStatus {
    return this.budgetManager.getStatus();
  }

  /**
   * Get current global budget config.
   */
  getConfig() {
    return this.budgetManager.getConfig();
  }

  /**
   * Set monthly spend cap.
   */
  setMonthlyCap(amount: number): void {
    this.budgetManager.setMonthlyCap(amount);
  }

  /**
   * Reset spending for the current period.
   */
  resetSpending(): void {
    this.budgetManager.resetSpending();
  }

  async onInit(): Promise<void> {}
  async onStart(): Promise<void> {}
  async onStop(): Promise<void> {}
}
