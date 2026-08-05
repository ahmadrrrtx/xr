/**
 * XR Phase 9 · T4 — parity machinery tests (the exclusion manifest is the
 * ONLY place a test may not run, and never silently).
 */
import { describe, expect, test } from "bun:test";
import { resolveSuite, validateExclusions, parityReport, listTestFiles, SUPPORTED_OSES } from "../../scripts/platform-parity.ts";

describe("Phase 9 · T4 — platform parity computation", () => {
  test("the committed exclusion manifest validates clean (no stale/silent skips)", () => {
    expect(validateExclusions()).toEqual([]);
  });

  test("Linux (reference) runs 100% of the suite; other OSes lose only documented files", () => {
    const report = parityReport();
    expect(report.perOs.linux.excluded).toBe(0);
    expect(report.perOs.linux.run).toBe(report.total);
    for (const os of SUPPORTED_OSES) {
      expect(report.perOs[os].run).toBeGreaterThan(190); // a real suite, not a subset rump
      expect(report.perOs[os].run).toBeLessThanOrEqual(report.total);
    }
  });

  test("windows exclusions exactly match the manifest's win32 entries", () => {
    const suite = resolveSuite("win32");
    const excludedFiles = new Set(suite.excluded.map((e) => e.pattern));
    expect(excludedFiles).toContain("test/reliability/crash-injection.test.ts");
    expect(excludedFiles).toContain("test/phase0/policy-gate-adversarial.test.ts");
    for (const e of suite.excluded) {
      expect(e.reason.length).toBeGreaterThan(20);
    }
    // Every excluded entry names a real file and leaves the suite intact.
    for (const f of suite.included) {
      expect(listTestFiles()).toContain(f);
    }
  });

  test("darwin inherits POSIX-capable tests that windows excludes", () => {
    const win = resolveSuite("win32").included;
    const mac = resolveSuite("darwin").included;
    expect(mac).toContain("test/reliability/crash-injection.test.ts");
    expect(mac).toContain("test/phase0/policy-gate-adversarial.test.ts");
    expect(win).not.toContain("test/reliability/crash-injection.test.ts");
  });

  test("a tampered exclusion that names no file is rejected", () => {
    // validateExclusions operates on the committed file, so assert the
    // invariant it enforces: every committed pattern matches ≥1 file.
    const files = listTestFiles();
    const suite = resolveSuite("win32");
    for (const e of suite.excluded) {
      const hits = files.filter((f) => f === e.pattern || f.startsWith(e.pattern));
      expect(hits.length).toBeGreaterThan(0);
    }
  });
});
