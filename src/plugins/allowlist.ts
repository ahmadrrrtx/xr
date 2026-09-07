/**
 * XR Phase 8 — Plugin signed allowlist (MCP allowlist pattern).
 *
 *   ~/.xr/plugins/allowlist.json
 *   {
 *     "schemaVersion": 1,
 *     "generatedAt": …,
 *     "plugins": { "<id>": { grantedAt, by, manifestHash?, treeHash? } },
 *     "signatures": [{ keyId, sig }]
 *   }
 *
 * DEFAULT-DENY: a plugin NOT on a validly-signed allowlist is quarantined
 * at load. `XR_PLUGINS_ALLOW_UNSIGNED=1` is a one-release hatch.
 */

import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const PLUGIN_ALLOWLIST_SCHEMA_VERSION = 1;

export interface PluginAllowlistEntry {
  grantedAt: number;
  by: string;
  reason?: string;
  manifestHash?: string;
  treeHash?: string;
}

export interface PluginAllowlistSignature {
  keyId: string;
  sig: string;
}

export interface PluginAllowlistFile {
  schemaVersion: typeof PLUGIN_ALLOWLIST_SCHEMA_VERSION;
  generatedAt: number;
  plugins: Record<string, PluginAllowlistEntry>;
  signatures: PluginAllowlistSignature[];
}

export function pluginAllowlistPath(): string {
  return join(process.env.XR_HOME ?? join(homedir(), ".xr"), "plugins", "allowlist.json");
}

export function defaultPluginAllowlistKeysPath(): string {
  return join(process.env.XR_HOME ?? join(homedir(), ".xr"), "plugins", "allowlist-keys.json");
}

export interface PluginAllowlistKeyMaterial {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem?: string;
}

export interface PluginAllowlistResult {
  ok: boolean;
  reason?: string;
}

function canonicalPlugins(plugins: Record<string, PluginAllowlistEntry>): string {
  const sorted: Record<string, PluginAllowlistEntry> = {};
  for (const id of Object.keys(plugins).sort()) sorted[id] = plugins[id]!;
  return JSON.stringify({ schemaVersion: PLUGIN_ALLOWLIST_SCHEMA_VERSION, generatedAt: 0, plugins: sorted });
}

export function signPluginAllowlist(
  plugins: Record<string, PluginAllowlistEntry>,
  privateKeyPem: string,
  keyId: string,
): PluginAllowlistSignature {
  const digest = createHash("sha256").update(canonicalPlugins(plugins), "utf8").digest("hex");
  const sig = cryptoSign(null, Buffer.from(digest, "utf8"), privateKeyPem).toString("base64");
  return { keyId, sig };
}

export function verifyPluginAllowlist(
  file: PluginAllowlistFile,
  publicKeys: Record<string, string>,
): { ok: boolean; reason: string; validKeyIds: string[] } {
  const digest = createHash("sha256").update(canonicalPlugins(file.plugins), "utf8").digest("hex");
  const validKeyIds: string[] = [];
  for (const sig of file.signatures) {
    const publicPem = publicKeys[sig.keyId];
    if (!publicPem) continue;
    try {
      if (cryptoVerify(null, Buffer.from(digest, "utf8"), publicPem, Buffer.from(sig.sig, "base64"))) {
        validKeyIds.push(sig.keyId);
      }
    } catch {
      /* invalid signature — ignore */
    }
  }
  if (validKeyIds.length === 0) {
    return { ok: false, reason: "plugin allowlist has no valid signature from a trusted key", validKeyIds };
  }
  return { ok: true, reason: `plugin allowlist signed by ${validKeyIds.join(", ")}`, validKeyIds };
}

export class PluginAllowlist {
  private file: PluginAllowlistFile;
  private keys: Record<string, string>;

  constructor(
    private readonly allowlistPath = pluginAllowlistPath(),
    private readonly keysPath = defaultPluginAllowlistKeysPath(),
  ) {
    this.keys = this.readKeys();
    this.file = this.readAllowlist();
  }

  private readKeys(): Record<string, string> {
    if (!existsSync(this.keysPath)) return {};
    try {
      const raw = JSON.parse(readFileSync(this.keysPath, "utf8")) as {
        keys: Array<{ keyId: string; publicKeyPem: string }>;
      };
      return Object.fromEntries((raw.keys ?? []).map((k) => [k.keyId, k.publicKeyPem]));
    } catch {
      return {};
    }
  }

  private readAllowlist(): PluginAllowlistFile {
    if (!existsSync(this.allowlistPath)) {
      return { schemaVersion: PLUGIN_ALLOWLIST_SCHEMA_VERSION, generatedAt: 0, plugins: {}, signatures: [] };
    }
    try {
      const raw = JSON.parse(readFileSync(this.allowlistPath, "utf8")) as PluginAllowlistFile;
      if (
        raw?.schemaVersion === PLUGIN_ALLOWLIST_SCHEMA_VERSION &&
        typeof raw.plugins === "object" &&
        Array.isArray(raw.signatures)
      ) {
        return raw;
      }
    } catch {
      /* corrupt → fail closed */
    }
    return { schemaVersion: PLUGIN_ALLOWLIST_SCHEMA_VERSION, generatedAt: 0, plugins: {}, signatures: [] };
  }

