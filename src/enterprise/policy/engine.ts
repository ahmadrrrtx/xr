/**
 * XR 6.1 — Policy resolution engine.
 *
 * Resolves rules from six layers into one `EffectivePolicy` with a full,
 * inspectable decision trace.
 *
 * Guarantees enforced here:
 *   - Safety-relevant keys resolve most-restrictive-wins across ALL layers.
 *   - User-visibility keys can never be resolved to a suppressed value.
 *   - Every rejected weakening attempt is returned in `rejectedOverrides`
 *     (never dropped), so it can be audited and surfaced.
 *   - Every effective value carries the layer and reason that produced it.
 */

import {
  POLICY_ENGINE_VERSION,
  isVisibilityKey,
  type EffectivePolicy,
  type PolicyDecisionEntry,
  type PolicyLayer,
  type PolicyOverrideAttempt,
  type PolicyResolution,
  type PolicyResolutionReason,
  type PolicyRule,
  type PolicyValue,
} from "../types.ts";
import {
  VISIBILITY_INVARIANT_FLOOR,
  compareRestrictiveness,
  getSafetyKeySpec,
  isSafetyRelevantKey,
  isVisibilitySuppression,
  layerSpecificity,
} from "./layers.ts";

export interface ResolvePolicyOptions {
  readonly organizationId?: string;
  readonly workspaceId?: string;
  readonly now?: number;
  /** Defaults applied when no layer supplies a key. */
  readonly defaults?: Readonly<Record<string, PolicyValue>>;
}

interface Candidate {
  readonly layer: PolicyLayer;
  readonly value: PolicyValue;
  readonly rule: PolicyRule;
}

/**
 * Resolve a set of policy rules into an effective policy.
 *
 * Pure and deterministic: same rules + same options → same resolution.
 */
