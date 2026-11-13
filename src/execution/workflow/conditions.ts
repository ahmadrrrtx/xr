/**
 * The condition kinds a branch node may carry (Preview 1 / D1).
 *
 * `expression` — a raw JavaScript string compiled with `new Function` — was
 * removed: it evaluated author-supplied source in the engine's own realm,
 * which is code execution wherever a workflow comes from an untrusted place.
 * Kept in its own module so `types.ts` (a waived >800 LOC file) does not grow.
 */
import type { BranchCondition } from "./types.ts";

export const BRANCH_CONDITION_TYPES = [
  "field_compare",
  "field_exists",
  "field_is_empty",
  "review_approved",
  "review_changes_requested",
  "approval_granted",
  "approval_denied",
] as const satisfies readonly BranchCondition["type"][];

/** True when a stored (possibly stale) condition kind is one we still evaluate. */
export function isSupportedCondition(type: string): boolean {
  return (BRANCH_CONDITION_TYPES as readonly string[]).includes(type);
}
