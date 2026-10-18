/**
 * XR Phase 2.5 · P2-15 — capability census truth: the gate scans the whole tree.
 *
 * REPRODUCTION (measured): the CI capability gate pre-filtered on
 * `xr-skill.json` before scanning, so the headline "scanned 56 bundled
 * capabilities" silently excluded the 11 legacy Markdown skills. While the
 * README claims 65 bundled skills, the gate declared a different false number.
 *
 * Fix: the gate walks every skills/<name> directory — manifest format AND
 * legacy SKILL.md (the loader's established fallback) — plus the bundled
 * plugins, and prints honest, labelled category totals (never a bare count).
 * A directory that is neither format FAILS the gate honestly instead of
 * vanishing from the count.
 *
 * These tests are static against the gate + honest totals against the real tree
 * via the one computation authority (src/skills/counts.ts).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { countBundledSkills } from "../../src/skills/counts.ts";

const ROOT = join(import.meta.dir, "..", "..");
const gate = readFileSync(join(ROOT, "scripts", "ci-capability-gate.ts"), "utf8");

describe("P2-15 census completeness", () => {
  test("the gate's skill loop no longer pre-filters on xr-skill.json", () => {
    expect(gate).not.toContain(`if (!existsSync(join(dir, "xr-skill.json"))) continue;`);
    expect(gate).toContain('SKILL.md');
  });

  test("the gate loads legacy skills via the established readSkillManifest fallback (no bespoke parser)", () => {
    expect(gate).toContain("readSkillManifest(dir)");
    expect(gate).toContain("legacy-markdown");
  });

  test("a directory that is neither manifest nor SKILL.md fails the gate honestly", () => {
    expect(gate).toContain("neither xr-skill.json nor SKILL.md");
    expect(gate).toMatch(/failures\.push\(`skill \$\{name\}: directory has neither/);
  });

  test("the headline line prints labelled categories (manifest / legacy / plugins), never a bare count", () => {
    expect(gate).toContain("manifest skills");
    expect(gate).toContain("legacy Markdown skills");
    expect(gate).toContain("plugins");
    expect(gate).toMatch(/scanned \$\{checked\.length\} bundled capabilities \(/);
  });

  test("enumeration matches the crate tree itself: categories sum to the whole population", () => {
    const counts = countBundledSkills(join(ROOT, "skills"));
    expect(counts.bundledDirectories).toBe(counts.officialManifests + counts.legacyMarkdown);
    expect(counts.bundledDirectories).toBeGreaterThan(0); // census must discover the tree
  });
});
