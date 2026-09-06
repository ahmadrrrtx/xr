/**
 * XR Phase 8 — test helper: build a ToolContext carrying a REAL capability
 * grant.
 *
 * Deliberately NOT a bypass. There is no "skip the grant check" switch in the
 * runtime and there must not be one in the tests either, because a test seam
 * that disables a security boundary is a security boundary that can be
 * disabled. This helper mints a genuine grant through the same registry the
 * policy engine uses, bound to the same arguments the test is about to pass.
 *
 * Consequences that tests rely on, and that are the point:
 *   · the grant is single-use — a test that calls the tool twice must mint
 *     twice, exactly like the agent loop does per tool call;
 *   · the grant is args-bound — a test that mutates args after minting will
 *     be denied, which is precisely the adversarial property under test.
 */

import { grants } from "../../src/capabilities/grant.ts";
import type { ToolContext } from "../../src/core/types.ts";

/**
 * Mint a grant for `capabilityId` + `args` and return a ToolContext carrying
 * it. `base` supplies the rest of the context (cwd, approve, audit, …).
 */
export function withGrant(
  base: ToolContext,
  capabilityId: string,
  args: Record<string, unknown>,
): ToolContext {
  const grant = grants.mint({ capabilityId, args, runId: "test-run" });
  return { ...base, grantId: grant.grantId };
}

/** Mint a grant and return only its id (for contexts built inline). */
export function mintTestGrant(capabilityId: string, args: Record<string, unknown>): string {
  return grants.mint({ capabilityId, args, runId: "test-run" }).grantId;
}
