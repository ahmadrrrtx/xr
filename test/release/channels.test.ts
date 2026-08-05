/**
 * XR Phase 9 · T3 — channel derivation tests (one canonical build, many channels).
 *
 * Asserts EFFECTS: the generated channel configs actually bind the release
 * manifest, stamped channels carry the canonical build's real checksums, the
 * drift gate catches a doctored config, and the .deb payload round-trips to
 * the exact bytes of the canonical binary.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  renderHomebrewFormula,
  renderWinget,
  renderScoop,
  renderedTemplates,
  downloadUrl,
  PACKAGING_DIR,
} from "../../scripts/channel-manifest.ts";
import { buildDeb } from "../../scripts/build-deb.ts";
import { loadManifest } from "../../scripts/release-manifest.ts";
import { parse, serialize } from "../../scripts/sums.ts";

const manifest = loadManifest();
const VERSION = manifest.identity.version;

describe("Phase 9 · T3 — one canonical build, many channels", () => {
  test("every installer-facing URL points at the canonical release of the manifest version", () => {
    const files = renderedTemplates(manifest);
    const urlBearing = files.filter((f) => f.content.includes("releases/download"));
    // formula + winget installer + scoop carry download URLs
    expect(urlBearing.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      expect(f.content).not.toContain("TODO");
    }
    for (const f of urlBearing) {
      expect(f.content).toContain(`/releases/download/v${VERSION}/`);
    }
    // version-stamped files exist for every channel
    const versioned = files.filter((f) => f.relpath.includes(`/${VERSION}/`) || f.content.includes(`version "${VERSION}"`));
    expect(versioned.length).toBeGreaterThanOrEqual(4);
  });

  test("committed packaging templates equal the generator output (no channel drift)", () => {
    for (const f of renderedTemplates(manifest)) {
      const onDisk = readFileSync(join(PACKAGING_DIR, f.relpath), "utf8");
      expect(onDisk).toBe(f.content);
    }
  });

  test("Homebrew formula binds all four macOS/Linux targets with stamped sha256", () => {
    const sums = new Map([
      ["xr-darwin-arm64", "a".repeat(64)],
      ["xr-darwin-x64", "b".repeat(64)],
      ["xr-linux-arm64", "c".repeat(64)],
      ["xr-linux-x64", "d".repeat(64)],
      ["xr-windows-x64.zip", "e".repeat(64)],
    ]);
    const formula = renderHomebrewFormula(manifest, sums);
    expect(formula).toContain(`sha256 "${"a".repeat(64)}"`);
    expect(formula).toContain(`sha256 "${"b".repeat(64)}"`);
    expect(formula).toContain(`sha256 "${"c".repeat(64)}"`);
    expect(formula).toContain(`sha256 "${"d".repeat(64)}"`);
    expect(formula).toContain(`version "${VERSION}"`);
  });

  test("stamping fails closed when a target is missing from the sums (no unsigned drift)", () => {
    const incomplete = new Map([["xr-darwin-arm64", "a".repeat(64)]]);
    expect(() => renderHomebrewFormula(manifest, incomplete)).toThrow(/failed closed/);
    expect(() => renderWinget(manifest, incomplete)).toThrow(/failed closed/);
    expect(() => renderScoop(manifest, incomplete)).toThrow(/failed closed/);
  });

  test("stamping fails closed on a malformed checksum", () => {
    const bad = new Map([
      ["xr-darwin-arm64", "z".repeat(64)],
      ["xr-darwin-x64", "b".repeat(64)],
      ["xr-linux-arm64", "c".repeat(64)],
      ["xr-linux-x64", "d".repeat(64)],
      ["xr-windows-x64.zip", "e".repeat(64)],
    ]);
    expect(() => renderHomebrewFormula(manifest, bad)).toThrow(/failed closed/);
  });

  test("WinGet + Scoop manifests bind the canonical windows zip sha256", () => {
    const sha = "f".repeat(64);
    const sums = new Map([["xr-windows-x64.zip", sha]]);
    const winget = renderWinget(manifest, sums);
    const installer = winget.find((f) => f.relpath.endsWith("installer.yaml"))!;
    expect(installer.content).toContain(`InstallerSha256: ${sha}`);
    expect(installer.relpath).toContain(`/${VERSION}/`);
    const scoop = JSON.parse(renderScoop(manifest, sums)) as { version: string; architecture: { "64bit": { hash: string; url: string } } };
    expect(scoop.version).toBe(VERSION);
    expect(scoop.architecture["64bit"].hash).toBe(sha);
    expect(scoop.architecture["64bit"].url).toBe(downloadUrl(manifest, "xr-windows-x64.zip"));
  });

  test(".deb round-trips: ar structure, control fields, payload identical to the canonical binary", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-deb-test-"));
    const payload = Buffer.from(`canonical-binary-${VERSION}`);
    const binPath = join(dir, "xr-linux-x64");
    writeFileSync(binPath, payload);

    const deb = buildDeb({
      info: {
        package: "xr",
        version: VERSION,
        architecture: "amd64",
        maintainer: "XR Maintainers",
        description: manifest.identity.description,
        homepage: manifest.identity.repo,
        section: "utils",
        priority: "optional",
        installedSizeKiB: Math.ceil(payload.length / 1024) || 1,
      },
      binaryPath: binPath,
    });

    // ── ar container
    expect(deb.subarray(0, 8).toString("ascii")).toBe("!<arch>\n");
    // parse members
    let off = 8;
    const members = new Map<string, Buffer>();
    while (off < deb.length) {
      const name = deb.subarray(off, off + 16).toString("ascii").trim();
      const size = Number.parseInt(deb.subarray(off + 48, off + 58).toString("ascii").trim(), 10);
      const data = Buffer.from(deb.subarray(off + 60, off + 60 + size));
      members.set(name, data);
      off += 60 + size + (size % 2);
    }
    expect(members.get("debian-binary")!.toString("utf8")).toBe("2.0\n");
    expect(members.has("control.tar.gz")).toBe(true);
    expect(members.has("data.tar.gz")).toBe(true);

    // ── control fields
    const controlTar = gunzipSync(members.get("control.tar.gz")!);
    const control = extractTarText(controlTar, "control");
    expect(control).toContain(`Package: xr`);
    expect(control).toContain(`Version: ${VERSION}`);
    expect(control).toContain("Architecture: amd64");
    const md5sums = extractTarText(controlTar, "md5sums");
    expect(md5sums).toContain(createHash("md5").update(payload).digest("hex"));

    // ── data payload: the EXACT canonical binary bytes
    const dataTar = gunzipSync(members.get("data.tar.gz")!);
    const extracted = extractTarData(dataTar, "usr/bin/xr");
    expect(extracted).not.toBeNull();
    expect(createHash("sha256").update(extracted!).digest("hex")).toBe(
      createHash("sha256").update(payload).digest("hex"),
    );
  });

  test("SHA256SUMS parse/serialize round-trip is deterministic", () => {
    const sums = new Map([
      ["xr-linux-x64", "1".repeat(64)],
      ["xr-windows-x64.exe", "2".repeat(64)],
    ]);
    const text = serialize(sums);
    const parsed = parse(text);
    expect(parsed.get("xr-linux-x64")).toBe("1".repeat(64));
    expect(parsed.get("xr-windows-x64.exe")).toBe("2".repeat(64));
    // sha256sum native format tolerated (binary marker + ./ prefix)
    expect(parse(`${"3".repeat(64)} *./xr-darwin-arm64\n`).get("xr-darwin-arm64")).toBe("3".repeat(64));
  });
});

function tarEntries(tar: Buffer): Array<{ name: string; data: Buffer }> {
  const out: Array<{ name: string; data: Buffer }> = [];
  let off = 0;
  while (off + 512 <= tar.length) {
    const name = tar.subarray(off, off + 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) break;
    const sizeOct = tar.subarray(off + 124, off + 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = sizeOct ? Number.parseInt(sizeOct, 8) : 0;
    out.push({ name: name.replace(/^\.\//, ""), data: Buffer.from(tar.subarray(off + 512, off + 512 + size)) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

function extractTarText(tar: Buffer, name: string): string {
  return tarEntries(tar).find((e) => e.name === name)?.data.toString("utf8").replace(/\0+$/g, "") ?? "";
}

function extractTarData(tar: Buffer, name: string): Buffer | null {
  const e = tarEntries(tar).find((x) => x.name === name);
  return e ? e.data : null;
}
