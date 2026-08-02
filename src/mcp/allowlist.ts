/**
 * XR Phase 7 · T6 — MCP signed allowlist (default-deny).
 *
 * Constitution Art. XV.3 / §10.6: MCP is a first-class governed boundary —
 * default-deny, exact command/network grants, SIGNED ALLOWLIST, disposable
 * isolation, kill/uninstall.
 *
 * The allowlist is a small ed25519-signed artifact:
 *
 *   ~/.xr/mcp/allowlist.json
 *   {
 *     "schemaVersion": 1,
 *     "generatedAt": 1712...,
 *     "servers": { "<serverId>": { "grantedAt": ..., "by": "operator" } },
 *     "signatures": [{ "keyId": "...", "sig": "base64" }]
 *   }
 *
 * - DEFAULT-DENY: a server NOT on the allowlist is refused at load even if
 *   `enabled` is true in the registry. `enabled` is necessary but not
 *   sufficient.
 * - The allowlist itself must be signed (by the operator key or the XR
 *   publisher key, threshold 1); an unsigned allowlist is treated as empty
 *   (fail-closed) — with a warning.
 * - `xr mcp allow <id>` signs the entry; `xr mcp revoke <id>` removes and
 *   re-signs, and revocation kills any live client (manager.unloadOne).
 */

import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const MCP_ALLOWLIST_SCHEMA_VERSION = 1;

export interface AllowlistEntry {
  grantedAt: number;
  by: string;
  reason?: string;
}

export interface AllowlistSignature {
  keyId: string;
  sig: string;
}

export interface McpAllowlistFile {
  schemaVersion: typeof MCP_ALLOWLIST_SCHEMA_VERSION;
  generatedAt: number;
  servers: Record<string, AllowlistEntry>;
  signatures: AllowlistSignature[];
}

export function mcpAllowlistPath(): string {
  return join(process.env.XR_HOME ?? join(homedir(), ".xr"), "mcp", "allowlist.json");
}

export function defaultAllowlistKeysPath(): string {
  return join(process.env.XR_HOME ?? join(homedir(), ".xr"), "mcp", "allowlist-keys.json");
}

export interface AllowlistKeyMaterial {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem?: string;
}

export interface AllowlistResult {
  ok: boolean;
  reason?: string;
}

function canonicalServers(servers: Record<string, AllowlistEntry>): string {
  const sorted: Record<string, AllowlistEntry> = {};
  for (const id of Object.keys(servers).sort()) sorted[id] = servers[id];
  return JSON.stringify({ schemaVersion: MCP_ALLOWLIST_SCHEMA_VERSION, generatedAt: 0, servers: sorted });
}

/** Sign the allowlist payload (servers only; timestamp excluded for replay-free rotation). */
export function signAllowlist(servers: Record<string, AllowlistEntry>, privateKeyPem: string, keyId: string): AllowlistSignature {
  const digest = createHash("sha256").update(canonicalServers(servers), "utf8").digest("hex");
  const sig = cryptoSign(null, Buffer.from(digest, "utf8"), privateKeyPem).toString("base64");
  return { keyId, sig };
}

export function verifyAllowlist(
  file: McpAllowlistFile,
  publicKeys: Record<string, string>,
): { ok: boolean; reason: string; validKeyIds: string[] } {
  const digest = createHash("sha256").update(canonicalServers(file.servers), "utf8").digest("hex");
  const validKeyIds: string[] = [];
  for (const sig of file.signatures) {
    const publicPem = publicKeys[sig.keyId];
    if (!publicPem) continue;
    try {
      if (cryptoVerify(null, Buffer.from(digest, "utf8"), publicPem, Buffer.from(sig.sig, "base64"))) {
        validKeyIds.push(sig.keyId);
      }
    } catch {
      // invalid signature — ignore
    }
  }
  if (validKeyIds.length === 0) {
    return { ok: false, reason: "allowlist has no valid signature from a trusted key", validKeyIds };
  }
  return { ok: true, reason: `allowlist signed by ${validKeyIds.join(", ")}`, validKeyIds };
}

export class McpAllowlist {
  private file: McpAllowlistFile;
  private keys: Record<string, string>; // keyId → public PEM (trusted signers)

  constructor(
    private readonly allowlistPath = mcpAllowlistPath(),
    private readonly keysPath = defaultAllowlistKeysPath(),
  ) {
    this.keys = this.readKeys();
    this.file = this.readAllowlist();
  }

  private readKeys(): Record<string, string> {
    if (!existsSync(this.keysPath)) return {};
    try {
      const raw = JSON.parse(readFileSync(this.keysPath, "utf8")) as { keys: Array<{ keyId: string; publicKeyPem: string }> };
      return Object.fromEntries((raw.keys ?? []).map((k) => [k.keyId, k.publicKeyPem]));
    } catch {
      return {};
    }
  }

