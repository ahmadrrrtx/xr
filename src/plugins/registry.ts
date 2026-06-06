/**
 * XR 1.0 — plugin registry (the persistent index of installed plugins).
 *
 * Stored as a single JSON file at XR_HOME/plugins/registry.json. Plugin code
 * itself lives at XR_HOME/plugins/<id>/. The registry records, per plugin: its
 * manifest, enabled state, the permissions the USER granted (which may be a
 * subset of what the manifest declared), install/update timestamps, and the
 * recorded trust hash.
 *
 * Self-healing like config: a corrupt registry never crashes XR; it degrades to
 * an empty registry and reports the problem.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { PermissionScope, PluginManifest } from "./types.ts";

/**
 * Resolve XR's home directory *at call time* (not captured at import). This
 * keeps production behaviour identical — the env var is set before anything
 * runs — while letting tests point XR_HOME at a temp dir and stay isolated.
 */
export function xrHome(): string {
  return process.env.XR_HOME ?? join(homedir(), ".xr");
}

export function pluginsDir(): string {
  return join(xrHome(), "plugins");
}

export function registryPath(): string {
  return join(pluginsDir(), "registry.json");
}

/** What the registry persists per plugin (manifest is re-read from disk too). */
export interface RegistryEntry {
  id: string;
  enabled: boolean;
  grantedPermissions: PermissionScope[];
  installedAt: number;
  updatedAt: number;
  /** Recorded sha256 of the entrypoint at install (tamper baseline). */
  installedHash?: string;
  source?: string;
  updateSource?: string;
}

interface RegistryFile {
  version: 1;
  plugins: Record<string, RegistryEntry>;
}

function ensureDir(): void {
  const dir = pluginsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export class PluginRegistry {
  private file: RegistryFile;
  private dir: string;
  private path: string;
  public warnings: string[] = [];

  constructor() {
    // Snapshot the resolved paths for this instance (still dynamic per `new`).
    this.dir = pluginsDir();
    this.path = registryPath();
    ensureDir();
    this.file = this.read();
  }

  private read(): RegistryFile {
    if (!existsSync(this.path)) {
      return { version: 1, plugins: {} };
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8"));
      if (raw && typeof raw === "object" && raw.plugins && typeof raw.plugins === "object") {
        return { version: 1, plugins: raw.plugins };
      }
      this.warnings.push("registry.json had an unexpected shape; starting empty.");
    } catch (e) {
      this.warnings.push(`registry.json is not valid JSON (${(e as Error).message}); starting empty.`);
    }
    return { version: 1, plugins: {} };
  }

  private flush(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.file, null, 2));
  }

  /** Absolute install directory for a plugin id. */
  dirFor(id: string): string {
    return join(this.dir, id);
  }

  has(id: string): boolean {
    return Boolean(this.file.plugins[id]);
  }

  get(id: string): RegistryEntry | undefined {
    return this.file.plugins[id];
  }

  list(): RegistryEntry[] {
    return Object.values(this.file.plugins).sort((a, b) => a.id.localeCompare(b.id));
  }

  upsert(entry: RegistryEntry): void {
    this.file.plugins[entry.id] = entry;
    this.flush();
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const e = this.file.plugins[id];
    if (!e) return false;
    e.enabled = enabled;
    e.updatedAt = Date.now();
    this.flush();
    return true;
  }

  setPermissions(id: string, perms: PermissionScope[]): boolean {
    const e = this.file.plugins[id];
    if (!e) return false;
    e.grantedPermissions = perms;
    e.updatedAt = Date.now();
    this.flush();
    return true;
  }

  remove(id: string): boolean {
    if (!this.file.plugins[id]) return false;
    delete this.file.plugins[id];
    this.flush();
    return true;
  }

  /** Build a registry entry from a freshly-installed plugin. */
  static newEntry(
    manifest: PluginManifest,
    grantedPermissions: PermissionScope[],
    opts: { enabled?: boolean; installedHash?: string } = {},
  ): RegistryEntry {
    const now = Date.now();
    return {
      id: manifest.id,
      enabled: opts.enabled ?? false,
      grantedPermissions,
      installedAt: now,
      updatedAt: now,
      installedHash: opts.installedHash,
      source: manifest.source,
      updateSource: manifest.updateSource,
    };
  }
}
