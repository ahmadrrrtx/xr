/**
 * XR 6.1 — Policy layer definitions, invariants, and restrictiveness ordering.
 *
 * This module encodes the rules that make organization policy SAFE:
 *
 *   1. Safety-relevant settings resolve MOST RESTRICTIVE across all layers.
 *      A more privileged layer may tighten; nothing may loosen.
 *   2. User-visibility keys are NON-OVERRIDABLE. Any layer may turn them on;
 *      no layer may turn them off. Attempts are rejected and recorded.
 *   3. Non-safety preferences resolve MOST SPECIFIC.
 *
 * Rule 2 is the concrete implementation of the Phase 12 mandate that
 * "organization policy must not silently override user-visible safety".
 */

import {
  POLICY_LAYERS,
  POLICY_LAYER_PRIVILEGE,
  POLICY_LAYER_SPECIFICITY,
  NON_OVERRIDABLE_VISIBILITY_KEYS,
  isVisibilityKey,
  type PolicyLayer,
  type PolicyValue,
  type SafetyRelevantKey,
} from "../types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Safety-relevant key registry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How to compare two values of a safety-relevant key to decide which is more
 * restrictive. `restrictive` is the direction that reduces capability.
 *
 *   - "lower_is_stricter":  numeric, smaller value = tighter (e.g. budgets)
 *   - "higher_is_stricter": numeric, larger value = tighter (e.g. min tier)
 *   - "false_is_stricter":  boolean, false = tighter (e.g. allowNetworkEgress)
 *   - "true_is_stricter":   boolean, true = tighter (e.g. requireApproval)
 *   - "enum_order":         ordered enum, later index = tighter
 */
export type RestrictivenessKind =
  | "lower_is_stricter"
  | "higher_is_stricter"
  | "false_is_stricter"
  | "true_is_stricter"
  | "enum_order";

export interface SafetyKeySpec {
  readonly key: string;
  readonly kind: RestrictivenessKind;
  readonly description: string;
  /** For `enum_order`: values from least to most restrictive. */
  readonly order?: readonly string[];
  /** Floor that no layer may go below (already in restrictive terms). */
  readonly platformFloor?: PolicyValue;
}

const RISK_TIER_ENUM_ORDER = ["tier0_in_process", "tier1_restricted", "tier2_isolated"] as const;

/**
 * The registry of safety-relevant policy keys.
 *
 * Adding a key here automatically makes it resolve most-restrictive-wins and
 * makes any weakening attempt a recorded, rejected override.
 */
export const SAFETY_KEY_SPECS: Readonly<Record<SafetyRelevantKey, SafetyKeySpec>> = {
  minRiskTier: {
    key: "minRiskTier",
    kind: "enum_order",
    order: RISK_TIER_ENUM_ORDER,
    description: "Minimum isolation tier applied to any task. Higher = more isolated.",
  },
  requireApprovalAbove: {
    key: "requireApprovalAbove",
    kind: "enum_order",
    order: RISK_TIER_ENUM_ORDER,
    description:
      "Risk tier above which human approval is mandatory. Lower threshold = stricter, so ordering is inverted at compare time.",
  },
  allowNetworkEgress: {
    key: "allowNetworkEgress",
    kind: "false_is_stricter",
    description: "Whether tasks may make outbound network calls.",
  },
  allowFilesystemWrite: {
    key: "allowFilesystemWrite",
    kind: "false_is_stricter",
    description: "Whether tasks may write to the filesystem.",
  },
  allowProcessSpawn: {
    key: "allowProcessSpawn",
    kind: "false_is_stricter",
    description: "Whether tasks may spawn subprocesses.",
  },
  allowRemotePlacement: {
    key: "allowRemotePlacement",
    kind: "false_is_stricter",
    description: "Whether work may be placed on remote/cloud workers.",
  },
  allowUnsignedCapabilities: {
    key: "allowUnsignedCapabilities",
    kind: "false_is_stricter",
    description: "Whether capabilities without a valid signature may load.",
  },
  allowUncertifiedCapabilities: {
    key: "allowUncertifiedCapabilities",
    kind: "false_is_stricter",
    description: "Whether capabilities that failed certification may load.",
  },
};

/**
 * `requireApprovalAbove` is special: a LOWER threshold means MORE approvals,
 * which is stricter. We invert its enum comparison.
 */
const INVERTED_ENUM_KEYS = new Set<string>(["requireApprovalAbove"]);

export function isSafetyRelevantKey(key: string): key is SafetyRelevantKey {
  return Object.prototype.hasOwnProperty.call(SAFETY_KEY_SPECS, key);
}

