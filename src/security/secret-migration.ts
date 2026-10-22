/**
 * XR-LAUNCH-015 / XR-LAUNCH-017 — keychain migration and purge.
 *
 * migrateFileSecretsToKeychain (idempotent; daemon start + `xr doctor`):
 *   1. A backup left by a previous run is deleted once every name it covered is
 *      confirmed readable from the OS store ("keep a backup until the next
 *      successful run"). While it is unverified, no new move is attempted.
 *   2. File-fallback entries are copied into the OS store, verified by
 *      read-back, then removed from ~/.xr/.env. The pre-move file is kept as
 *      ~/.xr/secrets/.env.pre-keychain-<ts> (0600, still AES-GCM sealed).
 *   3. Once: legacy keychain-only entries (written by older async paths that
 *      never touched the index) are discovered and indexed.
 *   Names only are logged, to ~/.xr/logs/secrets-migration.log.
 *
 * purgeXrSecrets (`xr uninstall --purge`): deletes every XR entry from the OS
 * store (index ∪ known ids ∪ what the backend can enumerate) and reports what
 * was removed and what could not be.
 */
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PRESETS } from "../providers/presets.ts";
import type { OsSecretBackend } from "./secret-backends.ts";
import {
  activeOsBackend,
  disableSyncOsSecretReads,
  dropFileSecret,
  listFileSecrets,
  readSecretIndex,
  secretBackendMode,
  warmSecretCache,
  writeSecretIndex,
  type SecretBackend,
  type SecretIndex,
} from "./secrets.ts";

/** Fixed XR secret ids outside the provider presets (pinned by test/security/secret-migration.test.ts). */
export const FIXED_SECRET_NAMES = [
  "XR_TELEGRAM_BOT_TOKEN",
  "XR_TELEGRAM_WEBHOOK_SECRET",
  "XR_DISCORD_BOT_TOKEN",
  "XR_CLOUD_SESSION",
  "XR_CLOUD_LICENSE",
  "XR_INTEGRATIONS_VAULT_KEY",
  "XR_AUDIT_SIGN_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "HF_API_KEY",
  "FIRECRAWL_API_KEY",
] as const;

const NAME_RE = /^[A-Z][A-Z0-9_]{1,80}$/;

/** Every secret id XR itself knows how to write. */
export function knownSecretNames(): string[] {
  const names = new Set<string>(FIXED_SECRET_NAMES);
  for (const p of Object.values(PRESETS)) if (p.apiKeyEnv && NAME_RE.test(p.apiKeyEnv)) names.add(p.apiKeyEnv);
  return [...names].sort();
}

function home(): string {
  return process.env.XR_HOME ?? join(homedir(), ".xr");
}

