/**
 * XR — in-memory config + secrets cache for the daemon hot path.
 *
 * Design goals:
 *  - loadConfig() remains a cheap sync call for the CLI and request handlers
 *  - Disk is read at most once per TTL (or when fs.watch notifies a change)
 *  - Secrets are loaded once into process.env and not re-probed every request
 *  - External editors / `xr config set` invalidate via watch or explicit bust
 *
 * This module is intentionally free of zod / provider imports so it can be
 * required early without pulling the full config graph.
 */
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CacheMeta {
  loadedAt: number;
  source: "disk" | "memory" | "default" | "save";
  hits: number;
  misses: number;
  watchActive: boolean;
}

const DEFAULT_TTL_MS = Math.max(
  250,
  Number(process.env.XR_CONFIG_CACHE_TTL_MS ?? 5_000) || 5_000,
);

type ConfigHolder = {
  config: unknown;
  warnings: string[];
  loadedAt: number;
  path: string;
};

let holder: ConfigHolder | null = null;
let secretsLoadedAt = 0;
let secretsLoaded = false;
let watcher: FSWatcher | null = null;
let watchPath: string | null = null;
let hits = 0;
let misses = 0;
let pendingReload: (() => void) | null = null;

export function configCacheTtlMs(): number {
  return DEFAULT_TTL_MS;
}

export function getCachedConfig<T = unknown>(): { config: T; warnings: string[]; loadedAt: number } | null {
  if (!holder) return null;
  if (Date.now() - holder.loadedAt > DEFAULT_TTL_MS) return null;
  hits++;
  return {
    config: holder.config as T,
    warnings: holder.warnings,
    loadedAt: holder.loadedAt,
  };
}

export function setCachedConfig(config: unknown, warnings: string[], path: string, source: CacheMeta["source"] = "disk"): void {
  holder = {
    config,
    warnings,
    loadedAt: Date.now(),
    path,
  };
  if (source === "disk" || source === "default" || source === "save") misses++;
  ensureWatcher(path);
}

export function peekCachedConfig<T = unknown>(): T | null {
  return (holder?.config as T) ?? null;
}

export function invalidateConfigCache(reason = "manual"): void {
  // "secrets" invalidates ONLY the secrets cache — the config snapshot stays
  // valid so the daemon hot path is not forced back to disk. Callers that
  // need both gone pass "all".
  if (reason === "secrets") {
    secretsLoaded = false;
    secretsLoadedAt = 0;
    return;
  }
  holder = null;
  // secrets stay in process.env; only re-read file backends when forced
  if (reason === "all") {
    secretsLoaded = false;
    secretsLoadedAt = 0;
  }
}

export function markSecretsLoaded(): void {
  secretsLoaded = true;
  secretsLoadedAt = Date.now();
}

export function shouldLoadSecrets(force = false): boolean {
  if (force) return true;
  if (!secretsLoaded) return true;
  // re-check file secrets at most every TTL (OS keychain is not re-probed)
  return Date.now() - secretsLoadedAt > DEFAULT_TTL_MS * 12;
}

export function cacheMeta(): CacheMeta {
  return {
    loadedAt: holder?.loadedAt ?? 0,
    source: holder ? "memory" : "default",
    hits,
    misses,
    watchActive: Boolean(watcher),
  };
}

function ensureWatcher(path: string): void {
  if (watcher && watchPath === path) return;
  stopWatcher();
  watchPath = path;
  try {
    watcher = watch(path, { persistent: false }, (event) => {
      if (event === "change" || event === "rename") {
        // Debounce bursty editors
        if (pendingReload) return;
        const t = setTimeout(() => {
          pendingReload = null;
          holder = null;
        }, 50);
        pendingReload = () => clearTimeout(t);
      }
    });
    watcher.on?.("error", () => {
      stopWatcher();
    });
  } catch {
    watcher = null;
  }
}

export function stopWatcher(): void {
  if (watcher) {
    try {
      watcher.close();
    } catch {
      /* ignore */
    }
  }
  watcher = null;
  watchPath = null;
  if (pendingReload) {
    pendingReload();
    pendingReload = null;
  }
}

/** Home used for default config path resolution without importing config.ts. */
export function defaultXrHome(): string {
  return process.env.XR_HOME ?? join(homedir(), ".xr");
}

export function defaultConfigPath(): string {
  return join(defaultXrHome(), "config.json");
}