export function resolvePolicy(
  rules: readonly PolicyRule[],
  options: ResolvePolicyOptions = {},
): PolicyResolution {
  const now = options.now ?? Date.now();
  const rejectedOverrides: PolicyOverrideAttempt[] = [];

  // ── 1. Filter rules to those in scope ────────────────────────────────────
  const inScope = rules.filter((r) => ruleInScope(r, options));

  // ── 2. Group by key ──────────────────────────────────────────────────────
  const byKey = new Map<string, Candidate[]>();
  for (const rule of inScope) {
    const list = byKey.get(rule.key) ?? [];
    list.push({ layer: rule.layer, value: rule.value, rule });
    byKey.set(rule.key, list);
  }

  // Visibility invariants always participate, even with no rule authored.
  for (const key of Object.keys(VISIBILITY_INVARIANT_FLOOR)) {
    if (!byKey.has(key)) byKey.set(key, []);
  }

  // Defaults participate so that every known key gets an entry.
  for (const key of Object.keys(options.defaults ?? {})) {
    if (!byKey.has(key)) byKey.set(key, []);
  }

  // ── 3. Resolve each key ──────────────────────────────────────────────────
  const entries: PolicyDecisionEntry[] = [];
  for (const [key, candidates] of [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    entries.push(resolveKey(key, candidates, options, rejectedOverrides, now));
  }

  return {
    engineVersion: POLICY_ENGINE_VERSION,
    resolvedAt: now,
    entries,
    rejectedOverrides,
    organizationId: options.organizationId,
    workspaceId: options.workspaceId,
  };
}

function ruleInScope(rule: PolicyRule, options: ResolvePolicyOptions): boolean {
  if (rule.organizationId && options.organizationId && rule.organizationId !== options.organizationId) {
    return false;
  }
  if (rule.workspaceId && options.workspaceId && rule.workspaceId !== options.workspaceId) {
    return false;
  }
  // A workspace-scoped rule cannot apply when no workspace context is given.
  if (rule.workspaceId && !options.workspaceId) return false;
  return true;
}

function resolveKey(
  key: string,
  candidates: readonly Candidate[],
  options: ResolvePolicyOptions,
  rejectedOverrides: PolicyOverrideAttempt[],
  now: number,
): PolicyDecisionEntry {
  // ── Case A: non-overridable user-visibility invariant ────────────────────
  if (isVisibilityKey(key)) {
    const trace: PolicyDecisionEntry["candidates"] = candidates.map((c) => {
      const suppression = isVisibilitySuppression(key, c.value);
      if (suppression) {
        rejectedOverrides.push({
          key,
          layer: c.layer,
          attemptedValue: c.value,
          rejectedBecause:
            "User-visibility invariant cannot be disabled by any policy layer. " +
            "Administrators may not hide safety-relevant information from users.",
          authoredBy: c.rule.authoredBy,
          at: now,
          severity: "critical",
        });
      }
      return {
        layer: c.layer,
        value: c.value,
        applied: !suppression,
        why: suppression
          ? "rejected: visibility invariant cannot be suppressed"
          : "accepted: reaffirms visibility invariant",
      };
    });

    return {
      key,
      effectiveValue: true,
      winningLayer: "platform_default",
      reason: "invariant_floor",
      candidates: trace,
      safetyRelevant: true,
      userVisible: true,
    };
  }

  // ── Case B: safety-relevant key → most restrictive wins ──────────────────
  const spec = getSafetyKeySpec(key);
  if (spec && isSafetyRelevantKey(key)) {
    const defaultValue = options.defaults?.[key];
    const pool: Candidate[] = [...candidates];

    let winner: Candidate | undefined;
    for (const c of pool) {
      if (!winner) {
        winner = c;
        continue;
      }
      winner = compareRestrictiveness(spec, c.value, winner.value) > 0 ? c : winner;
    }

    // Platform floor / default participates as a floor, never as a loosener.
    let effectiveValue: PolicyValue;
    let winningLayer: PolicyLayer;
    let reason: PolicyResolutionReason;

    if (!winner) {
      effectiveValue = spec.platformFloor ?? defaultValue ?? false;
      winningLayer = "platform_default";
      reason = "default";
    } else if (spec.platformFloor !== undefined && compareRestrictiveness(spec, spec.platformFloor, winner.value) > 0) {
      effectiveValue = spec.platformFloor;
      winningLayer = "platform_default";
      reason = "invariant_floor";
    } else {
      effectiveValue = winner.value;
      winningLayer = winner.layer;
      reason = pool.length === 1 ? "only_value" : "most_restrictive";
    }

    const trace: PolicyDecisionEntry["candidates"] = pool.map((c) => {
      const applied = c.layer === winningLayer && c.value === effectiveValue;
      const looser = compareRestrictiveness(spec, c.value, effectiveValue) < 0;
      if (looser) {
        // A layer asked for something weaker than the resolved value.
        // Not necessarily malicious (a lower layer may just be permissive),
        // but if a MORE privileged layer tries to loosen a stricter lower
        // layer, that is a genuine override attempt worth recording.
        rejectedOverrides.push({
          key,
          layer: c.layer,
          attemptedValue: c.value,
          rejectedBecause:
            `Safety-relevant setting resolves most-restrictive-wins. ` +
            `Requested value was weaker than the effective value from layer '${winningLayer}'.`,
          authoredBy: c.rule.authoredBy,
          at: now,
          severity: "warning",
        });
      }
      return {
        layer: c.layer,
        value: c.value,
        applied,
        why: applied
          ? "applied: most restrictive value"
          : looser
            ? "not applied: weaker than effective value"
            : "not applied: superseded by an equally or more restrictive layer",
      };
    });

    return {
      key,
      effectiveValue,
      winningLayer,
      reason,
      candidates: trace,
      safetyRelevant: true,
      userVisible: false,
    };
  }

  // ── Case C: ordinary preference → most specific wins ─────────────────────
  const defaultValue = options.defaults?.[key];
  let winner: Candidate | undefined;
  for (const c of candidates) {
    if (!winner || layerSpecificity(c.layer) >= layerSpecificity(winner.layer)) winner = c;
  }

  const effectiveValue = winner?.value ?? defaultValue ?? "";
  const winningLayer: PolicyLayer = winner?.layer ?? "platform_default";
  const reason: PolicyResolutionReason = winner
    ? candidates.length === 1
      ? "only_value"
      : "most_specific"
    : "default";

  const trace: PolicyDecisionEntry["candidates"] = candidates.map((c) => ({
    layer: c.layer,
    value: c.value,
    applied: c === winner,
    why: c === winner ? "applied: most specific layer" : "not applied: less specific layer",
  }));

  return {
    key,
    effectiveValue,
    winningLayer,
    reason,
    candidates: trace,
    safetyRelevant: false,
    userVisible: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EffectivePolicy wrapper
// ═══════════════════════════════════════════════════════════════════════════

export function createEffectivePolicy(resolution: PolicyResolution): EffectivePolicy {
  const index = new Map<string, PolicyDecisionEntry>();
  for (const e of resolution.entries) index.set(e.key, e);

  return {
    resolution,
    get(key: string): PolicyValue | undefined {
      return index.get(key)?.effectiveValue;
    },
    getBoolean(key: string, fallback: boolean): boolean {
      const v = index.get(key)?.effectiveValue;
      return typeof v === "boolean" ? v : fallback;
    },
    getNumber(key: string, fallback: number): number {
      const v = index.get(key)?.effectiveValue;
      return typeof v === "number" ? v : fallback;
    },
    userVisibleEffects(): readonly PolicyDecisionEntry[] {
      // Users see visibility invariants AND every safety restriction that
      // applies to them, so policy effects are never invisible.
      return resolution.entries.filter((e) => e.userVisible || e.safetyRelevant);
    },
  };
}

/** Convenience: resolve and wrap in one call. */
export function evaluatePolicy(
  rules: readonly PolicyRule[],
  options: ResolvePolicyOptions = {},
): EffectivePolicy {
  return createEffectivePolicy(resolvePolicy(rules, options));
}

// ═══════════════════════════════════════════════════════════════════════════
// Explanation helpers (CLI / dashboard / user-facing)
// ═══════════════════════════════════════════════════════════════════════════

export interface PolicyExplanation {
  readonly key: string;
  readonly effectiveValue: PolicyValue;
  readonly summary: string;
  readonly detail: readonly string[];
}

export function explainPolicyKey(resolution: PolicyResolution, key: string): PolicyExplanation | undefined {
  const entry = resolution.entries.find((e) => e.key === key);
  if (!entry) return undefined;

  const detail = entry.candidates.map(
    (c) => `${c.applied ? "→" : " "} ${c.layer}: ${String(c.value)} — ${c.why}`,
  );

  const summary =
    entry.reason === "invariant_floor"
      ? `${key} = ${String(entry.effectiveValue)} (non-overridable invariant)`
      : entry.reason === "most_restrictive"
        ? `${key} = ${String(entry.effectiveValue)} (most restrictive, from ${entry.winningLayer})`
        : entry.reason === "most_specific"
          ? `${key} = ${String(entry.effectiveValue)} (most specific, from ${entry.winningLayer})`
          : entry.reason === "default"
            ? `${key} = ${String(entry.effectiveValue)} (platform default)`
            : `${key} = ${String(entry.effectiveValue)} (from ${entry.winningLayer})`;

  return { key, effectiveValue: entry.effectiveValue, summary, detail };
}

/** All rejected override attempts, grouped for admin review. */
export function summarizeRejectedOverrides(
  resolution: PolicyResolution,
): readonly { readonly severity: "warning" | "critical"; readonly count: number; readonly keys: readonly string[] }[] {
  const critical = resolution.rejectedOverrides.filter((o) => o.severity === "critical");
  const warning = resolution.rejectedOverrides.filter((o) => o.severity === "warning");
  const out: { severity: "warning" | "critical"; count: number; keys: string[] }[] = [];
  if (critical.length > 0) {
    out.push({ severity: "critical", count: critical.length, keys: [...new Set(critical.map((o) => o.key))] });
  }
  if (warning.length > 0) {
    out.push({ severity: "warning", count: warning.length, keys: [...new Set(warning.map((o) => o.key))] });
  }
  return out;
}
