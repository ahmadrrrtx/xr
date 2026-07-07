/** XR 2.1E — Official Skill Pack hardening tests. */
import { test, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "skills");

function officialSkillDirs(): string[] {
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((dir) => existsSync(join(dir, "xr-skill.json")));
}

test("official XR Skill packs include professional hardening assets", () => {
  const dirs = officialSkillDirs();
  expect(dirs.length).toBeGreaterThanOrEqual(50);
  for (const dir of dirs) {
    const manifest = JSON.parse(readFileSync(join(dir, "xr-skill.json"), "utf8"));
    for (const rel of [
      "knowledge/playbook.md",
      "prompts/default.md",
      "prompts/diagnostic.md",
      "docs/operating-manual.md",
      "docs/permissions.md",
      "examples/professional.md",
      "tests/quality.md",
      "tests/permissions.md",
    ]) expect(existsSync(join(dir, rel))).toBe(true);
    expect(manifest.content.knowledge).toContain("knowledge/playbook.md");
    expect(manifest.content.promptTemplates).toContain("prompts/default.md");
    expect(manifest.content.promptTemplates).toContain("prompts/diagnostic.md");
    expect(manifest.content.examples).toContain("examples/professional.md");
    expect(manifest.content.tests).toContain("tests/quality.md");
    expect(manifest.content.tests).toContain("tests/permissions.md");
    expect(manifest.contributions.workflows.length).toBeGreaterThanOrEqual(3);
    expect(manifest.memoryTemplates.length).toBeGreaterThanOrEqual(3);
  }
});