export function getSafetyKeySpec(key: string): SafetyKeySpec | undefined {
  return isSafetyRelevantKey(key) ? SAFETY_KEY_SPECS[key] : undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// Restrictiveness comparison
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compare two values for a safety key.
 * @returns negative if `a` is LESS restrictive than `b`, positive if MORE,
 *          0 if equal or incomparable.
 */
export function compareRestrictiveness(spec: SafetyKeySpec, a: PolicyValue, b: PolicyValue): number {
  switch (spec.kind) {
    case "false_is_stricter": {
      const av = a === true ? 1 : 0;
      const bv = b === true ? 1 : 0;
      // false (0) is stricter → stricter means SMALLER numeric here, so invert.
      return bv - av;
    }
    case "true_is_stricter": {
      const av = a === true ? 1 : 0;
      const bv = b === true ? 1 : 0;
      return av - bv;
    }
    case "lower_is_stricter": {
      const av = typeof a === "number" ? a : Number.POSITIVE_INFINITY;
      const bv = typeof b === "number" ? b : Number.POSITIVE_INFINITY;
      return bv - av;
    }
    case "higher_is_stricter": {
      const av = typeof a === "number" ? a : Number.NEGATIVE_INFINITY;
      const bv = typeof b === "number" ? b : Number.NEGATIVE_INFINITY;
      return av - bv;
    }
    case "enum_order": {
      const order = spec.order ?? [];
      const ai = order.indexOf(String(a));
      const bi = order.indexOf(String(b));
      if (ai === -1 || bi === -1) return 0;
      const raw = ai - bi;
      return INVERTED_ENUM_KEYS.has(spec.key) ? -raw : raw;
    }
    default:
      return 0;
  }
}

/** Returns whichever of the two values is more restrictive. */
export function moreRestrictive(spec: SafetyKeySpec, a: PolicyValue, b: PolicyValue): PolicyValue {
  return compareRestrictiveness(spec, a, b) >= 0 ? a : b;
}

// ═══════════════════════════════════════════════════════════════════════════
// User-visibility invariants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The visibility invariant floor. Every one of these is `true` and no policy
 * layer — including `platform_default` — may resolve them to `false`.
 *
 * These correspond to roadmap §11: users must still see approvals, policy
 * effects, data scope, and action provenance.
 */
export const VISIBILITY_INVARIANT_FLOOR: Readonly<Record<string, true>> = Object.freeze(
  Object.fromEntries(NON_OVERRIDABLE_VISIBILITY_KEYS.map((k) => [k, true as const])),
);

export const VISIBILITY_KEY_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  showApprovalRequests: "Users always see approval requests that involve their work.",
  showPolicyEffects: "Users always see which policies restricted or altered an action.",
  showDataScope: "Users always see what data an action can read or write.",
  showActionProvenance: "Users always see which actor/capability performed an action.",
  showCapabilityTrust: "Users always see capability trust, signature, and quarantine state.",
  showIncidentImpact: "Users always see incidents that affect their workspace or data.",
});

/**
 * Determine whether a proposed value for a visibility key is an illegal
 * suppression attempt.
 */
export function isVisibilitySuppression(key: string, value: PolicyValue): boolean {
  if (!isVisibilityKey(key)) return false;
  return value !== true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer authority
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Whether an author operating at `authorLayer` may write a rule targeting
 * `targetLayer`. You may only author at or below your own privilege.
 */
export function canAuthorLayer(authorLayer: PolicyLayer, targetLayer: PolicyLayer): boolean {
  return POLICY_LAYER_PRIVILEGE[authorLayer] >= POLICY_LAYER_PRIVILEGE[targetLayer];
}

export function layerSpecificity(layer: PolicyLayer): number {
  return POLICY_LAYER_SPECIFICITY[layer];
}

export function layerPrivilege(layer: PolicyLayer): number {
  return POLICY_LAYER_PRIVILEGE[layer];
}

export function allPolicyLayers(): readonly PolicyLayer[] {
  return POLICY_LAYERS;
}

/**
 * Human-readable explanation of a layer, used by CLI/dashboard so admins and
 * users understand precedence without reading code.
 */
export const POLICY_LAYER_DESCRIPTIONS: Readonly<Record<PolicyLayer, string>> = Object.freeze({
  platform_default: "XR built-in defaults. The safety floor for every deployment.",
  deployment: "Set by the deployment operator (profile-level). Applies to the whole install.",
  organization: "Set by organization administrators. Applies to all workspaces in the org.",
  workspace: "Set by workspace administrators. Applies to one workspace or project.",
  user_task: "Set by the user for a specific task. May tighten, never loosen.",
  capability: "Declared by a capability about its own operation. Most specific, least privileged.",
});
