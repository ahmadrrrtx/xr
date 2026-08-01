/**
 * XR Phase 3 · T4 — content-addressed scan cache tests.
 *
 * The cache must:
 *   - MISS on first scan, HIT on the identical second scan;
 *   - return identical payloads (correctness — the cache is a mirror);
 *   - INVALIDATE when a tracked file changes content/size/mtime;
 *   - INVALIDATE when a tracked state file changes;
 *   - never throw on a corrupt cache (falls back to a full scan).
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { describe, test, expect, beforeEach } from "bun:test";
import { cachedScan, fingerprintDir, hashFingerprint } from "../../src/util/scan-cache.ts";

let root: string;
let home: string;

beforeEach(() => {
  root = join(tmpdir(), `xr-scan-cache-${process.pid}-${Date.now()}`);
  home = join(root, "home");
  mkdirSync(join(root, "tree"), { recursive: true });
  mkdirSync(home, { recursive: true });
});

function treeFile(name: string, content: string): void {
  writeFileSync(join(root, "tree", name), content);
}

describe("Phase 3 · T4 — content-addressed scan cache", () => {
  test("miss → hit on identical second scan with identical payload", () => {
    treeFile("a.txt", "aaa");
    const r1 = cachedScan({ cacheId: "t4-a", roots: [join(root, "tree")], files: [], xrHome: home, load: () => ({ n: 1 }) });
    const r2 = cachedScan({ cacheId: "t4-a", roots: [join(root, "tree")], files: [], xrHome: home, load: () => ({ n: 1 }) });
    expect(r1.hit).toBe(false);
    expect(r2.hit).toBe(true);
    expect(r2.value).toEqual(r1.value);
  });

  test("invalidates when a tracked file changes", async () => {
    treeFile("a.txt", "aaa");
    cachedScan({ cacheId: "t4-b", roots: [join(root, "tree")], files: [], xrHome: home, load: () => ({ n: 1 }) });
    await Bun.sleep(10); // mtime-granularity separation (documented limitation)
    treeFile("a.txt", "aab"); // content changed
    const r = cachedScan({ cacheId: "t4-b", roots: [join(root, "tree")], files: [], xrHome: home, load: () => ({ n: 2 }) });
    expect(r.hit).toBe(false);
    expect(r.value).toEqual({ n: 2 });
  });

  test("invalidates when a tracked state file changes", async () => {
    treeFile("a.txt", "aaa");
    const state = join(root, "registry.json");
    writeFileSync(state, "{\"v\":1}");
    cachedScan({ cacheId: "t4-c", roots: [join(root, "tree")], files: [state], xrHome: home, load: () => ({ n: 1 }) });
    await Bun.sleep(10); // mtime-granularity separation
    writeFileSync(state, "{\"v\":2}"); // state changed
    const r = cachedScan({ cacheId: "t4-c", roots: [join(root, "tree")], files: [state], xrHome: home, load: () => ({ n: 2 }) });
    expect(r.hit).toBe(false);
  });

  test("corrupt cache falls back to a full scan (never breaks the caller)", () => {
    treeFile("a.txt", "aaa");
    const cacheDir = join(home, "cache", "scans");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "t4-d.json"), "{corrupt-json!!");
    const r = cachedScan({ cacheId: "t4-d", roots: [join(root, "tree")], files: [], xrHome: home, load: () => ({ n: 42 }) });
    expect(r.hit).toBe(false);
    expect(r.value).toEqual({ n: 42 });
  });

  test("fingerprint includes every entry with size + mtime (merkle-style)", () => {
    treeFile("a.txt", "aaa");
    treeFile("sub.txt", "bbb");
    const fp = hashFingerprint([fingerprintDir(join(root, "tree"))]);
    expect(fp.length).toBe(64); // sha256 hex
    // Changing one entry changes the whole fingerprint.
    treeFile("a.txt", "aaaa");
    const fp2 = hashFingerprint([fingerprintDir(join(root, "tree"))]);
    expect(fp2).not.toBe(fp);
  });

  test("cleanup", () => {
    rmSync(root, { recursive: true, force: true });
  });
});
