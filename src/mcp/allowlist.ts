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

/**
 * ── Phase 8 · Step 5 — schema v2: per-server ISOLATION GRANTS ───────────────
 *
 * v1 answered one question: may this server load at all? The isolation
 * decision lived somewhere else entirely — in `XR_MCP_ALLOW_UNISOLATED=1`, a
 * process-wide environment variable that said "run ANY high-risk server
 * without a kernel boundary". That flag was:
 *
 *   · unattributable — nothing recorded WHO accepted the risk,
 *   · unscoped       — one variable relaxed every server at once,
 *   · unrevocable    — no artifact to revoke; you had to find the shell that
 *                      set it,
 *   · unsigned       — the weakest link in an otherwise ed25519-signed gate.
 *
 * v2 folds the decision into the signed artifact, per server:
 *
 *   isolation: "required"                    (default — no boundary, no run)
 *   isolation: "granted-unisolated-by:<key>" (explicit, signed, attributable)
 *
 * The escape hatch still exists — operators on hosts without bubblewrap have
 * a real need — but it is now a signed statement about ONE server, made by a
 * named key, revocable with `xr mcp revoke`, and visible in
 * `xr mcp allowlist-status`. That is the difference between a security
 * decision and an environment variable.
 *
 * v1 files are ACCEPTED for one release (read as isolation: "required", i.e.
 * the safe interpretation) with a warning; `xr mcp re-sign` upgrades them.
 */
export const MCP_ALLOWLIST_SCHEMA_VERSION = 2;
/** Schema versions this build can read. v1 is accepted (warned) for one release. */
export const MCP_ALLOWLIST_SUPPORTED_VERSIONS = [1, 2] as const;

/** Per-server isolation posture. Anything not explicitly granted is required. */
export type IsolationGrant = "required" | `granted-unisolated-by:${string}`;

export function isUnisolatedGrant(v: string | undefined): boolean {
  return typeof v === "string" && v.startsWith("granted-unisolated-by:");
}

/** The key id that accepted the risk, for the audit record. */
export function unisolatedGrantKeyId(v: string | undefined): string | undefined {
  return isUnisolatedGrant(v) ? (v as string).slice("granted-unisolated-by:".length) : undefined;
}

export interface AllowlistEntry {
  grantedAt: number;
  by: string;
  reason?: string;
  /**
   * Phase 8 · v2 — isolation posture for THIS server. Absent (v1 files, or a
   * v2 entry that never asked for the escape) reads as "required": the safe
   * default, never inferred as permission.
   */
  isolation?: IsolationGrant;
}

export interface AllowlistSignature {
  keyId: string;
  sig: string;
}

