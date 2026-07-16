/**
 * XR control permissions — in-memory cache with async disk persistence.
 * hasPermission / listPermissions never hit the disk on the hot path.
 */
import { promises as fsp } from "node:fs";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PermissionScope } from "./types.ts";

const PERM_PATH = join(homedir(), ".xr", "control-permissions.json");
const TTL_MS = Math.max(250, Number(process.env.XR_PERM_CACHE_TTL_MS ?? 5_000) || 5_000);

interface PermFile { granted: PermissionScope[]; updatedAt: number }

let cache: { data: PermFile; loadedAt: number } | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function loadSync(): PermFile {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.data;
  try {
    if (existsSync(PERM_PATH)) {
      const data = JSON.parse(readFileSync(PERM_PATH, "utf8")) as PermFile;
      if (Array.isArray(data.granted)) {
        cache = { data, loadedAt: Date.now() };
        return data;
      }
    }
  } catch { /* ignore */ }
  const data: PermFile = { granted: [], updatedAt: Date.now() };
  cache = { data, loadedAt: Date.now() };
  return data;
}

async function loadAsync(): Promise<PermFile> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.data;
  try {
    const raw = await fsp.readFile(PERM_PATH, "utf8");
    const data = JSON.parse(raw) as PermFile;
    if (Array.isArray(data.granted)) {
      cache = { data, loadedAt: Date.now() };
      return data;
    }
  } catch { /* ignore */ }
  const data: PermFile = { granted: [], updatedAt: Date.now() };
  cache = { data, loadedAt: Date.now() };
  return data;
}

function saveSync(p: PermFile): void {
  mkdirSync(join(homedir(), ".xr"), { recursive: true });
  writeFileSync(PERM_PATH, JSON.stringify(p, null, 2));
  cache = { data: p, loadedAt: Date.now() };
}

function saveAsync(p: PermFile): void {
  cache = { data: p, loadedAt: Date.now() };
  writeQueue = writeQueue.then(async () => {
    await fsp.mkdir(join(homedir(), ".xr"), { recursive: true });
    await fsp.writeFile(PERM_PATH, JSON.stringify(p, null, 2));
  }).catch(() => {
    // fall back to sync write if async fails
    try { saveSync(p); } catch { /* ignore */ }
  });
}

export function listPermissions(): PermissionScope[] {
  return loadSync().granted;
}

export async function listPermissionsAsync(): Promise<PermissionScope[]> {
  return (await loadAsync()).granted;
}

export function hasPermission(scope: PermissionScope): boolean {
  return loadSync().granted.includes(scope);
}

export async function hasPermissionAsync(scope: PermissionScope): Promise<boolean> {
  return (await loadAsync()).granted.includes(scope);
}

export function grantPermission(scope: PermissionScope): boolean {
  const p = loadSync();
  if (!p.granted.includes(scope)) {
    p.granted.push(scope);
    p.updatedAt = Date.now();
    saveAsync(p);
  }
  return true;
}

export function revokePermission(scope: PermissionScope): boolean {
  const p = loadSync();
  p.granted = p.granted.filter((s) => s !== scope);
  p.updatedAt = Date.now();
  saveAsync(p);
  return true;
}

export async function grantPermissionAsync(scope: PermissionScope): Promise<boolean> {
  const p = await loadAsync();
  if (!p.granted.includes(scope)) {
    p.granted.push(scope);
    p.updatedAt = Date.now();
    saveAsync(p);
  }
  return true;
}

export async function revokePermissionAsync(scope: PermissionScope): Promise<boolean> {
  const p = await loadAsync();
  p.granted = p.granted.filter((s) => s !== scope);
  p.updatedAt = Date.now();
  saveAsync(p);
  return true;
}

export function checkPermissionForAction(type: string): { allowed: boolean; scope: PermissionScope; reason?: string } {
  const map: Record<string, PermissionScope> = {
    app: "desktop", close: "desktop", focus: "desktop", type: "desktop", click: "desktop",
    drag_drop: "desktop", move: "desktop", scroll: "desktop", key: "desktop", wait_ms: "desktop",
    screenshot: "desktop", editor: "desktop", system: "system",
    browser: "browser", file: "files_read", computer_use: "desktop",
  };
  const scope = map[type] ?? "desktop";
  if (type === "file") return { allowed: true, scope: "files_read" };
  const allowed = hasPermission(scope);
  return {
    allowed,
    scope,
    reason: allowed ? undefined : `permission '${scope}' not granted – run: xr control permissions grant ${scope}`,
  };
}

export async function checkPermissionForActionAsync(type: string): Promise<{ allowed: boolean; scope: PermissionScope; reason?: string }> {
  const map: Record<string, PermissionScope> = {
    app: "desktop", close: "desktop", focus: "desktop", type: "desktop", click: "desktop",
    drag_drop: "desktop", move: "desktop", scroll: "desktop", key: "desktop", wait_ms: "desktop",
    screenshot: "desktop", editor: "desktop", system: "system",
    browser: "browser", file: "files_read", computer_use: "desktop",
  };
  const scope = map[type] ?? "desktop";
  if (type === "file") return { allowed: true, scope: "files_read" };
  const allowed = await hasPermissionAsync(scope);
  return {
    allowed,
    scope,
    reason: allowed ? undefined : `permission '${scope}' not granted – run: xr control permissions grant ${scope}`,
  };
}

export function requireFileWritePermission(): boolean {
  return hasPermission("files_write");
}

/** Test / doctor helper */
export function invalidatePermissionCache(): void {
  cache = null;
}

export async function flushPermissionWrites(): Promise<void> {
  await writeQueue;
}
