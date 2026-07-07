/** XR 2.1B — Skill SDK tests. */
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillSDK } from "../src/skills/sdk.ts";
import { SkillMarketplace } from "../src/skills/marketplace.ts";

test("SkillSDK init scaffolds production skill structure", () => {
  process.env.XR_HOME = mkdtempSync(join(tmpdir(), "xr-sdk-home-"));
  const dir = mkdtempSync(join(tmpdir(), "xr-sdk-skill-"));
  const sdk = new SkillSDK(new SkillMarketplace());
  const result = sdk.init({ dir, name: "Contract Reviewer", category: "business", publisher: "test-publisher" });
  expect(result.id).toBe("contract-reviewer");
  for (const rel of [
    "xr-skill.json",
    "SKILL.md",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "assets/icon.svg",
    "docs/reasoning.md",
    "docs/permissions.md",
    "docs/development.md",
    "knowledge/reference.md",
    "prompts/default.md",
    "templates/output.md",
    "examples/basic.md",
    "examples/advanced.md",
    "tests/selection.md",
    "tests/permissions.md",
    "tests/workflow.md",
    ".xrskillignore",
    "xr-skill.lock",
  ]) expect(existsSync(join(dir, rel))).toBe(true);
});

test("SkillSDK validates, tests, builds, and doctors a generated skill", () => {
  process.env.XR_HOME = mkdtempSync(join(tmpdir(), "xr-sdk-build-home-"));
  const dir = mkdtempSync(join(tmpdir(), "xr-sdk-build-skill-"));
  const sdk = new SkillSDK(new SkillMarketplace());
  sdk.init({ dir, name: "Incident Writer", category: "security", publisher: "test-publisher" });
  expect(sdk.validate(dir).ok).toBe(true);
  expect(sdk.test(dir).ok).toBe(true);
  const build = sdk.build(dir);
  expect(build.ok).toBe(true);
  expect(build.packagePath && existsSync(build.packagePath)).toBe(true);
  expect(build.reportPath && existsSync(build.reportPath)).toBe(true);
  expect(sdk.doctor(dir).ok).toBe(true);
});
