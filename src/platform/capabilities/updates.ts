/**
 * XR Phase 7 · T2 — TUF-style capability update/rollback.
 *
 * Adopts TUF *principles* (verified 2026-08-02: CNCF-graduated framework;
 * four-role metadata root/targets/snapshot/timestamp; threshold signatures;
 * protection against rollback, freeze, mix-and-match, arbitrary-package and
 * endless-data attacks) without building a multi-role repository — this is a
 * local-first single-user system.
 *
 * Roles (all ed25519-signed JSON envelopes):
 *   root      — trust anchor: which keys sign which roles + thresholds.
 *               Rotations must be signed by the PREVIOUS root (≥ threshold).
 *   timestamp — freshness: generatedAt must be inside the freshness window
 *               and it pins snapshot.json (hash + version).
 *   snapshot  — pins every other metadata file (version + hash + length),
 *               preventing mix-and-match.
 *   targets   — the per-capability inventory: id@version → sha256 + length.
 *
 * Client state (last-seen versions) is persisted so versions can only move
 * FORWARD (rollback protection) and root keys can rotate safely.
 *
 * Application stays workspace-safe and reversible: verification happens
 * BEFORE any write; the plane's existing staged install + snapshot rollback
 * (plugins: manager.commitInstall/rollback; skills: marketplace
 * importPackage/rollback) performs the actual switch.
 */

import { createHash, verify as cryptoVerify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const TUF_UPDATE_SCHEMA_VERSION = 1;

export const TUF_ROLES = ["root", "targets", "snapshot", "timestamp"] as const;
export type TufRole = (typeof TUF_ROLES)[number];

/** Per-role size cap (endless-data protection). */
export const TUF_METADATA_SIZE_LIMITS: Record<TufRole, number> = {
  root: 256 * 1024,
  targets: 2 * 1024 * 1024,
  snapshot: 512 * 1024,
  timestamp: 64 * 1024,
};

/** Default freshness window for timestamp metadata (freeze protection). */
export const TUF_DEFAULT_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

export interface TufSignature {
  keyId: string;
  sig: string; // base64 ed25519 over the canonical "signed" payload
}

export interface TufRoleKeys {
  keyIds: string[];
  threshold: number;
}

export interface TufRootSigned {
  _type: "root";
  version: number;
  expires: string; // ISO
  roles: Record<TufRole, TufRoleKeys>;
  keys: Record<string, { keytype: "ed25519"; keyval: { public: string } }>;
}

export interface TufTargetFile {
  length: number;
  hashes: { sha256: string };
  custom?: Record<string, unknown>;
}

export interface TufTargetsSigned {
  _type: "targets";
  version: number;
  expires: string;
  targets: Record<string, TufTargetFile>; // key: "<capabilityId>@<version>"
}

export interface TufSnapshotSigned {
  _type: "snapshot";
  version: number;
  expires: string;
  meta: Record<string, { version: number; length?: number; hashes?: { sha256: string } }>;
}

export interface TufTimestampSigned {
  _type: "timestamp";
  version: number;
  expires: string;
  generatedAt: number;
  meta: Record<string, { version: number; length?: number; hashes?: { sha256: string } }>;
}

export interface TufMetadata<T = unknown> {
  signed: T;
  signatures: TufSignature[];
}

export interface TufMetadataSet {
  root: TufMetadata<TufRootSigned>;
  timestamp: TufMetadata<TufTimestampSigned>;
  snapshot: TufMetadata<TufSnapshotSigned>;
  targets: TufMetadata<TufTargetsSigned>;
}

/** Persisted client state — last-seen versions + trusted keys. */
export interface TufClientState {
  schemaVersion: typeof TUF_UPDATE_SCHEMA_VERSION;
  rootVersion: number;
  targetsVersion: number;
  snapshotVersion: number;
  timestampVersion: number;
  /** Key ids currently trusted per role (mirror of root.signed.roles). */
  roleKeys: Record<TufRole, string[]>;
  /**
   * Trusted root snapshot (roles + public keys) — required to verify root
   * ROTATIONS (the new root must be signed by the previous root's keys).
   * Empty on first use (bootstrap trusts the initial self-signed root).
   */
  trustedRoot?: {
    version: number;
    keys: Record<string, string>; // keyId → public PEM
    roles: Record<TufRole, TufRoleKeys>;
  };
  lastCheckedAt: number;
}

export interface TufVerificationResult {
  ok: boolean;
  reasons: string[];
  warnings: string[];
}

export interface TufUpdateCandidate {
  capabilityId: string;
  version: string;
  /** sha256 of the candidate package/artifact to install. */
  packageSha256: string;
  packageLength: number;
}

export function tufStatePath(): string {
  return join(process.env.XR_HOME ?? join(homedir(), ".xr"), "capabilities", "tuf-state.json");
}

function emptyState(): TufClientState {
  return {
    schemaVersion: TUF_UPDATE_SCHEMA_VERSION,
    rootVersion: 0,
    targetsVersion: 0,
    snapshotVersion: 0,
    timestampVersion: 0,
    roleKeys: { root: [], targets: [], snapshot: [], timestamp: [] },
    lastCheckedAt: 0,
  };
}

export class TufClientStateStore {
  private state: TufClientState;

  constructor(private readonly path = tufStatePath()) {
    this.state = this.read();
  }

  private read(): TufClientState {
    if (!existsSync(this.path)) return emptyState();
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as Partial<TufClientState>;
      if (raw?.schemaVersion === TUF_UPDATE_SCHEMA_VERSION && typeof raw.rootVersion === "number") {
        return {
          ...emptyState(),
          rootVersion: raw.rootVersion ?? 0,
          targetsVersion: raw.targetsVersion ?? 0,
          snapshotVersion: raw.snapshotVersion ?? 0,
          timestampVersion: raw.timestampVersion ?? 0,
          roleKeys: { ...emptyState().roleKeys, ...(raw.roleKeys ?? {}) },
          trustedRoot: raw.trustedRoot,
          lastCheckedAt: raw.lastCheckedAt ?? 0,
        };
      }
    } catch {
      // Corrupt state → start from empty (derived trust state, never authority).
    }
    return emptyState();
  }

  get(): TufClientState {
    return this.state;
  }

  /** Advance the client state AFTER a fully verified update set. */
  commit(next: Partial<TufClientState>): void {
    this.state = {
      ...this.state,
      ...next,
      lastCheckedAt: Date.now(),
    };
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.path);
  }
}

