/**
 * Launch-audit L-008 regression: the desktop identity surfaces that users
 * actually SEE (tauri.conf.json on every installer; Cargo.toml crate
 * version) must be release-stamped surfaces — before this audit the gate
 * covered six surfaces and Cargo.toml had silently drifted to 0.2.0.
 * These tests would have caught both the missing surfaces and the drift.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateSurfaces,
  loadManifest,
  stampJsonVersionOnly,
  stampTomlPackageVersion,
} from "../../scripts/release-manifest.ts";

const ROOT = join(import.meta.dir, "..", "..");

describe("desktop version-identity surfaces (L-008)", () => {
  test("manifest declares tauri.conf.json and Cargo.toml as stamped targets", () => {
    const manifest = loadManifest();
    const ids = manifest.stampTargets.map((t) => `${t.kind}:${t.id}`);
    expect(ids).toContain("json-version-only:tauri.conf.json");
    expect(ids).toContain("toml-version:Cargo.toml");
  });

  test("all desktop surfaces evaluate in sync at the manifest version", () => {
    const manifest = loadManifest();
    const results = evaluateSurfaces(manifest);
    for (const id of ["tauri.conf.json", "Cargo.toml"]) {
      const r = results.find((x) => x.id === id);
      expect(r, `${id} missing from surface evaluation`).toBeTruthy();
      expect(r!.inSync, `${id} drifted: ${r!.detail}`).toBe(true);
    }
  });

  test("stampJsonVersionOnly touches ONLY the version key", () => {
    const conf = JSON.parse(readFileSync(join(ROOT, "desktop/src-tauri/tauri.conf.json"), "utf8"));
    const stamped = JSON.parse(stampJsonVersionOnly(JSON.stringify(conf, null, 2) + "\n", "9.9.9"));
    expect(stamped.version).toBe("9.9.9");
    expect(stamped.productName).toBe(conf.productName);
    expect(stamped.bundle).toEqual(conf.bundle);
    expect(stamped.app).toEqual(conf.app);
    expect(Object.keys(stamped).sort()).toEqual(Object.keys(conf).sort());
  });

  test("stampTomlPackageVersion rewrites only the [package] version line and fails loudly without one", () => {
    const toml = `[package]\nname = "xr-desktop"\nversion = "0.2.0"\nedition = "2021"\n\n[dependencies]\nfoo = { version = "1.0" }\n`;
    const stamped = stampTomlPackageVersion(toml, "1.2.3");
    expect(stamped).toContain('[package]\nname = "xr-desktop"\nversion = "1.2.3"');
    // [dependencies] foo.version must NOT be rewritten.
    expect(stamped).toContain('foo = { version = "1.0" }');
    expect(() => stampTomlPackageVersion("[lib]\nname = \"x\"\n", "1.0.0")).toThrow(/no \[package\] version/);
  });

  test("Cargo.toml version equals the manifest version (the drift that shipped)", () => {
    const manifest = loadManifest();
    const cargo = readFileSync(join(ROOT, "desktop/src-tauri/Cargo.toml"), "utf8");
    const pkgVersion = cargo.match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/ms)?.[1];
    expect(pkgVersion).toBe(manifest.identity.version);
  });
});