  verifyFile(): { ok: boolean; reason: string; hasKeys: boolean } {
    if (!this.keys || Object.keys(this.keys).length === 0) {
      return { ok: false, reason: "no trusted plugin allowlist keys configured", hasKeys: false };
    }
    if (this.file.signatures.length === 0) {
      return { ok: false, reason: "plugin allowlist file is unsigned", hasKeys: true };
    }
    const v = verifyPluginAllowlist(this.file, this.keys);
    return { ok: v.ok, reason: v.reason, hasKeys: true };
  }

  /**
   * DEFAULT-DENY gate. Optional hash pins refuse a listed plugin whose
   * tree/manifest no longer matches the signed grant.
   */
  isAllowed(
    pluginId: string,
    hashes?: { manifestHash?: string; treeHash?: string },
  ): PluginAllowlistResult {
    const file = this.verifyFile();
    if (!file.ok) return { ok: false, reason: `plugin allowlist gate fail-closed: ${file.reason}` };
    const entry = this.file.plugins[pluginId];
    if (!entry) {
      return { ok: false, reason: `plugin "${pluginId}" is not on the signed allowlist (default-deny)` };
    }
    if (entry.treeHash && hashes?.treeHash && entry.treeHash !== hashes.treeHash) {
      return { ok: false, reason: `plugin "${pluginId}" tree hash does not match the signed allowlist pin` };
    }
    if (entry.manifestHash && hashes?.manifestHash && entry.manifestHash !== hashes.manifestHash) {
      return { ok: false, reason: `plugin "${pluginId}" manifest hash does not match the signed allowlist pin` };
    }
    return {
      ok: true,
      reason: `plugin "${pluginId}" is on the signed allowlist (granted ${new Date(entry.grantedAt).toISOString()} by ${entry.by})`,
    };
  }

  list(): Array<{ pluginId: string; grantedAt: number; by: string; reason?: string; treeHash?: string }> {
    return Object.entries(this.file.plugins)
      .map(([pluginId, entry]) => ({
        pluginId,
        grantedAt: entry.grantedAt,
        by: entry.by,
        reason: entry.reason,
        treeHash: entry.treeHash,
      }))
      .sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  }

  allow(
    pluginId: string,
    opts: {
      by?: string;
      reason?: string;
      manifestHash?: string;
      treeHash?: string;
      privateKeyPem?: string;
      keyId?: string;
    } = {},
  ): PluginAllowlistResult {
    const signer = this.resolveSigner(opts);
    if (!signer) return { ok: false, reason: "no signing key available — configure a plugin allowlist key or pass --key" };
    this.file.plugins[pluginId] = {
      grantedAt: Date.now(),
      by: opts.by ?? "operator",
      reason: opts.reason,
      manifestHash: opts.manifestHash,
      treeHash: opts.treeHash,
    };
    this.signAndFlush(signer.privateKeyPem, signer.keyId);
    return { ok: true, reason: `plugin "${pluginId}" allowed and allowlist re-signed (${signer.keyId})` };
  }

  revoke(pluginId: string, opts: { privateKeyPem?: string; keyId?: string } = {}): PluginAllowlistResult {
    const signer = this.resolveSigner(opts);
    if (!signer) return { ok: false, reason: "no signing key available" };
    if (!this.file.plugins[pluginId]) return { ok: false, reason: `plugin "${pluginId}" is not allowlisted` };
    delete this.file.plugins[pluginId];
    this.signAndFlush(signer.privateKeyPem, signer.keyId);
    return { ok: true, reason: `plugin "${pluginId}" revoked; allowlist re-signed (${signer.keyId})` };
  }

  private resolveSigner(opts: { privateKeyPem?: string; keyId?: string }): { privateKeyPem: string; keyId: string } | null {
    if (opts.privateKeyPem && opts.keyId) return { privateKeyPem: opts.privateKeyPem, keyId: opts.keyId };
    if (existsSync(this.keysPath)) {
      try {
        const raw = JSON.parse(readFileSync(this.keysPath, "utf8")) as {
          keys: Array<{ keyId: string; publicKeyPem: string; privateKeyPem?: string }>;
        };
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
    this.file.signatures = [signPluginAllowlist(this.file.plugins, privateKeyPem, keyId)];
    const dir = dirname(this.allowlistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.allowlistPath}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.file, null, 2));
    renameSync(tmp, this.allowlistPath);
  }
}

export function generatePluginAllowlistKeyPair(keyId = "xr-plugin-operator-1"): PluginAllowlistKeyMaterial {
  const pair = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { keyId, publicKeyPem: pair.publicKey, privateKeyPem: pair.privateKey };
}

export function writePluginAllowlistKeys(
  keys: PluginAllowlistKeyMaterial[],
  path = defaultPluginAllowlistKeysPath(),
): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ keys }, null, 2));
}

/** One-release hatch: unsigned plugins may load (audited) when this is "1". */
export function pluginsAllowUnsigned(): boolean {
  return process.env.XR_PLUGINS_ALLOW_UNSIGNED === "1";
}
