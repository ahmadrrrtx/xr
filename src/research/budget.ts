/**
 * XR — research budget guard.
 *
 * Adapts XR's existing CostGovernor + BudgetManager to the research engine's
 * simple ResearchBudgetGuard interface. This keeps research budget enforcement
 * IDENTICAL to the rest of XR (same global monthly/daily caps, same per-task
 * ceiling, same pricing) instead of inventing a parallel system.
 *
 * Security rule honored: research never spends silently. Token usage is recorded
 * and surfaced through meter(); when a cap would be breached, allow() returns
 * false and the engine stops gracefully.
 */
import { CostGovernor, type Budget, type Pricing } from "../cost/governor.ts";
import { BudgetManager } from "../cost/manager.ts";
import type { Store } from "../state/db.ts";
import type { ResearchBudgetGuard } from "./engine.ts";

export class GovernedResearchBudget implements ResearchBudgetGuard {
  private gov: CostGovernor;
  private lastReason = "";

  constructor(store: Store, budget: Budget, pricing: Pricing) {
    this.gov = new CostGovernor(budget, pricing, new BudgetManager(store));
  }

  allow(): boolean {
    const decision = this.gov.checkBeforeStep();
    if (!decision.allow) {
      this.lastReason = decision.reason;
      return false;
    }
    return true;
  }

  record(inTokens: number, outTokens: number): void {
    this.gov.record(inTokens, outTokens);
  }

  meter(): string {
    return this.gov.meter();
  }

  reason(): string {
    return this.lastReason || "budget ceiling reached";
  }
}

/** A no-op guard for local/free models (no $ spend to govern, only a soft step cap). */
export class LocalResearchBudget implements ResearchBudgetGuard {
  private steps = 0;
  constructor(private maxSteps = 60) {}
  allow(): boolean {
    return this.steps++ < this.maxSteps;
  }
  record(): void {
    /* local = free */
  }
  meter(): string {
    return "💰 local · $0";
  }
  reason(): string {
    return `local step ceiling (${this.maxSteps}) reached`;
  }
}
