/**
 * XR — regression guard for the Windows installer release blocker.
 *
 * ROOT CAUSE: `install.ps1` began with a top-level `param(...)` block
 * containing `[ValidateSet('minimal',…)][string]$Mode = ''`.
 *
 * The documented install command is:
 *
 *   iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)
 *
 * `Invoke-Expression` executes the downloaded text as a statement list in the
 * CALLER's scope, not as a script with its own parameter binding. A top-level
 * `param()` there does not declare parameters — PowerShell tries to ATTACH the
 * attributes to variables in the current scope. Attaching a ValidateSet whose
 * current value ('') is outside the set fails immediately:
 *
 *   ValidationMetadataException / ValidateSetFailure
 *   "The attribute cannot be added because variable Mode with value
 *    would no longer be valid."
 *
 * Reproduced against PowerShell 7.4.6; removing only the default does NOT fix
 * it. The fix moves every parameter onto the `Invoke-XrInstall` function, where
 * ValidateSet performs genuine parameter binding.
 *
 * These tests are STATIC (they parse the script text) so they run on every OS
 * in CI. When a PowerShell host is available they additionally EXECUTE the
 * script through Invoke-Expression and assert the exception does not return.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const ps1Path = join(ROOT, "install.ps1");
const ps1 = readFileSync(ps1Path, "utf8");

/**
 * The script with comment lines removed. The header documents the historical
 * bug (and therefore legitimately contains strings like "$Mode" and
 * "Invoke-Expression"), so behavioural assertions must look at CODE only.
 */
const ps1Code = ps1
  .split(/\r?\n/)
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

/** Locate a PowerShell host, if this machine has one. */
function powershellHost(): string | null {
  for (const candidate of ["pwsh", "powershell"]) {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf8",
      timeout: 60_000,
    });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const shell = powershellHost();

