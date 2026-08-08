/**
 * Launch hardening · audit discrepancy D-1 — secrets file fallback is now
 * AES-256-GCM sealed at rest instead of plaintext NAME=value (the deep audit
 * claimed an "AES-256-GCM credential vault" that did not exist; this makes the
 * claim true for the fallback, with the honest threat model documented in
 * src/security/secrets.ts).
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let HOME: string;
let secrets: typeof import("../../src/security/secrets.ts");

beforeEach(async () => {
  HOME = mkdtempSync(join(tmpdir(), "xr-secrets-"));
  process.env.XR_HOME = HOME;
  // secrets.ts resolves XR_HOME lazily; a fresh import per case isolates the
  // in-memory memo.
  secrets = await import("../../src/security/secrets.ts");
  secrets.clearSecretMemo();
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("XR_TEST_")) delete process.env[k];
  }
  rmSync(HOME, { recursive: true, force: true });
  delete process.env.XR_HOME;
});

const NAME = "XR_TEST_LAUNCH_KEY";
const VALUE = "sk-test-launch-hardening-0123456789";

describe("D-1 · file fallback encrypts at rest", () => {
  test("a written secret is not recoverable from the file without the key", () => {
    secrets.setSecret(NAME, VALUE);
    const raw = readFileSync(join(HOME, ".env"), "utf8");
    expect(raw).not.toContain(VALUE);
    expect(raw).toContain(`${NAME}=XRG1.`);
    // Round-trip through the public API works.
    secrets.clearSecretMemo();
    delete process.env[NAME];
    expect(secrets.getSecret(NAME)).toBe(VALUE);
  });

  test("the per-install key exists, is 32 bytes, and lives outside the .env file", () => {
    secrets.setSecret(NAME, VALUE);
    const keyPath = join(HOME, "secrets", ".file-key");
    expect(existsSync(keyPath)).toBe(true);
    expect(readFileSync(keyPath).length).toBe(32);
    expect(readFileSync(join(HOME, ".env"), "utf8")).not.toContain(readFileSync(keyPath).toString("base64"));
  });

  test("ciphertext for the same value differs across writes (random IV)", () => {
    secrets.setSecret(NAME, VALUE);
    const first = readFileSync(join(HOME, ".env"), "utf8");
    secrets.setSecret(NAME, VALUE);
    const second = readFileSync(join(HOME, ".env"), "utf8");
    expect(first).not.toBe(second);
    secrets.clearSecretMemo();
    delete process.env[NAME];
    expect(secrets.getSecret(NAME)).toBe(VALUE);
  });

  test("legacy plaintext files migrate transparently on first read", () => {
    // Pre-hardening format: raw NAME=value, no header.
    writeFileSync(join(HOME, ".env"), `${NAME}=${VALUE}\n`);
    delete process.env[NAME];
    expect(secrets.getSecret(NAME)).toBe(VALUE);
    const migrated = readFileSync(join(HOME, ".env"), "utf8");
    expect(migrated).not.toContain(VALUE);
    expect(migrated).toContain(`${NAME}=XRG1.`);
  });

  test("legacy plaintext coexisting with sealed entries migrates only the plaintext", () => {
    secrets.setSecret(NAME, VALUE);
    const sealedLine = readFileSync(join(HOME, ".env"), "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${NAME}=XRG1.`))!;
    writeFileSync(join(HOME, ".env"), `${sealedLine}\nXR_TEST_LEGACY=legacy-value-123\n`);
    secrets.clearSecretMemo();
    delete process.env[NAME];
    expect(secrets.getSecret("XR_TEST_LEGACY" as any)).toBe("legacy-value-123");
    expect(secrets.getSecret(NAME)).toBe(VALUE);
    const raw = readFileSync(join(HOME, ".env"), "utf8");
    expect(raw).not.toContain("legacy-value-123");
    expect(raw).not.toContain(VALUE);
  });

  test("an entry sealed under a different key is never silently dropped", () => {
    secrets.setSecret(NAME, VALUE);
    // Simulate key loss/rotation: replace the key with a fresh random one.
    writeFileSync(join(HOME, "secrets", ".file-key"), Buffer.from("k".repeat(32)));
    secrets.clearSecretMemo();
    delete process.env[NAME];
    // Unreadable → absent to readers…
    expect(secrets.getSecret(NAME)).toBeUndefined();
    // …but a subsequent write of ANOTHER secret must preserve the sealed line.
    secrets.setSecret("XR_TEST_OTHER" as any, "other-value");
    const raw = readFileSync(join(HOME, ".env"), "utf8");
    expect(raw).toContain(`${NAME}=XRG1.`);
    expect(secrets.getSecret("XR_TEST_OTHER" as any)).toBe("other-value");
  });

  test("removeSecret removes the entry and keeps the file sealed", () => {
    secrets.setSecret(NAME, VALUE);
    secrets.removeSecret(NAME);
    const raw = readFileSync(join(HOME, ".env"), "utf8");
    expect(raw).not.toContain(NAME);
    expect(secrets.getSecret(NAME)).toBeUndefined();
  });
});