// ── Signing helpers (used by tests + publisher tooling) ──────────────────────

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function canonicalJson(payload: unknown): string {
  // Deterministic serialization: sorted keys, no whitespace.
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        out[key] = sorted((value as Record<string, unknown>)[key]);
      }
      return out;
    }
    return value;
  };
  return JSON.stringify(sorted(payload));
}

export function signMetadata(
  payload: unknown,
  privateKeyPem: string,
  keyId: string,
): TufSignature {
  const { sign } = require("node:crypto") as typeof import("node:crypto");
  const canonical = canonicalJson(payload);
  const sig = sign(null, Buffer.from(canonical, "utf8"), privateKeyPem).toString("base64");
  return { keyId, sig };
}

export function verifyMetadataSignature(
  payload: unknown,
  publicKeyPem: string,
  signature: TufSignature,
): boolean {
  const canonical = canonicalJson(payload);
  try {
    return cryptoVerify(null, Buffer.from(canonical, "utf8"), publicKeyPem, Buffer.from(signature.sig, "base64"));
  } catch {
    return false;
  }
}

export function buildMetadataSet(opts: {
  root: TufRootSigned;
  keys: Record<string, { public: string; private?: string }>;
  signers: Record<TufRole, string[]>; // keyIds per role (≥ threshold)
  timestamp?: TufTimestampSigned;
  snapshot?: TufSnapshotSigned;
  targets?: TufTargetsSigned;
}): TufMetadataSet {
  const { root, keys, signers } = opts;
  const make = <T>(payload: T, role: TufRole): TufMetadata<T> => {
    const signatures: TufSignature[] = [];
    for (const keyId of signers[role] ?? []) {
      const key = keys[keyId];
      if (!key?.private) continue;
      signatures.push(signMetadata(payload, key.private, keyId));
    }
    return { signed: payload, signatures };
  };
  const timestamp = opts.timestamp ?? {
    _type: "timestamp",
    version: 1,
    expires: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    generatedAt: Date.now(),
    meta: {},
  };
  const targets = opts.targets ?? { _type: "targets", version: 1, expires: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(), targets: {} };
  const targetsBytes = Buffer.from(canonicalJson(targets), "utf8");
  const snapshot = opts.snapshot ?? {
    _type: "snapshot",
    version: 1,
    expires: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    meta: {
      "targets.json": { version: targets.version, length: targetsBytes.length, hashes: { sha256: sha256Hex(targetsBytes) } },
    },
  };
  const snapshotBytes = Buffer.from(canonicalJson(snapshot), "utf8");
  timestamp.meta = {
    "snapshot.json": { version: snapshot.version, length: snapshotBytes.length, hashes: { sha256: sha256Hex(snapshotBytes) } },
  };
  return {
    root: make(root, "root"),
    timestamp: make(timestamp, "timestamp"),
    snapshot: make(snapshot, "snapshot"),
    targets: make(targets, "targets"),
  };
}

