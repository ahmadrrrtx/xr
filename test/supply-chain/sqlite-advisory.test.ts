import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const lock = readFileSync(resolve(root, "desktop/src-tauri/Cargo.lock"), "utf8");
const manifest = readFileSync(resolve(root, "desktop/src-tauri/Cargo.toml"), "utf8");
function lockedVersion(name: string): number[] {
  const sections = lock.split("[[package]]");
  const pkg = sections.filter((s) => new RegExp(`^\\s*name = "${name}"\\s*$`, "m").test(s));
  expect(pkg).toHaveLength(1);
  const v = pkg[0]?.match(/^version = "(\d+)\.(\d+)\.(\d+)"$/m);
  expect(v).not.toBeNull();
  return v!.slice(1).map(Number);
}
function atLeast(v: number[], min: number[]): boolean {
  for (let i = 0; i < 3; i++) { if (v[i]! !== min[i]!) return v[i]! > min[i]!; }
  return true;
}

test("desktop bundled SQLite remains outside RUSTSEC-2026-0459's vulnerable range", () => {
  expect(manifest).toMatch(/^rusqlite\s*=\s*\{[^\n]*features\s*=\s*\[\s*"bundled"\s*\]/m);
  expect(atLeast(lockedVersion("libsqlite3-sys"), [0, 39, 0])).toBe(true);
  expect(atLeast(lockedVersion("rusqlite"), [0, 41, 0])).toBe(true);
});