  private readAllowlist(): McpAllowlistFile {
    if (!existsSync(this.allowlistPath)) return { schemaVersion: MCP_ALLOWLIST_SCHEMA_VERSION, generatedAt: 0, servers: {}, signatures: [] };
    try {
      const raw = JSON.parse(readFileSync(this.allowlistPath, "utf8")) as McpAllowlistFile;
      if (raw?.schemaVersion === MCP_ALLOWLIST_SCHEMA_VERSION && typeof raw.servers === "object" && Array.isArray(raw.signatures)) {
        return raw;
      }
    } catch {
      // Corrupt → fail closed (empty allowlist).
    }
    return { schemaVersion: MCP_ALLOWLIST_SCHEMA_VERSION, generatedAt: 0, servers: {}, signatures: [] };
  }

  /** Verification state of the allowlist file itself. */
  verifyFile(): { ok: boolean; reason: string; hasKeys: boolean } {
    if (!this.keys || Object.keys(this.keys).length === 0) {
      return { ok: false, reason: "no trusted allowlist keys configured", hasKeys: false };
    }
    if (this.file.signatures.length === 0) {
      return { ok: false, reason: "allowlist file is unsigned", hasKeys: true };
    }
    return { ok: verifyAllowlist(this.file, this.keys).ok, reason: verifyAllowlist(this.file, this.keys).reason, hasKeys: true };
  }

  /**
   * DEFAULT-DENY gate: is this server allowed to LOAD?
   * A server is allowed only when the allowlist file is validly signed AND
   * the server id is listed.
   */
  isAllowed(serverId: string): AllowlistResult {
    const file = this.verifyFile();
    if (!file.ok) {
      return { ok: false, reason: `allowlist gate fail-closed: ${file.reason}` };
    }
    if (!this.file.servers[serverId]) {
      return { ok: false, reason: `server "${serverId}" is not on the signed allowlist (default-deny)` };
    }
    return { ok: true, reason: `server "${serverId}" is on the signed allowlist (granted ${new Date(this.file.servers[serverId].grantedAt).toISOString()} by ${this.file.servers[serverId].by})` };
  }

  list(): Array<{ serverId: string; grantedAt: number; by: string; reason?: string }> {
    return Object.entries(this.file.servers)
      .map(([serverId, entry]) => ({ serverId, grantedAt: entry.grantedAt, by: entry.by, reason: entry.reason }))
      .sort((a, b) => a.serverId.localeCompare(b.serverId));
  }

  /** Grant a server (signs the new allowlist). Requires a private signing key. */
  allow(serverId: string, opts: { by?: string; reason?: string; privateKeyPem?: string; keyId?: string } = {}): AllowlistResult {
    const signer = this.resolveSigner(opts);
    if (!signer) return { ok: false, reason: "no signing key available — configure an allowlist key or pass --key" };
    this.file.servers[serverId] = { grantedAt: Date.now(), by: opts.by ?? "operator", reason: opts.reason };
    this.signAndFlush(signer.privateKeyPem, signer.keyId);
    return { ok: true, reason: `server "${serverId}" allowed and allowlist re-signed (${signer.keyId})` };
  }

  /** Revoke a server and re-sign (revocation kills live clients at the manager layer). */
  revoke(serverId: string, opts: { by?: string; privateKeyPem?: string; keyId?: string } = {}): AllowlistResult {
    const signer = this.resolveSigner(opts);
    if (!signer) return { ok: false, reason: "no signing key available" };
    if (!this.file.servers[serverId]) return { ok: false, reason: `server "${serverId}" is not allowlisted` };
    delete this.file.servers[serverId];
    this.signAndFlush(signer.privateKeyPem, signer.keyId);
    return { ok: true, reason: `server "${serverId}" revoked; allowlist re-signed (${signer.keyId})` };
  }

  private resolveSigner(opts: { privateKeyPem?: string; keyId?: string }): { privateKeyPem: string; keyId: string } | null {
    if (opts.privateKeyPem && opts.keyId) return { privateKeyPem: opts.privateKeyPem, keyId: opts.keyId };
    if (existsSync(this.keysPath)) {
      try {
        const raw = JSON.parse(readFileSync(this.keysPath, "utf8")) as { keys: Array<{ keyId: string; publicKeyPem: string; privateKeyPem?: string }> };
        const withPriv = (raw.keys ?? []).find((k) => k.privateKeyPem);
        if (withPriv) return { privateKeyPem: withPriv.privateKeyPem!, keyId: withPriv.keyId };
      } catch {
        return null;
      }
    }
    return null;
  }

  private signAndFlush(privateKeyPem: string, keyId: string): void {
    this.file.generatedAt = Date.now();
    this.file.signatures = [signAllowlist(this.file.servers, privateKeyPem, keyId)];
    const dir = dirname(this.allowlistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.allowlistPath}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.file, null, 2));
    renameSync(tmp, this.allowlistPath);
  }
}

/** Generate an operator allowlist key pair (first-run helper / tests). */
export function generateAllowlistKeyPair(keyId = "xr-operator-1"): AllowlistKeyMaterial {
  const pair = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { keyId, publicKeyPem: pair.publicKey, privateKeyPem: pair.privateKey };
}

/** Persist operator keys to the default keys file (for `xr mcp allow` UX). */
export function writeAllowlistKeys(keys: AllowlistKeyMaterial[], path = defaultAllowlistKeysPath()): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ keys }, null, 2));
}