// ── Verification ─────────────────────────────────────────────────────────────

export class TufUpdateVerifier {
  constructor(
    private readonly state: TufClientState,
    private readonly opts: { now?: number; freshnessMs?: number } = {},
  ) {}

  /** Verify the full metadata set; returns ok + reasons. Pure (no I/O). */
  verifySet(set: TufMetadataSet): TufVerificationResult {
    const now = this.opts.now ?? Date.now();
    const freshnessMs = this.opts.freshnessMs ?? TUF_DEFAULT_FRESHNESS_MS;
    const reasons: string[] = [];
    const warnings: string[] = [];
    const fail = (reason: string): TufVerificationResult => ({ ok: false, reasons: [...reasons, reason], warnings });

    // 1. Root — trust anchor. First root is trusted as-is (self-signed
    //    bootstrap); ROTATIONS must be signed by the previous root's keys
    //    (≥ threshold) and version must move forward only.
    const root = set.root.signed;
    if (root._type !== "root") return fail("root metadata has wrong type");
    if (root.version < 1) return fail("root version must be ≥ 1");
    if (root.version < this.state.rootVersion) return fail(`rollback: root version ${root.version} < last seen ${this.state.rootVersion}`);
    if (this.state.rootVersion === 0) {
      // Bootstrap: initial root self-signed (TOFU — documented, local-first).
      if (!this.verifyRoleThreshold(set.root, root, "root", root, warnings)) {
        return fail("initial root signatures do not meet its own threshold");
      }
      warnings.push("initial root trusted on first use (local-first bootstrap)");
    } else {
      const prev = this.state.trustedRoot;
      if (!prev) return fail("rollback/rotation: no previous root snapshot to verify rotation against");
      const prevRootKeys = prev.roles.root;
      if (!prevRootKeys) return fail("rotation: previous root has no root role keys");
      let valid = 0;
      for (const sig of set.root.signatures) {
        if (!prevRootKeys.keyIds.includes(sig.keyId)) continue;
        const publicPem = prev.keys[sig.keyId];
        if (!publicPem) continue;
        if (verifyMetadataSignature(root, publicPem, sig)) {
          valid += 1;
          if (valid >= prevRootKeys.threshold) break;
        }
      }
      if (valid < prevRootKeys.threshold) {
        return fail(`rotation: new root signed by ${valid}/${prevRootKeys.threshold} previous-root keys — refused`);
      }
      reasons.push(`root v${root.version} rotation verified by previous root`);
    }
    for (const role of TUF_ROLES) {
      const roleKeys = root.roles[role];
      if (!roleKeys || !roleKeys.keyIds.length || roleKeys.threshold < 1) return fail(`root: role ${role} has no valid keys/threshold`);
      for (const keyId of roleKeys.keyIds) {
        const key = root.keys[keyId];
        if (!key || key.keytype !== "ed25519" || !key.keyval?.public) return fail(`root: key ${keyId} for role ${role} missing/invalid`);
      }
    }
    if (root.expires && new Date(root.expires).getTime() <= now) return fail("root metadata expired");
    reasons.push(`root v${root.version} trusted (${this.state.rootVersion === 0 ? "initial" : "rotation verified"})`);

    // 2. Timestamp — freshness (freeze protection) + pins snapshot.
    const ts = set.timestamp.signed;
    if (ts._type !== "timestamp") return fail("timestamp metadata has wrong type");
    if (ts.version < 1) return fail("timestamp version must be ≥ 1");
    if (ts.version < this.state.timestampVersion) return fail(`rollback: timestamp version ${ts.version} < last seen ${this.state.timestampVersion}`);
    if (!this.verifyRoleThreshold(set.timestamp, ts, "timestamp", root, warnings)) return fail("timestamp signatures do not meet threshold");
    if (new Date(ts.expires).getTime() <= now) return fail("timestamp expired");
    const age = now - (ts.generatedAt ?? 0);
    if (age > freshnessMs) return fail(`freeze: timestamp generated ${age}ms ago (> ${freshnessMs}ms freshness window)`);
    reasons.push(`timestamp v${ts.version} fresh (${age}ms old)`);

    // 3. Snapshot — pinned by timestamp; pins targets.
    const snap = set.snapshot.signed;
    if (snap._type !== "snapshot") return fail("snapshot metadata has wrong type");
    if (snap.version < 1) return fail("snapshot version must be ≥ 1");
    if (snap.version < this.state.snapshotVersion) return fail(`rollback: snapshot version ${snap.version} < last seen ${this.state.snapshotVersion}`);
    if (!this.verifyRoleThreshold(set.snapshot, snap, "snapshot", root, warnings)) return fail("snapshot signatures do not meet threshold");
    const snapBytes = Buffer.from(canonicalJson(snap), "utf8");
    const pinnedSnap = ts.meta["snapshot.json"];
    if (!pinnedSnap) return fail("mix-and-match: timestamp does not pin snapshot.json");
    if (pinnedSnap.version !== snap.version) return fail(`mix-and-match: timestamp pins snapshot v${pinnedSnap.version}, got v${snap.version}`);
    if (pinnedSnap.hashes?.sha256 && pinnedSnap.hashes.sha256 !== sha256Hex(snapBytes)) return fail("mix-and-match: snapshot bytes do not match timestamp pin");
    reasons.push(`snapshot v${snap.version} consistent with timestamp`);

    // 4. Targets — pinned by snapshot; contains the requested inventory.
    const targets = set.targets.signed;
    if (targets._type !== "targets") return fail("targets metadata has wrong type");
    if (targets.version < 1) return fail("targets version must be ≥ 1");
    if (targets.version < this.state.targetsVersion) return fail(`rollback: targets version ${targets.version} < last seen ${this.state.targetsVersion}`);
    if (!this.verifyRoleThreshold(set.targets, targets, "targets", root, warnings)) return fail("targets signatures do not meet threshold");
    const targetsBytes = Buffer.from(canonicalJson(targets), "utf8");
    const pinnedTargets = snap.meta["targets.json"];
    if (!pinnedTargets) return fail("mix-and-match: snapshot does not pin targets.json");
    if (pinnedTargets.version !== targets.version) return fail(`mix-and-match: snapshot pins targets v${pinnedTargets.version}, got v${targets.version}`);
    if (pinnedTargets.hashes?.sha256 && pinnedTargets.hashes.sha256 !== sha256Hex(targetsBytes)) return fail("mix-and-match: targets bytes do not match snapshot pin");
    if (pinnedTargets.length && pinnedTargets.length !== targetsBytes.length) return fail("mix-and-match: targets length does not match snapshot pin");
    reasons.push(`targets v${targets.version} consistent with snapshot`);

    return { ok: true, reasons, warnings };
  }

