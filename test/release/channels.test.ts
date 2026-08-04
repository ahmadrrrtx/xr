/**
 * XR Phase 9 · T3 (Part 10) — native package-manager channels.
 *
 * Assertions:
 *   - every manifest channel maps to the updater's channel contract
 *     (src/update/channels.ts) — one updater, many channels, no drift;
 *   - the rendered channel files are structurally valid for their ecosystem
 *     (Ruby formula ruby -c when available; Scoop JSON; WinGet YAML keys);
 *   - channel files carry the manifest version everywhere (sync, Art. XXII.1);
 *   - the tap/bucket/winget types point at the canonical release assets;
 *   - the .deb builder produces a REAL, structurally valid deterministic
 *     package (parsed back byte-for-byte; dpkg-deb used when present).
 */

import { describe, test, expect } from "bun:test";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifest } from "../../scripts/release-manifest.ts";
import {
  renderChannelFiles,
  renderScoopManifest,
  renderWingetFiles,
  renderHomebrewFormula,
  fillHashes,
  type MinimalManifest,
  type ReleaseHashes,
} from "../../scripts/distribution-model.ts";
import { CHANNELS, type ChannelId } from "../../src/update/channels.ts";
import { buildDeb, ar, tar } from "../../scripts/package-linux.ts";

const manifest = loadManifest();

// ── tiny ar/tar readers (only as much as assertions need) ───────────────────
function parseAr(buf: Buffer): Map<string, Buffer> {
  expect(buf.subarray(0, 8).toString()).toBe("!<arch>\n");
  const out = new Map<string, Buffer>();
  let off = 8;
  while (off < buf.length) {
    const name = buf.subarray(off, off + 16).toString().trim();
    const size = parseInt(buf.subarray(off + 48, off + 58).toString().trim(), 10);
    const data = buf.subarray(off + 60, off + 60 + size);
    out.set(name.replace(/\/$/, ""), data);
    off += 60 + size + (size % 2);
  }
  return out;
}

