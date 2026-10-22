/**
 * XR-LAUNCH-019 — the binary layout resolves the newest complete release and
 * compares it with the running version BEFORE any download.
 *
 * Acceptance: on the current version, `xr update` makes no network download.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binaryFileName, runAtomicUpdate } from "../../src/update/atomic-updater.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const savedBinary = process.env.XR_BINARY;
delete process.env.XR_BINARY; // layout detection must find dist/<platform binary>
afterAll(() => {
  if (savedBinary !== undefined) process.env.XR_BINARY = savedBinary;
});

const UNMANAGED = { channel: "binary", managed: false } as never;

/** A package root with dist/<platform binary> so detectInstallLayout → "binary". */
function binaryRoot(content = "old-binary"): { root: string; bin: string } {
  const root = mkdtempSync(join(tmpdir(), "xr-019-"));
  dirs.push(root);
  mkdirSync(join(root, "dist"), { recursive: true });
  const bin = join(root, "dist", binaryFileName());
  writeFileSync(bin, content, { mode: 0o755 });
  return { root, bin };
}

/** Records every URL; serves SHA256SUMS + the binary for one release. */
function recordingFetch(payload = "new-binary") {
  const urls: string[] = [];
  const bytes = new TextEncoder().encode(payload);
  const sum = createHash("sha256").update(bytes).digest("hex");
  const impl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    if (url.endsWith("/SHA256SUMS")) return new Response(`${sum}  ${binaryFileName()}\n`);
    return new Response(bytes);
  }) as unknown as typeof fetch;
  return { urls, impl };
}

describe("XR-LAUNCH-019 · binary update compares before downloading", () => {
  test("already on the newest release → 'up to date', zero downloads, binary untouched", async () => {
    const { root, bin } = binaryRoot();
    const net = recordingFetch();
    const r = await runAtomicUpdate({
      packageRoot: root,
      version: "1.1.0",
      currentVersion: "1.1.0",
      channel: UNMANAGED,
      releaseResolver: async () => "1.1.0",
      binary: { packageRoot: root, version: undefined as never, fetchImpl: net.impl, canary: () => ({ healthy: true }) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("up to date (1.1.0)");
    expect(net.urls).toEqual([]);
    expect(readFileSync(bin, "utf8")).toBe("old-binary");
  });

  test("running a build newer than the published release → nothing to update, zero downloads", async () => {
    const { root } = binaryRoot();
    const net = recordingFetch();
    const r = await runAtomicUpdate({
      packageRoot: root,
      currentVersion: "1.2.0-dev",
      channel: UNMANAGED,
      releaseResolver: async () => "1.1.0",
      binary: { packageRoot: root, version: undefined as never, fetchImpl: net.impl },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("newer than the published 1.1.0");
    expect(net.urls).toEqual([]);
  });

  test("release feed unreachable → a failure that says so (never 'up to date'), zero downloads", async () => {
    const { root } = binaryRoot();
    const net = recordingFetch();
    const r = await runAtomicUpdate({
      packageRoot: root,
      currentVersion: "1.1.0",
      channel: UNMANAGED,
      releaseResolver: async () => null,
      binary: { packageRoot: root, version: undefined as never, fetchImpl: net.impl },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("release feed unreachable — nothing changed");
    expect(net.urls).toEqual([]);
  });

  test("a newer complete release → downloads THAT version (verified) and swaps it in", async () => {
    const { root, bin } = binaryRoot();
    const net = recordingFetch("new-binary-1.2.0");
    const r = await runAtomicUpdate({
      packageRoot: root,
      version: "1.1.0", // the running version, as updateXR passes it — never the target
      currentVersion: "1.1.0",
      channel: UNMANAGED,
      releaseResolver: async () => "1.2.0",
      binary: { packageRoot: root, version: undefined as never, fetchImpl: net.impl, canary: () => ({ healthy: true }) },
    });
    expect(r).toEqual({ ok: true, activated: "1.2.0" });
    expect(net.urls.every((u) => u.includes("/releases/download/v1.2.0/"))).toBe(true);
    expect(net.urls.some((u) => u.endsWith("/SHA256SUMS"))).toBe(true);
    expect(readFileSync(bin, "utf8")).toBe("new-binary-1.2.0");
  });

  test("an explicit binary.version pins the target without consulting the feed", async () => {
    const { root } = binaryRoot();
    const net = recordingFetch();
    let consulted = false;
    const r = await runAtomicUpdate({
      packageRoot: root,
      currentVersion: "1.1.0",
      channel: UNMANAGED,
      releaseResolver: async () => {
        consulted = true;
        return "9.9.9";
      },
      binary: { packageRoot: root, version: "1.1.0", fetchImpl: net.impl },
    });
    expect(consulted).toBe(false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("up to date (1.1.0)");
    expect(net.urls).toEqual([]);
  });
});
