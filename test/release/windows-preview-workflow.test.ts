import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/windows-preview-test.yml", "utf8");
describe("Windows Preview evidence is fail closed", () => {
  test("cargo exit code survives the PowerShell tee pipeline", () => {
    expect(workflow).toMatch(/cargo test --locked[^\n]*\| Tee-Object[^\n]*\n\s*\$cargoExit = \$LASTEXITCODE\n\s*if \(\$cargoExit -ne 0\) \{ exit \$cargoExit \}/);
  });
  test("metadata-only installer lane reports not run and fails even when artifacts exist", () => {
    const block = workflow.slice(workflow.indexOf("      - name: Installer steps BLOCKED"));
    expect(block).toContain("if: always()");
    expect(block).toContain("have NOT RUN");
    expect(block).toContain("exit 1");
  });
  test("the direct automation refusal suite runs natively", () => {
    expect(workflow).toContain("bun test test/security/desktop-control-policy.test.ts test/trust/canonical-shell-isolation.test.ts");
  });
});
