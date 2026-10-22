/**
 * XR — local secret storage helpers.
 *
 * Security rules:
 * - Raw keys are never printed, and never placed on a child's argv.
 * - XR-LAUNCH-015: the OS store is the PRIMARY store. A write goes to the OS
 *   backend first and is verified by read-back; the file fallback is written
 *   ONLY when that fails (or when the user opts in with XR_SECRET_BACKEND=file),
 *   and the fallback is announced once on stderr. XR_SECRET_BACKEND=keychain
 *   refuses the fallback entirely (strict mode).
 * - A names-only index (~/.xr/secrets/index.json, 0600) records which backend
 *   holds each name, so sync readers know when a one-time OS read is warranted.
 *
 * Backends (src/security/secret-backends.ts):
 * - macOS: Keychain via `security -i` (command + value on stdin)
 * - Linux: Secret Service via `secret-tool` (value on stdin) when installed
 * - Windows: user/machine-bound DPAPI via PowerShell (value on stdin)
 * - Fallback: ~/.xr/.env — AES-256-GCM ENCRYPTED AT REST (launch hardening,
 *   audit discrepancy D-1). See "File fallback encryption" below.
 *
 * File fallback encryption:
 * - Values are sealed with AES-256-GCM using a per-install 256-bit random key
 *   at ~/.xr/secrets/.file-key (chmod 600, generated on first use).
 * - Format: `NAME=XRG1.<b64 iv>.<b64 tag>.<b64 ciphertext>`; legacy plaintext
 *   `NAME=value` lines are migrated transparently on first read/write.
 * - Honest threat model: this protects the file when it leaks WITHOUT the key
 *   (backups, accidental commits, partial exfiltration). An attacker who can
 *   read the whole ~/.xr directory can also read the key — OS backends remain
 *   the strong anchor; this fallback stops being the weakest form of storage
 *   XR could have shipped.
 *
 * Performance:
 * - getSecretSyncCached: env → memo → (indexed OS name: ONE memoized read) →
 *   file. The daemon disables the sync OS read and warms the memo instead.
 * - getSecretAsync uses non-blocking subprocesses for OS backends.
 */
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { envSecretCompatEnabled } from "./env-compat.ts";
import { detectOsBackend, osBackendFor, type OsBackendId, type OsSecretBackend } from "./secret-backends.ts";

export type SecretBackend = OsBackendId | "file";
/** XR_SECRET_BACKEND: auto (default, OS first) · file (opt-in) · keychain (strict, no fallback). */
export type SecretBackendMode = "auto" | "file" | "keychain";

/** XR_HOME is resolved lazily per call so long-lived processes (and tests
 *  setting process.env.XR_HOME per case) see the right root. */
function xrHome(): string {
  return process.env.XR_HOME ?? join(homedir(), ".xr");
}

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,80}$/;

/** In-memory secret memo — never re-probes OS keychain after a successful read. */
const secretMemo = new Map<string, string>();
/** Names whose one-time sync OS read came back empty (cleared by any write). */
const negativeMemo = new Set<string>();
let syncOsReads = true;

function assertSafeName(name: string): void {
  if (!SECRET_NAME_RE.test(name)) throw new Error(`unsafe secret name: ${name}`);
}

function assertSafeValue(value: string): void {
  if (!value || /[\r\n\0]/.test(value)) throw new Error("secret value is empty or contains an unsafe newline/null byte");
}

export function secretBackendMode(env: NodeJS.ProcessEnv = process.env): SecretBackendMode {
  const v = (env.XR_SECRET_BACKEND ?? "").trim().toLowerCase();
  return v === "file" ? "file" : v === "keychain" ? "keychain" : "auto";
}

let osOverride: OsSecretBackend | null | undefined;
let osCache: { key: string; backend: OsSecretBackend | null } | undefined;

/** Test seam: inject a mocked OS backend (null = none; undefined = real detection). */
export function __setOsBackendForTests(backend: OsSecretBackend | null | undefined): void {
  osOverride = backend;
  osCache = undefined;
  fallbackWarned = false;
  syncOsReads = true;
  clearSecretMemo();
}

/** The OS backend writes go to, or null (file mode / no usable OS store). Spawn-free. */
export function activeOsBackend(): OsSecretBackend | null {
  if (secretBackendMode() === "file") return null;
  if (osOverride !== undefined) return osOverride;
  const key = `${process.platform}|${process.env.PATH ?? ""}`;
  if (!osCache || osCache.key !== key) {
    const id = detectOsBackend();
    osCache = { key, backend: id ? osBackendFor(id, secretDir) : null };
  }
  return osCache.backend;
}

/** Truthful backend for new writes (doctor/status): the tool must actually exist. */
export function preferredSecretBackend(): SecretBackend {
  return activeOsBackend()?.id ?? "file";
}

