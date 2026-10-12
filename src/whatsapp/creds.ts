/**
 * XR — WhatsApp linked-device credentials, sealed at rest (Phase 26).
 *
 * A linked device is identified by a credential blob (noise keys, signed
 * pre-keys, registration id, app-state keys). Losing it means re-scanning the
 * QR; leaking it means someone else can act as this device. So:
 *
 *   · it is written to `~/.xr/whatsapp/creds.sealed` — never as plaintext JSON
 *   · it is sealed with AES-256-GCM through the same per-install vault key the
 *     CredentialVault uses for API keys (`src/security/secrets.ts`)
 *   · the directory is created 0700 and the file 0600, written atomically
 *   · a tampered or unreadable blob is an error, not an empty session: the
 *     adapter refuses to start rather than silently re-registering the device
 *   · `loggedOut` from WhatsApp wipes the file (the phone unlinked XR)
 *
 * Why a file and not the secrets file itself: the blob is hundreds of KB of
 * binary-keyed structures, and the `NAME=value` secrets file is line-oriented.
 * The *key* and the algorithm are shared; the container is not.
 *
 * Test seam: `peekSealed()` exposes the raw on-disk text so a test can assert
 * the plaintext is nowhere in it.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { openVaultValue, sealVaultValue } from "../security/secrets.ts";

/** Signal-key buckets Baileys writes. Unknown keys are rejected, not stored. */
const KEY_TYPES = new Set([
  "pre-key",
  "session",
  "sender-key",
  "sender-key-memory",
  "app-state-sync-key",
  "app-state-sync-version",
]);

export interface WhatsAppCredsSnapshot {
  creds: Record<string, unknown> | null;
  /** type → id → value (binary values live as Buffers). */
  keys: Record<string, Record<string, unknown>>;
  updatedAt: number | null;
}

export function whatsappDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XR_HOME ?? join(homedir(), ".xr"), "whatsapp");
}

/**
 * Baileys serializes binary values as `{ type: "Buffer", data: "<base64>" }`.
 * The adapter uses the same encoding so a sealed blob stays readable by any
 * standard Baileys reader if the user ever needs to migrate out.
 */
export function encodeBuffers(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Uint8Array) return { type: "Buffer", data: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map((v) => encodeBuffers(v));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    if (source.type === "Buffer" && typeof source.data === "string") return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(source)) out[k] = encodeBuffers(v);
    return out;
  }
  return value;
}

export function decodeBuffers(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => decodeBuffers(v));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    if (source.type === "Buffer" && typeof source.data === "string") return Buffer.from(source.data, "base64");
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(source)) out[k] = decodeBuffers(v);
    return out;
  }
  return value;
}

export function countKeys(snapshot: WhatsAppCredsSnapshot): number {
  return Object.values(snapshot.keys).reduce((sum, bucket) => sum + Object.keys(bucket).length, 0);
}

export class WhatsAppCredsStore {
  constructor(private readonly opts: { dir?: string; now?: () => number } = {}) {}

  get dir(): string {
    return this.opts.dir ?? whatsappDir();
  }

  get path(): string {
    return join(this.dir, "creds.sealed");
  }

  exists(): boolean {
    return existsSync(this.path);
  }

  /**
   * Read and unseal. `null` when there is nothing stored yet; throws when the
   * blob exists but cannot be opened (tamper or a replaced vault key) — the
   * caller must surface that instead of silently starting a fresh session.
   */
  read(): WhatsAppCredsSnapshot | null {
    if (!this.exists()) return null;
    const sealed = readFileSync(this.path, "utf8");
    const json = openVaultValue(sealed);
    const parsed = JSON.parse(json) as { creds?: unknown; keys?: unknown; updatedAt?: unknown };
    const keys: Record<string, Record<string, unknown>> = {};
    if (parsed.keys && typeof parsed.keys === "object") {
      for (const [type, bucket] of Object.entries(parsed.keys as Record<string, unknown>)) {
        if (!KEY_TYPES.has(type) || !bucket || typeof bucket !== "object") continue;
        const decoded: Record<string, unknown> = {};
        for (const [id, value] of Object.entries(bucket as Record<string, unknown>)) decoded[id] = decodeBuffers(value);
        keys[type] = decoded;
      }
    }
    return {
      creds: parsed.creds && typeof parsed.creds === "object" ? (parsed.creds as Record<string, unknown>) : null,
      keys,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : null,
    };
  }