  /** Verify a specific capability candidate against the verified targets. */
  verifyCandidate(
    set: TufMetadataSet,
    candidate: TufUpdateCandidate,
  ): TufVerificationResult {
    const base = this.verifySet(set);
    if (!base.ok) return base;
    const targetKey = `${candidate.capabilityId}@${candidate.version}`;
    const target = set.targets.signed.targets[targetKey];
    if (!target) {
      return { ok: false, reasons: [...base.reasons, `arbitrary package: no targets entry for ${targetKey}`], warnings: base.warnings };
    }
    if (target.hashes.sha256 !== candidate.packageSha256) {
      return { ok: false, reasons: [...base.reasons, `arbitrary package: sha256 mismatch for ${targetKey}`], warnings: base.warnings };
    }
    if (target.length && candidate.packageLength > 0 && target.length !== candidate.packageLength) {
      return { ok: false, reasons: [...base.reasons, `arbitrary package: length mismatch for ${targetKey}`], warnings: base.warnings };
    }
    return { ok: true, reasons: [...base.reasons, `candidate ${targetKey} verified (sha256 + length pinned by targets)`], warnings: base.warnings };
  }

  private verifyRoleThreshold<T>(
    metadata: TufMetadata<T>,
    signed: T,
    role: TufRole,
    root: TufRootSigned,
    warnings: string[],
  ): boolean {
    const roleKeys = root.roles[role];
    if (!roleKeys) return false;
    let valid = 0;
    for (const sig of metadata.signatures) {
      if (!roleKeys.keyIds.includes(sig.keyId)) continue;
      const key = root.keys[sig.keyId];
      if (!key?.keyval?.public) continue;
      const publicPem = key.keyval.public;
      if (verifyMetadataSignature(signed, publicPem, sig)) {
        valid += 1;
        if (valid >= roleKeys.threshold) return true;
      }
    }
    if (valid > 0) warnings.push(`role ${role}: ${valid}/${roleKeys.threshold} valid signatures`);
    return false;
  }
}

