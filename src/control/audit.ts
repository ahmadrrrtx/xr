/**
 * XR v0.8 — Computer Control: audit-log adapter.
 *
 * Thin wrapper over Store.audit() that ensures every control event is
 * recorded with a consistent schema *and* that no raw secret ever lands in
 * the hash chain.  The Store already redacts obvious API keys, but typed
 * passwords aren't keys — they're whatever the user told us was sensitive —
 * so we redact them here, at the source.
 */

import type { Store } from "../state/db.ts";
import type { Action, ActionResult, RiskAssessment } from "./types.ts";

function redactAction(action: Action): Record<string, unknown> {
  if (action.type === "type" && action.sensitive) {
    return { type: "type", text: "«redacted»", length: action.text.length, sensitive: true };
  }
  return action as unknown as Record<string, unknown>;
}

export function auditPlanned(store: Store, action: Action, risk: RiskAssessment): void {
  store.audit("control.plan", {
    action: redactAction(action),
    risk: risk.level,
    reason: risk.reason,
  });
}

export function auditExecuted(
  store: Store,
  action: Action,
  risk: RiskAssessment,
  result: ActionResult,
): void {
  store.audit("control.exec", {
    action: redactAction(action),
    risk: risk.level,
    ok: result.ok,
    skipped: Boolean(result.skipped),
    message: result.message,
  });
}

export function auditDenied(store: Store, action: Action, risk: RiskAssessment): void {
  store.audit("control.denied", {
    action: redactAction(action),
    risk: risk.level,
    reason: risk.reason,
  });
}

export function auditDisabled(store: Store, action: Action): void {
  store.audit("control.disabled", {
    action: redactAction(action),
    reason: "computer control is disabled in config",
  });
}
