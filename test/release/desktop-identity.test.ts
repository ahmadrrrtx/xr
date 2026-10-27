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
  msiWixVersion,
  stampJsonVersionOnly,
  stampTauriConf,
  stampTomlPackageVersion,
} from "../../scripts/release-manifest.ts";

const ROOT = join(import.meta.dir, "..", "..");

describe("desktop version-identity surfaces (L-008)", () => {
  test("manifest declares tauri.conf.json and Cargo.toml as stamped targets", () => {
    const manifest = loadManifest();
    const ids = manifest.stampTargets.map((t) => `${t.kind}:${t.id}`);
    expect(ids).toContain("tauri-conf:tauri.conf.json");
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

  // The MSI target refuses a semver pre-release ("optional pre-release
  // identifier ... must be numeric-only"), so a preview tag could not bundle a
  // .msi at all until the mapping below existed. It must ALSO order correctly:
  // installing 1.1.1 over 1.1.1-rc.1 cannot be a downgrade.
  test("tauri.conf.json: the MSI version is derived from a pre-release and orders below its release", () => {
    expect(msiWixVersion("1.1.1-rc.1")).toBe("1.1.0.1");
    expect(msiWixVersion("1.1.1-rc.2")).toBe("1.1.0.2");
    expect(msiWixVersion("2.1.0-beta.3")).toBe("2.0.65535.3");
    expect(msiWixVersion("2.0.0-rc.1")).toBe("1.65535.65535.1");
    expect(msiWixVersion("1.1.1-rc")).toBe("1.1.0.1");
    // Stable versions get NO override: Tauri's own derivation is right there,
    // and a stale pre-release mapping must never leak into a stable build.
    expect(msiWixVersion("1.1.1")).toBeUndefined();
    expect(() => msiWixVersion("1.1.1-rc.70000")).toThrow(/0\.\.65535/);
    expect(() => msiWixVersion("not-a-version")).toThrow(/semver/);

    const conf = JSON.stringify({ version: "0.0.0", bundle: { windows: { nsis: { installMode: "currentUser" } } } }, null, 2) + "\n";
    const pre = JSON.parse(stampTauriConf(conf, "1.1.1-rc.1"));
    expect(pre.version).toBe("1.1.1-rc.1");
    expect(pre.bundle.windows.wix.version).toBe("1.1.0.1");
    // Everything else survives the stamp byte-for-byte.
    expect(pre.bundle.windows.nsis).toEqual({ installMode: "currentUser" });
    // A stable bump REMOVES the mapping instead of inheriting it.
    const stable = JSON.parse(stampTauriConf(JSON.stringify(pre), "1.1.1"));
    expect(stable.bundle.windows.wix).toBeUndefined();
    expect(stable.bundle.windows.nsis).toEqual({ installMode: "currentUser" });
  });

  test("the committed tauri.conf.json MSI version matches the manifest identity", () => {
    const manifest = loadManifest();
    const conf = JSON.parse(readFileSync(join(ROOT, "desktop/src-tauri/tauri.conf.json"), "utf8"));
    expect(conf.bundle.windows.wix.version).toBe(msiWixVersion(manifest.identity.version) as string);
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