export async function preferredSecretBackendAsync(): Promise<SecretBackend> {
  return preferredSecretBackend();
}

function envPath(): string {
  const home = xrHome();
  if (!existsSync(home)) mkdirSync(home, { recursive: true, mode: 0o700 });
  return join(home, ".env");
}

function secretDir(): string {
  const dir = join(xrHome(), "secrets");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch {}
  return dir;
}

// ── AES-256-GCM file-fallback sealing (launch hardening · audit D-1) ────────

const ENC_PREFIX = "XRG1.";
const ENV_HEADER =
  "# XR secrets — values sealed with AES-256-GCM (per-install key in secrets/.file-key).\n" +
  "# Do not edit by hand; use `xr providers keys` / the onboarding wizard.\n";

function fileKeyPath(): string {
  return join(secretDir(), ".file-key");
}

/** Load or lazily create the per-install file key (never logged). */
function loadOrCreateFileKey(): Buffer {
  const path = fileKeyPath();
  if (existsSync(path)) {
    const raw = readFileSync(path);
    if (raw.length === 32) return raw;
    // A corrupt key must NOT be overwritten in place: secrets sealed with it
    // would become permanently unreadable. Fail closed instead.
    throw new Error(`XR secret file key at ${path} is corrupt (expected 32 bytes); refusing to continue`);
  }
  const key = randomBytes(32);
  writeFileSync(path, key, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch {}
  return key;
}

function encryptSecretValue(value: string): string {
  const key = loadOrCreateFileKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

function isEncryptedValue(raw: string): boolean {
  return raw.startsWith(ENC_PREFIX);
}

function decryptSecretValue(raw: string): string {
  const parts = raw.slice(ENC_PREFIX.length).split(".");
  if (parts.length !== 3) throw new Error("encrypted secret value is malformed");
  const [ivB64, tagB64, ctB64] = parts;
  const key = loadOrCreateFileKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64!, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64!, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64!, "base64")), decipher.final()]).toString("utf8");
}

/**
 * Seal an arbitrary string with the per-install vault key (AES-256-GCM).
 *
 * Used by the WhatsApp session store (Phase 26): the linked-device credential
 * blob is far too large for the `NAME=value` secrets file, but it must use the
 * same key, the same algorithm and the same fail-closed key handling as every
 * other secret on the machine. Never log the return value.
 */
export function sealVaultValue(plain: string): string {
  return encryptSecretValue(plain);
}

/** Open a value sealed by `sealVaultValue`. Throws when the value was tampered with. */
export function openVaultValue(sealed: string): string {
  return decryptSecretValue(sealed);
}

/**
 * Read the fallback file, decrypting sealed values and transparently migrating
 * legacy plaintext entries. Returns null only if the file does not exist.
 * A line that fails to decrypt is preserved verbatim and surfaced as undefined
 * — it is never silently dropped, and a migration rewrite only happens when
 * every line parses cleanly.
 */
function readEnvEntries(): { entries: Map<string, string>; corruptRaw: string[] } {
  const path = envPath();
  const entries = new Map<string, string>();
  const corruptRaw: string[] = [];
  if (!existsSync(path)) return { entries, corruptRaw };
  let sawPlaintext = false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!SECRET_NAME_RE.test(k)) continue;
    if (isEncryptedValue(v)) {
      try {
        entries.set(k, decryptSecretValue(v));
      } catch {
        // Undecryptable entries are carried through verbatim on rewrites and
        // surfaced as "absent" to readers — never silently discarded.
        corruptRaw.push(`${k}=${v}`);
      }
    } else if (v.length) {
      entries.set(k, v);
      sawPlaintext = true;
    }
  }
  if (sawPlaintext) writeEnvEntries(entries, corruptRaw);
  return { entries, corruptRaw };
}

function writeEnvEntries(entries: Map<string, string>, corruptRaw: string[] = []): void {
  const path = envPath();
  const lines = [...entries.keys()].sort().map((k) => `${k}=${encryptSecretValue(entries.get(k)!)}`);
  // Corrupt entries ride along unchanged; if the key is ever repaired the
  // value is still there, and if not, the damage is visible in the file.
  const body = [...lines, ...corruptRaw.sort()];
  writeFileSync(path, ENV_HEADER + body.join("\n") + (body.length ? "\n" : ""));
  try { chmodSync(path, 0o600); } catch {}
}

function setFileSecret(name: string, value: string): void {
  assertSafeName(name);
  assertSafeValue(value);
  const { entries, corruptRaw } = readEnvEntries();
  entries.set(name, value);
  writeEnvEntries(entries, corruptRaw.filter((line) => !line.startsWith(`${name}=`)));
  secretMemo.set(name, value);
}

