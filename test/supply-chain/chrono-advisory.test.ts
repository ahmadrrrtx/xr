import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const shell = resolve(import.meta.dir, "../../desktop/src-tauri");
const manifest = () => Bun.TOML.parse(readFileSync(resolve(shell, "Cargo.toml"), "utf8")) as {
  dependencies: Record<string, unknown>;
  target: Record<string, { dependencies: Record<string, unknown> }>;
  patch: { "crates-io": Record<string, { path: string }> };
};

test("desktop lock contains no chrono, including inactive optional dependencies", () => {
  // RUSTSEC-2026-0543 is an all-version unmaintained notice, not a
  // patchable version range. Removing only its active feature is insufficient:
  // Cargo also locks serde_with's disabled, weakly referenced chrono feature.
  const lock = Bun.TOML.parse(readFileSync(resolve(shell, "Cargo.lock"), "utf8")) as {
    package: Array<{ name: string }>;
  };
  expect(lock.package.some(pkg => pkg.name === "chrono")).toBe(false);
});

test("Linux trash uses GIO without losing freedesktop deletion metadata", () => {
  const cargo = manifest();
  expect(cargo.dependencies.trash).toBeUndefined();
  expect(cargo.target['cfg(target_os = "linux")'].dependencies.gio).toBe("0.18");
  const native = cargo.target['cfg(not(target_os = "linux"))'].dependencies.trash as {
    "default-features": boolean; features: string[];
  };
  expect(native["default-features"]).toBe(false);
  expect(native.features).toEqual(["coinit_apartmentthreaded"]);
  const callsite = readFileSync(resolve(shell, "src/commands/workspaces/db.rs"), "utf8");
  expect(callsite).toContain("crate::platform_trash::delete(&path)");
});

test("Tauri's serialization dependency enables only the macro actually used", () => {
  const patch = manifest().patch["crates-io"]["tauri-utils"];
  expect(patch.path).toBe("vendor/tauri-utils");
  const vendored = Bun.TOML.parse(readFileSync(resolve(shell, patch.path, "Cargo.toml"), "utf8")) as {
    dependencies: { serde_with: { "default-features": boolean; features: string[] } };
  };
  expect(vendored.dependencies.serde_with["default-features"]).toBe(false);
  expect(vendored.dependencies.serde_with.features).toEqual(["macros"]);
});