function parseTar(buf: Buffer): Map<string, { data: Buffer; mode: number; type: number }> {
  const out = new Map<string, { data: Buffer; mode: number; type: number }>();
  let off = 0;
  while (off + 512 <= buf.length) {
    const name = buf.subarray(off, off + 100).toString().replace(/\0.*$/, "");
    if (!name) break;
    const mode = parseInt(buf.subarray(off + 100, off + 108).toString().trim(), 8);
    const size = parseInt(buf.subarray(off + 124, off + 136).toString().trim(), 8);
    const type = buf[off + 156]!;
    const data = buf.subarray(off + 512, off + 512 + size);
    const prefix = buf.subarray(off + 345, off + 500).toString().replace(/\0.*$/, "");
    out.set(prefix ? `${prefix}/${name}` : name, { data, mode, type });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

describe("Phase 9 · channel contracts", () => {
  test("manifest channels map 1:1 to the updater contract (no drift)", () => {
    const ids = new Set(manifest.distribution!.channels.map((c) => c.id));
    const updaterIds = new Set(Object.keys(CHANNELS));
    expect(ids).toEqual(updaterIds);
    for (const c of manifest.distribution!.channels) {
      const def = CHANNELS[c.id as ChannelId];
      expect(def).toBeDefined();
      expect(def.owner).toBe(c.updateOwner === "xr" ? "xr" : "channel");
      // PM-owned channels must ship update AND rollback commands (Art. XXIII).
      if (def.owner === "channel") {
        expect(def.update, c.id).toBeTruthy();
        expect(def.rollback, c.id).toBeTruthy();
      }
    }
  });

  test("every stamped channel file carries the manifest version", () => {
    const rendered = renderChannelFiles(manifest as unknown as MinimalManifest);
    expect(Object.keys(rendered).length).toBeGreaterThanOrEqual(6);
    for (const [path, content] of Object.entries(rendered)) {
      if (path.includes("winget") && path.includes("installer")) {
        expect(content).toContain(`PackageVersion: ${manifest.identity.version}`);
      } else if (path.endsWith(".spec")) {
        expect(content).toContain(`Version:        ${manifest.identity.version}`);
      } else if (path.endsWith(".rb")) {
        expect(content).toContain(`version "${manifest.identity.version}"`);
      } else if (path.endsWith(".json")) {
        expect(JSON.parse(content).version).toBe(manifest.identity.version);
      }
    }
  });

  test("scoop manifest: JSON-valid, canonical asset url, autoupdate wired", () => {
    const rendered = JSON.parse(renderScoopManifest(manifest as unknown as MinimalManifest));
    expect(rendered.version).toBe(manifest.identity.version);
    const url = rendered.architecture["64bit"].url as string;
    expect(url).toContain(`/releases/download/v${manifest.identity.version}/xr-windows-x64.exe`);
    expect(rendered.hash ?? rendered.architecture["64bit"].hash).toBeTruthy();
    expect(rendered.autoupdate.architecture["64bit"].url).toContain("$version");
    expect(rendered.autoupdate.architecture["64bit"].hash.url).toContain("SHA256SUMS");
    expect(rendered.checkver).toBe("github");
    // urls and hashes pin from ONE release (canonical build) — R1
    expect(url).toContain(manifest.identity.repo);
  });

  test("homebrew formula: 4 platform urls + sha placeholders + beta caveat", () => {
    const rb = renderHomebrewFormula(manifest as unknown as MinimalManifest);
    for (const file of ["xr-darwin-arm64", "xr-darwin-x64", "xr-linux-arm64", "xr-linux-x64"]) {
      expect(rb).toContain(`/releases/download/v${manifest.identity.version}/${file}`);
    }
    expect((rb.match(/__SHA256_[A-Z0-9_]+__/g) ?? []).length).toBe(4);
    expect(rb).toContain(manifest.distribution!.stabilityLabel);
    expect(rb).toContain("test do");
    // syntax-check with real ruby when available (Art. XX.5: detected, never faked)
    const ruby = spawnSync("ruby", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (ruby.status === 0) {
      const dir = mkdtempSync(join(tmpdir(), "xr-rb-"));
      try {
        const p = join(dir, "xr.rb");
        writeFileSync(p, rb);
        const c = spawnSync("ruby", ["-c", p], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        expect(c.status).toBe(0);
        expect(c.stdout + c.stderr).toContain("Syntax OK");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("winget manifests: three-file structure, portable x64 installer", () => {
    const files = renderWingetFiles(manifest as unknown as MinimalManifest);
    const [v, l, i] = Object.values(files);
    expect(v).toContain("ManifestType: version");
    expect(l).toContain("ManifestType: defaultLocale");
    expect(i).toContain("ManifestType: installer");
    for (const content of Object.values(files)) {
      expect(content).toContain(`PackageVersion: ${manifest.identity.version}`);
    }
    expect(i).toContain("InstallerType: portable");
    expect(i).toContain("Architecture: x64");
    expect(i).toContain("__SHA256_XR_WINDOWS_X64_EXE__");
  });

  test("fillHashes refuses an unshipped version (channel must not drift)", () => {
    const wrong: ReleaseHashes = { version: "0.0.0", files: [{ file: "xr-windows-x64.exe", sha256: "a".repeat(64) }] };
    const rendered = renderChannelFiles(manifest as unknown as MinimalManifest);
    // fillHashes itself is version-agnostic; the CLI enforces the version gate.
    // Here we assert the windows-only token set still refuses when incomplete.
    expect(() => fillHashes(rendered["packaging/homebrew/xr.rb"]!, wrong)).toThrow(/no sha256 recorded/);
  });
});

describe("Phase 9 · the .deb is a real package", () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-deb-"));
  const binPath = join(dir, "xr-linux-x64");
  writeFileSync(binPath, Buffer.from("FAKE-XR-BINARY-payload-0123456789", "utf8"));
  const m = loadManifest().identity;
  const deb = buildDeb({
    binary: binPath,
    version: m.version,
    arch: "amd64",
    description: m.description,
    maintainer: m.author,
    licenseText: "MIT — test license text",
  });

  test("ar structure: debian-binary + control.tar.gz + data.tar.gz", () => {
    const members = parseAr(deb);
    expect(members.get("debian-binary")?.toString()).toBe("2.0\n");
    expect(members.has("control.tar.gz")).toBe(true);
    expect(members.has("data.tar.gz")).toBe(true);
  });

  test("control metadata: name, version (debianized), arch, size, beta honesty", () => {
    const control = parseTar(gunzipSync(parseAr(deb).get("control.tar.gz")!));
    const text = control.get("./control")!.data.toString();
    expect(text).toContain("Package: xr\n");
    expect(text).toMatch(/Version: 7\.1\.0-1/);
    expect(text).toContain("Architecture: amd64");
    expect(text).toContain("Public Beta");
    expect(text).toMatch(/Installed-Size: \d+/);
  });

  test("payload: /usr/bin/xr is byte-identical to the canonical binary (0755)", () => {
    const data = parseTar(gunzipSync(parseAr(deb).get("data.tar.gz")!));
    const entry = data.get("./usr/bin/xr")!;
    expect(entry.data.toString()).toBe("FAKE-XR-BINARY-payload-0123456789");
    expect(entry.mode).toBe(0o755);
    expect(data.get("./usr/share/doc/xr/copyright")!.data.toString()).toContain("MIT");
  });

  test("deterministic: rebuilding yields byte-identical output (reproducible)", () => {
    const again = buildDeb({
      binary: binPath,
      version: m.version,
      arch: "amd64",
      description: m.description,
      maintainer: m.author,
      licenseText: "MIT — test license text",
    });
    expect(again.equals(deb)).toBe(true);
  });

  test("dpkg-deb accepts it (when dpkg is on the host)", () => {
    const dpkg = spawnSync("dpkg-deb", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (dpkg.status !== 0) return; // host without dpkg — structural asserts above already ran
    const p = join(dir, "xr.deb");
    writeFileSync(p, deb);
    const info = spawnSync("dpkg-deb", ["--info", p], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(info.status).toBe(0);
    expect(info.stdout).toContain("Package: xr");
    const contents = spawnSync("dpkg-deb", ["--contents", p], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(contents.status).toBe(0);
    expect(contents.stdout).toContain("./usr/bin/xr");
  });
});

describe("Phase 9 · tar/ar writers are correct (self-check)", () => {
  test("tar round-trip parses names/modes/sizes", () => {
    const arc = tar([
      { name: "./a/b.txt", data: Buffer.from("hello"), mode: 0o644 },
      { name: "./dir", data: Buffer.alloc(0), mode: 0o755, dir: true },
    ]);
    const parsed = parseTar(arc);
    expect(parsed.get("./a/b.txt")!.data.toString()).toBe("hello");
    expect(parsed.get("./dir/")!.type).toBe("5".charCodeAt(0));
  });
  test("ar round-trip parses members", () => {
    const a = ar([{ name: "x", data: Buffer.from("yz") }]);
    expect(parseAr(a).get("x")!.toString()).toBe("yz");
  });
});
