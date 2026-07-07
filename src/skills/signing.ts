/** XR 2.1C — Skill package verification and signing helpers. */
import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export interface PublisherKeyPair {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface PackageSignatureEnvelope {
  schemaVersion: 1;
  type: "xr.skill.signature.v1";
  keyId: string;
  algorithm: "ed25519";
  packageSha256: string;
  signature: string;
  signedAt: number;
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function generatePublisherKeyPair(keyId = `xr-pub-${Date.now()}`): PublisherKeyPair {
  const pair = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { keyId, publicKeyPem: pair.publicKey, privateKeyPem: pair.privateKey };
}

export function signPackageFile(packagePath: string, privateKeyPem: string, keyId: string): PackageSignatureEnvelope {
  const digest = sha256File(packagePath);
  const signature = cryptoSign(null, Buffer.from(digest, "utf8"), privateKeyPem).toString("base64");
  return { schemaVersion: 1, type: "xr.skill.signature.v1", keyId, algorithm: "ed25519", packageSha256: digest, signature, signedAt: Date.now() };
}

export function writePackageSignature(packagePath: string, privateKeyPem: string, keyId: string, outPath = `${packagePath}.sig.json`): PackageSignatureEnvelope {
  const envelope = signPackageFile(packagePath, privateKeyPem, keyId);
  writeFileSync(outPath, JSON.stringify(envelope, null, 2));
  return envelope;
}

export function verifyPackageSignature(packagePath: string, publicKeyPem: string, envelope: PackageSignatureEnvelope): { ok: boolean; reason: string } {
  const digest = sha256File(packagePath);
  if (digest !== envelope.packageSha256) return { ok: false, reason: "package sha256 does not match signature envelope" };
  const ok = cryptoVerify(null, Buffer.from(envelope.packageSha256, "utf8"), publicKeyPem, Buffer.from(envelope.signature, "base64"));
  return ok ? { ok: true, reason: "signature valid" } : { ok: false, reason: "signature invalid" };
}
