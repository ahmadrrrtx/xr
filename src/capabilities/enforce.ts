/**
 * XR Phase 8 · Step 1/2 — the GRANT ENFORCEMENT POINT.
 *
 * `grant.ts` defines and verifies the artifact. THIS module is the single
 * function every side-effecting execution path calls immediately before it
 * causes a side effect:
 *
 *     const gate = requireGrant(ctx, "shell", args);
 *     if (!gate.ok) return gate.denial;      // audited, honest, fail-closed
 *     …do the thing…
 *
 * Keeping enforcement in one named function is what makes the architecture
 * test possible: "every side-effecting path calls requireGrant" is a property
 * a call-site census can actually check, whereas "every path verifies somehow"
 * is a code-review opinion.
 *
 * ── Why this is not simply `grants.verifyAndConsume` ────────────────────────
 *
 * Three concerns belong together at the boundary and nowhere else:
 *   1. verification + single-use consumption (delegated to the registry),
 *   2. the AUDIT record of the outcome (`grant.verified` / `grant.mismatch`),
 *      written through the ToolContext so it lands in the hash chain,
 *   3. the COMPATIBILITY posture — what to do when no grant was threaded at
 *      all, which is the honest transition problem described below.
 *
 * ── The ungranted-path posture (read this before changing it) ───────────────
 *
 * Not every caller of a tool is the agent loop. Tests, `xr` subcommands that
 * invoke a tool directly, and embedders call `tool.run(args, ctx)` with a
 * hand-built context. If a missing grant were an unconditional hard denial,
 * this phase would break every one of those callers, and the pressure would be
 * to hand out a "bypass grant" helper — which is a bypass, i.e. the thing the
 * phase exists to remove.
 *
 * So the rule is explicit and asymmetric:
 *
 *   · A grant that is PRESENT and INVALID (mutated args, replayed, expired,
 *     wrong capability) is ALWAYS a denial. No flag relaxes this. This is the
 *     TOCTOU property and it is unconditional.
 *   · A grant that is ABSENT is a denial when the runtime is grant-enforcing
 *     (`ctx.hardened !== false`, i.e. the default, and the agent loop always
 *     threads one), and an audited, warned DEGRADED path otherwise.
 *
 * That gives the phase its real guarantee — "no executed action can differ
 * from the action that was authorized" — without pretending that every
 * embedding has been migrated on day one.
 */

import type { ToolContext, ToolResult } from "../core/types.ts";
import type { CapabilityScope } from "./types.ts";
import { grants, grantAuditFields, type CapabilityGrant, type GrantDenyReason } from "./grant.ts";

export type GrantGate =
  | { ok: true; grant?: CapabilityGrant; degraded: boolean }
  | { ok: false; reason: GrantDenyReason; detail: string; denial: ToolResult };

export interface RequireGrantOptions {
  /** Scope presented at execution (checked against the grant's scope). */
  scope?: CapabilityScope;
  /**
   * Force the strict posture regardless of `ctx.hardened` — used by paths that
   * are ALWAYS agent-driven and therefore always granted.
   */
  strict?: boolean;
}

/**
 * Verify (and consume) the grant authorizing this call.
 *
 * Returns a discriminated result rather than throwing: a denial is a normal,
 * reportable outcome of a tool call, and throwing would route it into the
 * generic `tool.error` path where it would read as a crash instead of a
 * refusal.
 */
export function requireGrant(
  ctx: ToolContext,
  capabilityId: string,
  args: Record<string, unknown>,
  opts: RequireGrantOptions = {},
): GrantGate {
  const strict = opts.strict === true || ctx.hardened !== false;

  if (!ctx.grantId) {
    if (!strict) {
      // Degraded, but never silent: the chain records that a side effect
      // happened without an args-binding, so an auditor can find it.
      safeAudit(ctx, "grant.absent", {
        capabilityId,
        note: "executed without a capability grant (non-hardened context); no args binding was enforced",
      });
      return { ok: true, degraded: true };
    }
    const detail = `no capability grant was presented for "${capabilityId}" — refusing to execute (hardened)`;
    safeAudit(ctx, "grant.mismatch", { capabilityId, reason: "unknown_grant", detail });
    return {
      ok: false,
      reason: "unknown_grant",
      detail,
      denial: { ok: false, output: `blocked: ${detail}` },
    };
  }

  const verdict = grants.verifyAndConsume(ctx.grantId, { capabilityId, args, scope: opts.scope });

  if (!verdict.ok) {
    safeAudit(ctx, "grant.mismatch", {
      capabilityId,
      grantId: ctx.grantId,
      reason: verdict.reason,
      detail: verdict.detail,
    });
    return {
      ok: false,
      reason: verdict.reason,
      detail: verdict.detail,
      denial: { ok: false, output: `blocked: ${verdict.detail}` },
    };
  }

  safeAudit(ctx, "grant.verified", grantAuditFields(verdict.grant));
  return { ok: true, grant: verdict.grant, degraded: false };
}

/**
 * An audit sink that throws (a corrupted chain, a closed store) must not turn
 * a security DECISION into an exception that unwinds past the boundary. The
 * decision stands; only the record of it is lost, and that loss is itself
 * loud at the chain level.
 */
function safeAudit(ctx: ToolContext, event: string, detail: Record<string, unknown>): void {
  try {
    ctx.audit(event, detail);
  } catch {
    /* the verdict is already computed; recording is best-effort */
  }
}
