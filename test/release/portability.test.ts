/**
 * XR Phase 9 · T4 (Part 10) — portability discipline.
 *
 * The suite runs in FULL on 3 OS families. OS-specific behavior is allowed
 * ONLY as runtime detection inside tests (Constitution Art. XX.5) and ONLY in
 * whitelisted files — so a new unreviewed platform exclusion fails here,
 * never silently narrows CI coverage.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { POSIX_ONLY as CRASH_POSIX_ONLY } from "../reliability/platform-guards.ts";

const TEST_ROOT = join(import.meta.dir, "..");

/**
 * Files permitted to contain runtime OS restrictions, with the reason.
 * Adding an entry requires the same review as adding a CI exclusion — this
 * list failing on a NEW file is the point.
 */
export const ALLOWED_PLATFORM_GUARDS: Record<string, string> = {
  "test/phase0/cli-spine.test.ts": "spawns the built CLI; doctor --json not asserted on win32 (pre-existing precedent)",
  "test/phase0/policy-gate-adversarial.test.ts": "POSIX absolute-path corpus (/etc realpath semantics)",
  "test/reliability/crash-injection.test.ts": "POSIX child-SIGKILL semantics",
  "test/baseline/doctor.test.ts": "windows doctor probe differs (path shells)",
};

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      yield* walk(p);
    } else if (entry.endsWith(".test.ts")) {
      yield p;
    }
  }
}

describe("Phase 9 · portability whitelist", () => {
  test("runtime OS guards exist ONLY in whitelisted files", () => {
    const offenders: string[] = [];
    // What we forbid outside the whitelist is OS-based TEST EXCLUSION (skips),
    // not runtime platform branches — a path-form branch in src/ or test data
    // construction is legitimate everywhere.
    const guardPattern = /(describe|test|it)\.skipIf\([\s\S]{0,120}win32|skipIf\((?:POSIX_ONLY|WINDOWS_ONLY|LINUX_ONLY|DARWIN_ONLY)\)/;
    // This file defines the pattern itself — matching it here is a self-hit on
    // the regex literals, not an actual guard. Everything else must be clean.
    const SELF = "test/release/portability.test.ts";
    for (const f of walk(TEST_ROOT)) {
      const rel = relative(join(TEST_ROOT, ".."), f).replace(/\\/g, "/");
      if (rel === SELF) continue;
      if (ALLOWED_PLATFORM_GUARDS[rel]) continue;
      const src = readFileSync(f, "utf8");
      if (guardPattern.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  test("crash-injection guard is the detection-based skipIf (not config exclusion)", () => {
    expect(CRASH_POSIX_ONLY).toBe(process.platform === "win32");
    const src = readFileSync(join(TEST_ROOT, "reliability", "crash-injection.test.ts"), "utf8");
    expect(src).toContain("describe.skipIf(POSIX_ONLY)");
  });

  test("whitelisted files actually exist (the list cannot drift)", () => {
    for (const rel of Object.keys(ALLOWED_PLATFORM_GUARDS)) {
      const abs = join(TEST_ROOT, "..", rel);
      expect(() => readFileSync(abs), rel).not.toThrow();
    }
  });
});