export interface McpAllowlistFile {
  schemaVersion: number;
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

/**
 * The signed payload.
 *
 * CRITICAL: `isolation` is part of the canonical form. If it were not, an
 * attacker with write access to the file could add
 * `isolation: "granted-unisolated-by:…"` to an existing signed entry and the
 * signature would still verify — the escape hatch would be forgeable, which
 * is exactly the property v2 exists to remove. Every field that grants
 * authority must be inside the signature.
 *
 * The schema version is pinned to the value being signed rather than the
 * build's constant, so a v1 file re-verifies under a v2 binary.
 */
function canonicalServers(servers: Record<string, AllowlistEntry>, schemaVersion: number = MCP_ALLOWLIST_SCHEMA_VERSION): string {
  const sorted: Record<string, { grantedAt: number; by: string; reason?: string; isolation?: string }> = {};
  for (const id of Object.keys(servers).sort()) {
    const e = servers[id];
    sorted[id] = { grantedAt: e.grantedAt, by: e.by, reason: e.reason, isolation: e.isolation };
  }
  return JSON.stringify({ schemaVersion, generatedAt: 0, servers: sorted });
}

/** Sign the allowlist payload (servers only; timestamp excluded for replay-free rotation). */
export function signAllowlist(
  servers: Record<string, AllowlistEntry>,
  privateKeyPem: string,
  keyId: string,
  schemaVersion: number = MCP_ALLOWLIST_SCHEMA_VERSION,
): AllowlistSignature {
  const digest = createHash("sha256").update(canonicalServers(servers, schemaVersion), "utf8").digest("hex");
  const sig = cryptoSign(null, Buffer.from(digest, "utf8"), privateKeyPem).toString("base64");
  return { keyId, sig };
}

export function verifyAllowlist(
  file: McpAllowlistFile,
  publicKeys: Record<string, string>,
): { ok: boolean; reason: string; validKeyIds: string[] } {
  const digest = createHash("sha256")
    .update(canonicalServers(file.servers, file.schemaVersion ?? MCP_ALLOWLIST_SCHEMA_VERSION), "utf8")
    .digest("hex");
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
      const known = (MCP_ALLOWLIST_SUPPORTED_VERSIONS as readonly number[]).includes(raw?.schemaVersion);
      if (known && typeof raw.servers === "object" && Array.isArray(raw.signatures)) {
        // A v1 file verifies against its OWN canonical form (see
        // canonicalServers) and is read with isolation implicitly "required".
        // An UNKNOWN future version is refused rather than downgraded: reading
        // a v3 file with v2 rules could silently ignore a field that grants
        // authority.
        return raw;
      }
    } catch {
      // Corrupt → fail closed (empty allowlist).
    }
    return { schemaVersion: MCP_ALLOWLIST_SCHEMA_VERSION, generatedAt: 0, servers: {}, signatures: [] };
  }

  /** Schema version of the loaded file (1 = legacy, warned for one release). */
  get schemaVersion(): number {
    return this.file.schemaVersion ?? MCP_ALLOWLIST_SCHEMA_VERSION;
  }

  /** True when the on-disk file predates the v2 isolation-grant schema. */
  get isLegacySchema(): boolean {
    return this.schemaVersion < MCP_ALLOWLIST_SCHEMA_VERSION;
  }

  /**
   * Phase 8 · Step 5 — the per-server isolation posture, as a SIGNED fact.
   *
   * Returns "required" for: an unlisted server, a v1 file, an entry with no
   * isolation field, or any file whose signature does not verify. Every
   * uncertainty resolves to the safe answer — a missing or unverifiable
   * statement is never read as permission.
   */
  isolationFor(serverId: string): { unisolatedGranted: boolean; grantedBy?: string; reason: string } {
    if (!this.verifyFile().ok) {
      return { unisolatedGranted: false, reason: "allowlist is not validly signed — isolation required (fail closed)" };
    }
    const entry = this.file.servers[serverId];
    if (!entry) {
      return { unisolatedGranted: false, reason: `server "${serverId}" is not allowlisted — isolation required` };
    }
    if (!isUnisolatedGrant(entry.isolation)) {
      return { unisolatedGranted: false, reason: `server "${serverId}" has no signed unisolated grant — isolation required` };
    }
    const keyId = unisolatedGrantKeyId(entry.isolation);
    return {
      unisolatedGranted: true,
      grantedBy: keyId,
      reason: `server "${serverId}" carries a SIGNED unisolated grant issued by "${keyId}" — running without a kernel boundary is explicitly accepted and attributable`,
    };
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

  list(): Array<{ serverId: string; grantedAt: number; by: string; reason?: string; isolation: string }> {
    return Object.entries(this.file.servers)
      .map(([serverId, entry]) => ({
        serverId,
        grantedAt: entry.grantedAt,
        by: entry.by,
        reason: entry.reason,
        isolation: entry.isolation ?? "required",
      }))
      .sort((a, b) => a.serverId.localeCompare(b.serverId));
  }

  /** Grant a server (signs the new allowlist). Requires a private signing key. */
  allow(
    serverId: string,
    opts: {
      by?: string;
      reason?: string;
      privateKeyPem?: string;
      keyId?: string;
      /**
       * Phase 8 — grant this ONE server the right to run without kernel
       * isolation. The grant records the signing key, so the acceptance of
       * risk is attributable and revocable.
       */
      allowUnisolated?: boolean;
    } = {},
  ): AllowlistResult {
    const signer = this.resolveSigner(opts);
    if (!signer) return { ok: false, reason: "no signing key available — configure an allowlist key or pass --key" };
    // Preserve an existing isolation grant across a re-allow unless the caller
    // is explicitly setting one; silently DROPPING a grant would be safe, but
    // silently keeping one the operator did not ask for would not — so an
    // explicit `allowUnisolated: false` clears it.
    const previous = this.file.servers[serverId];
    const isolation: IsolationGrant =
      opts.allowUnisolated === true
        ? `granted-unisolated-by:${signer.keyId}`
        : opts.allowUnisolated === false
          ? "required"
          : (previous?.isolation ?? "required");
    this.file.servers[serverId] = {
      grantedAt: Date.now(),
      by: opts.by ?? "operator",
      reason: opts.reason,
      isolation,
    };
    this.signAndFlush(signer.privateKeyPem, signer.keyId);
    const iso = isUnisolatedGrant(isolation)
      ? ` — WITH a signed unisolated grant (${signer.keyId}): this server may run without a kernel boundary`
      : "";
    return { ok: true, reason: `server "${serverId}" allowed and allowlist re-signed (${signer.keyId})${iso}` };
  }

  /**
   * Phase 8 · rollout — re-sign the current entry set under the v2 schema.
   * The one-time upgrade path for operators holding a v1 file
   * (`xr mcp re-sign`). Entries are preserved verbatim; no isolation grant is
   * invented by the upgrade — every server comes across as "required".
   */
  reSign(opts: { privateKeyPem?: string; keyId?: string } = {}): AllowlistResult {
    const signer = this.resolveSigner(opts);
    if (!signer) return { ok: false, reason: "no signing key available — configure an allowlist key or pass --key" };
    const from = this.schemaVersion;
    for (const [id, entry] of Object.entries(this.file.servers)) {
      this.file.servers[id] = { ...entry, isolation: entry.isolation ?? "required" };
    }
    this.file.schemaVersion = MCP_ALLOWLIST_SCHEMA_VERSION;
    this.signAndFlush(signer.privateKeyPem, signer.keyId);
    return {
      ok: true,
      reason: `allowlist re-signed v${from} → v${MCP_ALLOWLIST_SCHEMA_VERSION} (${Object.keys(this.file.servers).length} server(s), all isolation="required") by ${signer.keyId}`,
    };
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
    // Any write upgrades the file to the current schema: a mutation is the
    // natural moment to migrate, and it keeps signed-payload version and file
    // version in lockstep.
    this.file.schemaVersion = MCP_ALLOWLIST_SCHEMA_VERSION;
    this.file.signatures = [signAllowlist(this.file.servers, privateKeyPem, keyId, MCP_ALLOWLIST_SCHEMA_VERSION)];
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
