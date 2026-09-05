import { describe, expect, test } from "bun:test";
import {
  assertTagNpmInvariant,
  classifyGitTag,
  isPrerelease,
  repairCommands,
} from "../../scripts/tag-npm-invariant.ts";

describe("Phase 3 — tag ⇔ npm invariant (1.x line)", () => {
  test("historical v3/v4/v7 and backup-* tags are out of band", () => {
    expect(classifyGitTag("v3.0.0")).toBe("historical");
    expect(classifyGitTag("v4.5.0")).toBe("historical");
    expect(classifyGitTag("v7.0.0")).toBe("historical");
    expect(classifyGitTag("backup-pre-rebaseline")).toBe("historical");
    expect(classifyGitTag("v1.0.0")).toBe("line-1");
    expect(classifyGitTag("v1.0.0-beta.1")).toBe("line-1");
    expect(classifyGitTag("v2.0.0")).toBe("other");
  });

  test("isPrerelease detects semver pre-release identifiers (stable gate binds releases only)", () => {
    expect(isPrerelease("1.0.0-beta.1")).toBe(true);
    expect(isPrerelease("v1.2.3-rc.2")).toBe(true);
    expect(isPrerelease("1.0.0-alpha")).toBe(true);
    expect(isPrerelease("1.0.0")).toBe(false);
    expect(isPrerelease("v1.2.3")).toBe(false);
    // Build metadata does NOT make a stable version a pre-release.
    expect(isPrerelease("1.0.0+20260101")).toBe(false);
  });

  test("vacuous pass: no STABLE 1.x on either side (today's HEAD)", () => {
    const r = assertTagNpmInvariant({
      gitTags: ["v3.0.0", "v4.3.0", "v4.5.0", "v7.0.0"],
      npmVersions: ["0.2.0", "3.0.0", "3.0.3", "3.1.5"],
    });
    expect(r.ok).toBe(true);
    expect(r.git1).toEqual([]);
    expect(r.npm1).toEqual([]);
  });

  test("a lone beta git tag with no stable publish is vacuous (pre-release does not gate the stable line)", () => {
    // This is today's real state: v1.0.0-beta.1 exists, no stable 1.x shipped.
    const r = assertTagNpmInvariant({
      gitTags: ["v1.0.0-beta.1", "v7.0.0"],
      npmVersions: ["3.1.5"],
    });
    expect(r.ok).toBe(true);
    expect(r.git1).toEqual([]); // no stable tag
    expect(r.gitPre).toEqual(["1.0.0-beta.1"]); // beta surfaced, not gated
    expect(r.npm1).toEqual([]);
    expect(r.missingOnNpm).toEqual([]);
  });

  test("a STABLE v1 git tag without a matching stable npm version fails closed", () => {
    const r = assertTagNpmInvariant({
      gitTags: ["v1.0.0", "v7.0.0"],
      npmVersions: ["3.1.5"],
    });
    expect(r.ok).toBe(false);
    expect(r.missingOnNpm).toEqual(["1.0.0"]);
  });

  test("a stable 1.x npm version without a v1 git tag fails closed", () => {
    const r = assertTagNpmInvariant({
      gitTags: ["v7.0.0"],
      npmVersions: ["3.1.5", "1.0.0"],
    });
    expect(r.ok).toBe(false);
    expect(r.missingOnGit).toEqual(["1.0.0"]);
  });

  test("a stable npm 1.x with only a beta git tag still fails closed (beta does not satisfy stable)", () => {
    const r = assertTagNpmInvariant({
      gitTags: ["v1.0.0-beta.1", "v7.0.0"],
      npmVersions: ["1.0.0", "3.1.5"],
    });
    expect(r.ok).toBe(false);
    expect(r.missingOnGit).toEqual(["1.0.0"]);
  });

  test("matching stable 1.x sides pass even with historical tags present", () => {
    const r = assertTagNpmInvariant({
      gitTags: ["v1.0.0", "v1.0.0-beta.1", "v3.0.0", "v7.0.0"],
      npmVersions: ["1.0.0", "1.0.0-beta.1", "3.1.5"],
    });
    expect(r.ok).toBe(true);
    expect(r.git1).toEqual(["1.0.0"]);
    expect(r.gitPre).toEqual(["1.0.0-beta.1"]);
  });

  test("repair commands never auto-repoint latest to a beta", () => {
    const cmds = repairCommands("3.1.5").join("\n");
    expect(cmds).toContain("npm dist-tag add @rrrtx/xr@1.0.0 latest");
    expect(cmds).not.toMatch(/dist-tag add @rrrtx\/xr@1\.0\.0-beta/);
    expect(cmds).toContain("Do NOT auto-repoint latest");
  });
});
