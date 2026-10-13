/**
 * XR Cloud — org key store.
 *
 * ## Why a cache at all
 *
 * Unwrapping is one AES-GCM open — microseconds. The cache exists to avoid a
 * *database round-trip* per memory read, not to save CPU. It is bounded in both
 * entry count and age so a rotated KEK takes effect within minutes without a
 * restart, and so a service that somehow accumulates orgs cannot grow a map
 * without a ceiling (Constitution Art. XII · Rule 3).
 *
 * ## Why keys are never logged, fingerprint-cached, or exported
 *
 * A `Buffer` of key material has no business in a log line, a metric label, or a
 * debug endpoint. The only way out of this module is `get()`, and the only thing
 * a caller can do with the result is derive a workspace key. There is deliberately
 * no `dump()` and no `all()`.
 */

import type { OrgKeyStore, WrappedOrgKey } from "../deps.ts";
import { CryptoError, randomKey, unwrapKey, wrapKey } from "./crypto.ts";
import type { CloudEnv } from "../env.ts";

const MAX_ENTRIES = 500;
const MAX_AGE_MS = 10 * 60 * 1000;

/**
 * The KEK generation, recorded on every wrapped organization key so that a KEK
 * rotation can enumerate what still needs re-wrapping. One generation exists
 * today; adding the second is a migration, not a new string. (The ternary that
 * used to be here returned "kek-1" on both branches.)
 */
const KEK_ID = "kek-1";

interface Entry {
  key: Buffer;
  at: number;
}

/**
 * @param _env kept in the signature because the store is constructed from the
 *   environment in `deps.ts` and a second KEK generation will almost certainly
 *   read its id from configuration. Unused today — the parameter name is
 *   underscore-prefixed so the compiler (and the reader) can see that this is
 *   deliberate rather than forgotten.
 */
export function createOrgKeyStore(_env: CloudEnv, kek: Buffer): OrgKeyStore {
  const cache = new Map<string, Entry>();

  function evictExpired(now: number): void {
    for (const [orgId, entry] of cache) {
      if (now - entry.at > MAX_AGE_MS) cache.delete(orgId);
    }
    // Insertion-ordered, so the oldest entry is the first key.
    while (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }

  return {
    kek,
    kekId: KEK_ID,

    generate: () => randomKey(),

    wrap(key: Buffer): WrappedOrgKey {
      return { ciphertext: wrapKey(kek, key), kekId: KEK_ID };
    },

    get(orgId, ciphertext) {
      const now = Date.now();
      const cached = cache.get(orgId);
      if (cached && now - cached.at <= MAX_AGE_MS) return cached.key;

      let key: Buffer;
      try {
        key = unwrapKey(kek, ciphertext);
      } catch {
        // A wrapped key that does not authenticate means the deployment KEK does
        // not match this row. That is a misconfiguration, never a user error, and
        // it must not silently degrade to "no encryption".
        throw new CryptoError(
          "Could not unwrap this organization's key: the deployment KEK does not match the one that wrapped it. " +
            "Both XR_KEY_ENCRYPTION_KEY and XR_LICENSE_KID must match the values used when the org was created.",
        );
      }
      evictExpired(now);
      cache.set(orgId, { key, at: now });
      return key;
    },

    invalidate(orgId) {
      cache.delete(orgId);
    },

    clear() {
      for (const entry of cache.values()) {
        // Best-effort: overwriting a Buffer's bytes before dropping the reference
        // does not guarantee the GC cannot still see them, and claiming otherwise
        // would be dishonest. It reduces the window, and that is all.
        entry.key.fill(0);
      }
      cache.clear();
    },

    get size() {
      return cache.size;
    },
  };
}
