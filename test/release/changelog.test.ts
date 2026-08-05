/**
 * XR Phase 9 · T2 — conventional-commits changelog generator tests.
 * Effects: parsed commits land in the right sections; upsert is idempotent
 * and never duplicates or clobbers other versions.
 */
import { describe, expect, test } from "bun:test";
import { parseCommitLine, renderSection, upsertSection, previousTagFor, type ParsedCommit } from "../../scripts/changelog.ts";

describe("Phase 9 · changelog generator", () => {
  test("parses conventional commit subjects (type, scope, breaking)", () => {
    const plain = parseCommitLine("abc1234", "feat(channels): add homebrew formula generator");
    expect(plain.type).toBe("feat");
    expect(plain.scope).toBe("channels");
    expect(plain.breaking).toBe(false);
    expect(plain.subject).toContain("homebrew");

    const breaking = parseCommitLine("def5678", "feat(api)!: drop legacy v0 endpoint");
    expect(breaking.breaking).toBe(true);

    const nonConventional = parseCommitLine("999aaaa", "Random historical commit");
    expect(nonConventional.type).toBe("other");
  });

  test("renders grouped, deterministic sections", () => {
    const commits: ParsedCommit[] = [
      parseCommitLine("a1b2c3d4", "feat(channels): add winget manifest"),
      parseCommitLine("e5f60708", "fix(release): wire slsa outputs"),
      parseCommitLine("90abcdef", "docs(release): verification guide"),
    ];
    const section = renderSection("7.1.0", "2026-08-05", commits);
    expect(section).toContain("## 7.1.0 — 2026-08-05");
    expect(section).toContain("### Features");
    expect(section).toContain("**channels:** add winget manifest");
    expect(section).toContain("### Fixes");
    expect(section).toContain("### Documentation");
    expect(section.indexOf("### Features")).toBeLessThan(section.indexOf("### Fixes"));
  });

  test("breaking changes get a prominent section", () => {
    const commits = [parseCommitLine("a1b2c3d4", "feat!: remove deprecated installer flag")];
    const section = renderSection("8.0.0", "2026-08-05", commits);
    expect(section).toContain("⚠ Breaking changes");
  });

  test("upsert prepends a new entry without touching history", () => {
    const existing = "# Changelog\n\n## 7.0.0 — 2026-07-01\n\nold entry\n";
    const section = renderSection("7.1.0", "2026-08-05", [parseCommitLine("a1b2c3d", "feat: new")]);
    const out = upsertSection(existing, "7.1.0", section);
    expect(out.indexOf("## 7.1.0")).toBeLessThan(out.indexOf("## 7.0.0"));
    expect(out).toContain("old entry");
  });

  test("upsert is idempotent for the same version (replacement, not duplication)", () => {
    const sectionA = renderSection("7.1.0", "2026-08-05", [parseCommitLine("a1b2c3d", "fix: one")]);
    const sectionB = renderSection("7.1.0", "2026-08-06", [parseCommitLine("e5f6070", "fix: two")]);
    const once = upsertSection("# Changelog\n", "7.1.0", sectionA);
    const twice = upsertSection(once, "7.1.0", sectionB);
    expect(twice.match(/## 7\.1\.0/g)!.length).toBe(1);
    expect(twice).toContain("- two (e5f6070)");
    expect(twice).not.toContain("- one (a1b2c3d)");
  });

  test("previousTagFor picks the closest older semver tag", () => {
    const tags = ["v3.0.0", "v4.3.0", "v7.0.0", "backup-before-agent"];
    expect(previousTagFor("7.1.0", tags)).toBe("v7.0.0");
    expect(previousTagFor("4.5.0", tags)).toBe("v4.3.0");
    expect(previousTagFor("2.0.0", tags)).toBeUndefined();
  });
});
