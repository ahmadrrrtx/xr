/** Explicit tariff for scripted in-process test adapters, never real providers.
 * Real policy/tools/audit/budgets still execute. Tests of unknown pricing pass
 * that unknown pricing explicitly and are NOT converted to free requests. */
import {
  runAgentLoop as actualLoop,
  type AgentDeps,
} from "../../src/core/agent";
import type { Mode } from "../../src/core/types";
export const SCRIPTED_TARIFF = {
  inPerMTok: 0,
  outPerMTok: 0,
  known: true,
  source: "synthetic in-process fixture; no provider billing",
};
export function runAgent(task: string, mode: Mode, deps: AgentDeps) {
  return actualLoop(task, mode, {
    ...deps,
    pricing: deps.pricing ?? { ...SCRIPTED_TARIFF },
  });
}
export const runAgentLoop = runAgent;