function getFileSecret(name: string): string | undefined {
  assertSafeName(name);
  return readEnvEntries().entries.get(name);
}

/**
 * Decrypted view over the file fallback, for the ONE authorized consumer
 * besides this module: the config loader hydrating provider env vars at
 * startup. Everything else should use the per-name get/set helpers so this
 * module remains the sole owner of the on-disk format. Triggers the same
 * transparent legacy migration as a per-name read.
 */
export function listFileSecrets(): Record<string, string> {
  return Object.fromEntries(readEnvEntries().entries);
}

function removeFileSecret(name: string): void {
  assertSafeName(name);
  const path = envPath();
  const { entries, corruptRaw } = readEnvEntries();
  entries.delete(name);
  const keptCorrupt = corruptRaw.filter((line) => !line.startsWith(`${name}=`));
  if (entries.size || keptCorrupt.length || existsSync(path)) writeEnvEntries(entries, keptCorrupt);
  secretMemo.delete(name);
}

// ── Names-only index (XR-LAUNCH-015) ─────────────────────────────────────────

export interface SecretIndex {
  version: 1;
  /** name → backend holding it. Never values. */
  entries: Record<string, SecretBackend>;
  /** True once the keychain migration enumerated the OS store for legacy names. */
  discovered?: boolean;
  /** Pre-migration backup of ~/.xr/.env, deleted by the next successful run. */
  pendingBackup?: { path: string; names: string[]; at: string };
}

const BACKENDS: readonly SecretBackend[] = ["macos-keychain", "linux-secret-service", "windows-dpapi", "file"];

function indexPath(): string {
  return join(xrHome(), "secrets", "index.json");
}

export function readSecretIndex(): SecretIndex {
  const empty: SecretIndex = { version: 1, entries: {} };
  try {
    if (!existsSync(indexPath())) return empty;
    const raw = JSON.parse(readFileSync(indexPath(), "utf8")) as Partial<SecretIndex>;
    const entries: Record<string, SecretBackend> = {};
    for (const [k, v] of Object.entries(raw.entries ?? {})) {
      if (SECRET_NAME_RE.test(k) && BACKENDS.includes(v as SecretBackend)) entries[k] = v as SecretBackend;
    }
    return { ...raw, version: 1, entries };
  } catch {
    return empty;
  }
}

export function writeSecretIndex(index: SecretIndex): void {
  secretDir();
  writeFileSync(indexPath(), JSON.stringify(index, null, 2) + "\n", { mode: 0o600 });
  try { chmodSync(indexPath(), 0o600); } catch {}
}

function indexSet(name: string, backend: SecretBackend | null): void {
  const index = readSecretIndex();
  if ((index.entries[name] ?? null) === backend) return;
  if (backend) index.entries[name] = backend;
  else delete index.entries[name];
  writeSecretIndex(index);
}

/** True when the index records `name` (in any backend) — "exists but may be unreadable". */
export function isSecretIndexed(name: string): boolean {
  return name in readSecretIndex().entries;
}

// ── Write / read API ────────────────────────────────────────────────────────

let fallbackWarned = false;

function remember(name: string, value: string): void {
  secretMemo.set(name, value);
  negativeMemo.delete(name);
  if (envSecretCompatEnabled()) process.env[name] = value;
}

/** Remove a stale file copy (no-op when the file never held `name`). */
export function dropFileSecret(name: string): void {
  assertSafeName(name);
  if (!existsSync(join(xrHome(), ".env"))) return;
  const { entries, corruptRaw } = readEnvEntries();
  if (entries.has(name) || corruptRaw.some((l) => l.startsWith(`${name}=`))) removeFileSecret(name);
}

function committedToOs(os: OsSecretBackend, name: string, value: string): SecretBackend {
  dropFileSecret(name);
  indexSet(name, os.id);
  remember(name, value);
  return os.id;
}

function fileFallback(name: string, value: string, os: OsSecretBackend | null): SecretBackend {
  const mode = secretBackendMode();
  if (mode === "keychain") {
    throw new Error(
      `XR_SECRET_BACKEND=keychain: ${os ? `the OS keychain (${os.id}) rejected ${name}` : "no OS keychain is available"}; refusing the file fallback`,
    );
  }
  if (mode === "auto" && !fallbackWarned) {
    fallbackWarned = true;
    const why = os ? `the OS keychain (${os.id}) rejected the write` : "no OS keychain was found (macOS Keychain, Linux secret-tool, Windows PowerShell)";
    console.error(
      `⚠ XR: ${why}; secrets are being stored in the encrypted file fallback (~/.xr/.env, key in ~/.xr/secrets). ` +
        "Set XR_SECRET_BACKEND=file to choose this silently, or XR_SECRET_BACKEND=keychain to refuse it.",
    );
  }
  setFileSecret(name, value);
  indexSet(name, "file");
  remember(name, value);
  return "file";
}

