/**
 * XR 1.0 — plugin loader (the error-isolation boundary).
 *
 * Responsibilities:
 *   1. Validate a plugin directory (manifest present + parses + permissions ok).
 *   2. Check compatibility (core semver range + host ABI).
 *   3. Verify trust (entrypoint hash matches the recorded baseline, if any).
 *   4. Dynamically import the entrypoint, build a permission-scoped host, and
 *      collect the plugin's contributions.
 *
 * EVERY step is wrapped: a throwing/broken plugin produces a typed failure and
 * is skipped. The XR core is never taken down by a bad plugin.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Store } from "../state/db.ts";
import type { XRConfig } from "../config/config.ts";
import { CORE_VERSION, PLUGIN_API_VERSION } from "../core/version.ts";
import { readManifest, validatePermissions, effectiveGrant } from "./manifest.ts";
import { checkCompatibility } from "./compat.ts";
import { buildHost } from "./host.ts";
import type {
  PluginContributions,
  PluginManifest,
  PluginModule,
  PluginRecord,
  PermissionScope,
} from "./types.ts";

export interface ValidateResult {
  ok: boolean;
  manifest?: PluginManifest;
  /** sha256 of the entrypoint file (used as the trust baseline). */
  entryHash?: string;
  errors: string[];
}

/** Hash the entrypoint file for trust/tamper baselining. */
export function hashEntrypoint(dir: string, manifest: PluginManifest): string | undefined {
  const entry = join(dir, manifest.entrypoint);
  if (!existsSync(entry)) return undefined;
  try {
    return createHash("sha256").update(readFileSync(entry)).digest("hex");
  } catch {
    return undefined;
  }
}

/**
 * Static validation of a plugin directory: manifest + permissions + compat +
 * entrypoint existence. Does NOT execute any plugin code.
 */
export function validatePlugin(dir: string): ValidateResult {
  const errors: string[] = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { ok: false, errors: [`not a directory: ${dir}`] };
  }

  const parsed = readManifest(dir);
  if (!parsed.ok || !parsed.manifest) {
    return { ok: false, errors: parsed.errors };
  }
  const manifest = parsed.manifest;

  const perms = validatePermissions(manifest.permissions);
  if (!perms.ok) errors.push(...perms.errors);

  const compat = checkCompatibility(
    CORE_VERSION,
    manifest.apiVersion,
    PLUGIN_API_VERSION,
    manifest.compatibility,
  );
  if (!compat.ok && compat.reason) errors.push(compat.reason);

  const entry = join(dir, manifest.entrypoint);
  if (!existsSync(entry)) errors.push(`entrypoint not found: ${manifest.entrypoint}`);

  const entryHash = hashEntrypoint(dir, manifest);

  return { ok: errors.length === 0, manifest, entryHash, errors };
}

export interface LoadOk {
  ok: true;
  manifest: PluginManifest;
  contributions: PluginContributions;
  granted: PermissionScope[];
}

export interface LoadErr {
  ok: false;
  manifest?: PluginManifest;
  reason: string;
  kind: "incompatible" | "untrusted" | "error";
}

export type LoadResult = LoadOk | LoadErr;

export interface LoadDeps {
  store: Store;
  config: XRConfig;
  cwd: string;
  /** Permissions the user approved at install (registry-backed). */
  granted: PermissionScope[];
  /** Recorded entrypoint hash baseline; if set and mismatched → untrusted. */
  expectedHash?: string;
}

/**
 * Fully load a plugin: validate → compat → trust → import → host → contributions.
 * Fail-soft: returns a typed error instead of throwing, so the caller can keep
 * loading the rest of the plugins.
 */
export async function loadPlugin(dir: string, deps: LoadDeps): Promise<LoadResult> {
  // 1. Static validation
  const v = validatePlugin(dir);
  if (!v.ok || !v.manifest) {
    return { ok: false, reason: v.errors.join("; ") || "invalid plugin", kind: "error" };
  }
  const manifest = v.manifest;

  // 2. Compatibility (typed as incompatible so doctor/CLI can show it clearly)
  const compat = checkCompatibility(
    CORE_VERSION,
    manifest.apiVersion,
    PLUGIN_API_VERSION,
    manifest.compatibility,
  );
  if (!compat.ok) {
    return { ok: false, manifest, reason: compat.reason ?? "incompatible", kind: "incompatible" };
  }

  // 3. Trust: if a baseline hash was recorded at install, the entrypoint must
  //    still match it. A changed entrypoint => possible tampering => refuse.
  if (deps.expectedHash) {
    if (v.entryHash !== deps.expectedHash) {
      return {
        ok: false,
        manifest,
        reason: "entrypoint hash does not match the value recorded at install (possible tampering)",
        kind: "untrusted",
      };
    }
  }

  // 4. Import the entrypoint — isolated.
  let mod: PluginModule;
  try {
    const entry = join(dir, manifest.entrypoint);
    // Cache-bust so update/reload picks up new code within one process.
    mod = (await import(`${entry}?v=${Date.now()}`)) as PluginModule;
  } catch (e) {
    return { ok: false, manifest, reason: `import failed: ${(e as Error).message}`, kind: "error" };
  }

  const activate = resolveActivate(mod);
  if (!activate) {
    return {
      ok: false,
      manifest,
      reason: "plugin has no activate() export (named `activate` or default function)",
      kind: "error",
    };
  }

  // Effective grant = manifest ∩ user-approved (defence in depth).
  const granted = effectiveGrant(manifest.permissions, deps.granted);
  const host = buildHost(granted, {
    store: deps.store,
    config: deps.config,
    cwd: deps.cwd,
    pluginDir: dir,
  });

  let contributions: PluginContributions;
  try {
    contributions = (await activate(host)) ?? {};
  } catch (e) {
    return { ok: false, manifest, reason: `activate() threw: ${(e as Error).message}`, kind: "error" };
  }

  return { ok: true, manifest, contributions, granted };
}

function resolveActivate(mod: PluginModule) {
  if (typeof mod.activate === "function") return mod.activate;
  if (typeof mod.default === "function") return mod.default;
  if (mod.default && typeof (mod.default as any).activate === "function") {
    return (mod.default as any).activate;
  }
  return undefined;
}

/** Build a display-ready PluginRecord from validation (no code execution). */
export function describePlugin(
  dir: string,
  enabled: boolean,
  granted: PermissionScope[],
  installedAt: number,
  updatedAt: number,
): PluginRecord | null {
  const v = validatePlugin(dir);
  if (!v.manifest) return null;
  const compatible = v.ok;
  return {
    id: v.manifest.id,
    dir,
    manifest: v.manifest,
    enabled,
    grantedPermissions: granted,
    installedAt,
    updatedAt,
    status: {
      kind: !compatible ? "error" : enabled ? "enabled" : "disabled",
      loaded: false,
      detail: v.errors.join("; ") || undefined,
    },
    reason: v.errors.join("; ") || undefined,
  };
}
