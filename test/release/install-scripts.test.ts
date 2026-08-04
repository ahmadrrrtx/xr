/**
 * XR Phase 9 · T5 (Part 10) — installer integrity + channel recording.
 *
 * The installers are the trust frontier of the binary channel (Part 20):
 * they must verify the release checksums before trusting a download, fail
 * closed on tamper or unavailability, and record the install channel so
 * `xr update` picks the right contract.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..", "..");
const SH = readFileSync(join(ROOT, "install.sh"), "utf8");
const PS1 = readFileSync(join(ROOT, "install.ps1"), "utf8");

describe("Phase 9 · install.sh integrity contract", () => {
  test("fetches SHA256SUMS and verifies before trusting the binary", () => {
    expect(SH).toContain("SHA256SUMS");
    expect(SH).toContain("verify_binary");
    expect(SH.indexOf('curl -fsSL "$sums_url"')).toBeGreaterThan(-1);
    // verification happens between download and use (fetch_binary calls verify_binary)
    const fetch = SH.indexOf("fetch_binary(){");
    const verify = SH.indexOf("verify_binary(){");
    expect(verify).toBeGreaterThan(-1);
    const downloadAt = SH.indexOf('curl -fsSL "$url" -o "$TARGET_DIR/dist/$bin"', fetch);
    const verifyCallAt = SH.indexOf('verify_binary "$bin"', fetch);
    expect(verifyCallAt).toBeGreaterThan(downloadAt);
  });

  test("fails closed on tamper and on missing checksums (die, not warn)", () => {
    expect(SH).toContain('die "Checksum mismatch for $bin');
    expect(SH).toContain('die "SHA256SUMS has no entry for $bin');
    expect(SH).toContain("integrity-unverified binary");
  });

  test("optional cosign verification refuses when a fetched bundle fails", () => {
    expect(SH).toContain("cosign verify-blob");
    expect(SH).toContain('die "cosign bundle present but verification failed');
  });

  test("records the install channel (github-releases vs git-checkout)", () => {
    expect(SH).toContain('write_install_record "github-releases" "binary"');
    expect(SH).toContain('write_install_record "git-checkout" "git"');
    expect(SH).toContain("install.json");
  });

  test("bash syntax is valid", () => {
    const r = spawnSync("bash", ["-n", join(ROOT, "install.sh")], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });
});

describe("Phase 9 · install.ps1 integrity contract", () => {
  test("fetches SHA256SUMS and verifies via Get-FileHash before trusting", () => {
    expect(PS1).toContain("SHA256SUMS");
    expect(PS1).toContain("Verify-XrBinary");
    expect(PS1).toContain("Get-FileHash -Path $Path -Algorithm SHA256");
  });

  test("fails closed on tamper and on missing checksums (Die, not Warn)", () => {
    expect(PS1).toContain('Die "Checksum mismatch for $Name');
    expect(PS1).toContain("integrity-unverified binary");
  });

  test("records the install channel", () => {
    expect(PS1).toContain("Write-InstallRecord -Channel 'github-releases' -Layout 'binary'");
    expect(PS1).toContain("Write-InstallRecord -Channel 'git-checkout' -Layout 'git'");
  });
});
