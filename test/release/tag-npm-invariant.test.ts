import { describe, expect, test } from "bun:test";
import {
  assertTagNpmInvariant,
  classifyGitTag,
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

  test("vacuous pass: no 1.x on either side (today's HEAD)", () => {
    const r = assertTagNpmInvariant({
      gitTags: ["v3.0.0", "v4.3.0", "v4.5.0", "v7.0.0"],
      npmVersions: ["0.2.0", "3.0.0", "3.0.3", "3.1.5"],
    });
    expect(r.ok).toBe(true);
    expect(r.git1).toEqual([]);
    expect(r.npm1).toEqual([]);
  });

  test("a v1 git tag without a matching npm version fails closed", () => {
    const r = assertTagNpmInvariant({
      gitTags: ["v1.0.0-beta.1", "v7.0.0"],
      npmVersions: ["3.1.5"],
    });
    expect(r.ok).toBe(false);
    expect(r.missingOnNpm).toEqual(["1.0.0-beta.1"]);
  });

  test("a 1.x npm version without a v1 git tag fails closed", () => {
    const r = assertTagNpmInvariant({
      gitTags: ["v7.0.0"],
      npmVersions: ["3.1.5", "1.0.0"],
    });
    expect(r.ok).toBe(false);
    expect(r.missingOnGit).toEqual(["1.0.0"]);
  });

  test("matching 1.x sides pass even with historical tags present", () => {
    const r = assertTagNpmInvariant({
      gitTags: ["v1.0.0-beta.1", "v3.0.0", "v7.0.0"],
      npmVersions: ["1.0.0-beta.1", "3.1.5"],
    });
    expect(r.ok).toBe(true);
  });

  test("repair commands never auto-repoint latest to a beta", () => {
    const cmds = repairCommands("3.1.5").join("\n");
    expect(cmds).toContain("npm dist-tag add @rrrtx/xr@1.0.0 latest");
    expect(cmds).not.toMatch(/dist-tag add @rrrtx\/xr@1\.0\.0-beta/);
    expect(cmds).toContain("Do NOT auto-repoint latest");
  });
});
