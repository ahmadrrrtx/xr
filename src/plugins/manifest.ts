/**
 * XR 1.0 — plugin manifest parser + permission validator.
 *
 * Reads and validates `xr-plugin.json`. Never throws on bad input: returns a
 * typed result with precise reasons so the loader/CLI can fail safely and tell
 * the user exactly what is wrong (the same "never breaks" doctrine as config).
 */
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

/** Parse a manifest object (already JSON-parsed) into a validated manifest. */
export function parseManifestObject(raw: unknown): ParseResult {
  const parsed = ManifestSchema.safeParse(raw ?? {});
  if (parsed.success) {
    return { ok: true, manifest: parsed.data, errors: [] };
  }
  const errors = parsed.error.issues.map(
    (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
  );
  return { ok: false, errors };
}

/** Read + parse a manifest file from a plugin directory. */
export function readManifest(dir: string): ParseResult {
  const file = join(dir, MANIFEST_FILENAME);
  if (!existsSync(file)) {
    return { ok: false, errors: [`missing ${MANIFEST_FILENAME}`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { ok: false, errors: [`${MANIFEST_FILENAME} is not valid JSON: ${(e as Error).message}`] };
  }
  return parseManifestObject(raw);
}

// ── Permission validation ──────────────────────────────────────────────────────

export interface PermissionValidation {
  ok: boolean;
  /** Permissions the manifest declared that are known + well-formed. */
  declared: PermissionScope[];
  /** Any scope strings that are not recognised (rejected). */
  unknown: string[];
  errors: string[];
}

/**
 * Validate the manifest's declared permissions. zod already enforces the closed
 * enum at parse time, but this gives a defensive second pass for manifests
 * constructed programmatically and a single place to add policy later
 * (e.g. enterprise deny-lists).
 */
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
 * Compute the effective grant: intersection of what the manifest declares and
 * what the user approved. A plugin can NEVER receive a permission it did not
 * declare, and never one the user did not approve.
 */
export function effectiveGrant(
  declared: PermissionScope[],
  approved: PermissionScope[],
): PermissionScope[] {
  const approvedSet = new Set(approved);
  return declared.filter((p) => approvedSet.has(p));
}