describe("install.ps1 — remote-execution safety (iex (irm ...))", () => {
  test("has NO top-level param() block (the ValidateSetFailure root cause)", () => {
    // A top-level param() is only legal for scripts/functions; under
    // Invoke-Expression it becomes an attribute-application against caller
    // scope. Anchored to line start so the function's indented param() blocks
    // are not matched.
    expect(ps1Code).not.toMatch(/^param\s*\(/m);
    expect(ps1Code).not.toMatch(/^\[CmdletBinding\(\)\]\s*$/m);
  });

  test("does not attach a ValidateSet to a bare top-level $Mode variable", () => {
    expect(ps1Code).not.toMatch(/^\s*\[ValidateSet\([^)]*\)\]\[string\]\$Mode/m);
  });

  test("parameters live on the Invoke-XrInstall function instead", () => {
    expect(ps1).toMatch(/function Invoke-XrInstall/);
    expect(ps1).toMatch(/\[ValidateSet\('minimal', 'local', 'byok', 'hybrid', 'full'\)\]\s*\r?\n\s*\[string\]\$InstallMode/);
  });

  test("uses explicit, collision-resistant variable names (no generic $Mode)", () => {
    // `Mode` is a very common variable name; injecting it into the caller's
    // interactive session is exactly what broke.
    expect(ps1Code).not.toMatch(/\$Mode\b/);
    expect(ps1Code).toMatch(/\$InstallMode\b/);
    expect(ps1Code).toMatch(/\$TargetDirectory\b/);
  });

  test("does not call exit at top level (would close the user's console under iex)", () => {
    expect(ps1Code).not.toMatch(/^\s*exit\s+\d+\s*$/m);
  });

  test("detects Windows without reading $IsWindows unguarded (breaks on 5.1 + StrictMode)", () => {
    // $IsWindows does not exist in Windows PowerShell 5.1; under
    // `Set-StrictMode -Version Latest` merely reading it throws.
    expect(ps1Code).toMatch(/Test-Path Variable:\\IsWindows/);
    expect(ps1Code).not.toMatch(/if \(\$IsWindows -or/);
  });

  test("enables TLS 1.2 explicitly (stock 5.1 cannot reach GitHub otherwise)", () => {
    expect(ps1).toMatch(/SecurityProtocol/);
    expect(ps1).toMatch(/Tls12/);
  });
});

describe("install.ps1 — security posture", () => {
  test("every remote download uses HTTPS", () => {
    const urls = ps1Code.match(/https?:\/\/[^\s"')]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith("https://")).toBe(true);
  });

  test("does not pipe downloaded content into Invoke-Expression", () => {
    // The installer may be delivered via iex, but it must never itself iex
    // something it just fetched.
    expect(ps1Code).not.toMatch(/Invoke-Expression/);
    expect(ps1Code).not.toMatch(/\biex\b\s*\(/);
  });

  test("verifies the downloaded binary against published checksums", () => {
    expect(ps1).toMatch(/SHA256SUMS/);
    expect(ps1).toMatch(/Get-FileHash/);
    expect(ps1).toMatch(/Integrity check FAILED/);
  });

  test("temp files are uniquely named and cleaned up", () => {
    expect(ps1).toMatch(/\[Guid\]::NewGuid\(\)/);
    expect(ps1).toMatch(/Remove-Item .*-ErrorAction SilentlyContinue/);
  });

  test("PATH is only appended when the entry is genuinely absent", () => {
    expect(ps1).toMatch(/-notcontains/);
    expect(ps1).toMatch(/SetEnvironmentVariable\('Path'/);
  });
});

const describeShell = shell ? describe : describe.skip;

describeShell(`install.ps1 — executed under ${shell ?? "powershell"}`, () => {
  /** Run PowerShell code, returning combined output. */
  function run(code: string): { status: number | null; out: string } {
    const res = spawnSync(shell!, ["-NoProfile", "-Command", code], {
      encoding: "utf8",
      timeout: 120_000,
      cwd: ROOT,
    });
    return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
  }

  test("the script parses with zero syntax errors", () => {
    const { out } = run(
      `$e=$null;$t=$null;` +
        `[void][System.Management.Automation.Language.Parser]::ParseFile(` +
        `(Resolve-Path './install.ps1'),[ref]$t,[ref]$e);` +
        `Write-Output ("ERRORS=" + ($e | Measure-Object).Count)`,
    );
    expect(out).toContain("ERRORS=0");
  });

  test("Invoke-Expression of the script does NOT raise ValidateSetFailure", () => {
    // The exact failure mode users hit. The install itself cannot complete in
    // a test sandbox, so we assert on the ERROR CLASS, not on success.
    const { out } = run(
      `$src = Get-Content -Raw ./install.ps1; ` +
        `try { Invoke-Expression $src } catch { Write-Output ("CAUGHT=" + $_.Exception.GetType().Name) }`,
    );
    expect(out).not.toContain("ValidationMetadataException");
    expect(out).not.toContain("attribute cannot be added");
    expect(out).not.toContain("ValidateSetFailure");
  });

  test("Invoke-Expression does not pollute caller scope with installer variables", () => {
    const { out } = run(
      `try { Invoke-Expression (Get-Content -Raw ./install.ps1) } catch {}; ` +
        `Write-Output ("MODE=" + (Test-Path Variable:\\Mode)); ` +
        `Write-Output ("INSTALLMODE=" + (Test-Path Variable:\\InstallMode)); ` +
        `Write-Output ("TARGETDIR=" + (Test-Path Variable:\\TargetDirectory))`,
    );
    expect(out).toContain("MODE=False");
    expect(out).toContain("INSTALLMODE=False");
    expect(out).toContain("TARGETDIR=False");
  });

  test("a pre-existing $Mode in the caller's session is left untouched", () => {
    const { out } = run(
      `Set-Variable -Name Mode -Value 'user-value'; ` +
        `try { Invoke-Expression (Get-Content -Raw ./install.ps1) } catch {}; ` +
        `Write-Output ("MODE=" + (Get-Variable Mode -ValueOnly))`,
    );
    expect(out).toContain("MODE=user-value");
  });

  test("dot-sourcing defines Invoke-XrInstall and ValidateSet still rejects bad modes", () => {
    const { out } = run(
      `$env:OS='Windows_NT'; . ./install.ps1 *> $null; ` +
        `Write-Output ("DEFINED=" + [bool](Get-Command Invoke-XrInstall -ErrorAction SilentlyContinue)); ` +
        `try { Invoke-XrInstall -InstallMode definitely-not-a-mode } ` +
        `catch { Write-Output "REJECTED=True" }`,
    );
    expect(out).toContain("DEFINED=True");
    expect(out).toContain("REJECTED=True");
  });

  test("a valid -InstallMode binds without a validation error", () => {
    const { out } = run(
      `$env:OS='Windows_NT'; . ./install.ps1 *> $null; ` +
        `try { Invoke-XrInstall -InstallMode minimal -TargetDirectory /tmp/xr-binding-probe } ` +
        `catch { Write-Output ("STOPPED=" + $_.Exception.Message) }`,
    );
    expect(out).not.toContain("does not belong to the set");
    expect(out).not.toContain("ValidationMetadataException");
  });
});
