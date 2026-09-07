/**
 * XR Phase 8 — Plugin isolation placement.
 *
 * High-risk plugins (granted shell / control / browser) must leave the host
 * process (Tier-2). On Linux that means a namespace sandbox (bubblewrap) is
 * available; elsewhere — or without bwrap — they are refused. Fail closed.
 *
 * The plugin VM / worker_threads membrane is defense-in-depth, NOT a kernel
 * boundary (see src/plugins/loader/sandbox.ts). Placement here is the
 * honest gate: no bwrap → no high-risk plugin in the host process.
 */

import { PLUGIN_HARD_BOUNDARY_PERMS, type PluginPermTier } from "../runtime/trust/tool-support.ts";

export type PluginPlacement = "in_process" | "isolated" | "blocked";

export function grantedHardBoundaryPerms(granted: readonly string[]): string[] {
  return granted.filter((p) => (PLUGIN_HARD_BOUNDARY_PERMS as readonly string[]).includes(p));
}

/**
 * Pure placement decision. `effectiveTier` is recorded; only GRANTED
 * hard-boundary perms force isolation (declared ≠ authority).
 */
export function decidePluginPlacement(
  grantedHardBoundary: readonly string[],
  sandboxAvailable: boolean,
  _effectiveTier?: PluginPermTier,
): PluginPlacement {
  if (grantedHardBoundary.length === 0) return "in_process";
  if (sandboxAvailable) return "isolated";
  return "blocked";
}
