/**
 * XR Stage 11 — MCP Registry (persistent state for installed MCP servers)
 *
 * Tracks: installed, enabled, disabled, health, permissions, capabilities, tools/resources/prompts inventory.
 * Opt-in only. Explicit. Auditable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type {
  McpServerConfig,
  McpServerConfigInput,
  McpHealthState,
  McpPermissionScope,
  McpTrustLevel,
  McpHealthReport,
} from "./types.ts";
import { McpServerConfigSchema } from "./types.ts";

export function xrHome(): string {
  return process.env.XR_HOME ?? join(homedir(), ".xr");
}

export function mcpDir(): string {
  return join(xrHome(), "mcp");
}

export function registryPath(): string {
  return join(mcpDir(), "registry.json");
}

function ensureDir(): void {
  const dir = mcpDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export interface McpRegistryEntry extends McpServerConfig {
  dirName?: string;
}

interface RegistryFile {
  version: 1;
  servers: Record<string, McpRegistryEntry>;
}

const EntrySchema = McpServerConfigSchema.extend({
  dirName: z.string().optional(),
});

export class McpRegistry {
  private file: RegistryFile;
  public warnings: string[] = [];

  constructor() {
    ensureDir();
    this.file = this.read();
  }

  private read(): RegistryFile {
    const path = registryPath();
    if (!existsSync(path)) return { version: 1, servers: {} };
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const servers: Record<string, McpRegistryEntry> = {};
      for (const [id, row] of Object.entries(raw.servers || {})) {
        const parsed = EntrySchema.safeParse(row);
        if (parsed.success) {
          servers[id] = parsed.data as McpRegistryEntry;
        } else {
          this.warnings.push(`MCP registry entry ${id} invalid, ignored`);
        }
      }
      return { version: 1, servers };
    } catch (e) {
      this.warnings.push(`registry.json invalid: ${(e as Error).message}`);
      return { version: 1, servers: {} };
    }
  }

  private flush(): void {
    ensureDir();
    writeFileSync(registryPath(), JSON.stringify(this.file, null, 2));
  }

  has(id: string): boolean {
    return !!this.file.servers[id];
  }

  get(id: string): McpRegistryEntry | undefined {
    return this.file.servers[id];
  }

  list(): McpRegistryEntry[] {
    return Object.values(this.file.servers).sort((a, b) => a.id.localeCompare(b.id));
  }

  listEnabled(): McpRegistryEntry[] {
    return this.list().filter((e) => e.enabled);
  }

  upsert(entry: McpRegistryEntry): void {
    this.file.servers[entry.id] = {
      ...entry,
      updatedAt: Date.now(),
      history: [...(entry.history ?? []).slice(-80)],
    };
    this.flush();
  }

  patch(id: string, patch: Partial<McpRegistryEntry>): boolean {
    const e = this.file.servers[id];
    if (!e) return false;
    this.file.servers[id] = {
      ...e,
      ...patch,
      updatedAt: Date.now(),
    };
    this.flush();
    return true;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    return this.patch(id, { enabled });
  }

  setHealth(id: string, health: McpHealthState, detail?: string): boolean {
    return this.patch(id, {
      health,
      healthDetail: detail,
      lastHealthCheckAt: Date.now(),
    });
  }

  recordInvocation(id: string): void {
    const e = this.file.servers[id];
    if (!e) return;
    e.invocationCount = (e.invocationCount || 0) + 1;
    e.lastInvokedAt = Date.now();
    this.flush();
  }

  record(id: string, action: string, detail?: string): void {
    const e = this.file.servers[id];
    if (!e) return;
    e.history = [...(e.history ?? []), { at: Date.now(), action, detail }].slice(-80);
    this.flush();
  }

  remove(id: string): boolean {
    if (!this.file.servers[id]) return false;
    delete this.file.servers[id];
    this.flush();
    return true;
  }

  search(query: string): McpRegistryEntry[] {
    const q = query.toLowerCase();
    return this.list().filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q)
    );
  }

  static newEntry(input: McpServerConfigInput): McpRegistryEntry {
    const now = Date.now();
    return {
      ...McpServerConfigSchema.parse(input),
      installedAt: now,
      updatedAt: now,
      enabled: input.enabled ?? false,
      health: "unknown",
      invocationCount: 0,
      history: [{ at: now, action: "install", detail: input.version }],
    } as McpRegistryEntry;
  }
}
