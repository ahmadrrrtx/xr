import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("desktop lock does not select the RUSTSEC-2026-0486 vulnerable rustix range", () => {
  const lock = readFileSync(resolve(import.meta.dir, "../../desktop/src-tauri/Cargo.lock"), "utf8");
  const versions = [...lock.matchAll(/^name = "rustix"\nversion = "(\d+)\.(\d+)\.(\d+)"/gm)];
  expect(versions.length).toBeGreaterThan(0);
  for (const [, major, minor, patch] of versions) {
    const [a, b, c] = [Number(major), Number(minor), Number(patch)];
    expect(a === 0 || a > 1 || (a === 1 && (b > 1 || (b === 1 && c >= 6)))).toBe(true);
  }
});
