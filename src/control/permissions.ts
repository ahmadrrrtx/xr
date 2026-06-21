import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PermissionScope } from "./types.ts";

const PERM_PATH = join(homedir(), ".xr", "control-permissions.json");

interface PermFile { granted: PermissionScope[]; updatedAt: number; }

function load(): PermFile {
  try {
    if (existsSync(PERM_PATH)) return JSON.parse(readFileSync(PERM_PATH, "utf8"));
  } catch {}
  return { granted: [], updatedAt: Date.now() };
}
function save(p: PermFile){ mkdirSync(join(homedir(), ".xr"), { recursive: true }); writeFileSync(PERM_PATH, JSON.stringify(p,null,2)); }

export function listPermissions(): PermissionScope[] { return load().granted; }
export function hasPermission(scope: PermissionScope): boolean { return load().granted.includes(scope); }
export function grantPermission(scope: PermissionScope){
  const p = load(); if(!p.granted.includes(scope)){ p.granted.push(scope); p.updatedAt=Date.now(); save(p);} return true;
}
export function revokePermission(scope: PermissionScope){
  const p = load(); p.granted = p.granted.filter(s=>s!==scope); p.updatedAt=Date.now(); save(p); return true;
}
export function checkPermissionForAction(type: string): { allowed: boolean; scope: PermissionScope; reason?: string } {
  const map: Record<string, PermissionScope> = {
    app:"desktop", close:"desktop", focus:"desktop", type:"desktop", click:"desktop",
    drag_drop:"desktop", move:"desktop", scroll:"desktop", key:"desktop", wait_ms:"desktop",
    screenshot:"desktop", editor:"desktop", system:"system",
    browser:"browser", file:"files_read", computer_use:"desktop"
  };
  const scope = map[type] ?? "desktop";
  if (type==="file") return { allowed: true, scope: "files_read" };
  return { allowed: hasPermission(scope), scope, reason: hasPermission(scope)?undefined:`permission '${scope}' not granted – run: xr control permissions grant ${scope}` };
}
export function requireFileWritePermission(): boolean { return hasPermission("files_write"); }
