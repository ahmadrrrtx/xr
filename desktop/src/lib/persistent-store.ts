/*
 * Durable settings access — Tauri Store (`settings.json`) with a localStorage
 * write-through fallback (docs/phases/01-app-shell.plan.md §Research 8).
 *
 * Inside the native shell the Tauri Store is the source of truth; localStorage
 * stays in sync so `public/theme-init.js` can apply the theme synchronously
 * before first paint and the app still works in a plain browser.
 *
 * Two accessors: *Raw for the theme key (localStorage holds the bare string —
 * the pre-paint script's contract) and *JSON for everything else.
 */
import { isTauri } from '@/lib/tauri';
import { purgeCredentialCopies } from './credential-migration';
import {
  assertSafeSetting,
  durableModelSelection,
  isSensitiveSettingKey,
} from './persistent-safety';
export { isSensitiveSettingKey } from './persistent-safety';

type Store = {
  get: <T>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  save: () => Promise<void>;
};

let storePromise: Promise<Store | null> | null = null;

/** Lazily load the settings store once (Tauri only; resolves null in browser). */
function getStore(): Promise<Store | null> {
  if (!isTauri()) return Promise.resolve(null);
  storePromise ??= (async () => {
    try {
      const { load } = await import('@tauri-apps/plugin-store');
      const store = await load('settings.json', { autoSave: true });
      return store as unknown as Store;
    } catch {
      // Store plugin unavailable (permission/capability) — localStorage only.
      return null;
    }
  })();
  return storePromise;
}

/** One-time in-place cleanup. This is not secure erasure of backups: owners
 * must rotate keys previously stored by older builds. Never copy them. */
export async function purgeLegacyCredentialSettings(): Promise<boolean> {
  return purgeCredentialCopies(
    await getStore(),
    window.localStorage,
    isTauri()
  );
}

function writeLocalStorageRaw(key: string, raw: string): void {
  if (isSensitiveSettingKey(key)) {
    // Also evict any copy an older build already wrote.
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    /* storage unavailable — keep the session-only value */
  }
}

function writeToTauriStore(key: string, value: unknown): void {
  void getStore().then((store) => {
    if (!store) return;
    void store
      .set(key, value)
      .then(() => store.save())
      .catch(() => {
        /* best-effort persistence; never block the UI */
      });
  });
}

/** Raw string setting (theme): bare string in localStorage + Tauri Store. */
export function writeSettingRaw(key: string, value: string): void {
  assertSafeSetting(key, value);
  writeLocalStorageRaw(key, value);
  writeToTauriStore(key, value);
}

/** JSON setting (sidebar, user name): JSON.stringify in both layers. */
export function writeSettingJSON(key: string, value: unknown): void {
  assertSafeSetting(key, value);
  writeLocalStorageRaw(key, JSON.stringify(value));
  writeToTauriStore(key, value);
}

/** Read a raw string setting: Tauri Store first, then localStorage. */
export async function readSettingRaw(key: string): Promise<string | null> {
  if (isSensitiveSettingKey(key)) return null;
  const store = await getStore();
  if (store) {
    try {
      const value = await store.get<string>(key);
      if (typeof value === 'string' && value.length > 0) {
        assertSafeSetting(key, value);
        return value;
      }
    } catch {
      /* fall through to localStorage */
    }
  }
  if (isSensitiveSettingKey(key)) return null; // A14: never read secrets back from localStorage
  try {
    const value = window.localStorage.getItem(key);
    assertSafeSetting(key, value);
    return value;
  } catch {
    return null;
  }
}

/** Read a JSON setting: Tauri Store first, then the localStorage copy. */
export async function readSettingJSON<T>(key: string): Promise<T | null> {
  if (isSensitiveSettingKey(key)) return null;
  const safe = (value: unknown): T | null => {
    const result =
      key === 'xr.model.default' ? durableModelSelection(value) : value;
    assertSafeSetting(key, result);
    if (result !== value) {
      // Sanitized value only, never write the legacy object back.
      writeSettingJSON(key, result);
    }
    return result as T | null;
  };
  const store = await getStore();
  if (store) {
    try {
      const value = await store.get<T>(key);
      if (value !== undefined && value !== null) return safe(value);
    } catch {
      /* fall through to localStorage */
    }
  }
  if (isSensitiveSettingKey(key)) return null; // A14: never read secrets back from localStorage
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : safe(JSON.parse(raw));
  } catch {
    return null;
  }
}