/** Non-blocking write: OS store first (verified by read-back), file only on failure. */
export async function setSecretAsync(name: string, value: string): Promise<SecretBackend> {
  assertSafeName(name);
  assertSafeValue(value);
  const os = activeOsBackend();
  if (os) {
    let ok = false;
    try { ok = (await os.set(name, value)) && (await os.get(name)) === value; } catch { ok = false; }
    if (ok) return committedToOs(os, name, value);
  }
  return fileFallback(name, value, os);
}

/** Sync write for CLI paths: same contract as setSecretAsync (bounded spawnSync). */
export function setSecret(name: string, value: string): SecretBackend {
  assertSafeName(name);
  assertSafeValue(value);
  const os = activeOsBackend();
  if (os) {
    let ok = false;
    try { ok = os.setSync(name, value) && os.getSync(name) === value; } catch { ok = false; }
    if (ok) return committedToOs(os, name, value);
  }
  return fileFallback(name, value, os);
}

/** env (compat) → memo → file. Never spawns. */
function cachedOnly(name: string): string | undefined {
  // Phase 2 · F-24 — ambient env is only part of the read path while compat is on.
  if (envSecretCompatEnabled() && process.env[name]) return process.env[name];
  if (secretMemo.has(name)) return secretMemo.get(name);
  return undefined;
}

function fromFile(name: string): string | undefined {
  const file = getFileSecret(name);
  if (file) remember(name, file);
  return file;
}

/**
 * Hot-path read: env → memo → one memoized OS read for names the index places
 * in the OS store → file. Spawns at most once per name per process, and never
 * in the daemon (disableSyncOsSecretReads + warmSecretCache).
 */
export function getSecretSyncCached(name: string): string | undefined {
  assertSafeName(name);
  const quick = cachedOnly(name);
  if (quick) return quick;
  const os = syncOsReads && !negativeMemo.has(name) ? activeOsBackend() : null;
  if (os && readSecretIndex().entries[name] === os.id) {
    let v: string | undefined;
    try { v = os.getSync(name); } catch { v = undefined; }
    if (v) { remember(name, v); return v; }
    negativeMemo.add(name);
  }
  return fromFile(name);
}

/** Async OS-aware read for daemon startup / explicit key fetch. */
export async function getSecretAsync(name: string): Promise<string | undefined> {
  assertSafeName(name);
  const quick = cachedOnly(name);
  if (quick) return quick;
  const os = activeOsBackend();
  if (os) {
    const index = readSecretIndex();
    // Before the migration has enumerated the OS store, an unindexed name may
    // still be a legacy keychain-only entry, so it is probed.
    if (index.entries[name] === os.id || (!(name in index.entries) && !index.discovered)) {
      const v = await os.get(name).catch(() => undefined);
      if (v) { remember(name, v); return v; }
    }
  }
  return fromFile(name);
}

/** Legacy alias of getSecretSyncCached. */
export function getSecret(name: string): string | undefined {
  return getSecretSyncCached(name);
}

/** Daemon: never block the event loop on a sync keychain read (memo is warmed instead). */
export function disableSyncOsSecretReads(): void {
  syncOsReads = false;
}

/** Load every OS-held indexed name (plus `extra`) into the memo. Returns the count loaded. */
export async function warmSecretCache(extra: readonly string[] = []): Promise<number> {
  const os = activeOsBackend();
  if (!os) return 0;
  const index = readSecretIndex();
  const names = new Set([...Object.keys(index.entries).filter((n) => index.entries[n] === os.id), ...extra]);
  let loaded = 0;
  for (const name of names) {
    if (!SECRET_NAME_RE.test(name) || secretMemo.has(name)) continue;
    const v = await os.get(name).catch(() => undefined);
    if (v) { remember(name, v); loaded++; } else negativeMemo.add(name);
  }
  return loaded;
}

function forget(name: string): void {
  removeFileSecret(name);
  indexSet(name, null);
  secretMemo.delete(name);
  negativeMemo.delete(name);
  delete process.env[name];
}

export async function removeSecretAsync(name: string): Promise<SecretBackend> {
  assertSafeName(name);
  const os = activeOsBackend();
  if (os) await os.remove(name).catch(() => false);
  forget(name);
  return os?.id ?? "file";
}

export function removeSecret(name: string): SecretBackend {
  assertSafeName(name);
  const os = activeOsBackend();
  if (os) { try { os.removeSync(name); } catch {} }
  forget(name);
  return os?.id ?? "file";
}

export function clearSecretMemo(): void {
  secretMemo.clear();
  negativeMemo.clear();
}