// ── High-level update gate ───────────────────────────────────────────────────

export interface CapabilityUpdateGateResult {
  ok: boolean;
  reasons: string[];
  warnings: string[];
  /** New client state to commit after a successful applied update. */
  nextState?: Partial<TufClientState>;
  unsigned: boolean;
}

export class CapabilityUpdateGate {
  constructor(
    private readonly stateStore = new TufClientStateStore(),
    private readonly verifier?: (set: TufMetadataSet, state: TufClientState) => TufVerificationResult,
  ) {}

  /**
   * Gate an update: TUF-verified metadata required for remote/package
   * candidates. Local (dir) sources may pass with `allowUnsigned` (explicit
   * operator opt-in — installation is never trust; the operator overrides,
   * the system does not).
   */
  gate(
    candidate: TufUpdateCandidate,
    metadata?: TufMetadataSet,
    opts: { allowUnsigned?: boolean } = {},
  ): CapabilityUpdateGateResult {
    const state = this.stateStore.get();
    if (!metadata) {
      const reason = "no signed update metadata (TUF root/timestamp/snapshot/targets) provided";
      if (opts.allowUnsigned) {
        return { ok: true, reasons: [reason, "unsigned update accepted by explicit operator opt-in"], warnings: [], unsigned: true };
      }
      return { ok: false, reasons: [reason], warnings: [], unsigned: true };
    }

    const result = this.verifier ? this.verifier(metadata, state) : new TufUpdateVerifier(state).verifyCandidate(metadata, candidate);
    if (!result.ok) return { ok: false, reasons: result.reasons, warnings: result.warnings, unsigned: false };

    const rootSigned = metadata.root.signed;
    const nextState: Partial<TufClientState> = {
      rootVersion: rootSigned.version,
      targetsVersion: metadata.targets.signed.version,
      snapshotVersion: metadata.snapshot.signed.version,
      timestampVersion: metadata.timestamp.signed.version,
      roleKeys: Object.fromEntries(
        TUF_ROLES.map((role) => [role, rootSigned.roles[role].keyIds]),
      ) as Record<TufRole, string[]>,
      trustedRoot: {
        version: rootSigned.version,
        keys: Object.fromEntries(Object.entries(rootSigned.keys).map(([id, k]) => [id, k.keyval.public])),
        roles: rootSigned.roles,
      },
    };
    return { ok: true, reasons: result.reasons, warnings: result.warnings, nextState, unsigned: false };
  }
}

/** sha256 of a file on disk (candidate packages). */
export function sha256File(path: string): { sha256: string; length: number } {
  const buf = readFileSync(path);
  return { sha256: sha256Hex(buf), length: buf.length };
}
