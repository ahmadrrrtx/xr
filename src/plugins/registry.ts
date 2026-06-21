/** XR Stage 10 — persistent installed-plugin registry. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { PermissionScope, PluginHealth, PluginManifest, PluginTrustLevel } from "./types.ts";

export function xrHome(): string {
  return process.env.XR_HOME ?? join(homedir(), ".xr");
}

export function pluginsDir(): string {
  return join(xrHome(), "plugins");
}

export function registryPath(): string {
  return join(pluginsDir(), "registry.json");
}

export function safePluginDirName(id: string): string {
  return id.replace(/^@/, "at_").replace(/[\\/]/g, "__").replace(/[^a-z0-9._-]/gi, "_");
}

export interface LifecycleEvent {
  at: number;
  action: "install" | "enable" | "disable" | "update" | "remove" | "load" | "load_error" | "permissions" | "health";
  detail?: string;
}

export interface RegistryEntry {
  id: string;
  dirName: string;
  enabled: boolean;
  grantedPermissions: PermissionScope[];
  installedAt: number;
  updatedAt: number;
  version?: string;
  type?: string;
  source?: string;
  sourceUrl?: string;
  updateSource?: string;
  trustLevel?: PluginTrustLevel;
  installedHash?: string;
  treeHash?: string;
  capabilities?: Array<{ kind: string; name: string; description?: string }>;
  health?: PluginHealth;
  history?: LifecycleEvent[];
}

const RegistryEntrySchema = z.object({
  id: z.string(),
  dirName: z.string().optional(),
  enabled: z.boolean().default(false),
  grantedPermissions: z.array(z.string()).default([]),
  installedAt: z.number().default(() => Date.now()),
  updatedAt: z.number().default(() => Date.now()),
  version: z.string().optional(),
  type: z.string().optional(),
  source: z.string().optional(),
  sourceUrl: z.string().optional(),
  updateSource: z.string().optional(),
  trustLevel: z.string().optional(),
  installedHash: z.string().optional(),
  treeHash: z.string().optional(),
  capabilities: z.array(z.any()).optional(),
  health: z.any().optional(),
  history: z.array(z.any()).optional(),
});

interface RegistryFile {
  version: 2;
  plugins: Record<string, RegistryEntry>;
}

function ensureDir(): void {
  const dir = pluginsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function normalizeEntry(raw: unknown): RegistryEntry | null {
  const parsed = RegistryEntrySchema.safeParse(raw);
  if (!parsed.success) return null;
  const e = parsed.data as any;
  return {
    id: e.id,
    dirName: e.dirName ?? safePluginDirName(e.id),
    enabled: Boolean(e.enabled),
    grantedPermissions: (e.grantedPermissions ?? []) as PermissionScope[],
    installedAt: Number(e.installedAt ?? Date.now()),
    updatedAt: Number(e.updatedAt ?? Date.now()),
    version: e.version,
    type: e.type,
    source: e.source,
    sourceUrl: e.sourceUrl,
    updateSource: e.updateSource,
    trustLevel: e.trustLevel,
    installedHash: e.installedHash,
    treeHash: e.treeHash,
    capabilities: e.capabilities ?? [],
    health: e.health,
    history: Array.isArray(e.history) ? e.history.slice(-100) : [],
  };
}

export class PluginRegistry {
  private file: RegistryFile;
  private dir: string;
  private path: string;
  public warnings: string[] = [];

  constructor() {
    this.dir = pluginsDir();
    this.path = registryPath();
    ensureDir();
    this.file = this.read();
  }

  private read(): RegistryFile {
    if (!existsSync(this.path)) return { version: 2, plugins: {} };
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8"));
      const rows = raw?.plugins && typeof raw.plugins === "object" ? raw.plugins : {};
      const plugins: Record<string, RegistryEntry> = {};
      for (const [id, row] of Object.entries(rows)) {
        const e = normalizeEntry({ id, ...(row as any) });
        if (e) plugins[e.id] = e;
        else this.warnings.push(`registry entry for ${id} was invalid and was ignored`);
      }
      return { version: 2, plugins };
    } catch (e) {
      this.warnings.push(`registry.json is not valid JSON (${(e as Error).message}); starting empty.`);
      return { version: 2, plugins: {} };
    }
  }

  private flush(): void {
    ensureDir();
    writeFileSync(this.path, JSON.stringify(this.file, null, 2));
  }

  dirFor(id: string): string {
    const e = this.file.plugins[id];
    return join(this.dir, e?.dirName ?? safePluginDirName(id));
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
    this.file.plugins[entry.id] = {
      ...entry,
      dirName: entry.dirName ?? safePluginDirName(entry.id),
      history: (entry.history ?? []).slice(-100),
    };
    this.flush();
  }

  patch(id: string, patch: Partial<RegistryEntry>): boolean {
    const e = this.file.plugins[id];
    if (!e) return false;
    this.file.plugins[id] = { ...e, ...patch, updatedAt: patch.updatedAt ?? Date.now() };
    this.flush();
    return true;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    return this.patch(id, { enabled });
  }

  setPermissions(id: string, perms: PermissionScope[]): boolean {
    return this.patch(id, { grantedPermissions: perms });
  }

  setHealth(id: string, health: PluginHealth): boolean {
    return this.patch(id, { health });
  }

  record(id: string, action: LifecycleEvent["action"], detail?: string): void {
    const e = this.file.plugins[id];
    if (!e) return;
    e.history = [...(e.history ?? []), { at: Date.now(), action, detail }].slice(-100);
    e.updatedAt = Date.now();
    this.flush();
  }

  remove(id: string): boolean {
    if (!this.file.plugins[id]) return false;
    delete this.file.plugins[id];
    this.flush();
    return true;
  }

  static newEntry(
    manifest: PluginManifest,
    grantedPermissions: PermissionScope[],
    opts: { enabled?: boolean; installedHash?: string; treeHash?: string; source?: string; updateSource?: string } = {},
  ): RegistryEntry {
    const now = Date.now();
    return {
      id: manifest.id,
      dirName: safePluginDirName(manifest.id),
      enabled: opts.enabled ?? false,
      grantedPermissions,
      installedAt: now,
      updatedAt: now,
      version: manifest.version,
      type: manifest.type,
      source: opts.source ?? (typeof manifest.source === "string" ? manifest.source : manifest.source?.url),
      sourceUrl: manifest.sourceUrl,
      updateSource: opts.updateSource ?? manifest.updateSource,
      trustLevel: manifest.trustLevel,
      installedHash: opts.installedHash,
      treeHash: opts.treeHash,
      capabilities: manifest.capabilities,
      health: { state: opts.enabled ? "unknown" : "disabled", checkedAt: now },
      history: [{ at: now, action: "install", detail: `v${manifest.version}` }],
    };
  }
}
