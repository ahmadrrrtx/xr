/**
 * XR-LAUNCH-011 — the clean-machine journey's building blocks.
 *
 * The journey itself (scripts/journey/cli-journey.ts) runs per OS in
 * .github/workflows/journey.yml; these tests pin the pieces it relies on so a
 * refactor cannot quietly turn the journey into a no-op:
 *   - the hermetic overrides (XR_INSTALL_BASE_URL, XR_UPDATE_RELEASES_URL,
 *     npm registry) accept only https or loopback http;
 *   - install.sh really installs from a loopback release (curl --proto);
 *   - the fixture server's packument carries the tarball's dependencies;
 *   - the rc block the journey simulates is the one install.sh writes, and
 *     uninstall restores the original bytes;
 *   - Windows uninstall removes exactly install.ps1's user-Path entry.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INSTALLER_RC_BLOCK, binaryAsset, hostSlug, nextVersion } from "../../scripts/journey/cli-journey.ts";
import { FIXTURE_CONTENT, FIXTURE_FILE, startFixtureProvider, startFixtureServer, type Running } from "../../scripts/journey/fixtures.ts";
import { endpointOverride, npmRegistry } from "../../src/update/npm-channel.ts";
import { latestCompleteRelease } from "../../src/update/check.ts";
import { removeWindowsUserPath, stripUserPathEntry, stripXrRcBlock, type UninstallPaths } from "../../src/install/uninstall.ts";

const ROOT = join(import.meta.dir, "..", "..");
const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "xr-journey-test-"));
  cleanup.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const serve = async (r: Promise<Running>) => {
  const s = await r;
  cleanup.push(() => s.close());
  return s;
};
/** Async spawn: the fixture servers live in this process. */
async function run(cmd: string[], env: Record<string, string>) {
  const p = Bun.spawn(cmd, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out + err };
}

describe("journey helpers", () => {
  test("N+1 is the next patch, tagged so it can never be a real release", () => {
    expect(nextVersion("1.1.0")).toBe("1.1.1-journey.1");
    expect(nextVersion("2.0.9-beta.3")).toBe("2.0.10-journey.1");
    expect(() => nextVersion("latest")).toThrow();
  });

  test("binary assets match the installer's names; unsupported hosts are de-scoped", () => {
    expect(binaryAsset(hostSlug("linux", "x64"))).toBe("xr-linux-x64");
    expect(binaryAsset(hostSlug("darwin", "arm64"))).toBe("xr-darwin-arm64");
    expect(binaryAsset(hostSlug("win32", "x64"))).toBe("xr-windows-x64.exe");
    expect(binaryAsset(hostSlug("win32", "arm64"))).toBe("");
    const sh = readFileSync(join(ROOT, "install.sh"), "utf8");
    for (const a of ["xr-linux-x64", "xr-linux-arm64", "xr-darwin-x64", "xr-darwin-arm64"]) expect(sh).toContain(a);
  });

  test("the simulated rc block is byte-for-byte what install.sh appends, and uninstall removes it", () => {
    const sh = readFileSync(join(ROOT, "install.sh"), "utf8");
    const m = /printf '(\\n# >>> XR launcher >>>[^']*)' >> "\$rc"/.exec(sh);
    expect(m).not.toBeNull();
    expect(m![1]!.replace(/\\n/g, "\n")).toBe(INSTALLER_RC_BLOCK);
    const original = "# ~/.bashrc\nalias ll='ls -l'\n";
    expect(stripXrRcBlock(original + INSTALLER_RC_BLOCK)).toBe(original);
  });
});

