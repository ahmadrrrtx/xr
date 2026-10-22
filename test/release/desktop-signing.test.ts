/**
 * XR-LAUNCH-008 (decision D5) — desktop signing is secrets-gated, and the
 * updater manifest is verified before it is published.
 *
 * The signature fixtures under fixtures/updater/ were produced by the real
 * Tauri CLI (`tauri signer generate` with a throwaway key whose PRIVATE half
 * was deleted, then `tauri signer sign`); only the public key, the payload and
 * the .sig are committed.
 */
import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signingPlan, type PlanInput } from "../../scripts/desktop-signing-plan.ts";
import { parsePublicKey, verifyManifest, verifySignature } from "../../scripts/verify-updater-signatures.ts";
import { buildManifest } from "../../scripts/make-updater-manifest.ts";

const FIX = join(import.meta.dir, "fixtures", "updater");
const pub = readFileSync(join(FIX, "tauri-test.pub"), "utf8");
const sig = readFileSync(join(FIX, "payload.bin.sig"), "utf8");
const payload = readFileSync(join(FIX, "payload.bin"));

const base: PlanInput = { os: "linux", tag: false, pubkeyCommitted: false, hasUpdaterKey: false, hasAppleCert: false, hasAppleNotary: false, hasWindowsCert: false };

describe("signing plan — missing secrets give an honest unsigned build", () => {
  test("no secrets anywhere: no config, unsigned notices, never an error on PRs", () => {
    for (const os of ["linux", "macos", "windows"] as const) {
      const p = signingPlan({ ...base, os });
      expect(p.error).toBeUndefined();
      expect(p.config).toEqual({});
      expect(p.signedOs).toBe(false);
      expect(p.updaterArtifacts).toBe(false);
      if (os !== "linux") expect(p.notices.join(" ")).toContain("UNSIGNED");
    }
  });

  test("pubkey committed but key missing: PR builds skip updater artifacts; tag builds fail", () => {
    const pr = signingPlan({ ...base, pubkeyCommitted: true });
    expect(pr.error).toBeUndefined();
    expect(pr.config).toEqual({ bundle: { createUpdaterArtifacts: false } });
    const tag = signingPlan({ ...base, pubkeyCommitted: true, tag: true });
    expect(tag.error).toContain("TAURI_UPDATER_KEY");
  });

  test("updater fully provisioned: artifacts on, config untouched", () => {
    const p = signingPlan({ ...base, pubkeyCommitted: true, hasUpdaterKey: true });
    expect(p.updaterArtifacts).toBe(true);
    expect(p.config).toEqual({});
  });

  test("windows: thumbprint → Authenticode config with SHA-256 + timestamp; bad thumbprint fails", () => {
    const thumb = "a".repeat(40);
    const p = signingPlan({ ...base, os: "windows", hasWindowsCert: true, windowsThumbprint: thumb });
    expect(p.signedOs).toBe(true);
    expect(p.config).toEqual({ bundle: { windows: { certificateThumbprint: thumb.toUpperCase(), digestAlgorithm: "sha256", timestampUrl: "http://timestamp.digicert.com" } } });
    expect(signingPlan({ ...base, os: "windows", hasWindowsCert: true }).error).toContain("thumbprint");
  });

  test("macos: a signed-but-not-notarized TAG build is refused", () => {
    expect(signingPlan({ ...base, os: "macos", hasAppleCert: true, tag: true }).error).toContain("notarized");
    const ok = signingPlan({ ...base, os: "macos", hasAppleCert: true, hasAppleNotary: true, tag: true });
    expect(ok.error).toBeUndefined();
    expect(ok.notarized).toBe(true);
  });

  test("the workflow wires the plan, the OS verifiers and the manifest verifier", () => {
    const wf = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "desktop-app.yml"), "utf8");
    expect(wf).toContain("scripts/desktop-signing-plan.ts");
    expect(wf).toContain("--config ${{ env.XR_SIGNING_CONFIG }}");
    expect(wf).toContain("codesign --verify --deep --strict");
    expect(wf).toContain("spctl --assess --type execute");
    expect(wf).toContain("verify /pa /v");
    expect(wf).toContain("TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
    const verifyAt = wf.indexOf("scripts/verify-updater-signatures.ts");
    const publishAt = wf.indexOf("Publish latest.json to the release");
    expect(verifyAt).toBeGreaterThan(0);
    expect(verifyAt).toBeLessThan(publishAt);
  });
});

