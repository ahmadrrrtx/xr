/**
 * XR — Budget Service
 * Manages spending caps, cost accounting, and governs per-task usage.
 */

import { CostRepo } from "../state/repos/cost-repo.ts";
import { BudgetManager, BudgetStatus } from "../cost/manager.ts";
import { CostGovernor, Budget, Pricing, CostSnapshot, GovernorDecision } from "../cost/governor.ts";
import { ServiceRegistry } from "../core/service-registry.ts";
import { LifecycleHook } from "../core/lifecycle.ts";
import { Tokens } from "../core/tokens.ts";

export class BudgetService implements LifecycleHook {
  private registry: ServiceRegistry;
  private budgetManager: BudgetManager;

  constructor(registry: ServiceRegistry) {
    this.registry = registry;
    const costStore = this.registry.resolve(Tokens.CostStore);
    this.budgetManager = new BudgetManager(costStore as any); 
    // Note: BudgetManager was written against old store, cast to any for now 
    // but we'll fix the BudgetManager to use CostRepo.
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
