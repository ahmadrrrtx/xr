/**
 * XR 7.0 — Effect recording (Phase 13).
 *
 * Side-effect correctness is part of an outcome, so effects are evidence.
 *
 * The recorder is also how the harness catches:
 *   - accidental cloud dependence in a "local" benchmark;
 *   - unexpected process spawning;
 *   - credential access in a scenario that declared it needs none;
 *   - writes outside the fixture root.
 *
 * Effect targets are redacted on the way in, so an effect log can never
 * become a leak channel.
 */

import { redactEvidence } from "./provenance.ts";
import type { AllowedEffects, EffectKind, RecordedEffect } from "./types.ts";

export class EffectRecorder {
  private readonly effects: RecordedEffect[] = [];
  /**
   * Pre-redaction copies, used ONLY by the runner's safety gates.
   *
   * Redaction protects stored artifacts, but if gates also saw only redacted
   * text they could never detect that a scenario tried to emit a credential —
   * the gate would be vacuous. So gates inspect the raw form while everything
   * persisted or exported uses the redacted form.
   */
  private readonly raw: RecordedEffect[] = [];
  private readonly clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  record(e: Omit<RecordedEffect, "at">): void {
    const at = this.clock();
    this.raw.push(
      Object.freeze({
        kind: e.kind,
        target: e.target,
        allowed: e.allowed,
        ...(e.detail !== undefined ? { detail: e.detail } : {}),
        at,
      }),
    );
    this.effects.push(
      Object.freeze({
        kind: e.kind,
        target: redactEvidence(e.target),
        allowed: e.allowed,
        ...(e.detail !== undefined ? { detail: redactEvidence(e.detail) } : {}),
        at,
      }),
    );
  }

  /** Redacted effects — safe to persist, export, and publish. */
  list(): readonly RecordedEffect[] {
    return Object.freeze([...this.effects]);
  }

  /**
   * Unredacted effects for gate evaluation only.
   * Never persist or export the result of this method.
   */
  listRawForGates(): readonly RecordedEffect[] {
    return Object.freeze([...this.raw]);
  }

  count(kind?: EffectKind): number {
    return kind ? this.effects.filter((e) => e.kind === kind).length : this.effects.length;
  }

  /** Effects of a kind that were actually permitted to happen. */
  allowedOf(kind: EffectKind): readonly RecordedEffect[] {
    return this.effects.filter((e) => e.kind === kind && e.allowed);
  }

  /** Effects that were refused — evidence that a control worked. */
  refused(): readonly RecordedEffect[] {
    return this.effects.filter((e) => !e.allowed);
  }

  has(kind: EffectKind): boolean {
    return this.effects.some((e) => e.kind === kind);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Declared-vs-actual comparison
// ═══════════════════════════════════════════════════════════════════════════

export interface EffectViolation {
  readonly kind: EffectKind;
  readonly target: string;
  readonly reason: string;
}

/**
 * Compare the effects a scenario actually produced against the effects it
 * declared it was allowed to produce.
 *
 * Only ALLOWED effects count as violations: a refused network attempt is
 * evidence that the boundary held, not evidence of a breach.
 */
export function findEffectViolations(
  effects: readonly RecordedEffect[],
  allowed: AllowedEffects,
): readonly EffectViolation[] {
  const violations: EffectViolation[] = [];

  for (const e of effects) {
    if (!e.allowed) continue;

    if (e.kind === "network" && !allowed.network) {
      violations.push({
        kind: e.kind,
        target: e.target,
        reason: "scenario performed network access but declared allowedEffects.network = false",
      });
    }
    if (e.kind === "process_spawn" && !allowed.processSpawn) {
      violations.push({
        kind: e.kind,
        target: e.target,
        reason: "scenario spawned a process but declared allowedEffects.processSpawn = false",
      });
    }
    if (e.kind === "credential_access" && !allowed.credentialAccess) {
      violations.push({
        kind: e.kind,
        target: e.target,
        reason: "scenario accessed credentials but declared allowedEffects.credentialAccess = false",
      });
    }
    if (e.kind === "fs_write" && !allowed.fsWriteInsideFixture) {
      violations.push({
        kind: e.kind,
        target: e.target,
        reason: "scenario wrote to the filesystem but declared allowedEffects.fsWriteInsideFixture = false",
      });
    }
  }

  return Object.freeze(violations);
}

/**
 * Summarise effects for a report in a way that is safe to publish.
 * Counts only — targets stay in the raw record where retention rules apply.
 */
export function summarizeEffects(effects: readonly RecordedEffect[]): Record<string, { allowed: number; refused: number }> {
  const out: Record<string, { allowed: number; refused: number }> = {};
  for (const e of effects) {
    const bucket = (out[e.kind] ??= { allowed: 0, refused: 0 });
    if (e.allowed) bucket.allowed += 1;
    else bucket.refused += 1;
  }
  return out;
}
