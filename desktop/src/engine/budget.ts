import type { BudgetSettings } from '../budget/types';
import { ownerLimitPatch, tighteningPatch } from './budget-policy';
import { engineJson, enginePost } from './transport';
import type { EngineBudget } from './types';
export function readEngineBudget(): Promise<EngineBudget> {
  return engineJson<EngineBudget>('/budget');
}
/** Explicit owner action; never called implicitly to raise a limit. */
export async function applyOwnerEngineLimits(
  settings: BudgetSettings
): Promise<EngineBudget> {
  await enginePost('/budget/set', ownerLimitPatch(settings));
  return readEngineBudget();
}
export async function tightenEngineLimits(
  settings: BudgetSettings
): Promise<EngineBudget> {
  const current = await readEngineBudget();
  const patch = tighteningPatch(current, settings);
  if (Object.keys(patch).length)
    await enginePost('/budget/set', { ...patch, tightenOnly: true });
  return current;
}
