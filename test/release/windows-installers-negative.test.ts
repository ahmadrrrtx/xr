import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const pwsh = Bun.which("pwsh");
// These tests stop before any OS installer call; they work on Linux or Windows
// with PowerShell 7 and must never execute the fabricated installer files.
for (const names of [[], ["only.msi"], ["first.msi", "second.msi", "one-setup.exe"]]) {
  test.skipIf(!pwsh)(`missing or duplicate installer inputs fail closed: ${names.join(", ") || "empty"}`, () => {
    const tmp = mkdtempSync(join(tmpdir(), "xr-installer-negative-"));
    try {
      const bundles = join(tmp, "bundles"); const evidence = join(tmp, "evidence");
      mkdirSync(bundles);
      for (const name of names) writeFileSync(join(bundles, name), "not an executable");
      const result = spawnSync(pwsh!, ["-NoProfile", "-File", resolve("scripts/journey/windows-installers.ps1"), "-Bundles", bundles, "-EvidenceDir", evidence], {
        encoding: "utf8", env: { ...process.env, RUNNER_OS: "Windows", CI: "true", GITHUB_ACTIONS: "true", RUNNER_TEMP: tmp },
        timeout: 15_000,
      });
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
  const result = spawnSync(pwsh!, ["-NoProfile", "-File", resolve("test/release/windows-auth-controls.ps1")], {
    encoding: "utf8", timeout: 15_000,
  });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
  expect(result.stdout).toContain("5 PASS");
}, 25_000);
