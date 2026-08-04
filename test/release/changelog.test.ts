/**
 * XR Phase 9 · T2 (Part 10) — changelog generator (conventional commits).
 * Effects: real git fixture repo → grouped, deterministic notes; empty ranges
 * produce an explicit marker; the previous stable tag is found correctly.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { commitsInRange, parseCommitLine, previousStableTag, renderChangelog } from "../../scripts/changelog.ts";

const REPO = mkdtempSync(join(tmpdir(), "xr-changelog-repo-"));

function git(args: string[]): void {
  const r = spawnSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

function commit(msg: string): void {
  writeFileSync(join(REPO, `f-${Date.now()}-${Math.random()}.txt`), "x");
  git(["add", "-A"]);
  git(["commit", "-m", msg]);
}

beforeAll(() => {
  git(["init", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  commit("feat(cli): initial version");
  git(["tag", "v7.0.0"]);
  commit("feat(release): signed binary distribution");
  commit("fix(updater): verify checksums before swap");
  commit("docs(release): verification guide");
  commit("feat(website)!: drop fictional integrations");
  commit("perf(startup): lazy boot improvements");
  commit("random non-conventional subject");
  git(["tag", "v7.1.0"]);
});

afterAll(() => rmSync(REPO, { recursive: true, force: true }));

describe("Phase 9 · changelog generator", () => {
  test("parses conventional commit lines; rejects non-conventional", () => {
    const p = parseCommitLine("abc1234 feat(scope): add thing");
    expect(p).toEqual({ hash: "abc1234", type: "feat", scope: "scope", subject: "add thing", breaking: false });
    const b = parseCommitLine("def5678 feat(core)!: break api");
    expect(b!.breaking).toBe(true);
    expect(parseCommitLine("zzz hello world")).toBeNull();
  });

  test("range collection returns only conventional subjects, newest first", () => {
    const commits = commitsInRange("v7.0.0", "v7.1.0", REPO);
    expect(commits.length).toBe(5); // non-conventional subject excluded
    expect(commits.map((c) => c.type)).toContain("feat");
    expect(commits.map((c) => c.type)).toContain("fix");
    expect(commits.map((c) => c.type)).toContain("perf");
    expect(commits.map((c) => c.type)).toContain("docs");
    expect(commits.some((c) => c.breaking)).toBe(true);
  });

  test("renders grouped sections with breaking callout, deterministically", () => {
    const commits = commitsInRange("v7.0.0", "v7.1.0", REPO);
    const a = renderChangelog({ version: "7.1.0", date: "2026-08-04", commits, fromRef: "v7.0.0", toRef: "v7.1.0" });
    const b = renderChangelog({ version: "7.1.0", date: "2026-08-04", commits, fromRef: "v7.0.0", toRef: "v7.1.0" });
    expect(a).toBe(b); // deterministic for the range
    expect(a).toContain("## 7.1.0 — 2026-08-04");
    expect(a).toContain("### ⚠ Breaking changes");
    expect(a).toContain("### Added");
    expect(a).toContain("### Fixed");
    expect(a).toContain("### Performance");
    expect(a).toContain("**release:** signed binary distribution");
    expect(a).toContain("`v7.0.0…v7.1.0`");
    // Added comes before Fixed (stable section order)
    expect(a.indexOf("### Added")).toBeLessThan(a.indexOf("### Fixed"));
  });

  test("empty range → explicit marker, never silent emptiness", () => {
    const out = renderChangelog({ version: "7.1.0", date: "2026-08-04", commits: [], fromRef: "v7.1.0", toRef: "v7.1.0" });
    expect(out).toContain("_No user-facing changes in this range._");
  });

  test("previousStableTag ignores prereleases and picks the newest stable", () => {
    expect(previousStableTag(REPO)).toBe("v7.1.0");
    git(["tag", "v7.2.0-beta.1"]);
    expect(previousStableTag(REPO)).toBe("v7.1.0");
  });
});
