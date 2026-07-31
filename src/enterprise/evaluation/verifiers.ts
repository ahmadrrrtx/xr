/**
 * XR 7.0 — Outcome verifiers (Phase 13).
 *
 * The governing rule of this file:
 *
 *   A scenario is NEVER marked successful because a model said the right
 *   thing. Success means an artifact exists and is correct, a state
 *   transition happened, a record was written, a policy was applied, the
 *   evidence chain is complete, and the side effects are the expected ones.
 *
 * Every verifier returns a `VerificationResult` with an explanation. The
 * runner — not the scenario — adjudicates the final status.
 */

import type { FixtureWorkspace } from "./fixtures.ts";
import type { RecordedEffect, VerificationResult, VerifierKind } from "./types.ts";

function result(
  id: string,
  kind: VerifierKind,
  satisfied: boolean,
  detail: string,
  required: boolean,
): VerificationResult {
  return Object.freeze({ id, kind, satisfied, detail, required });
}

// ═══════════════════════════════════════════════════════════════════════════
// Artifact verification
// ═══════════════════════════════════════════════════════════════════════════

export interface ArtifactExpectation {
  readonly id: string;
  /** Path relative to the fixture root. */
  readonly path: string;
  /** Must exist (default true). Set false to assert absence. */
  readonly mustExist?: boolean;
  /** Substrings the artifact must contain. */
  readonly mustContain?: readonly string[];
  /** Substrings the artifact must NOT contain (e.g. secrets). */
  readonly mustNotContain?: readonly string[];
  /** Optional structural predicate over parsed JSON. */
  readonly json?: (value: unknown) => boolean;
  readonly required?: boolean;
}

/**
 * Verify a produced artifact by inspecting it on disk.
 * This is the primary defence against "the model said it wrote the file".
 */
export function verifyArtifact(
  workspace: FixtureWorkspace,
  expectation: ArtifactExpectation,
): VerificationResult {
  const required = expectation.required ?? true;
  const mustExist = expectation.mustExist ?? true;
  const exists = workspace.exists(expectation.path);

  if (!mustExist) {
    return result(
      expectation.id,
      "artifact",
      !exists,
      exists ? `artifact "${expectation.path}" exists but was expected to be absent` : `artifact "${expectation.path}" correctly absent`,
      required,
    );
  }

  if (!exists) {
    return result(expectation.id, "artifact", false, `artifact "${expectation.path}" was not produced`, required);
  }

  let content: string;
  try {
    content = workspace.read(expectation.path);
  } catch (e) {
    return result(
      expectation.id,
      "artifact",
      false,
      `artifact "${expectation.path}" could not be read: ${e instanceof Error ? e.message : String(e)}`,
      required,
    );
  }

  const missing = (expectation.mustContain ?? []).filter((s) => !content.includes(s));
  if (missing.length > 0) {
    return result(
      expectation.id,
      "artifact",
      false,
      `artifact "${expectation.path}" is missing expected content: ${missing.map((m) => JSON.stringify(m)).join(", ")}`,
      required,
    );
  }

  const forbidden = (expectation.mustNotContain ?? []).filter((s) => content.includes(s));
  if (forbidden.length > 0) {
    return result(
      expectation.id,
      "artifact",
      false,
      `artifact "${expectation.path}" contains forbidden content (${forbidden.length} match(es))`,
      required,
    );
  }

  if (expectation.json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return result(expectation.id, "artifact", false, `artifact "${expectation.path}" is not valid JSON`, required);
    }
    if (!expectation.json(parsed)) {
      return result(expectation.id, "artifact", false, `artifact "${expectation.path}" failed its structural check`, required);
    }
  }

  return result(expectation.id, "artifact", true, `artifact "${expectation.path}" verified on disk`, required);
}

// ═══════════════════════════════════════════════════════════════════════════
// State verification
// ═══════════════════════════════════════════════════════════════════════════

export interface StateExpectation<T = unknown> {
  readonly id: string;
  readonly description: string;
  readonly actual: T;
  readonly expected: T;
  readonly required?: boolean;
}

