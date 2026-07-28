/**
 * XR 7.0 — Benchmark suite registry (Phase 13).
 *
 * The canonical, ordered list of suites. Every suite here calls real XR
 * contracts through their public barrels.
 */

import { TRUST_SUITE } from "./trust.ts";
import { CONTEXT_SUITE } from "./context.ts";
import { EXECUTION_SUITE, DURABILITY_SUITE } from "./execution.ts";
import { RUNTIME_SUITE, INTELLIGENCE_SUITE, ENVIRONMENT_SUITE, DEPLOYMENT_SUITE } from "./platform.ts";
import { WORKFLOW_SUITE, CAPABILITY_SUITE, BUSINESS_SUITE } from "./workflow.ts";
import { ENTERPRISE_SUITE, DX_SUITE, UX_SUITE } from "./enterprise.ts";
import type { SuiteDefinition } from "../types.ts";

export {
  TRUST_SUITE,
  CONTEXT_SUITE,
  EXECUTION_SUITE,
  DURABILITY_SUITE,
  RUNTIME_SUITE,
  INTELLIGENCE_SUITE,
  ENVIRONMENT_SUITE,
  DEPLOYMENT_SUITE,
  WORKFLOW_SUITE,
  CAPABILITY_SUITE,
  BUSINESS_SUITE,
  ENTERPRISE_SUITE,
  DX_SUITE,
  UX_SUITE,
};

/** Every shipped suite, ordered by platform layer. */
export const ALL_SUITES: readonly SuiteDefinition[] = Object.freeze([
  RUNTIME_SUITE,
  EXECUTION_SUITE,
  TRUST_SUITE,
  DURABILITY_SUITE,
  INTELLIGENCE_SUITE,
  CONTEXT_SUITE,
  WORKFLOW_SUITE,
  ENVIRONMENT_SUITE,
  CAPABILITY_SUITE,
  BUSINESS_SUITE,
  DEPLOYMENT_SUITE,
  ENTERPRISE_SUITE,
  DX_SUITE,
  UX_SUITE,
]);

export function getSuite(id: string): SuiteDefinition | undefined {
  return ALL_SUITES.find((s) => s.id === id);
}

export function listSuiteIds(): readonly string[] {
  return Object.freeze(ALL_SUITES.map((s) => s.id));
}

/** Total scenario count across all suites. */
export function totalScenarios(): number {
  return ALL_SUITES.reduce((n, s) => n + s.scenarios.length, 0);
}

/** Scenarios that can run with no network access at all. */
export function offlineScenarioIds(): readonly string[] {
  const ids: string[] = [];
  for (const s of ALL_SUITES) for (const sc of s.scenarios) if (sc.offlineCapable) ids.push(sc.id);
  return Object.freeze(ids);
}