describe("hermetic endpoint overrides (https or loopback only)", () => {
  test("endpointOverride", () => {
    expect(endpointOverride("https://mirror.example/x/")).toBe("https://mirror.example/x");
    expect(endpointOverride("http://127.0.0.1:4873")).toBe("http://127.0.0.1:4873");
    expect(endpointOverride("http://localhost/releases.json")).toBe("http://localhost/releases.json");
    for (const bad of ["http://example.com", "http://127.0.0.1.evil.com", "file:///etc/passwd", "ftp://x", "", undefined]) {
      expect(endpointOverride(bad)).toBeNull();
    }
  });

  test("npm registry: scoped override wins, then registry, then the public default", () => {
    expect(npmRegistry({})).toBe("https://registry.npmjs.org");
    expect(npmRegistry({ npm_config_registry: "http://127.0.0.1:1" })).toBe("http://127.0.0.1:1");
    expect(npmRegistry({ npm_config_registry: "http://127.0.0.1:1", "npm_config_@rrrtx:registry": "http://127.0.0.1:2" })).toBe("http://127.0.0.1:2");
    expect(npmRegistry({ npm_config_registry: "http://evil.example" })).toBe("https://registry.npmjs.org");
  });

  test("XR_UPDATE_RELEASES_URL points the release check at a mirror; a plain-http remote is ignored", async () => {
    const seen: string[] = [];
    const fetcher = async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify([{ tag_name: "v9.9.9", assets: [{ name: "SHA256SUMS" }] }]));
    };
    const prev = process.env.XR_UPDATE_RELEASES_URL;
    try {
      process.env.XR_UPDATE_RELEASES_URL = "http://127.0.0.1:9/releases.json";
      expect(await latestCompleteRelease(fetcher)).toBe("9.9.9");
      process.env.XR_UPDATE_RELEASES_URL = "http://evil.example/releases.json";
      await latestCompleteRelease(fetcher);
    } finally {
      if (prev === undefined) delete process.env.XR_UPDATE_RELEASES_URL;
      else process.env.XR_UPDATE_RELEASES_URL = prev;
    }
    expect(seen[0]).toBe("http://127.0.0.1:9/releases.json");
    expect(seen[1]).toStartWith("https://api.github.com/");
  });
});

