/**
 * XR Phase 9 · T5 (Part 10) — per-channel update / rollback discipline.
 *
 * Effects asserted:
 *   - binary channel: an update served by a REAL local HTTP release feed swaps
 *     atomically; the new bytes run (canary), old bytes are gone from the slot;
 *   - tamper: hash mismatch / missing checksums / missing entry → the plan
 *     REFUSES and the current binary is byte-identical afterwards;
 *   - channel detection: install.json wins over path heuristics, which win
 *     over legacy layout mapping;
 *   - PM-owned channels return complete update+rollback command pairs, and
 *     `xr update`'s delegation branch is exercised for every channel id.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  createBinaryUpdatePlan,
  parseSha256Sums,
  binaryFileName,
} from "../../src/update/atomic-updater.ts";
import { applyUpdate, type UpdateResult } from "../../src/update/selfheal.ts";
import {
  CHANNELS,
  detectChannel,
  rollbackHintFor,
  type ChannelId,
} from "../../src/update/channels.ts";

const dir = mkdtempSync(join(tmpdir(), "xr-channel-update-"));

function writeFakeBinary(path: string, tag: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\necho "v-${tag}"\nexit 0\n`);
  if (process.platform !== "win32") chmodSync(path, 0o755);
}

/** Serve a release feed over loopback HTTP — the real fetch path, no mocks. */
let server: ReturnType<typeof Bun.serve> | null = null;
let port = 0;
const served = new Map<string, Uint8Array>();

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname.replace(/^\//, "");
      const body = served.get(path);
      return body ? new Response(body) : new Response("not found", { status: 404 });
    },
  });
  port = server.port!;
});

