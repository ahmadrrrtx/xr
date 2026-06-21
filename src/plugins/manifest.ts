/** XR Stage 10 — plugin manifest parser and policy validator. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ManifestSchema,
  type PluginManifest,
  type PermissionScope,
  isPermissionScope,
} from "./types.ts";

export const MANIFEST_FILENAME = "xr-plugin.json";

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
    return parseManifestObject(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    return { ok: false, errors: [`${MANIFEST_FILENAME} is not valid JSON: ${(e as Error).message}`] };
  }
}

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

export function effectiveGrant(declared: PermissionScope[], approved: PermissionScope[]): PermissionScope[] {
  const approvedSet = new Set(approved);
  return declared.filter((p) => approvedSet.has(p));
}

/** Cross-field rules the schema alone cannot express. */
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
  for (const dep of manifest.dependencies) {
    if (dep === manifest.id) errors.push("plugin cannot depend on itself");
  }
  const seen = new Set<string>();
  for (const c of manifest.capabilities) {
    const key = `${c.kind}:${c.name}`;
    if (seen.has(key)) errors.push(`duplicate capability ${key}`);
    seen.add(key);
  }
  return { ok: errors.length === 0, errors };
}
