/**
 * XR Phase 8 · Step 4 — PLUGIN SIGNING (provenance, not just integrity).
 *
 * ── What was already there, and why it was not enough ───────────────────────
 *
 * The plugin manager already recorded an entrypoint hash and a whole-tree hash
 * at install and re-checked them at load (`requireTrust`). That is INTEGRITY:
 * it proves the code did not change after you installed it. It says nothing
 * about PROVENANCE — who wrote it, and whether you ever agreed to trust them.
 * A malicious plugin installed once is perfectly "trusted" under a hash check,
 * forever, because it never changes.
 *
 * This module adds the missing half, reusing the MCP allowlist pattern
 * verbatim (ed25519, threshold 1, fail-closed, signed canonical payload) rather
 * than inventing a second trust format. One trust mechanism, two consumers.
 *
 * ── The upgrade problem, and the grandfathering answer ──────────────────────
 *
 * `plugins.requireSigned` defaults TRUE: a plugin installed from now on must
 * carry a signature from a key on the local trust store, or it is quarantined
 * rather than loaded.
 *
 * Applied naively that rule breaks every existing install on upgrade — users
 * would find their plugins dead after a version bump, and the standard human
 * response to that is `XR_PLUGINS_ALLOW_UNSIGNED=1` permanently exported,
 * which is strictly worse than no gate at all because it silences future
 * warnings too.
 *
 * So plugins already present at upgrade time are GRANDFATHERED: the first run
 * under the new rule issues each of them a local trust record, bound to the
 * tree hash they had at that moment, audited as `plugin.trust.grandfathered`.
 * The effect is precise:
 *
 *   · nothing that already worked stops working;
 *   · nothing NEW gets in unsigned;
 *   · the grandfathered record is bound to a specific tree hash, so if a
 *     grandfathered plugin is later modified it fails the check like any other
 *     untrusted code — the amnesty covers the code that was there, not the
 *     plugin id forever;
 *   · the register is inspectable (`xr plugins trust-status`), so an operator
 *     can see exactly which plugins are trusted only by amnesty and re-sign or
 *     remove them deliberately.
 *
 * `XR_PLUGINS_ALLOW_UNSIGNED=1` remains for one release as the documented
 * escape hatch, and it warns loudly every time it is used.
 */

import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const PLUGIN_TRUST_SCHEMA_VERSION = 1;

/** How a plugin came to be trusted. Recorded so amnesty is never invisible. */
export type PluginTrustKind =
  /** A publisher/operator ed25519 signature over the plugin's tree hash. */
  | "signed"
  /** Issued by the upgrade path for a plugin that predates the signing rule. */
  | "grandfathered"
  /** An operator explicitly accepted this exact tree hash (`xr plugins allow`). */
  | "operator-allowed";

export interface PluginTrustRecord {
  pluginId: string;
  /** The tree hash this record vouches for. A different tree is NOT covered. */
  treeHash: string;
  kind: PluginTrustKind;
  grantedAt: number;
  by: string;
  reason?: string;
}

export interface PluginTrustFile {
  schemaVersion: number;
  generatedAt: number;
  plugins: Record<string, PluginTrustRecord>;
  signatures: Array<{ keyId: string; sig: string }>;
}

export interface PluginTrustResult {
  ok: boolean;
  reason?: string;
}

export function defaultPluginTrustPath(): string {
  return join(process.env.XR_HOME ?? join(homedir(), ".xr"), "plugins", "trust.json");
}

export function defaultPluginKeysPath(): string {
  return join(process.env.XR_HOME ?? join(homedir(), ".xr"), "plugins", "trust-keys.json");
}

/**
 * Canonical signed payload.
 *
 * As in the MCP allowlist: every field that grants authority is inside the
 * signature. `treeHash` and `kind` are both in here, so an attacker with file
 * access can neither retarget a record at different code nor upgrade a
 * `grandfathered` record to `signed` without re-signing.
 */
function canonicalPlugins(plugins: Record<string, PluginTrustRecord>): string {
  const sorted: Record<string, PluginTrustRecord> = {};
  for (const id of Object.keys(plugins).sort()) sorted[id] = plugins[id];
  return JSON.stringify({ schemaVersion: PLUGIN_TRUST_SCHEMA_VERSION, generatedAt: 0, plugins: sorted });
}