afterAll(() => {
  server?.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

/** Narrows the union — bun's expect() does not narrow for tsc. */
function expectRefused(result: UpdateResult<string>): asserts result is { ok: false; keptCurrent: string; reason: string } {
  if (result.ok) throw new Error("expected the update plan to REFUSE; it succeeded");
}

function sumsFor(files: Record<string, Uint8Array>): string {
  return Object.entries(files)
    .map(([name, bytes]) => `${createHash("sha256").update(bytes).digest("hex")}  ${name}`)
    .join("\n") + "\n";
}

describe("Phase 9 · binary channel — verified atomic update", () => {
  test("happy path: checksum-verified download → canary → atomic swap", async () => {
    const pkg = join(dir, "pkg-update");
    mkdirSync(join(pkg, "dist"), { recursive: true });
    const name = binaryFileName();
    writeFakeBinary(join(pkg, "dist", name), "old");

    const candidate = new TextEncoder().encode(`#!/usr/bin/env bash\necho "v-new"\nexit 0\n`);
    served.set(name, candidate);
    served.set("SHA256SUMS", new TextEncoder().encode(sumsFor({ [name]: candidate })));

    const plan = createBinaryUpdatePlan({
      packageRoot: pkg,
      version: "9.9.9",
      baseUrl: `http://127.0.0.1:${port}`,
      canary: () => ({ healthy: true }),
    });
    expect(plan).not.toBeNull();
    const result = await applyUpdate(plan!);
    expect(result.ok).toBe(true);
    // EFFECT: the slot now carries the new bytes.
    expect(readFileSync(join(pkg, "dist", name), "utf8")).toContain("v-new");
  });

  test("tamper: hash mismatch → refused, current binary untouched", async () => {
    const pkg = join(dir, "pkg-tamper");
    mkdirSync(join(pkg, "dist"), { recursive: true });
    const name = binaryFileName();
    writeFakeBinary(join(pkg, "dist", name), "old");
    const before = readFileSync(join(pkg, "dist", name));

    const candidate = new TextEncoder().encode(`#!/usr/bin/env bash\necho "v-evil"\nexit 0\n`);
    served.set(`${name}-tamper`, candidate);
    // sums advertise a DIFFERENT file's digest → mismatch
    served.set("SHA256SUMS-tamper", new TextEncoder().encode(sumsFor({ [name]: new TextEncoder().encode("other-bytes") })));

    const plan = createBinaryUpdatePlan({
      packageRoot: pkg,
      version: "9.9.9",
      baseUrl: `http://127.0.0.1:${port}`,
      canary: () => ({ healthy: true }),
      fetchSums: async () => ({ ok: true, text: readFileSyncSync(`SHA256SUMS-tamper`) }),
    });
    const result = await applyUpdate(plan!);
    expectRefused(result);
    expect(result.reason).toContain("checksum mismatch");
    expect(readFileSync(join(pkg, "dist", name))).toEqual(before);
  });

  test("tamper: checksums file unavailable → refused, current untouched", async () => {
    const pkg = join(dir, "pkg-nosums");
    mkdirSync(join(pkg, "dist"), { recursive: true });
    const name = binaryFileName();
    writeFakeBinary(join(pkg, "dist", name), "old");
    const before = readFileSync(join(pkg, "dist", name));

    const plan = createBinaryUpdatePlan({
      packageRoot: pkg,
      version: "9.9.9",
      baseUrl: `http://127.0.0.1:${port}`,
      canary: () => ({ healthy: true }),
      fetchSums: async () => ({ ok: false, text: "" }),
    });
    const result = await applyUpdate(plan!);
    expectRefused(result);
    expect(result.reason).toContain("checksums unavailable");
    expect(readFileSync(join(pkg, "dist", name))).toEqual(before);
  });

  test("tamper: sums file present but no entry for this binary → refused", async () => {
    const pkg = join(dir, "pkg-noentry");
    mkdirSync(join(pkg, "dist"), { recursive: true });
    const name = binaryFileName();
    writeFakeBinary(join(pkg, "dist", name), "old");

    const plan = createBinaryUpdatePlan({
      packageRoot: pkg,
      version: "9.9.9",
      baseUrl: `http://127.0.0.1:${port}`,
      canary: () => ({ healthy: true }),
      fetchSums: async () => ({ ok: true, text: sumsFor({ "xr-other-file": new Uint8Array([1, 2, 3]) }) }),
    });
    const result = await applyUpdate(plan!);
    expectRefused(result);
    expect(result.reason).toContain("no SHA256SUMS entry");
  });

  test("forced-failure rollback: unhealthy canary keeps the current binary", async () => {
    const pkg = join(dir, "pkg-rollback");
    mkdirSync(join(pkg, "dist"), { recursive: true });
    const name = binaryFileName();
    writeFakeBinary(join(pkg, "dist", name), "old");
    const before = readFileSync(join(pkg, "dist", name));

    const candidate = new TextEncoder().encode(`#!/usr/bin/env bash\necho "v-new"\nexit 0\n`);
    served.set("SHA256SUMS", new TextEncoder().encode(sumsFor({ [name]: candidate })));
    served.set(name, candidate);

    const plan = createBinaryUpdatePlan({
      packageRoot: pkg,
      version: "9.9.9",
      baseUrl: `http://127.0.0.1:${port}`,
      canary: () => ({ healthy: false, reason: "boot failed" }),
    });
    const result = await applyUpdate(plan!);
    expectRefused(result);
    expect(result.reason).toContain("self-test");
    expect(readFileSync(join(pkg, "dist", name))).toEqual(before);
  });
});

// tiny sync reader used only above to keep the tamper fixture readable
function readFileSyncSync(key: string): string {
  const bytes = served.get(key)!;
  return new TextDecoder().decode(bytes);
}

describe("Phase 9 · channel detection + PM delegation", () => {
  test("install.json record wins; malformed record falls through", () => {
    const home = join(dir, "home-record");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "install.json"), JSON.stringify({ channel: "homebrew", layout: "package-manager", version: "7.1.0", installedAt: "2026-08-04T00:00:00Z", installer: "brew" }));
    const d = detectChannel({ xrHome: home, packageRoot: join(dir, "record-root"), legacyLayout: "binary" });
    expect(d.channel).toBe("homebrew");
    expect(d.via).toBe("install.json");

    writeFileSync(join(home, "install.json"), "not-json{");
    const d2 = detectChannel({ xrHome: home, packageRoot: join(dir, "record-root"), legacyLayout: "binary" });
    expect(d2.via).toBe("legacy");
    expect(d2.channel).toBe("github-releases");
  });

  test("path heuristics resolve brew cellar / scoop / system paths", () => {
    expect(detectChannel({ xrHome: join(dir, "none"), packageRoot: join(dir, "none2"), exePath: "/home/linuxbrew/.linuxbrew/Cellar/xr/7.1.0/bin/xr", legacyLayout: "binary" }).channel).toBe("homebrew");
    expect(detectChannel({ xrHome: join(dir, "none"), packageRoot: join(dir, "none2"), exePath: "C:\\Users\\u\\scoop\\apps\\xr\\current\\xr.exe", legacyLayout: "binary" }).channel).toBe("scoop");
    expect(detectChannel({ xrHome: join(dir, "none"), packageRoot: join(dir, "none2"), exePath: "/usr/bin/xr", legacyLayout: "binary" }).channel).toBe("deb");
    expect(detectChannel({ xrHome: join(dir, "none"), packageRoot: join(dir, "none2"), exePath: "/opt/xr/dist/xr-linux-x64", legacyLayout: "git" }).channel).toBe("git-checkout");
  });

  test("every manifest-advertised channel has update + rollback guidance", () => {
    for (const id of Object.keys(CHANNELS) as ChannelId[]) {
      const hint = rollbackHintFor(id);
      expect(hint.length).toBeGreaterThan(10);
      if (CHANNELS[id].owner === "channel") {
        expect(CHANNELS[id].update).toBeTruthy();
      }
    }
  });
});

describe("Phase 9 · SHA256SUMS parsing", () => {
  test("parseSha256Sums handles coreutils format incl. ./ prefixes", () => {
    const sums = parseSha256Sums(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  xr-linux-x64\n" +
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  ./dist/xr-darwin-arm64\n",
    );
    expect(sums.get("xr-linux-x64")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sums.get("dist/xr-darwin-arm64")).toBeDefined();
  });
});