function log(line: string): void {
  try {
    const dir = join(home(), "logs");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(join(dir, "secrets-migration.log"), `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
  } catch { /* best-effort */ }
}

async function verifiedStore(os: OsSecretBackend, name: string, value: string): Promise<boolean> {
  try { return (await os.set(name, value)) && (await os.get(name)) === value; } catch { return false; }
}

async function present(os: OsSecretBackend, name: string): Promise<boolean> {
  return Boolean(await os.get(name).catch(() => undefined));
}

export interface SecretMigrationReport {
  backend: SecretBackend | null;
  moved: string[];
  failed: string[];
  discovered: string[];
  backup?: string;
  backupRemoved?: boolean;
  /** Why nothing ran (file mode, no OS store, unverified previous backup). */
  skipped?: string;
}

export async function migrateFileSecretsToKeychain(now: Date = new Date()): Promise<SecretMigrationReport> {
  const os = activeOsBackend();
  const report: SecretMigrationReport = { backend: os?.id ?? null, moved: [], failed: [], discovered: [] };
  if (!os) {
    report.skipped = secretBackendMode() === "file" ? "XR_SECRET_BACKEND=file" : "no OS keychain available";
    return report;
  }
  const secretsDir = join(home(), "secrets");
  const changes: Array<(i: SecretIndex) => void> = [];

  // 1. Retire the previous run's backup once its names are confirmed in the OS store.
  let pending = readSecretIndex().pendingBackup;
  if (pending) {
    let verified = true;
    for (const n of pending.names) if (!(await present(os, n))) { verified = false; break; }
    if (verified) {
      if (pending.path.startsWith(secretsDir)) rmSync(pending.path, { force: true });
      report.backupRemoved = true;
      changes.push((i) => { delete i.pendingBackup; });
      pending = undefined;
    } else {
      report.skipped = `previous backup ${pending.path} is not yet verified; kept`;
    }
  }

  // 2. Move file-fallback entries (only when no unverified backup is outstanding).
  const fileEntries = pending ? [] : Object.entries(listFileSecrets());
  if (fileEntries.length) {
    mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
    const backup = join(secretsDir, `.env.pre-keychain-${now.toISOString().replace(/[:.]/g, "-")}`);
    copyFileSync(join(home(), ".env"), backup);
    try { chmodSync(backup, 0o600); } catch {}
    for (const [name, value] of fileEntries) {
      if (await verifiedStore(os, name, value)) {
        dropFileSecret(name);
        report.moved.push(name);
        changes.push((i) => { i.entries[name] = os.id; });
      } else {
        report.failed.push(name);
        changes.push((i) => { i.entries[name] = "file"; });
      }
    }
    if (report.moved.length) {
      report.backup = backup;
      const names = [...report.moved];
      changes.push((i) => { i.pendingBackup = { path: backup, names, at: now.toISOString() }; });
    } else {
      rmSync(backup, { force: true });
    }
  }

  // 3. One-time discovery of legacy keychain-only entries.
  if (!readSecretIndex().discovered) {
    let names = await os.list().catch(() => null);
    if (names === null) {
      names = [];
      for (const n of knownSecretNames()) if (await present(os, n)) names.push(n);
    }
    const indexed = readSecretIndex().entries;
    for (const n of names) {
      if (!NAME_RE.test(n) || n in indexed || report.moved.includes(n)) continue;
      report.discovered.push(n);
      changes.push((i) => { i.entries[n] = os.id; });
    }
    changes.push((i) => { i.discovered = true; });
  }

  // Re-read before writing so a concurrent setSecret is never clobbered.
  if (changes.length) {
    const index = readSecretIndex();
    for (const apply of changes) apply(index);
    writeSecretIndex(index);
  }
  if (report.moved.length || report.failed.length || report.discovered.length || report.backupRemoved) {
    log(
      `backend=${os.id} moved=[${report.moved.join(",")}] failed=[${report.failed.join(",")}] ` +
        `discovered=[${report.discovered.join(",")}] backup=${report.backup ?? "-"} backupRemoved=${report.backupRemoved ?? false}`,
    );
  }
  return report;
}

export interface SecretPurgeReport {
  backend: SecretBackend | null;
  removed: string[];
  failed: string[];
  /** Why the OS store was not checked (file mode / no OS store). */
  skipped?: string;
}

export async function purgeXrSecrets(): Promise<SecretPurgeReport> {
  const os = activeOsBackend();
  if (!os) {
    return {
      backend: null,
      removed: [],
      failed: [],
      skipped: secretBackendMode() === "file" ? "XR_SECRET_BACKEND=file — OS keychain not checked" : "no OS keychain available",
    };
  }
  const listed = (await os.list().catch(() => null)) ?? [];
  const names = new Set([...Object.keys(readSecretIndex().entries), ...knownSecretNames(), ...listed]);
  const report: SecretPurgeReport = { backend: os.id, removed: [], failed: [] };
  for (const name of [...names].sort()) {
    if (!NAME_RE.test(name) || !(await present(os, name))) continue;
    await os.remove(name).catch(() => false);
    if (await present(os, name)) report.failed.push(name);
    else report.removed.push(name);
  }
  return report;
}

export interface SecretStoreHealth {
  state: "ok" | "warn" | "fail";
  detail: string;
  remediation?: string;
}

/** Doctor's "Secret store" row. Truthful: an OS store counts only if its tool exists. */
export function secretStoreHealth(platform: NodeJS.Platform = process.platform): SecretStoreHealth {
  const mode = secretBackendMode();
  const os = activeOsBackend();
  const index = readSecretIndex();
  const fileHeld = Object.values(index.entries).filter((b) => b === "file").length;
  if (os) {
    const kept = index.pendingBackup ? `; pre-migration backup kept at ${index.pendingBackup.path}` : "";
    return {
      state: fileHeld ? "warn" : "ok",
      detail: `${os.id}${fileHeld ? `; ${fileHeld} secret(s) still in the file fallback` : ""}${kept}`,
      remediation: fileHeld ? "Run xr repair to move them into the OS keychain." : undefined,
    };
  }
  const hint =
    platform === "linux"
      ? "Install secret-tool (libsecret-tools) with a running Secret Service (GNOME Keyring / KWallet)"
      : platform === "win32"
        ? "Windows PowerShell is required for DPAPI"
        : "The macOS `security` tool was not found";
  const fallback = "keys use ~/.xr/.env, AES-256-GCM sealed; its key sits beside it in ~/.xr/secrets, so this protects against partial leaks only";
  if (mode === "file") {
    return { state: "warn", detail: "file (XR_SECRET_BACKEND=file)", remediation: `By choice, ${fallback}. Unset XR_SECRET_BACKEND to use the OS keychain.` };
  }
  if (mode === "keychain") {
    return { state: "fail", detail: "no OS keychain available; XR_SECRET_BACKEND=keychain refuses the file fallback", remediation: `${hint}.` };
  }
  return { state: "warn", detail: "file — no OS keychain found", remediation: `${hint}, then run xr repair. Until then ${fallback}.` };
}

/**
 * Daemon start (XR-LAUNCH-015): keychain-held secrets are warmed, bounded by
 * `capMs`, BEFORE the daemon serves, and the request path never makes a sync
 * keychain read. The file → keychain migration then runs in the background.
 */
export async function prepareDaemonSecrets(hydrate: () => Promise<void>, capMs = 5000): Promise<void> {
  disableSyncOsSecretReads();
  let cap: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all([warmSecretCache(), hydrate()]).catch(() => {}),
    new Promise((resolve) => { cap = setTimeout(resolve, capMs); }),
  ]);
  clearTimeout(cap);
  void migrateFileSecretsToKeychain().catch(() => {});
}
