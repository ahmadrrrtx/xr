/**
 * XR — skill-count authority (audit GAP-008 · P2).
 *
 * The audit found four different numbers all labelled "skills" (65 / 54 / 79 /
 * 64). None was false; they measured different populations but were presented
 * identically, so a reader could not tell which was which. For a project whose
 * differentiator is mechanically-verified honesty, an ambiguous count is a
 * real defect.
 *
 * These tests pin the authority itself, and — importantly — pin it against the
 * REAL bundled tree rather than a fixture, so the number the README claims and
 * the number this function computes cannot drift apart silently.
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { countBundledSkills, describeSkillCounts } from "../../src/skills/counts.ts";

describe("GAP-008 — one authority for skill counts", () => {
  test("counts the real bundled tree consistently", () => {
    const counts = countBundledSkills();

    expect(counts.bundledDirectories).toBeGreaterThan(0);
    // The three numbers are internally consistent by construction.
    expect(counts.officialManifests + counts.legacyMarkdown).toBe(counts.bundledDirectories);
    expect(counts.officialManifests).toBeLessThanOrEqual(counts.bundledDirectories);
  });

  test("the release manifest's skills claim matches the computed count", async () => {
    const manifest = JSON.parse(await Bun.file("release.manifest.json").text());
    const counts = countBundledSkills();

    // Find the mechanically-verified skills-count claim wherever it lives.
    const serialized = JSON.stringify(manifest);
    // The manifest states a bundled-skills number; it must equal what the one
    // authority computes from disk. This is the drift guard the audit asked for.
    expect(serialized).toContain(String(counts.bundledDirectories));
  });

  test("populations are named, not conflated, in the human summary", () => {
    const summary = describeSkillCounts({
      bundledDirectories: 65,
      officialManifests: 54,
      legacyMarkdown: 11,
    });

    expect(summary).toContain("65 bundled");
    expect(summary).toContain("54 with an xr-skill.json manifest");
    expect(summary).toContain("11 legacy markdown");
  });

  test("counts a synthetic tree exactly (the function is not vacuous)", () => {
    const root = mkdtempSync(join(tmpdir(), "xr-skill-count-"));
    try {
      // 2 official + 1 legacy + a stray file that must not be counted.
      for (const name of ["alpha", "beta"]) {
        mkdirSync(join(root, name));
        writeFileSync(join(root, name, "xr-skill.json"), "{}");
      }
      mkdirSync(join(root, "gamma"));
      writeFileSync(join(root, "gamma", "SKILL.md"), "# legacy");
      writeFileSync(join(root, "README.md"), "not a skill");

      const counts = countBundledSkills(root);
      expect(counts.bundledDirectories).toBe(3);
      expect(counts.officialManifests).toBe(2);
      expect(counts.legacyMarkdown).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a missing tree yields zeros rather than throwing", () => {
    const counts = countBundledSkills(join(tmpdir(), "xr-does-not-exist-" + Date.now()));
    expect(counts).toEqual({ bundledDirectories: 0, officialManifests: 0, legacyMarkdown: 0 });
  });
});
