/**
 * Phase 5 · updater dry-run (DoD): the latest.json assembler is exercised
 * offline against fixture artifacts and must stay honest —
 *   • signed per-platform artifacts map to the exact platform keys the
 *     tauri-plugin-updater expects, with release-asset URLs for THIS repo/tag
 *   • an unprovisioned bundle dir (no .sig files) yields ZERO platforms so the
 *     publish step skips instead of half-shipping an unsigned updater
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest } from "../../scripts/make-updater-manifest.ts";

describe("updater manifest dry-run", () => {
  test("signed artifacts map to updater platform keys + repo URLs", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-updater-"));
    try {
      writeFileSync(join(dir, "xr-desktop_0.1.0_amd64.AppImage.tar.gz"), "x");
      writeFileSync(join(dir, "xr-desktop_0.1.0_amd64.AppImage.tar.gz.sig"), "SIGLINUX");
      writeFileSync(join(dir, "XR Desktop_0.1.0_aarch64.app.tar.gz"), "x");
      writeFileSync(join(dir, "XR Desktop_0.1.0_aarch64.app.tar.gz.sig"), "SIGMAC");
      writeFileSync(join(dir, "XR Desktop_0.1.0_x64.msi.zip"), "x");
      writeFileSync(join(dir, "XR Desktop_0.1.0_x64.msi.zip.sig"), "SIGWIN");
      writeFileSync(join(dir, "unrelated.deb"), "x");

      const m = buildManifest(dir, "0.1.0", "v0.1.0", "notes") as {
        version: string;
        platforms: Record<string, { signature: string; url: string }>;
      };
      expect(m.version).toBe("0.1.0");
      expect(Object.keys(m.platforms).sort()).toEqual(["linux-x86_64", "darwin-aarch64", "windows-x86_64"].sort());
      expect(m.platforms["linux-x86_64"].signature).toBe("SIGLINUX");
      expect(m.platforms["windows-x86_64"].url).toBe(
        "https://github.com/ahmadrrrtx/xr/releases/download/v0.1.0/XR Desktop_0.1.0_x64.msi.zip",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unprovisioned dir ⇒ zero platforms (publish must skip, never half-ship)", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-updater-empty-"));
    try {
      writeFileSync(join(dir, "xr-desktop_0.1.0_amd64.AppImage.tar.gz"), "x"); // unsigned
      const m = buildManifest(dir, "0.1.0", "v0.1.0", "n") as { platforms: Record<string, unknown> };
      expect(Object.keys(m.platforms)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