describe("updater signatures — real Tauri minisign output", () => {
  test("the committed fixture key parses as a minisign Ed25519 public key", () => {
    expect(parsePublicKey(pub).key.length).toBe(32);
  });

  test("a genuine signature verifies", () => {
    expect(verifySignature(pub, sig, payload)).toEqual({ ok: true });
  });

  test("a tampered payload is rejected", () => {
    expect(verifySignature(pub, sig, Buffer.concat([payload, Buffer.from("!")])).ok).toBe(false);
  });

  test("an altered trusted comment is rejected", () => {
    const lines = Buffer.from(sig, "base64").toString("utf8").split("\n");
    lines[2] = lines[2]!.replace("timestamp:", "timestamp:9");
    expect(verifySignature(pub, Buffer.from(lines.join("\n")).toString("base64"), payload)).toMatchObject({ ok: false, reason: expect.stringContaining("trusted comment") });
  });

  test("a signature from another key is rejected (key id and math)", () => {
    // Forge a well-formed minisign signature with a different Ed25519 key.
    const { privateKey } = generateKeyPairSync("ed25519");
    const keyId = Buffer.from("0123456789abcdef", "hex");
    const s = edSign(null, payload, privateKey);
    const trusted = "trusted comment: forged";
    const g = edSign(null, Buffer.concat([s, Buffer.from("forged")]), privateKey);
    const forged = Buffer.from(["untrusted comment: x", Buffer.concat([Buffer.from("Ed"), keyId, s]).toString("base64"), trusted, g.toString("base64")].join("\n")).toString("base64");
    expect(verifySignature(pub, forged, payload)).toMatchObject({ ok: false, reason: expect.stringContaining("different key") });
  });

  test("a raw 32-byte key (the old generate-updater-keys output) is refused", () => {
    const raw = Buffer.alloc(32, 7).toString("base64");
    expect(verifySignature(raw, sig, payload).ok).toBe(false);
  });
});

describe("latest.json verification before publishing", () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-updater-verify-"));
  const name = "XR_1.2.0_amd64.AppImage";
  writeFileSync(join(dir, name), payload);
  writeFileSync(join(dir, `${name}.sig`), sig);
  const manifest = buildManifest(dir, "1.2.0", "v1.2.0", "notes") as { platforms: Record<string, { signature: string; url: string }> };

  test("the manifest built from signed artifacts verifies", () => {
    const r = verifyManifest(manifest, dir, [name, `${name}.sig`], pub);
    expect(r.length).toBe(1);
    expect(r.every((x) => x.ok)).toBe(true);
  });

  test("a tampered latest.json (URL pointing at another payload) is rejected", () => {
    writeFileSync(join(dir, "other.AppImage"), "something else");
    const tampered = structuredClone(manifest);
    tampered.platforms["linux-x86_64"]!.url = "https://github.com/ahmadrrrtx/xr/releases/download/v1.2.0/other.AppImage";
    const r = verifyManifest(tampered, dir, [name, "other.AppImage"], pub);
    expect(r[0]!.ok).toBe(false);
  });

  test("a tampered latest.json (signature swapped) is rejected", () => {
    const tampered = structuredClone(manifest);
    const p = tampered.platforms["linux-x86_64"]!;
    p.signature = Buffer.from(Buffer.from(p.signature, "base64").toString("utf8").replace(/\n(.)/, "\nX")).toString("base64");
    expect(verifyManifest(tampered, dir, [name], pub)[0]!.ok).toBe(false);
  });

  test("--notes is text, not a path (the tag job used to crash with ENOENT)", () => {
    const src = readFileSync(join(import.meta.dir, "..", "..", "scripts", "make-updater-manifest.ts"), "utf8");
    expect(src).toContain('a["notes-file"] ? readFileSync(a["notes-file"], "utf8") : (a.notes || "See CHANGELOG.md")');
    rmSync(dir, { recursive: true, force: true });
  });
});
