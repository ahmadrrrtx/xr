/**
 * XR 5.1 — Desktop/application environment provider helpers.
 *
 * Desktop execution itself stays in control/executor (audited, per-OS
 * adapters). This provider adds capability gating, observation-backed target
 * evidence for coordinate actions, and honest unsupported-platform reporting.
 */
import { detectCapabilities } from "../../control/adapter.ts";
import { observeScreen } from "./vision.ts";
import type { Action } from "../../control/types.ts";
import type { EnvironmentObservation, EnvironmentSession } from "../types.ts";

/** Desktop actions that need keyboard/mouse injection tooling. */
const NEEDS_INPUT: ReadonlySet<Action["type"]> = new Set(["type", "click", "drag_drop", "move", "scroll", "key"]);
const NEEDS_WINDOWS: ReadonlySet<Action["type"]> = new Set(["focus"]);

export function desktopSupportFor(action: Action): { ok: boolean; reason?: string } {
  const caps = detectCapabilities();
  if (NEEDS_INPUT.has(action.type) && !caps.tools.keyboard) {
    return {
      ok: false,
      reason: `desktop input tooling unavailable: ${caps.missing.join("; ") || "keyboard/mouse backend missing"}`,
    };
  }
  if (NEEDS_WINDOWS.has(action.type) && !caps.tools.windows) {
    return {
      ok: false,
      reason: `window management tooling unavailable: ${caps.missing.join("; ") || "wmctrl/osascript missing"}`,
    };
  }
  if (action.type === "scroll" && caps.os !== "linux") {
    return { ok: false, reason: `scroll injection is not supported on ${caps.os} in this build` };
  }
  return { ok: true };
}

export function applicationSupportFor(): { ok: boolean; reason?: string } {
  const caps = detectCapabilities();
  if (!caps.tools.launcher) {
    return { ok: false, reason: `application launcher unavailable: ${caps.missing.join("; ") || "none"}` };
  }
  return { ok: true };
}

/**
 * Capture the observation a coordinate action will cite as evidence. The
 * caller attaches the returned observationId to the action request; the gate
 * enforces freshness (`staleAfterMs`).
 */
export async function captureTargetEvidence(session?: EnvironmentSession): Promise<EnvironmentObservation> {
  return observeScreen(session);
}
