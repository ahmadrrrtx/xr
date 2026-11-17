/** Async observation scheduling must share the operation-owning filesystem boundary. */
import { expect, spyOn, test } from "bun:test";
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprint, fingerprintAsync } from "../../src/context/memory/rag.ts";
import { FilesystemAuthority, type FilesystemLease } from "../../src/security/filesystem.ts";

async function fixture(run: (root: string, base: string) => Promise<void>) {
  const base = mkdtempSync(join(tmpdir(), "xr-async-fs-"));
  const root = join(base, "project"); mkdirSync(root);
  try { await run(realpathSync(root), base); } finally { rmSync(base, { recursive: true, force: true }); }
}
const populate = (root: string, count = 100) => {
  for (let i = 0; i < count; i++) writeFileSync(join(root, `safe-${String(i).padStart(3, "0")}.ts`), "export const safe = true;");
};

test("async/sync walks and fingerprints have identical authorized candidates and limits", async () => fixture(async (root, base) => {
  populate(root);
  mkdirSync(join(root, "nested")); writeFileSync(join(root, "nested", "safe.test.ts"), "safe fixture");
  mkdirSync(join(root, "node_modules")); writeFileSync(join(root, "node_modules", "excluded.ts"), "not a project source");
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { react: "fixture" } }));
  writeFileSync(join(root, ".env.local"), "SYNTHETIC_ASYNC_SECRET");
  writeFileSync(join(root, "credentials.json"), "SYNTHETIC_ASYNC_SECRET");
  writeFileSync(join(base, "outside.ts"), "SYNTHETIC_ASYNC_OUTSIDE");
  symlinkSync(join(base, "outside.ts"), join(root, "linked.ts"));
  symlinkSync(base, join(root, "linked-dir"), process.platform === "win32" ? "junction" : "dir");
  linkSync(join(base, "outside.ts"), join(root, "hardlink.ts"));
  const fs = new FilesystemAuthority(root, "index"), skip = new Set(["node_modules"]);
  try {
    const paths = (rows: ReturnType<FilesystemAuthority["walk"]>) => rows.map(row => row.path).sort();
    expect(paths(await fs.walkAsync(".", skip))).toEqual(paths(fs.walk(".", skip)));
    expect(paths(await fs.walkAsync(".", skip, 7))).toEqual(paths(fs.walk(".", skip, 7)));
    expect(await fs.walkAsync(".", skip, 0)).toEqual([]);
    const profile = await fingerprintAsync(root);
    expect(profile).toEqual(fingerprint(root));
    expect(profile).toEqual({ files: 102, languages: { ".json": 1, ".ts": 101 }, frameworks: ["react"], hasTests: true });
    expect(paths(await fs.walkAsync())).not.toContain("linked.ts");
    expect(paths(await fs.walkAsync())).not.toContain("hardlink.ts");
    expect(paths(await fs.walkAsync())).not.toContain("credentials.json");
  } finally { fs.close(); }
}));

test("one wide directory yields before completion, rather than moving the whole stall to a timer", async () => fixture(async root => {
  populate(root, 160);
  const fs = new FilesystemAuthority(root, "index");
  let finished = false, servedWhileWalking = false;
  const request = new Promise<void>(resolve => setImmediate(() => { servedWhileWalking = !finished; resolve(); }));
  try {
    const rows = await fs.walkAsync(); finished = true; await request;
    expect(rows).toHaveLength(160); expect(servedWhileWalking).toBe(true);
  } finally { fs.close(); }
}));

test("already-aborted walks never start metadata work", async () => fixture(async root => {
  const fs = new FilesystemAuthority(root, "index"), abort = new AbortController(); abort.abort();
  const metadata = spyOn(fs, "metadata");
  try { await expect(fs.walkAsync(".", new Set(), 10_000, abort.signal)).rejects.toThrow(); expect(metadata).not.toHaveBeenCalled(); }
  finally { metadata.mockRestore(); fs.close(); }
}));

test("abort between batches rejects, closes the retained walk, and does not poison the next scan", async () => fixture(async root => {
  populate(root);
  const fs = new FilesystemAuthority(root, "index"), abort = new AbortController();
  const cancel = new Promise<void>(resolve => setImmediate(() => { abort.abort(); resolve(); }));
  try {
    await expect(fs.walkAsync(".", new Set(), 10_000, abort.signal)).rejects.toThrow(); await cancel;
    expect(await fs.walkAsync()).toHaveLength(100);
  } finally { fs.close(); }
}));

test("denied-only directories still yield and observe cancellation", async () => fixture(async root => {
  for (let i = 0; i < 100; i++) writeFileSync(join(root, `.env.private-${i}`), "SYNTHETIC_ASYNC_SECRET");
  const fs = new FilesystemAuthority(root, "index"), abort = new AbortController();
  const cancel = new Promise<void>(resolve => setImmediate(() => { abort.abort(); resolve(); }));
  try { await expect(fs.walkAsync(".", new Set(), 10_000, abort.signal)).rejects.toThrow(); await cancel; }
  finally { fs.close(); }
}));

test("revoked leases cannot publish a partial success after an asynchronous yield", async () => fixture(async root => {
  populate(root);
  let current = true;
  const lease: FilesystemLease = { grantId: "fixture-grant", actor: "fixture-actor", purpose: "index", generation: "fixture-generation", deniedPaths: [], current: () => current, permits: () => true, permitsSensitiveRead: () => false };
  const fs = new FilesystemAuthority(root, "index", lease);
  const revoke = new Promise<void>(resolve => setImmediate(() => { current = false; resolve(); }));
  try { await expect(fs.walkAsync()).rejects.toThrow("filesystem stale"); await revoke; }
  finally { fs.close(); }
}));

test("async candidates still obey blocked-path leases", async () => fixture(async root => {
  populate(root);
  const lease: FilesystemLease = { grantId: "fixture-grant", actor: "fixture-actor", purpose: "index", generation: "fixture-generation", deniedPaths: [join(root, "safe-050.ts")], current: () => true, permits: path => path !== join(root, "safe-050.ts"), permitsSensitiveRead: () => false };
  const fs = new FilesystemAuthority(root, "index", lease);
  try { const rows = await fs.walkAsync(); expect(rows).toHaveLength(99); expect(rows.map(row => row.path)).not.toContain("safe-050.ts"); }
  finally { fs.close(); }
}));