/** Verify a state value (e.g. an execution reached `cancelled`). */
export function verifyState<T>(expectation: StateExpectation<T>): VerificationResult {
  const ok = Object.is(expectation.actual, expectation.expected);
  return result(
    expectation.id,
    "state",
    ok,
    ok
      ? `${expectation.description}: observed ${JSON.stringify(expectation.actual)} as expected`
      : `${expectation.description}: expected ${JSON.stringify(expectation.expected)} but observed ${JSON.stringify(expectation.actual)}`,
    expectation.required ?? true,
  );
}

/** Verify an arbitrary predicate about system state, with an explanation. */
export function verifyPredicate(
  id: string,
  description: string,
  satisfied: boolean,
  detail: string,
  required = true,
): VerificationResult {
  return result(id, "state", satisfied, `${description}: ${detail}`, required);
}

// ═══════════════════════════════════════════════════════════════════════════
// Record verification
// ═══════════════════════════════════════════════════════════════════════════

export interface RecordExpectation {
  readonly id: string;
  readonly description: string;
  /** The records that were actually written. */
  readonly records: readonly unknown[];
  /** Minimum count required. */
  readonly minCount?: number;
  /** Predicate every record must satisfy. */
  readonly every?: (r: unknown) => boolean;
  /** Predicate at least one record must satisfy. */
  readonly some?: (r: unknown) => boolean;
  readonly required?: boolean;
}

