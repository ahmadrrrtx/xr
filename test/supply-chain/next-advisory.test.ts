import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lockedDependencies } from "../../scripts/sbom.ts";

const website = resolve(import.meta.dir, "../../website");
const manifest = JSON.parse(readFileSync(resolve(website, "package.json"), "utf8"));

function assertPatched(version: string) {
  // CVE-2026-119790 / GHSA-mfr8-8qww-v76h affects >=16.3.0 <16.4.5.
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(Bun.semver.satisfies(version, ">=16.3.0 <16.4.5")).toBe(false);
  expect(version).toBe(manifest.dependencies.next);
}

test("website manifest pins Next outside CVE-2026-119790's affected range", () => {
  assertPatched(manifest.dependencies.next);
});

test("website npm lock selects the same patched Next, including nested copies", () => {
  const lock = JSON.parse(readFileSync(resolve(website, "package-lock.json"), "utf8"));
  expect(lock.packages[""].dependencies.next).toBe(manifest.dependencies.next);
  const copies = Object.entries(lock.packages).filter(([path]) => /(^|\/)node_modules\/next$/.test(path));
  expect(copies.length).toBeGreaterThan(0);
  for (const [, entry] of copies) {
    const pkg = entry as { version: string; integrity: string };
    assertPatched(pkg.version);
    expect(pkg.integrity).toMatch(/^sha512-/);
  }
});

test("website Bun lock selects the same patched Next, including nested copies", () => {
  const copies = lockedDependencies(resolve(website, "bun.lock")).filter(pkg => pkg.name === "next");
  expect(copies.length).toBeGreaterThan(0);
  for (const pkg of copies) {
    assertPatched(pkg.version);
    expect(pkg.integrity).toMatch(/^sha512-/);
  }
});
