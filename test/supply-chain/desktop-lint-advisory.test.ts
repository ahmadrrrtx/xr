import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lockedDependencies } from "../../scripts/sbom.ts";

const desktop = resolve(import.meta.dir, "../../desktop");

test("all desktop minimatch copies are outside GHSA-g3hv-75wg-m249's affected range", () => {
  const copies = lockedDependencies(resolve(desktop, "bun.lock"))
    .filter(pkg => pkg.name === "minimatch");
  expect(copies.length).toBeGreaterThan(0);
  for (const pkg of copies) {
    expect(Bun.semver.satisfies(pkg.version, ">=11.0.1")).toBe(true);
    expect(pkg.integrity).toMatch(/^sha512-/);
  }
  // Upstream parents now support the patched major; no forced override is needed.
  const manifest = JSON.parse(readFileSync(resolve(desktop, "package.json"), "utf8"));
  expect(manifest.overrides?.minimatch).toBeUndefined();
});

test("desktop's retired minimatch exception cannot hide a lint-lock regression", () => {
  const policy = Bun.TOML.parse(readFileSync(resolve(desktop, "osv-scanner.toml"), "utf8")) as {
    IgnoredVulns?: { id: string }[];
  };
  expect((policy.IgnoredVulns ?? []).map(entry => entry.id))
    .not.toContain("GHSA-g3hv-75wg-m249");
});
