import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/windows-preview-test.yml", "utf8");
const waiter = readFileSync("scripts/journey/wait-windows-artifact.sh", "utf8");
const lifecycle = readFileSync("scripts/journey/windows-installers.ps1", "utf8");
describe("Windows Preview evidence is fail closed", () => {
  test("cargo exit code survives the PowerShell tee pipeline", () => {
    expect(workflow).toMatch(/cargo test --locked[^\n]*\| Tee-Object[^\n]*\n\s*\$cargoExit = \$LASTEXITCODE\n\s*if \(\$cargoExit -ne 0\) \{ exit \$cargoExit \}/);
  });
  test("no stale or absent artifact can count as an installer pass", () => {
    const job = workflow.slice(workflow.indexOf("  installers:"));
    expect(workflow).toContain("needs: [installer-artifact]");
    expect(waiter).toContain("head_sha=$GITHUB_SHA");
    expect(waiter).toContain('select(.head_sha ==');
    expect(waiter).toContain('.event == "workflow_dispatch" or .event == "push"');
    expect(job).toContain('xr-desktop-windows-x64');
    expect(waiter).toContain('no unexpired xr-desktop-windows-x64 artifact from exact head');
    expect(waiter).toContain('Installer lifecycle NOT RUN');
    expect(job).toContain('exit 1');
    expect(job).toContain('if: always()');
    expect(job).toContain('windows-installer-lifecycle-evidence');
    expect(job).toContain('scripts/journey/windows-installers.ps1');
  });
  test("both installers, app-owned authenticated sidecar, uninstall and data are required", () => {
    expect(lifecycle).toContain("$msis.Count -eq 1 -and $nsis.Count -eq 1");
    expect(lifecycle).toContain("Resolve-InstallerLocation ([string]$entry.InstallLocation) $uninstaller");
    expect(lifecycle).toContain("Test-Path -LiteralPath $dir -PathType Container");
    expect(lifecycle).toContain("pre-existing XR registration");
    expect(lifecycle).toContain("ParentProcessId = $appId");
    expect(lifecycle).toContain("$_.ExecutablePath -ieq $enginePath");
    expect(lifecycle).toContain("$anonymous.StatusCode -eq 401");
    expect(lifecycle).toContain("$wrong.StatusCode -eq 401");
    expect(lifecycle).toContain("$good.StatusCode -eq 200");
    expect(lifecycle).toContain("$version -eq $expectedVersion");
    expect(lifecycle).toContain("desktop home sentinel was removed or modified");
    expect(lifecycle).toContain("installed binaries or registration remained after uninstall");
    expect(lifecycle).toContain("both installers completed all required assertions");
  });
  test("the direct automation refusal suite runs natively", () => {
    expect(workflow).toContain("bun test test/security/desktop-control-policy.test.ts test/trust/canonical-shell-isolation.test.ts");
  });
});
