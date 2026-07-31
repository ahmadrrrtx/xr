/**
 * XR 5.1 — Environment classifier: control Action → environment profile.
 *
 * Deterministic. Reuses the audited control risk classifier as the risk base,
 * then derives interaction kind, environment compatibility, reversibility
 * CLASS (not a boolean), compensation spec, approval strength, and perception
 * requirements. Nothing a model says can widen these decisions.
 */
import type { Action } from "../../control/types.ts";
import { classify as controlClassify } from "../../control/classify.ts";
import {
  confidenceAtLeast,
  type EnvironmentAssessment,
  type EnvironmentActionRequest,
  type EnvironmentType,
  type InteractionKind,
  type Reversibility,
  type TargetIdentity,
} from "./types.ts";

/** Which control action types each environment accepts. Closed sets: no cross-talk. */
const ENV_ACTIONS: Record<EnvironmentType, ReadonlySet<Action["type"]>> = {
  browser: new Set(["browser"]),
  desktop: new Set(["type", "click", "drag_drop", "move", "scroll", "key", "wait_ms", "screenshot", "system", "computer_use"]),
  filesystem: new Set(["file"]),
  application: new Set(["app", "close", "focus", "open", "editor"]),
  // Voice is an interface: it never owns an action. Voice-sourced requests are
  // re-mapped to the action's real environment before reaching the classifier.
  voice: new Set(),
  // Vision perceives only. It never executes.
  vision: new Set(["screenshot"]),
};

export function environmentForAction(action: Action): EnvironmentType {
  switch (action.type) {
    case "browser":
      return "browser";
    case "file":
      return "filesystem";
    case "app":
    case "close":
    case "focus":
    case "open":
    case "editor":
      return "application";
    default:
      return "desktop";
  }
}

const COORDINATE_TYPES: ReadonlySet<Action["type"]> = new Set(["click", "drag_drop", "move"]);

export function interactionFor(action: Action, target: TargetIdentity): InteractionKind {
  switch (action.type) {
    case "click":
    case "drag_drop":
    case "move":
      return "coordinate";
    case "browser":
      // Playwright selectors (css/text=/role=) are semantic DOM interaction.
      return "semantic";
    case "file":
      return "structural";
    case "app":
    case "close":
    case "focus":
    case "editor":
    case "open":
      return target.kind === "application" || target.kind === "none" ? "semantic" : "structural";
    case "type":
    case "key":
    case "scroll":
    case "wait_ms":
    case "system":
      return target.kind === "semantic" ? "semantic" : "structural";
    case "screenshot":
    case "computer_use":
      return "stream";
  }
}

/**
 * Honest reversibility classes. The control classifier's boolean is a floor,
 * never a ceiling: a click the classifier calls "irreversible" is irreversible;
 * a click it would call reversible is STILL only `unknown` because the effect
 * depends on a target we cannot verify from here.
 */
export function reversibilityFor(action: Action, interaction: InteractionKind): Reversibility {
  const base = controlClassify(action);
  switch (action.type) {
    case "wait_ms":
    case "move":
    case "scroll":
    case "focus":
    case "screenshot":
      return "reversible";
    case "app":
    case "open":
    case "editor":
      return base.reversible ? "compensatable" : "irreversible";
    case "close":
      return "compensatable"; // relaunch — unsaved work may still be lost
    case "type":
    case "key":
      return base.reversible ? "compensatable" : "irreversible"; // in-app undo at best
    case "system": {
      if (action.op === "clipboard_write") return "compensatable";
      return base.reversible ? "reversible" : "irreversible";
    }
    case "click":
    case "drag_drop":
      // Pointer actions act on whatever happens to be at those coordinates when
      // the OS delivers the event. Whether the intended target was hit is a
      // perception question XR cannot certify from here: reversibility remains
      // unknown (and approval strength treats unknown as irreversible).
      return "unknown";
    case "browser": {
      if (action.op === "extract" || action.op === "screenshot" || action.op === "wait") return "reversible";
      if (action.op === "new_tab" || action.op === "close_tab" || action.op === "switch_tab") return "compensatable";
      if (action.op === "goto") return base.reversible ? "compensatable" : "irreversible";
      if (action.op === "close") return "reversible";
      // fill/type/press/click/upload/drag/submit: pre-submit change at best.
      return base.reversible ? "unknown" : "irreversible";
    }
    case "file": {
      if (action.op === "read" || action.op === "list") return "reversible";
      if (action.op === "move") return "compensatable";
      if (action.op === "write" || action.op === "mkdir") return "compensatable"; // pre-image/backup
      return "irreversible"; // delete
    }
    case "computer_use":
      return "unknown";
  }
}

