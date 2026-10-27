/** Owner-facing limit synchronization with the SAME ledger used by CLI/runs.
 * The desktop guard may tighten admission, never waive/raise an engine cap as
 * a side effect of sending chat. Raising requires an explicit owner action. */
import type { BudgetSettings } from '../budget/types';
import type { EngineBudget } from './types';
export interface EngineLimitPatch {
  monthlyCap?: number;
  dailyCap?: number | null;
  perTaskUsd?: number;
}
export function ownerLimitPatch(s: BudgetSettings): EngineLimitPatch {
  if (
    ![s.monthlyLimit, s.dailyLimit, s.perRequestLimit].every(
      (n) => Number.isFinite(n) && n >= 0
    )
  )
    throw new Error('Invalid desktop admission limits; nothing sent');
  return {
    monthlyCap: s.monthlyLimit,
    dailyCap: s.dailyLimit > 0 ? s.dailyLimit : null,
    perTaskUsd: s.perRequestLimit,
  };
}
export function tighteningPatch(
  current: EngineBudget,
  s: BudgetSettings
): EngineLimitPatch {
  const desired = ownerLimitPatch(s),
    out: EngineLimitPatch = {};
  const monthly = current.persisted?.monthly_cap,
    daily = current.persisted?.daily_cap,
    task = current.config.perTaskUsd;
  if (
    typeof monthly !== 'number' ||
    !Number.isFinite(monthly) ||
    monthly < 0 ||
    (daily != null && (!Number.isFinite(daily) || daily < 0)) ||
    typeof task !== 'number' ||
    !Number.isFinite(task) ||
    task < 0
  )
    throw new Error(
      'Engine admission limits unavailable/invalid; nothing sent'
    );
  // Monthly zero is LOCAL-ONLY, not unlimited. Off/soft desktop controls never
  // increase the engine authority's limits. Daily/per-task zero means off.
  if ((s.hardCap || s.monthlyLimit === 0) && desired.monthlyCap! < monthly)
    out.monthlyCap = desired.monthlyCap;
  if (s.dailyLimit > 0 && (daily == null || s.dailyLimit < daily))
    out.dailyCap = s.dailyLimit;
  if (s.perRequestLimit > 0 && (task === 0 || s.perRequestLimit < task))
    out.perTaskUsd = s.perRequestLimit;
  return out;
}