  /** Seal and write atomically (0700 dir, 0600 file, tmp + rename). */
  write(snapshot: { creds: Record<string, unknown> | null; keys: Record<string, Record<string, unknown>> }): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const body = JSON.stringify({
      creds: encodeBuffers(snapshot.creds),
      keys: encodeBuffers(snapshot.keys),
      updatedAt: (this.opts.now ?? Date.now)(),
    });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, sealVaultValue(body), { mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      /* best-effort on platforms without POSIX modes */
    }
    renameSync(tmp, this.path);
  }

  /** Remove the blob (unlink, or WhatsApp logged the device out). */
  wipe(): void {
    rmSync(this.path, { force: true });
  }

  /** Status-card facts. Counts and timestamps only — never key material. */
  summary(): { linked: boolean; updatedAt: number | null; keyCount: number; bytes: number } {
    if (!this.exists()) return { linked: false, updatedAt: null, keyCount: 0, bytes: 0 };
    let bytes = 0;
    try {
      bytes = statSync(this.path).size;
    } catch {
      bytes = 0;
    }
    try {
      const snapshot = this.read();
      return { linked: true, updatedAt: snapshot?.updatedAt ?? null, keyCount: snapshot ? countKeys(snapshot) : 0, bytes };
    } catch {
      return { linked: true, updatedAt: null, keyCount: 0, bytes };
    }
  }

  /** The raw sealed text, for tests that assert nothing readable leaked. */
  peekSealed(): string | null {
    return this.exists() ? readFileSync(this.path, "utf8") : null;
  }
}

/** Signal-key bucket access, as Baileys expects it (null value deletes). */
export interface WhatsAppKeyStore {
  get(type: string, ids: string[]): Promise<Record<string, unknown>>;
  set(data: Record<string, Record<string, unknown | null>>): Promise<void>;
}

export interface WhatsAppAuthState {
  /** The live creds object handed to Baileys (it mutates this in place). */
  creds: Record<string, unknown>;
  keys: WhatsAppKeyStore;
  /** Persist creds + keys. */
  save(): Promise<void>;
  /** When the blob was last written (null before the first write). */
  updatedAt(): number | null;
}

/**
 * Build the auth state for a socket.
 *
 * `seed` supplies a fresh credential object when nothing is stored (the caller
 * passes Baileys' `initAuthCreds`, so this module never imports Baileys).
 */
export function loadWhatsAppAuthState(opts: {
  store: WhatsAppCredsStore;
  seed: () => Record<string, unknown>;
  onLog?: (line: string) => void;
}): WhatsAppAuthState {
  const opened = opts.store.exists() ? opts.store.read() : null;
  let creds = opened?.creds ?? opts.seed();
  const buckets = new Map<string, Record<string, unknown>>(Object.entries(opened?.keys ?? {}));
  let updatedAt = opened?.updatedAt ?? null;
  let writes = Promise.resolve();

  const snapshot = (): { creds: Record<string, unknown>; keys: Record<string, Record<string, unknown>> } => ({
    creds,
    keys: Object.fromEntries(buckets),
  });

  const persist = (): Promise<void> => {
    // Serialize writes: two overlapping saves would race the tmp+rename.
    writes = writes.then(() => {
      try {
        opts.store.write(snapshot());
        updatedAt = Date.now();
      } catch (err) {
        opts.onLog?.(`could not save WhatsApp credentials: ${(err as Error).message}`);
      }
    });
    return writes;
  };

  return {
    get creds() {
      return creds;
    },
    set creds(next: Record<string, unknown>) {
      creds = next;
    },
    keys: {
      async get(type, ids) {
        const bucket = buckets.get(type) ?? {};
        const out: Record<string, unknown> = {};
        for (const id of ids) if (bucket[id] !== undefined) out[id] = bucket[id];
        return out;
      },
      async set(data) {
        for (const [type, values] of Object.entries(data)) {
          const bucket = buckets.get(type) ?? {};
          for (const [id, value] of Object.entries(values)) {
            if (value === null || value === undefined) delete bucket[id];
            else bucket[id] = value;
          }
          buckets.set(type, bucket);
        }
        await persist();
      },
    },
    save: persist,
    updatedAt: () => updatedAt,
  };
}
