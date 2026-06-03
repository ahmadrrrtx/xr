/**
 * XR — Verifiers (the "verifiability gate").
 *
 * Research is blunt about this: naive self-improvement catastrophically forgets
 * and reward-hacks UNLESS outcomes are objectively verifiable. So a skill run
 * can only be "learned/frozen" if a deterministic verifier confirms success.
 * No verifier passes → no auto-learn. (TRD §3.3.)
 *
 * Verifiers are pure functions over the *outcome* of a run. They must never
 * call an LLM — that would defeat the whole point.
 */
import { existsSync, statSync, readFileSync } from "node:fs";
import { resolve, isAbsolute, relative } from "node:path";

/** A verifier spec is a small, declarative, serializable rule. */
export type VerifierSpec =
  | { kind: "file_exists"; path: string }
  | { kind: "file_nonempty"; path: string }
  | { kind: "file_contains"; path: string; text: string }
  | { kind: "always_false" } // explicit "not verifiable" → never auto-learns
  | { kind: "user_approved" }; // human explicitly confirmed success

export interface VerifyResult {
  passed: boolean;
  reason: string;
}

/** Keep verifiers inside the working directory (no path escape). */
function safe(cwd: string, p: string): string | null {
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  const rel = relative(cwd, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}

/**
 * Run a verifier against the outcome.
 * @param ctx.userApproved set when the human explicitly confirmed the run.
 */
export function verify(
  spec: VerifierSpec,
  ctx: { cwd: string; userApproved?: boolean },
): VerifyResult {
  switch (spec.kind) {
    case "always_false":
      return { passed: false, reason: "not objectively verifiable — will not auto-learn" };

    case "user_approved":
      return ctx.userApproved
        ? { passed: true, reason: "user confirmed success" }
        : { passed: false, reason: "awaiting user confirmation" };

    case "file_exists": {
      const p = safe(ctx.cwd, spec.path);
      if (!p) return { passed: false, reason: `unsafe path: ${spec.path}` };
      return existsSync(p)
        ? { passed: true, reason: `file exists: ${spec.path}` }
        : { passed: false, reason: `file missing: ${spec.path}` };
    }

    case "file_nonempty": {
      const p = safe(ctx.cwd, spec.path);
      if (!p) return { passed: false, reason: `unsafe path: ${spec.path}` };
      if (!existsSync(p)) return { passed: false, reason: `file missing: ${spec.path}` };
      return statSync(p).size > 0
        ? { passed: true, reason: `file non-empty: ${spec.path}` }
        : { passed: false, reason: `file empty: ${spec.path}` };
    }

    case "file_contains": {
      const p = safe(ctx.cwd, spec.path);
      if (!p) return { passed: false, reason: `unsafe path: ${spec.path}` };
      if (!existsSync(p)) return { passed: false, reason: `file missing: ${spec.path}` };
      const content = readFileSync(p, "utf8");
      return content.includes(spec.text)
        ? { passed: true, reason: `file contains expected text` }
        : { passed: false, reason: `expected text not found in ${spec.path}` };
    }

    default: {
      // Exhaustiveness guard.
      const _never: never = spec;
      return { passed: false, reason: "unknown verifier" };
    }
  }
}

/** Is this spec capable of ever passing automatically (gate check)? */
export function isVerifiable(spec: VerifierSpec): boolean {
  return spec.kind !== "always_false";
}