/** Verify that durable records were actually written and are well-formed. */
export function verifyRecords(expectation: RecordExpectation): VerificationResult {
  const required = expectation.required ?? true;
  const min = expectation.minCount ?? 1;

  if (expectation.records.length < min) {
    return result(
      expectation.id,
      "record",
      false,
      `${expectation.description}: expected at least ${min} record(s), found ${expectation.records.length}`,
      required,
    );
  }
  if (expectation.every && !expectation.records.every(expectation.every)) {
    return result(expectation.id, "record", false, `${expectation.description}: not every record satisfied the required shape`, required);
  }
  if (expectation.some && !expectation.records.some(expectation.some)) {
    return result(expectation.id, "record", false, `${expectation.description}: no record satisfied the required condition`, required);
  }
  return result(
    expectation.id,
    "record",
    true,
    `${expectation.description}: ${expectation.records.length} record(s) verified`,
    required,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Policy verification
// ═══════════════════════════════════════════════════════════════════════════

export interface PolicyExpectation {
  readonly id: string;
  readonly description: string;
  /** The decision that was actually made. */
  readonly decision: string;
  /** Decisions considered correct. */
  readonly allowed: readonly string[];
  /** The explanation the system produced — required for user-visible policy. */
  readonly explanation?: string;
  readonly required?: boolean;
}

/**
 * Verify a policy decision AND that it was explained.
 * XR's contract is that users can always see why a policy applied.
 */
export function verifyPolicy(expectation: PolicyExpectation): VerificationResult {
  const required = expectation.required ?? true;
  const correct = expectation.allowed.includes(expectation.decision);
  if (!correct) {
    return result(
      expectation.id,
      "policy",
      false,
      `${expectation.description}: decision "${expectation.decision}" is not among the acceptable outcomes [${expectation.allowed.join(", ")}]`,
      required,
    );
  }
  if (expectation.explanation !== undefined && expectation.explanation.trim().length === 0) {
    return result(
      expectation.id,
      "policy",
      false,
      `${expectation.description}: decision "${expectation.decision}" was correct but carried no explanation`,
      required,
    );
  }
  return result(
    expectation.id,
    "policy",
    true,
    `${expectation.description}: decision "${expectation.decision}" correct and explained`,
    required,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Evidence verification
// ═══════════════════════════════════════════════════════════════════════════

export interface EvidenceExpectation {
  readonly id: string;
  readonly description: string;
  /** Evidence items that should be present (audit rows, provenance links...). */
  readonly present: readonly string[];
  /** Items required. */
  readonly expected: readonly string[];
  readonly required?: boolean;
}

/** Verify the evidence chain is complete — absence of evidence is a failure. */
export function verifyEvidence(expectation: EvidenceExpectation): VerificationResult {
  const missing = expectation.expected.filter((e) => !expectation.present.includes(e));
  const ok = missing.length === 0;
  return result(
    expectation.id,
    "evidence",
    ok,
    ok
      ? `${expectation.description}: all ${expectation.expected.length} expected evidence item(s) present`
      : `${expectation.description}: missing evidence [${missing.join(", ")}]`,
    expectation.required ?? true,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Side-effect verification
// ═══════════════════════════════════════════════════════════════════════════

export interface SideEffectExpectation {
  readonly id: string;
  readonly description: string;
  readonly effects: readonly RecordedEffect[];
  /** Effect kinds that must have occurred and been allowed. */
  readonly expectAllowed?: readonly RecordedEffect["kind"][];
  /** Effect kinds that must NOT have been allowed. */
  readonly expectRefusedOrAbsent?: readonly RecordedEffect["kind"][];
  readonly required?: boolean;
}

/** Verify the effects that actually occurred match what should have occurred. */
export function verifySideEffects(expectation: SideEffectExpectation): VerificationResult {
  const required = expectation.required ?? true;
  const problems: string[] = [];

  for (const kind of expectation.expectAllowed ?? []) {
    if (!expectation.effects.some((e) => e.kind === kind && e.allowed)) {
      problems.push(`expected an allowed "${kind}" effect but none occurred`);
    }
  }
  for (const kind of expectation.expectRefusedOrAbsent ?? []) {
    if (expectation.effects.some((e) => e.kind === kind && e.allowed)) {
      problems.push(`"${kind}" effect was allowed but should have been refused or absent`);
    }
  }

  const ok = problems.length === 0;
  return result(
    expectation.id,
    ok && (expectation.expectAllowed?.length ?? 0) === 0 ? "no_side_effect" : "side_effect",
    ok,
    ok ? `${expectation.description}: side effects match expectation` : `${expectation.description}: ${problems.join("; ")}`,
    required,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Comprehension verification (UX)
// ═══════════════════════════════════════════════════════════════════════════

export interface ComprehensionExpectation {
  readonly id: string;
  readonly description: string;
  /** The user-facing text under test (e.g. an approval prompt, an error). */
  readonly text: string;
  /** Concepts the text must convey, each with a matcher. */
  readonly mustConvey: readonly { readonly concept: string; readonly matches: (t: string) => boolean }[];
  readonly required?: boolean;
}

/**
 * Verify user-facing text conveys the required concepts.
 *
 * This is an explicit PROXY for comprehension. It checks that the information
 * a user needs is present and structured; it does not claim to measure human
 * understanding. That limitation is published with the metric.
 */
export function verifyComprehension(expectation: ComprehensionExpectation): VerificationResult {
  const missing = expectation.mustConvey.filter((c) => !c.matches(expectation.text)).map((c) => c.concept);
  const ok = missing.length === 0;
  return result(
    expectation.id,
    "comprehension",
    ok,
    ok
      ? `${expectation.description}: conveys all ${expectation.mustConvey.length} required concept(s)`
      : `${expectation.description}: does not convey [${missing.join(", ")}]`,
    expectation.required ?? true,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Aggregate helpers
// ═══════════════════════════════════════════════════════════════════════════

/** True when every REQUIRED verification is satisfied. */
export function allRequiredSatisfied(verifications: readonly VerificationResult[]): boolean {
  return verifications.filter((v) => v.required).every((v) => v.satisfied);
}

/** True when at least one optional verification failed (⇒ partial outcome). */
export function anyOptionalFailed(verifications: readonly VerificationResult[]): boolean {
  return verifications.some((v) => !v.required && !v.satisfied);
}

/** Ratio of satisfied verifications; null when there are none. */
export function satisfactionRatio(verifications: readonly VerificationResult[]): number | null {
  if (verifications.length === 0) return null;
  return verifications.filter((v) => v.satisfied).length / verifications.length;
}