export function compensationFor(action: Action, rev: Reversibility): EnvironmentAssessment["compensation"] {
  if (rev === "reversible") return { scope: "reversible_action", description: "effect is ephemeral or fully undoable by XR" };
  if (rev === "irreversible") return { scope: "none", description: "no rollback exists; effect may be permanent" };
  if (rev === "unknown") return { scope: "none", description: "reversibility cannot be established; treated as irreversible" };
  switch (action.type) {
    case "app":
    case "editor":
    case "open":
      return { scope: "best_effort", description: `close/quit what was opened (${"name" in action ? action.name : action.type})` };
    case "close":
      return { scope: "best_effort", description: "relaunch the closed application (unsaved state is not recovered)" };
    case "type":
    case "key":
      return { scope: "best_effort", description: "in-application undo where the target app supports it; not guaranteed" };
    case "system":
      return { scope: "best_effort", description: "restore prior clipboard value if captured beforehand" };
    case "browser":
      return { scope: "best_effort", description: "navigate back / clear the field before submission; post-submit effects are not compensatable" };
    case "file":
      return action.op === "move"
        ? { scope: "compensating_transaction", description: "move the entry back to its original path" }
        : { scope: "compensating_transaction", description: "restore the pre-image captured before write/mkdir" };
    default:
      return { scope: "best_effort", description: "best-effort compensation only" };
  }
}

/**
 * The environment gate assessment. Fails closed on:
 *  - action not accepted by the requested environment;
 *  - coordinate interaction without target evidence;
 *  - coordinate interaction with sub-medium perception confidence;
 *  - vision asked to execute anything other than observation.
 */
export function assessEnvironmentAction(request: EnvironmentActionRequest): EnvironmentAssessment {
  const action = request.action;
  const realEnv = request.environment === "voice" ? environmentForAction(action) : request.environment;
  const base = controlClassify(action);
  const target = request.target;
  const interaction = interactionFor(action, target);
  const reversibility = reversibilityFor(action, interaction);
  const compensation = compensationFor(action, reversibility);

  const assessment: EnvironmentAssessment = {
    request,
    interaction,
    risk: { level: base.level, reason: base.reason },
    reversibility,
    compensation,
    approval: "none",
    approvalReason: "safe action — no approval required",
  };

  // 1. Environment compatibility (closed world).
  if (request.environment === "vision") {
    assessment.blockedReason = "vision is an observation environment; it cannot execute actions — call observe() instead";
    return assessment;
  }
  if (!ENV_ACTIONS[request.environment === "voice" ? realEnv : request.environment].has(action.type)) {
    assessment.blockedReason = `action type '${action.type}' is not valid for the '${request.environment}' environment`;
    return assessment;
  }

  // 2. Coordinate proof requirements.
  if (interaction === "coordinate" || COORDINATE_TYPES.has(action.type)) {
    if (target.kind !== "coordinate" || !target.evidence.trim()) {
      assessment.blockedReason =
        "coordinate action requires a coordinate target with evidence (a fresh observation reference); semantic targets are preferred";
      return assessment;
    }
    if (!request.observationRef) {
      assessment.blockedReason = "coordinate action requires observationRef (the screenshot/vision observation it was derived from)";
      return assessment;
    }
    if (!confidenceAtLeast(request.confidence, "medium")) {
      assessment.blockedReason = `coordinate action requires at least medium perception confidence (got '${request.confidence}')`;
      return assessment;
    }
  }

  // 3. Approval strength.
  const sensitiveValue =
    (action.type === "type" && (action as { sensitive?: boolean }).sensitive) ||
    (action.type === "browser" && (action as { sensitive?: boolean }).sensitive);
  const uncertainPerception = request.confidence === "unknown" || request.confidence === "low";

  if (base.level === "safe" && reversibility === "reversible" && interaction !== "coordinate") {
    assessment.approval = "none";
    assessment.approvalReason = "safe and reversible";
  } else if (
    sensitiveValue ||
    reversibility === "irreversible" ||
    reversibility === "unknown" ||
    (interaction === "coordinate" && !confidenceAtLeast(request.confidence, "high"))
  ) {
    assessment.approval = "strong";
    assessment.approvalReason = sensitiveValue
      ? "sensitive value — explicit approval required; value stays redacted"
      : reversibility === "irreversible"
        ? "irreversible action — explicit approval required, auto-approval disabled"
        : reversibility === "unknown"
          ? "reversibility unknown — treated as irreversible; explicit approval required"
          : "coordinate action without high-confidence perception — explicit approval required";
  } else {
    assessment.approval = base.level === "safe" ? "none" : "standard";
    assessment.approvalReason =
      base.level === "safe" ? "safe action" : `${base.level} action — standard approval flow`;
  }

  // 4. User-visible uncertainty.
  if (uncertainPerception && (interaction === "coordinate" || action.type === "computer_use")) {
    assessment.uncertainty =
      `perception confidence is '${request.confidence}'; the visible state may differ from what XR believes`;
  }

  return assessment;
}
