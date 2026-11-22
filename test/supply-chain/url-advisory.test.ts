import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// RUSTSEC-2026-0592 (GHSA-hrj5-67jp-wqp9, added 2026-11-22): in url <= 2.5.8, `Url::origin()` recursed once per
// nested `blob:` prefix, so one crafted URL overflowed the stack and aborted the process. Fixed in 2.5.9, which
// requires form_urlencoded ^1.2.3 (NEW-18).
const lock = () => readFileSync(resolve(import.meta.dir, "../../desktop/src-tauri/Cargo.lock"), "utf8");
const locked = (text: string, name: string) =>
  [...text.matchAll(new RegExp(`^name = "${name}"\\nversion = "(\\d+)\\.(\\d+)\\.(\\d+)"`, "gm"))].map(
    ([, a, b, c]) => [Number(a), Number(b), Number(c)] as const,
  );
const atLeast = ([a, b, c]: readonly number[], [x, y, z]: readonly number[]) =>
  a! > x! || (a === x && (b! > y! || (b === y && c! >= z!)));

test("desktop lock does not select the RUSTSEC-2026-0592 vulnerable url range (<= 2.5.8)", () => {
  const versions = locked(lock(), "url");
  expect(versions.length).toBeGreaterThan(0);
  for (const v of versions) expect(atLeast(v, [2, 5, 9])).toBe(true);
});

test("url 2.5.9's form_urlencoded requirement (^1.2.3) is met, so cargo --locked accepts the lock", () => {
  const versions = locked(lock(), "form_urlencoded");
  expect(versions.length).toBeGreaterThan(0);
  for (const v of versions) expect(atLeast(v, [1, 2, 3])).toBe(true);
});
