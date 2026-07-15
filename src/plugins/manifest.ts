/**
 * XR — Hardened Plugin Manifest Parser & Policy Validator
 *
 * Manifest is strict data contract and single source of truth for permissions.
 * Declaration is not authority: install & load still validate file tree, hashes,
 * compatibility, policy, and granted permissions intersection.
 *
 * SECURITY IMPROVEMENTS:
 *  - validatePermissions now supports denied policy and dedup
 *  - effectiveGrant is intersection of declared ∩ approved, minus denied
 *  - resolveGranted() is explicit allow-list with deny override (non-bypassable)
 *  - validateManifestPolicy checks mcp server command injection, url scheme,
 *    duplicate caps, self-dependency, ui hooks, type consistency, skill path
 *    traversal, entrypoint containment (relative)
 *  - readManifest size-limited, JSON parse safe
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ManifestSchema,
  type PluginManifest,
  type PermissionScope,
  isPermissionScope,
} from "./types.ts";

export const MANIFEST_FILENAME = "xr-plugin.json";
const MAX_MANIFEST_BYTES = 100 * 1024; // 100KB

export interface ParseResult {
  ok: boolean;
  manifest?: PluginManifest;
  errors: string[];
}

export function parseManifestObject(raw: unknown): ParseResult {
  const parsed = ManifestSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }

  const manifest = parsed.data;
  const policy = validateManifestPolicy(manifest);
  if (!policy.ok) return { ok: false, manifest, errors: policy.errors };
  return { ok: true, manifest, errors: [] };
}

export function readManifest(dir: string): ParseResult {
  const file = join(dir, MANIFEST_FILENAME);
  if (!existsSync(file)) return { ok: false, errors: [`missing ${MANIFEST_FILENAME}`] };
  try {
    const st = statSync(file);
    if (st.size > MAX_MANIFEST_BYTES) return { ok: false, errors: [`${MANIFEST_FILENAME} too large (max ${MAX_MANIFEST_BYTES})`] };
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return parseManifestObject(raw);
  } catch (e) {
    return { ok: false, errors: [`${MANIFEST_FILENAME} is not valid JSON: ${(e as Error).message}`] };
  }
}

// ── Permission logic (single source of truth) ────────────────────────────────

export interface PermissionValidation {
  ok: boolean;
  declared: PermissionScope[];
  unknown: string[];
  errors: string[];
}

export function validatePermissions(
  declared: string[],
  policy: { denied?: PermissionScope[] } = {},
): PermissionValidation {
  const known: PermissionScope[] = [];
  const unknown: string[] = [];
  const errors: string[] = [];
  const denied = new Set(policy.denied ?? []);

  for (const p of declared) {
    if (!isPermissionScope(p)) {
      unknown.push(p);
      continue;
    }
    if (denied.has(p)) {
      errors.push(`permission "${p}" is denied by policy`);
      continue;
    }
    if (!known.includes(p)) known.push(p);
  }
  for (const u of unknown) errors.push(`unknown permission "${u}"`);
  return { ok: errors.length === 0, declared: known, unknown, errors };
}

/**
 * effectiveGrant = intersection of declared ∩ approved
 * Order preserved from declared, deduped, no extra perms can be injected.
 */
export function effectiveGrant(declared: PermissionScope[], approved: PermissionScope[]): PermissionScope[] {
  const approvedSet = new Set(approved);
  const seen = new Set<PermissionScope>();
  const out: PermissionScope[] = [];
  for (const p of declared) {
    if (!approvedSet.has(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * resolveGranted = (declared ∩ approved) − denied
 * The non-bypassable permission resolver. Denied always wins.
 */
export function resolveGranted(
  declared: PermissionScope[],
  approved: PermissionScope[],
  denied: PermissionScope[] = [],
): PermissionScope[] {
  const deniedSet = new Set(denied);
  const approvedSet = new Set(approved.filter((p) => !deniedSet.has(p)));
  const seen = new Set<PermissionScope>();
  const out: PermissionScope[] = [];
  for (const p of declared) {
    if (deniedSet.has(p)) continue;
    if (!approvedSet.has(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Cross-field manifest policy + security validation
 */
export function validateManifestPolicy(manifest: PluginManifest): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const perms = new Set(manifest.permissions);

  if (manifest.mcpServers.length && !perms.has("mcp")) {
    errors.push("manifest declares mcpServers but does not request the mcp permission");
  }
  if (manifest.uiHooks.length && !perms.has("ui")) {
    errors.push("manifest declares uiHooks but does not request the ui permission");
  }
  if (manifest.type === "mcp" && !perms.has("mcp")) {
    errors.push("type=mcp plugins must request the mcp permission");
  }
  if (manifest.type === "ui" && manifest.uiHooks.length === 0) {
    errors.push("type=ui plugins must declare at least one uiHook");
  }
  // self-dependency
  for (const dep of manifest.dependencies) {
    if (dep === manifest.id) errors.push("plugin cannot depend on itself");
    if (dep.length > 96 || /[^a-z0-9._@/-]/i.test(dep)) errors.push(`invalid dependency id "${dep}"`);
  }
  // duplicate capabilities
  const seen = new Set<string>();
  for (const c of manifest.capabilities) {
    const key = `${c.kind}:${c.name}`;
    if (seen.has(key)) errors.push(`duplicate capability ${key}`);
    seen.add(key);
  }

  // skillPaths containment (defense-in-depth, loader also checks)
  for (const sp of manifest.skillPaths) {
    if (sp.startsWith("/") || sp.startsWith("\\") || sp.includes("..")) {
      errors.push(`skillPath must be contained relative: ${sp}`);
    }
  }

  // entrypoint containment
  if (manifest.entrypoint.startsWith("/") || manifest.entrypoint.startsWith("\\") || manifest.entrypoint.includes("..")) {
    errors.push(`entrypoint must be contained relative: ${manifest.entrypoint}`);
  }

  // mcp server security validation
  for (const srv of manifest.mcpServers) {
    if (!/^[a-z0-9._:-]{1,80}$/i.test(srv.id)) errors.push(`mcp server id invalid: ${srv.id}`);
    if (srv.transport === "http") {
      if (!srv.url) errors.push(`mcp server ${srv.id}: http requires url`);
      else {
        try {
          const u = new URL(srv.url);
          if (!["http:", "https:"].includes(u.protocol)) errors.push(`mcp server ${srv.id}: url must be http/https`);
        } catch {
          errors.push(`mcp server ${srv.id}: url invalid`);
        }
      }
    }
    if (srv.transport === "stdio") {
      if (!srv.command) errors.push(`mcp server ${srv.id}: stdio requires command`);
      else {
        if (srv.command.length > 240) errors.push(`mcp server ${srv.id}: command too long`);
        if (/[;&|`$(){}<>]/.test(srv.command)) errors.push(`mcp server ${srv.id}: command contains shell metacharacters`);
      }
      for (const arg of srv.args ?? []) {
        if (arg.length > 300) errors.push(`mcp server ${srv.id}: arg too long`);
        if (arg.includes("\0")) errors.push(`mcp server ${srv.id}: arg contains null byte`);
      }
    }
    if (srv.apiKeyEnv && !/^[A-Z_][A-Z0-9_]*$/i.test(srv.apiKeyEnv)) {
      errors.push(`mcp server ${srv.id}: apiKeyEnv invalid`);
    }
  }

  // permissions: at least declared array is reasonable (schema already validates enum)
  if (manifest.permissions.length > 20) {
    errors.push("too many permissions declared (max 20)");
  }

  return { ok: errors.length === 0, errors };
}
