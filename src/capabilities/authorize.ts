/**
 * XR Phase 8 — the single authorized Tool.run choke point.
 *
 * Production callers (agent loop, capability executor) MUST go through
 * `runAuthorized`. It verifies + consumes the grant, then invokes the tool.
 * Wrappers (MCP / plugin) additionally `bindGrant` as defense in depth.
 */

import type { Tool, ToolContext, ToolResult } from "../core/types.ts";
import {
  verifyAndConsumeGrant,
  type CapabilityGrant,
} from "./grant.ts";

export async function runAuthorized(
  tool: Tool,
  args: Record<string, unknown>,
  ctx: ToolContext,
  grant: CapabilityGrant | undefined,
  opts?: { capabilityId?: string; runId?: string },
): Promise<ToolResult> {
  const capabilityId = opts?.capabilityId ?? tool.name;
  const v = verifyAndConsumeGrant(grant, args, { capabilityId, runId: opts?.runId });
  if (!v.ok) {
    ctx.audit(`grant.${v.code}`, {
      capabilityId,
      reason: v.reason,
      grantId: grant?.grantId,
    });
    return { ok: false, output: `blocked: grant ${v.code}: ${v.reason}` };
  }
  return tool.run(args, { ...ctx, grant: v.grant });
}