const posix = process.platform !== "win32" && Bun.which("bash") !== null && Bun.which("curl") !== null;
describe.if(posix)("install.sh with XR_INSTALL_BASE_URL", () => {
  const baseEnv = (home: string) => ({ HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin", TMPDIR: home, TERM: "dumb" });

  test("a non-loopback http mirror is refused before anything is fetched or created", async () => {
    const home = scratch();
    const r = await run(["bash", join(ROOT, "install.sh"), "--yes", "--version=1.0.0"], { ...baseEnv(home), XR_INSTALL_BASE_URL: "http://example.com/mirror" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("XR_INSTALL_BASE_URL must be an https:// or loopback http:// URL");
    expect(existsSync(join(home, ".xr-agent"))).toBe(false);
    expect(existsSync(join(home, ".local", "bin", "xr"))).toBe(false);
  });

  const asset = binaryAsset(hostSlug());
  test.if(asset !== "")("a loopback mirror installs the verified binary (http allowed only for loopback)", async () => {
    const home = scratch();
    const rel = join(scratch(), "v7.7.7");
    mkdirSync(rel, { recursive: true });
    writeFileSync(join(rel, asset), "#!/bin/sh\n[ \"$1\" = --version ] && echo 'xr 7.7.7'\nexit 0\n");
    chmodSync(join(rel, asset), 0o755);
    writeFileSync(join(rel, "SHA256SUMS"), `${createHash("sha256").update(readFileSync(join(rel, asset))).digest("hex")}  ${asset}\n`);
    const srv = await serve(startFixtureServer({ root: join(rel, "..") }));
    const r = await run(["bash", join(ROOT, "install.sh"), "--yes", "--version=7.7.7", "--mode=minimal"], { ...baseEnv(home), XR_INSTALL_BASE_URL: srv.url });
    expect(r.code).toBe(0);
    expect(srv.requests).toContain(`GET /v7.7.7/SHA256SUMS`);
    expect(srv.requests).toContain(`GET /v7.7.7/${asset}`);
    expect(readFileSync(join(home, ".xr-agent", "dist", asset), "utf8")).toContain("7.7.7");
    expect(existsSync(join(home, ".local", "bin", "xr"))).toBe(true);
  }, 60_000);
});

describe("journey fixtures", () => {
  test("the release index lists SHA256SUMS; the packument carries the tarball's dependencies", async () => {
    const root = scratch();
    mkdirSync(join(root, "v1.2.3"), { recursive: true });
    writeFileSync(join(root, "v1.2.3", "SHA256SUMS"), `${"0".repeat(64)}  xr-linux-x64\n`);
    const pkgDir = join(scratch(), "package");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@rrrtx/xr", version: "1.2.3", bin: { xr: "bin/xr" }, dependencies: { zod: "^3.0.0" } }));
    const tgz = join(root, "xr-1.2.3.tgz");
    expect(Bun.spawnSync(["tar", "-czf", tgz, "-C", join(pkgDir, ".."), "package"]).exitCode).toBe(0);
    const srv = await serve(startFixtureServer({ root, releases: [{ version: "1.2.3" }], npm: { name: "@rrrtx/xr", tarballs: { "1.2.3": tgz }, latest: "1.2.3" } }));
    const rel = (await (await fetch(`${srv.url}/releases.json`)).json()) as Array<{ tag_name: string; assets: Array<{ name: string }> }>;
    expect(rel[0]!.tag_name).toBe("v1.2.3");
    expect(rel[0]!.assets.map((a) => a.name)).toEqual(["xr-linux-x64", "SHA256SUMS"]);
    const pack = (await (await fetch(`${srv.url}/@rrrtx%2fxr`)).json()) as { "dist-tags": { latest: string }; versions: Record<string, { dependencies: Record<string, string>; dist: { tarball: string; integrity: string } }> };
    expect(pack["dist-tags"].latest).toBe("1.2.3");
    expect(pack.versions["1.2.3"]!.dependencies).toEqual({ zod: "^3.0.0" });
    const tar = await fetch(pack.versions["1.2.3"]!.dist.tarball);
    const bytes = Buffer.from(await tar.arrayBuffer());
    expect(`sha512-${createHash("sha512").update(bytes).digest("base64")}`).toBe(pack.versions["1.2.3"]!.dist.integrity);
    // Only the files the fixture was built with are served.
    expect((await fetch(`${srv.url}/not-a-fixture-file`)).status).toBe(404);
  });

  test("the fixture provider asks for write_file of the proof file, then finishes", async () => {
    const p = await serve(startFixtureProvider());
    const call = async (messages: unknown[]) => (await (await fetch(`${p.url}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "journey-model", messages }) })).json()) as { choices: Array<{ message: { content: string | null; tool_calls?: Array<{ function: { name: string; arguments: string } }> } }> };
    const first = await call([{ role: "user", content: "go" }]);
    const tc = first.choices[0]!.message.tool_calls?.[0];
    expect(tc?.function.name).toBe("write_file");
    expect(JSON.parse(tc!.function.arguments)).toMatchObject({ path: FIXTURE_FILE, content: FIXTURE_CONTENT });
    const second = await call([{ role: "user", content: "go" }, { role: "assistant", content: null, tool_calls: [tc] }, { role: "tool", tool_call_id: "x", content: "ok" }]);
    expect(second.choices[0]!.message.tool_calls ?? []).toHaveLength(0);
  });
});

describe("Windows uninstall: install.ps1's user-Path entry", () => {
  const paths: UninstallPaths = { installDir: "C:\\Users\\a\\.xr-agent", dataHome: "C:\\Users\\a\\.xr", launcher: "", rcFiles: [] };

  test("strips exactly that entry (case/trailing-slash insensitive), keeps everything else in order", () => {
    const p = "C:\\Tools;c:\\users\\A\\.xr-agent\\bin-local\\;D:\\bin;;C:\\Users\\a\\.xr-agent\\bin-local-old";
    expect(stripUserPathEntry(p, "C:\\Users\\a\\.xr-agent\\bin-local")).toBe("C:\\Tools;D:\\bin;;C:\\Users\\a\\.xr-agent\\bin-local-old");
    expect(stripUserPathEntry("C:\\Tools", "C:\\Users\\a\\.xr-agent\\bin-local")).toBe("C:\\Tools");
  });

  test("writes back only a changed Path it read successfully; no-op off Windows", () => {
    const calls: Array<{ script: string; env?: Record<string, string> }> = [];
    const ps = (read: string, status = 0) => (script: string, env?: Record<string, string>) => {
      calls.push({ script, env });
      return { status: script.includes("SetEnvironmentVariable") ? 0 : status, stdout: read };
    };
    expect(removeWindowsUserPath(paths, ps("C:\\Tools;C:\\Users\\a\\.xr-agent\\bin-local\r\n"), "win32")).toBe(true);
    expect(calls[1]!.env?.XR_UNINSTALL_PATH).toBe("C:\\Tools");
    calls.length = 0;
    expect(removeWindowsUserPath(paths, ps("C:\\Tools\r\n"), "win32")).toBe(false);
    expect(calls).toHaveLength(1);
    calls.length = 0;
    expect(removeWindowsUserPath(paths, ps("", 1), "win32")).toBe(false);
    expect(calls).toHaveLength(1);
    expect(removeWindowsUserPath(paths, ps("x"), "linux")).toBe(false);
  });
});
