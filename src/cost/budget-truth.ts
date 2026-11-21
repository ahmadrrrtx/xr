/**
 * B5/B6 — the budget facts a user must be able to see, shared by `xr doctor`
 * and `xr budget status`: which monthly cap is in force (XR's $10 safety
 * default or an explicit setting; 0 blocks all paid spend) and whether the
 * model price facts are past their review date (runs keep the last-known
 * rates; XR_STALE_PRICE_FACTS=refuse opts into refusal). The meaning of 0 is
 * documented once, in docs/budget-semantics.md.
 */
import { MODEL_FACTS_STALE_AT, MODEL_FACTS_VERIFIED_AT, modelFactsFresh } from "../core/model-registry.ts";

export const DEFAULT_MONTHLY_CAP_USD = 10;
export interface BudgetTruthCheck { id: string; label: string; state: "ok" | "warn"; detail: string }

export function capLine(cap: number, explicit: boolean): string {
  if (cap === 0) return "$0.00 — blocks ALL paid requests (local models still run)";
  return `$${cap.toFixed(2)}${explicit ? "" : " — XR's default safety cap (change: xr budget set <usd>)"}`;
}

export function budgetTruthChecks(monthlyCap: number, explicit: boolean, now = Date.now()): BudgetTruthCheck[] {
  const fresh = modelFactsFresh(now);
  return [
    { id: "budget-monthly-cap", label: "Monthly spend cap", state: monthlyCap === 0 ? "warn" : "ok", detail: capLine(monthlyCap, explicit) },
    { id: "price-facts", label: "Model price facts", state: fresh ? "ok" : "warn", detail: fresh
      ? `verified ${MODEL_FACTS_VERIFIED_AT}, review by ${MODEL_FACTS_STALE_AT.slice(0, 10)}`
      : `past review date (verified ${MODEL_FACTS_VERIFIED_AT}); runs use the last-known rates — set XR_STALE_PRICE_FACTS=refuse to refuse instead` },
  ];
}
