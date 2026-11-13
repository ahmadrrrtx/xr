import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("cloud lock selects Hono outside the five 2026 advisory ranges", () => {
  const lock = readFileSync(resolve(import.meta.dir, "../../cloud/bun.lock"), "utf8");
  const matches = [...lock.matchAll(/"hono": \["hono@(\d+)\.(\d+)\.(\d+)"/g)];
  expect(matches).toHaveLength(1);
  const [, major, minor, patch] = matches[0]!;
  const [a, b, c] = [Number(major), Number(minor), Number(patch)];
  expect(a > 4 || (a === 4 && (b > 13 || (b === 13 && c >= 16)))).toBe(true);
});
