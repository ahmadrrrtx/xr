/**
 * XR Phase 08 — Capability Request abstraction.
 *
 * Models the "MODEL REQUESTS but never GRANTS" rule.
 * A request contains no authority to grant itself access.
 */

import type { CapabilityRequest, CapabilityDecision, CapabilityScope } from "./types.ts";
import type { Mode } from "../core/types.ts";

export function createCapabilityRequest(opts: {
  capabilityId: string;
  requestedBy?: string;
  runId?: string;
  sessionId?: string;
  scope?: CapabilityScope;
  workspaceId?: string;
  cwd?: string;
  arguments?: Record<string, unknown>;
  reason?: string;
  mode?: Mode;
}): CapabilityRequest {
  return {
    capabilityId: opts.capabilityId,
    requestedBy: opts.requestedBy ?? "model",
    runId: opts.runId,
    sessionId: opts.sessionId,
    scope: opts.scope,
    workspaceId: opts.workspaceId,
    cwd: opts.cwd ?? process.cwd(),
    arguments: opts.arguments ?? {},
    reason: opts.reason,
    mode: opts.mode ?? "agent",
  };
}

/**
 * Validate that a request does NOT contain self-grant authority.
 * It must not contain fields that would grant permissions, trust, lifecycle, etc.
 */
export function validateRequestNoSelfGrant(request: Record<string, unknown>): { ok: boolean; reason?: string } {
  const forbidden = [
    "grant",
    "permissions",
    "trust",
    "lifecycle",
    "allowlist",
    "enable",
    "disable",
    "quarantine",
    "certify",
    "approveSelf",
    "setTrust",
    "setLifecycle",
    "addToAllowlist",
    "grantedPermissions",
  ];
  for (const key of forbidden) {
    if (key in request) {
      // If it's the tool's own args that legitimately contain e.g. "permissions" as part of capability inspection, that's different.
      // But for capability request creation, args should not contain authority mutation.
      // We check top-level request, not args.
      if (key !== "arguments") {
        // For safety, any forbidden top-level key is denied.
        return { ok: false, reason: `request contains forbidden authority field: ${key}` };
      }
    }
  }
  const args = request.arguments as Record<string, unknown> | undefined;
  if (args) {
    const forbiddenInArgs = ["grant", "allowlist", "lifecycle", "trust", "permissions.grant", "enable", "disable"];
    for (const k of Object.keys(args)) {
      if (forbiddenInArgs.includes(k)) {
        return { ok: false, reason: `arguments contain forbidden authority field: ${k}` };
      }
    }
  }
  return { ok: true };
}

export type { CapabilityRequest, CapabilityDecision };
