/** Shared, fail-closed locality predicate. Workspace and request policies are
 * intersected by the evaluator; a request can never weaken workspace policy. */
import type { Locality, PolicyConstraints } from "./types.ts";
export function localityAllowed(
  policy: PolicyConstraints["localityPolicy"] | string,
  locality: Locality | "unknown",
): boolean {
  switch (policy) {
    case "any":
      return true;
    case "local_only":
      return locality === "local";
    case "private_only":
    case "no_cloud":
      return locality === "local" || locality === "private";
    default:
      return false;
  }
}