export function signPluginTrust(
  plugins: Record<string, PluginTrustRecord>,
  privateKeyPem: string,
  keyId: string,
): { keyId: string; sig: string } {
  const digest = createHash("sha256").update(canonicalPlugins(plugins), "utf8").digest("hex");
  const sig = cryptoSign(null, Buffer.from(digest, "hex"), privateKeyPem).toString("base64");
  return { keyId, sig };
}

export function generatePluginKeyPair(keyId = "xr-plugin-operator-1"): { keyId: string; publicKeyPem: string; privateKeyPem: string } {
  const pair = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { keyId, publicKeyPem: pair.publicKey as string, privateKeyPem: pair.privateKey as string };
}

export function writePluginKeys(
  keys: Array<{ keyId: string; publicKeyPem: string; privateKeyPem?: string }>,
  path = defaultPluginKeysPath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ keys }, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * The plugin trust store.
 *
 * Mirrors `McpAllowlist` deliberately — same fail-closed reading, same
 * threshold-1 verification, same "unsigned file is treated as empty" rule — so
 * that a reader who has understood one understands the other.
 */
export class PluginTrustStore {
  private keys: Record<string, string>;
  private file: PluginTrustFile;

  constructor(
    private readonly trustPath = defaultPluginTrustPath(),
    private readonly keysPath = defaultPluginKeysPath(),
  ) {
    this.keys = this.readKeys();
    this.file = this.readTrust();
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

  private readTrust(): PluginTrustFile {
    const empty: PluginTrustFile = { schemaVersion: PLUGIN_TRUST_SCHEMA_VERSION, generatedAt: 0, plugins: {}, signatures: [] };
    if (!existsSync(this.trustPath)) return empty;
    try {
      const raw = JSON.parse(readFileSync(this.trustPath, "utf8")) as PluginTrustFile;
      if (raw?.schemaVersion === PLUGIN_TRUST_SCHEMA_VERSION && typeof raw.plugins === "object" && Array.isArray(raw.signatures)) {
        return raw;
      }
      return empty;
    } catch {
      return empty;
    }
  }

  /** Whether the trust file itself carries a valid signature from a known key. */
  verifyFile(): { ok: boolean; reason: string; hasKeys: boolean } {
    const hasKeys = Object.keys(this.keys).length > 0;
    if (!existsSync(this.trustPath)) {
      return { ok: false, reason: "no plugin trust store yet (nothing is signed)", hasKeys };
    }
    if (!hasKeys) {
      return { ok: false, reason: "no trust keys configured — trust store cannot be verified (treated as empty)", hasKeys };
    }
    if (!this.file.signatures.length) {
      return { ok: false, reason: "plugin trust store is UNSIGNED — treated as empty (fail closed)", hasKeys };
    }
    const digest = createHash("sha256").update(canonicalPlugins(this.file.plugins), "utf8").digest("hex");
    for (const s of this.file.signatures) {
      const pub = this.keys[s.keyId];
      if (!pub) continue;
      try {
        if (cryptoVerify(null, Buffer.from(digest, "hex"), pub, Buffer.from(s.sig, "base64"))) {
          return { ok: true, reason: `verified by ${s.keyId}`, hasKeys };
        }
      } catch {
        /* try the next signature */
      }
    }
    return { ok: false, reason: "no valid signature over the plugin trust store (fail closed)", hasKeys };
  }

  /**
   * The load-time question: may this plugin, with THIS tree hash, run?
   *
   * Fails closed on every uncertainty. Note the tree-hash comparison: a record
   * only vouches for the exact code it was issued against, which is what keeps
   * grandfathering from becoming a permanent blank cheque.
   */
  isTrusted(pluginId: string, treeHash: string): { ok: boolean; kind?: PluginTrustKind; reason: string } {
    if (!this.verifyFile().ok) {
      return { ok: false, reason: this.verifyFile().reason };
    }
    const rec = this.file.plugins[pluginId];
    if (!rec) return { ok: false, reason: `plugin "${pluginId}" has no trust record (unsigned)` };
    if (rec.treeHash !== treeHash) {
      return {
        ok: false,
        kind: rec.kind,
        reason:
          `plugin "${pluginId}" has a ${rec.kind} trust record for a DIFFERENT tree hash ` +
          `(recorded ${rec.treeHash.slice(0, 12)}…, found ${treeHash.slice(0, 12)}…) — the code changed since it was trusted`,
      };
    }
    return { ok: true, kind: rec.kind, reason: `trusted (${rec.kind}) by ${rec.by}` };
  }

  /** Record trust for a plugin at a specific tree hash, then re-sign the store. */
  record(
    pluginId: string,
    treeHash: string,
    kind: PluginTrustKind,
    opts: { by?: string; reason?: string; privateKeyPem?: string; keyId?: string } = {},
  ): PluginTrustResult {
    const signer = this.resolveSigner(opts);
    if (!signer) return { ok: false, reason: "no signing key available — run `xr plugins trust-init` or pass --key" };
    this.file.plugins[pluginId] = {
      pluginId,
      treeHash,
      kind,
      grantedAt: Date.now(),
      by: opts.by ?? "operator",
      reason: opts.reason,
    };
    this.signAndFlush(signer.privateKeyPem, signer.keyId);
    return { ok: true, reason: `plugin "${pluginId}" recorded as ${kind} (${signer.keyId})` };
  }

  revoke(pluginId: string, opts: { privateKeyPem?: string; keyId?: string } = {}): PluginTrustResult {
    const signer = this.resolveSigner(opts);
    if (!signer) return { ok: false, reason: "no signing key available" };
    if (!this.file.plugins[pluginId]) return { ok: false, reason: `plugin "${pluginId}" has no trust record` };
    delete this.file.plugins[pluginId];
    this.signAndFlush(signer.privateKeyPem, signer.keyId);
    return { ok: true, reason: `plugin "${pluginId}" trust revoked; store re-signed (${signer.keyId})` };
  }

  list(): PluginTrustRecord[] {
    return Object.values(this.file.plugins).sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  }

  /** True when no trust store exists yet — the signal for the one-time amnesty. */
  get isUninitialised(): boolean {
    return !existsSync(this.trustPath);
  }

  /**
   * Ensure a signing key exists. First run generates an operator key, exactly
   * as `xr mcp allow` does, so the common path needs no key ceremony.
   */
  ensureKeys(): { keyId: string } | null {
    if (existsSync(this.keysPath)) {
      const signer = this.resolveSigner({});
      if (signer) return { keyId: signer.keyId };
    }
    const pair = generatePluginKeyPair();
    writePluginKeys([pair], this.keysPath);
    this.keys = this.readKeys();
    return { keyId: pair.keyId };
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
    this.file.schemaVersion = PLUGIN_TRUST_SCHEMA_VERSION;
    this.file.signatures = [signPluginTrust(this.file.plugins, privateKeyPem, keyId)];
    mkdirSync(dirname(this.trustPath), { recursive: true });
    const tmp = `${this.trustPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.file, null, 2), { mode: 0o600 });
    renameSync(tmp, this.trustPath);
  }
}

/** The one-release escape hatch. Callers must warn when this is true. */
export function pluginsAllowUnsignedEnv(): boolean {
  return process.env.XR_PLUGINS_ALLOW_UNSIGNED === "1";
}

/**
 * ── High-risk plugins ⇒ Tier-2 ──────────────────────────────────────────────
 *
 * A plugin that declares shell, process or network permissions is not merely
 * "sensitive": it is asking for the capabilities an attacker needs to turn a
 * supply-chain foothold into host access and exfiltration. Those three are
 * therefore forced to Tier-2 placement (explicit approval, no silent
 * auto-allow) regardless of what the manifest asks for.
 */
export const HIGH_RISK_PLUGIN_PERMISSIONS = ["shell", "process", "network"] as const;

export function pluginRiskTier(permissions: string[]): "tier1" | "tier2" {
  const high = permissions.some((p) =>
    (HIGH_RISK_PLUGIN_PERMISSIONS as readonly string[]).some((h) => p === h || p.startsWith(`${h}:`)),
  );
  return high ? "tier2" : "tier1";
}

/** The high-risk permissions a plugin actually declared (for messages/audit). */
export function highRiskPermissions(permissions: string[]): string[] {
  return permissions.filter((p) =>
    (HIGH_RISK_PLUGIN_PERMISSIONS as readonly string[]).some((h) => p === h || p.startsWith(`${h}:`)),
  );
}
