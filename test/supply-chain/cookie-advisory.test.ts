import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// RUSTSEC-2026-0594 (GHSA-8wcq-xq25-7fhm, added 2026-11-23): private-cookie AES-GCM nonces drawn from
// rand::thread_rng() can repeat across fork(). Affected: >= 0.11.3, < 0.12.0 and >= 0.14.0, < 0.18.3; fixed in
// 0.18.3 (NEW-19). tauri, tauri-runtime, wry and cookie_store all require cookie ^0.18.
const lock = () => readFileSync(resolve(import.meta.dir, "../../desktop/src-tauri/Cargo.lock"), "utf8");
const versions = (text: string) =>
  [...text.matchAll(/^name = "cookie"\nversion = "(\d+)\.(\d+)\.(\d+)"/gm)].map(
    ([, a, b, c]) => [Number(a), Number(b), Number(c)] as const,
  );
const below = ([a, b, c]: readonly number[], [x, y, z]: readonly number[]) =>
  a! < x! || (a === x && (b! < y! || (b === y && c! < z!)));
const affected = (v: readonly number[]) =>
  (!below(v, [0, 11, 3]) && below(v, [0, 12, 0])) || (!below(v, [0, 14, 0]) && below(v, [0, 18, 3]));

test("the range check matches the advisory's bounds", () => {
  expect(affected([0, 18, 2])).toBe(true);
  expect(affected([0, 14, 0])).toBe(true);
  expect(affected([0, 11, 3])).toBe(true);
  expect(affected([0, 18, 3])).toBe(false);
  expect(affected([0, 13, 9])).toBe(false);
  expect(affected([0, 11, 2])).toBe(false);
});

test("desktop lock does not select a RUSTSEC-2026-0594 vulnerable cookie version", () => {
  const found = versions(lock());
  expect(found.length).toBeGreaterThan(0);
  for (const v of found) expect(affected(v)).toBe(false);
});
