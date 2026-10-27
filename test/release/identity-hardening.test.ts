import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  compareSemver,
  evaluateSurfaces,
  loadManifest,
  stampCargoLockRoot,
  validateReleaseTag,
} from "../../scripts/release-manifest.ts";

const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});

describe("RC-101 release identity is checked, never silently repaired", () => {
  test("SemVer 2 precedence includes numeric prerelease identifiers and ignores build metadata", () => {
    const order = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let i = 1; i < order.length; i++)
      expect(compareSemver(order[i - 1], order[i])).toBeLessThan(0);
    expect(compareSemver("v1.1.1-rc.9", "1.1.1-rc.10")).toBe(-1);
    expect(compareSemver("1.0.0+a", "1.0.0+b")).toBe(0);
    for (const bad of ["01.0.0", "1.0.0-rc..1", "1.0.0-01", "1.0.0-"])
      expect(() => compareSemver(bad, "1.0.0")).toThrow();
  });

  test("desktop JS package and root Cargo lock identity are mandatory declared targets", () => {
    const m = loadManifest();
    const targets = m.stampTargets.filter((t) =>
      ["desktop/package.json", "desktop/src-tauri/Cargo.lock"].includes(t.path),
    );
    expect(targets.length).toBe(2);
    const root = mkdtempSync(join(tmpdir(), "xr-identity-"));
    roots.push(root);
    for (const t of targets) {
      const original = readFileSync(
        join(import.meta.dir, "../..", t.path),
        "utf8",
      );
      const changed =
        t.kind === "cargo-lock-root"
          ? stampCargoLockRoot(original, "0.0.0")
          : JSON.stringify(
              { ...JSON.parse(original), version: "0.0.0" },
              null,
              2,
            ) + "\n";
      mkdirSync(dirname(join(root, t.path)), { recursive: true });
      writeFileSync(join(root, t.path), changed);
    }
    const results = evaluateSurfaces({ ...m, stampTargets: targets }, root);
    expect(results.every((r) => !r.inSync)).toBe(true);
    for (const t of targets)
      expect(readFileSync(join(root, t.path), "utf8")).toContain("0.0.0"); // check is read-only
  });

  test("lock stamping preserves every dependency byte and refuses missing/duplicate roots", () => {
    const before =
      'version = 4\n\n[[package]]\nname = "other"\nversion = "9.0.0"\nchecksum = "fixture"\n\n[[package]]\nname = "xr-desktop"\nversion = "1.0.0"\ndependencies = ["other"]\n';
    expect(stampCargoLockRoot(before, "1.1.1-rc.1")).toBe(
      before.replace('version = "1.0.0"', 'version = "1.1.1-rc.1"'),
    );
    expect(() => stampCargoLockRoot("version = 4\n", "1.0.0")).toThrow();
    expect(() => stampCargoLockRoot(before + before, "1.0.0")).toThrow();
  });

  test("native builds depend on gates and no post-build version rewrite is permitted", () => {
    const workflow = readFileSync(
      join(import.meta.dir, "../../.github/workflows/release.yml"),
      "utf8",
    );
    const build = workflow.split("\n  build:\n")[1]!.split("\n  assemble:")[0]!;
    expect(build).toMatch(/needs:\s*\[gates\]/);
    expect(workflow).not.toContain("STAMP_VERSION");
    expect(workflow).not.toContain("bun run release:stamp");
    expect(workflow).not.toContain("m.identity.version =");
  });

  test("tag must match committed identity, cannot be withdrawn or falsely stable", () => {
    const m = loadManifest();
    const preview = {
      ...m,
      identity: {
        ...m.identity,
        version: "1.1.1-rc.1",
        stability: "public-beta" as const,
      },
    };
    expect(() => validateReleaseTag(preview, "v1.1.1-rc.1")).not.toThrow();
    expect(() => validateReleaseTag(preview, "v1.1.1")).toThrow(
      /does not match/,
    );
    const withdrawn = {
      ...preview,
      channels: {
        ...m.channels!,
        withdrawnTags: [
          { tag: "v1.1.1-rc.1", reason: "fixture withdrawn release" },
        ],
      },
    };
    expect(() => validateReleaseTag(withdrawn, "v1.1.1-rc.1")).toThrow(
      /withdrawn/,
    );
    const stable = {
      ...m,
      identity: {
        ...m.identity,
        version: "1.1.1",
        stability: "public-beta" as const,
      },
    };
    expect(() => validateReleaseTag(stable, "v1.1.1")).toThrow(
      /stability=stable/,
    );
    expect(() =>
      validateReleaseTag(
        { ...stable, identity: { ...stable.identity, stability: "stable" } },
        "v1.1.1",
      ),
    ).not.toThrow();
  });
});
