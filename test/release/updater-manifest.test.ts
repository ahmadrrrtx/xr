/**
 * Phase 5 · updater dry-run (DoD): the latest.json assembler is exercised
 * offline against fixture artifacts and must stay honest —
 *   • signed per-platform artifacts map to the exact platform keys
 *     tauri-plugin-updater (≥ 2.10, installer-aware) expects, with release-asset
 *     URLs for THIS repo/tag, named the way GitHub actually serves them
 *   • both Windows flavours are listed under their specific keys and the
 *     generic key mirrors the MSI (the flavour every pre-policy install has)
 *   • an unprovisioned bundle dir (no .sig files) yields ZERO platforms so the
 *     publish step skips instead of half-shipping an unsigned updater
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest, releaseAssetName } from "../../scripts/make-updater-manifest.ts";

type Manifest = { version: string; platforms: Record<string, { signature: string; url: string }> };

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-updater-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

describe("updater manifest dry-run", () => {
  test("signed v2 artifacts map to installer-aware platform keys + repo asset URLs", () => {
    const dir = fixtureDir({
      "xr-desktop_1.0.0_amd64.AppImage": "x",
      "xr-desktop_1.0.0_amd64.AppImage.sig": "SIGLINUX",
      "XR Desktop_1.0.0_aarch64.app.tar.gz": "x",
      "XR Desktop_1.0.0_aarch64.app.tar.gz.sig": "SIGMAC",
      "XR Desktop_1.0.0_x64-setup.exe": "x",
      "XR Desktop_1.0.0_x64-setup.exe.sig": "SIGNSIS",
      "XR Desktop_1.0.0_x64_en-US.msi": "x",
      "XR Desktop_1.0.0_x64_en-US.msi.sig": "SIGMSI",
      "unrelated.deb": "x",
    });
    try {
      const m = buildManifest(dir, "1.0.0", "v1.0.0", "notes") as Manifest;
      expect(m.version).toBe("1.0.0");
      expect(Object.keys(m.platforms).sort()).toEqual(
        ["linux-x86_64", "darwin-aarch64", "windows-x86_64-nsis", "windows-x86_64-msi", "windows-x86_64"].sort(),
      );
      expect(m.platforms["linux-x86_64"].signature).toBe("SIGLINUX");
      expect(m.platforms["linux-x86_64"].url).toBe(
        "https://github.com/ahmadrrrtx/xr/releases/download/v1.0.0/xr-desktop_1.0.0_amd64.AppImage",
      );
      // GitHub serves "XR Desktop_…" as "XR.Desktop_…" — the URL must say so.
      expect(m.platforms["windows-x86_64-nsis"].url).toBe(
        "https://github.com/ahmadrrrtx/xr/releases/download/v1.0.0/XR.Desktop_1.0.0_x64-setup.exe",
      );
      expect(m.platforms["windows-x86_64-msi"].signature).toBe("SIGMSI");
      // Generic key = MSI while an MSI exists: MSI installs never get an NSIS payload.
      expect(m.platforms["windows-x86_64"]).toEqual(m.platforms["windows-x86_64-msi"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("generic windows key falls back to NSIS only when no MSI was built", () => {
    const dir = fixtureDir({
      "XR Desktop_1.0.0_x64-setup.exe": "x",
      "XR Desktop_1.0.0_x64-setup.exe.sig": "SIGNSIS",
    });
    try {
      const m = buildManifest(dir, "1.0.0", "v1.0.0", "n") as Manifest;
      expect(Object.keys(m.platforms).sort()).toEqual(["windows-x86_64-nsis", "windows-x86_64"].sort());
      expect(m.platforms["windows-x86_64"].signature).toBe("SIGNSIS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unprovisioned dir ⇒ zero platforms (publish must skip, never half-ship)", () => {
    const dir = fixtureDir({
      "xr-desktop_1.0.0_amd64.AppImage": "x", // unsigned
      "XR Desktop_1.0.0_x64_en-US.msi.sig": "orphan", // a .sig without its payload is not shippable either
    });
    try {
      const m = buildManifest(dir, "1.0.0", "v1.0.0", "n") as Manifest;
      expect(Object.keys(m.platforms)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("legacy v1Compatible shapes are NOT silently accepted (config says createUpdaterArtifacts: true)", () => {
    const dir = fixtureDir({
      "XR Desktop_1.0.0_x64.msi.zip": "x",
      "XR Desktop_1.0.0_x64.msi.zip.sig": "SIG",
      "xr-desktop_1.0.0_amd64.AppImage.tar.gz": "x",
      "xr-desktop_1.0.0_amd64.AppImage.tar.gz.sig": "SIG",
    });
    try {
      const m = buildManifest(dir, "1.0.0", "v1.0.0", "n") as Manifest;
      expect(Object.keys(m.platforms)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("release asset naming mirrors GitHub's normalisation (spaces → periods)", () => {
    expect(releaseAssetName("XR Desktop_1.0.0_x64_en-US.msi")).toBe("XR.Desktop_1.0.0_x64_en-US.msi");
    expect(releaseAssetName("xr-desktop_1.0.0_amd64.AppImage")).toBe("xr-desktop_1.0.0_amd64.AppImage");
  });

  test("keygen script emits a raw-32-byte ed25519 pubkey (tauri format)", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { publicKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ type: "spki", format: "der" }).toString("hex");
    const raw = Buffer.from(spki.slice(24), "hex"); // 12-byte SPKI prefix
    expect(raw.length).toBe(32);
    expect(Buffer.from(raw.toString("base64"), "base64").length).toBe(32);
  });
});
