import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const pwsh = Bun.which("pwsh");

/**
 * NEW-9: PowerShell's start-up telemetry and its update check both reach the network. On a loaded Ubuntu runner the
 * first `pwsh` of this file twice missed the 15 s bound: once after printing its result (`8b2b1a3`), once before
 * printing anything (`8d29f9e`). Every child this file starts has both turned off. The 15 s bound is unchanged.
 */
const QUIET_POWERSHELL = { POWERSHELL_TELEMETRY_OPTOUT: "1", POWERSHELL_UPDATECHECK: "Off" } as const;
function runPwsh(exe: string, args: string[], env: Record<string, string | undefined> = process.env) {
  return spawnSync(exe, ["-NoProfile", ...args], { encoding: "utf8", env: { ...env, ...QUIET_POWERSHELL }, timeout: 15_000 });
}
// These tests stop before any OS installer call; they work on Linux or Windows
// with PowerShell 7 and must never execute the fabricated installer files.
for (const names of [[], ["only.msi"], ["first.msi", "second.msi", "one-setup.exe"]]) {
  test.skipIf(!pwsh)(`missing or duplicate installer inputs fail closed: ${names.join(", ") || "empty"}`, () => {
    const tmp = mkdtempSync(join(tmpdir(), "xr-installer-negative-"));
    try {
      const bundles = join(tmp, "bundles"); const evidence = join(tmp, "evidence");
      mkdirSync(bundles);
      for (const name of names) writeFileSync(join(bundles, name), "not an executable");
      const result = runPwsh(pwsh!, ["-File", resolve("scripts/journey/windows-installers.ps1"), "-Bundles", bundles, "-EvidenceDir", evidence],
        { ...process.env, RUNNER_OS: "Windows", CI: "true", GITHUB_ACTIONS: "true", RUNNER_TEMP: tmp });
      if (result.error || result.signal) throw new Error(`PowerShell control did not finish: ${result.error?.message ?? result.signal}; stdout=${result.stdout}; stderr=${result.stderr}`);
      expect(result.status).not.toBe(0);
      const raw = JSON.parse(readFileSync(join(evidence, "windows-installer-events.json"), "utf8"));
      const events = Array.isArray(raw) ? raw : [raw];
      expect(events.some((e: { state: string; detail: string }) => e.state === "FAIL" && e.detail.includes("exactly one MSI and one NSIS"))).toBe(true);
      expect(events.some((e: { state: string }) => e.state === "PASS")).toBe(false);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }, 25_000);
}

test.skipIf(!pwsh)("app-owned sidecar auth orchestration rejects four fake fault cases", () => {
  const result = runPwsh(pwsh!, ["-File", resolve("test/release/windows-auth-controls.ps1")]);
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
  expect(result.stdout).toContain("6 PASS");
}, 25_000);

test.skipIf(!pwsh)("installer location normalization handles quotes and rejects malformed values", () => {
  const result = runPwsh(pwsh!, ["-File", resolve("test/release/windows-install-path-controls.ps1")]);
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
  expect(result.stdout).toContain("8 PASS");
}, 25_000);

// Runs everywhere a POSIX shell exists, including runners and machines without PowerShell: a stand-in `pwsh` prints
// what it was started with, so the guarantee every real child above relies on is checked even where they skip.
test.skipIf(process.platform === "win32")("every PowerShell child starts with telemetry and the update check off (NEW-9)", () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-fake-pwsh-"));
  try {
    const fake = join(dir, "pwsh");
    writeFileSync(fake, '#!/bin/sh\nprintf "%s|%s|%s" "$POWERSHELL_TELEMETRY_OPTOUT" "$POWERSHELL_UPDATECHECK" "$*"\n');
    chmodSync(fake, 0o755);
    const inherited = runPwsh(fake, ["-File", "x.ps1"], { PATH: process.env.PATH, POWERSHELL_TELEMETRY_OPTOUT: "0", POWERSHELL_UPDATECHECK: "Default" });
    expect({ status: inherited.status, stdout: inherited.stdout }).toEqual({ status: 0, stdout: "1|Off|-NoProfile -File x.ps1" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

