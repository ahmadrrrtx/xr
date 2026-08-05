/**
 * XR Phase 9 · Part 20 / T5 — installer integrity enforcement tests.
 * The bootstrap installers are the FIRST thing users run; they must refuse
 * unverified binaries (fail closed) and never silently skip verification.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const sh = readFileSync(join(ROOT, "install.sh"), "utf8");
const ps1 = readFileSync(join(ROOT, "install.ps1"), "utf8");

describe("Phase 9 · install.sh verified-only binary path", () => {
  test("fetches the release SHA256SUMS before installing any binary", () => {
    expect(sh).toContain('/SHA256SUMS" -o "$sums_file"');
  });
  test("fails closed when checksums are unavailable", () => {
    expect(sh).toContain("Release checksums unavailable — refusing an unverified binary");
  });
  test("fails closed when the checksum does not match (tamper detection)", () => {
    expect(sh).toContain("Integrity check FAILED for $bin");
  });
  test("fails closed when the artifact has no sums entry", () => {
    expect(sh).toContain("No checksum entry for $bin in SHA256SUMS");
  });
  test("reports verification success honestly", () => {
    expect(sh).toContain("Compiled binary installed and verified");
  });
  test("keeps the source-checkout fallback (alternative channel preserved)", () => {
    expect(sh).toContain("fetch_repo");
  });
});

describe("Phase 9 · install.ps1 verified-only binary path", () => {
  test("fetches the release SHA256SUMS before installing any binary", () => {
    expect(ps1).toContain("-OutFile $sumsPath");
    expect(ps1).toContain("/SHA256SUMS");
  });
  test("fails closed when checksums are unavailable", () => {
    expect(ps1).toContain("Release checksums unavailable");
  });
  test("verifies sha256 and fails closed on mismatch", () => {
    expect(ps1).toContain("Get-FileHash");
    expect(ps1).toContain("Integrity check FAILED");
  });
  test("reports verification success honestly", () => {
    expect(ps1).toContain("Compiled binary installed and verified");
  });
});

describe("Phase 9 · updater binary plan wires verification by default", () => {
  const updater = readFileSync(join(ROOT, "src", "update", "atomic-updater.ts"), "utf8");
  test("the binary update plan verifies downloads against SHA256SUMS", () => {
    expect(updater).toContain("downloadVerified");
    expect(updater).toContain("sumsUrl: opts.sumsUrl ?? `${baseUrl}/SHA256SUMS`");
  });
  test("the verify escape hatch is explicit and test-scoped (never silent)", () => {
    expect(updater).toContain("opts.verify === false");
    expect(updater).toContain("test-only");
  });
});
