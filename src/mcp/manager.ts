/**
 * XR Stage 11 — MCP Platform Manager
 *
 * Complete lifecycle, discovery, health, permissions, tool/resource/prompt surfacing.
 * Secure integration with XR core (approval, audit, budget, control gates).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { McpClient } from "./client.ts";
import { McpRegistry, type McpRegistryEntry } from "./registry.ts";
import type { Store } from "../state/workspace-store.ts";
import type { Tool, ToolContext } from "../core/types.ts";
import {
  type McpServerConfigInput,
  type McpHealthReport,
  type McpPermissionScope,
  type McpToolDef,
  type McpResourceDef,
  type McpPromptDef,
  MCP_PERMISSION_HELP,
  MCP_SENSITIVE_PERMISSIONS,
} from "./types.ts";
import { wrapMcpTool, wrapMcpResource, wrapMcpPrompt } from "./client.ts";

export interface McpLoadResult {
  serverId: string;
  tools: Tool[];
  resources: Tool[];
  prompts: Tool[];
  capabilities: any;
  error?: string;
}

export class McpManager {
  private registry: McpRegistry;
  private loaded: Map<string, McpLoadResult> = new Map();
  private clients: Map<string, McpClient> = new Map();
  private config: any;

  constructor(private store: Store, private cwd = process.cwd()) {
    this.registry = new McpRegistry();
    try {
      // pull minimal config for future gating
      const { loadConfig } = require("../config/config.ts");
      this.config = loadConfig().config;
    } catch {
      this.config = {};
    }
  }

  get warnings() { return this.registry.warnings; }

  // ── Registry operations ───────────────────────────────────────────────────

  listServers() {
    return this.registry.list();
  }

  listEnabled() {
    return this.registry.listEnabled();
  }

  getServer(id: string) {
    return this.registry.get(id);
  }

  search(query: string) {
    return this.registry.search(query);
  }

  async addServer(input: McpServerConfigInput): Promise<{ ok: boolean; entry?: McpRegistryEntry; reason?: string }> {
    if (this.registry.has(input.id)) {
      return { ok: false, reason: "server already registered" };
    }
    // basic validation
    if (input.transport === "http" && !input.url) {
      return { ok: false, reason: "http transport requires url" };
    }
    if (input.transport === "stdio" && !input.command) {
      return { ok: false, reason: "stdio transport requires command" };
    }

    const entry = McpRegistry.newEntry(input);
    this.registry.upsert(entry);
    this.store.audit("mcp.add", { id: entry.id, transport: entry.transport, source: entry.source });
    return { ok: true, entry };
  }

  enable(id: string): { ok: boolean; reason?: string } {
    const e = this.registry.get(id);
    if (!e) return { ok: false, reason: "server not found" };
    this.registry.setEnabled(id, true);
    this.registry.record(id, "enable");
    this.store.audit("mcp.enable", { id });
    return { ok: true };
  }

  async disable(id: string): Promise<{ ok: boolean; reason?: string }> {
    const e = this.registry.get(id);
    if (!e) return { ok: false, reason: "server not found" };
    await this.unloadOne(id);
    this.registry.setEnabled(id, false);
    this.registry.setHealth(id, "disabled");
    this.registry.record(id, "disable");
    this.store.audit("mcp.disable", { id });
    return { ok: true };
  }

  remove(id: string): { ok: boolean; reason?: string } {
    const e = this.registry.get(id);
    if (!e) return { ok: false, reason: "server not found" };
    this.unloadOne(id); // sync best-effort
    this.registry.remove(id);
    this.store.audit("mcp.remove", { id });
    return { ok: true };
  }

  // ── Inspection & Health ───────────────────────────────────────────────────

  async inspect(id: string): Promise<{
    ok: boolean;
    entry?: McpRegistryEntry;
    capabilities?: any;
    tools: McpToolDef[];
    resources: McpResourceDef[];
    prompts: McpPromptDef[];
    health?: McpHealthReport;
    error?: string;
  }> {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, tools: [], resources: [], prompts: [], error: "not found" };

    try {
      const client = await this.getOrCreateClient(entry);
      const caps = await client.connect();
      const tools = await client.listTools();
      const resources = await client.listResources();
      const prompts = await client.listPrompts();

      const health: McpHealthReport = {
        id,
        state: "healthy",
        checkedAt: Date.now(),
        toolsCount: tools.length,
        resourcesCount: resources.length,
        promptsCount: prompts.length,
      };

      this.registry.setHealth(id, "healthy", `${tools.length} tools`);
      this.registry.patch(id, { tools, resources, prompts, declaredCapabilities: caps });

      return {
        ok: true,
        entry,
        capabilities: caps,
        tools,
        resources,
        prompts,
        health,
      };
    } catch (e: any) {
      this.registry.setHealth(id, "error", e.message);
      return {
        ok: false,
        entry,
        tools: [],
        resources: [],
        prompts: [],
        error: e.message,
      };
    }
  }

  async healthCheck(id?: string): Promise<McpHealthReport[]> {
    const targets: McpRegistryEntry[] = id
      ? (() => {
          const entry = this.registry.get(id);
          return entry ? [entry] : [];
        })()
      : this.registry.listEnabled();
    const reports: McpHealthReport[] = [];

    for (const e of targets) {
      try {
        const client = await this.getOrCreateClient(e);
        await client.connect();
        const tools = await client.listTools();
        const res = await client.listResources();
        const p = await client.listPrompts();

        const report: McpHealthReport = {
          id: e.id,
          state: "healthy",
          checkedAt: Date.now(),
          toolsCount: tools.length,
          resourcesCount: res.length,
          promptsCount: p.length,
        };
        this.registry.setHealth(e.id, "healthy");
        reports.push(report);
      } catch (err: any) {
        const report: McpHealthReport = {
          id: e.id,
          state: "error",
          checkedAt: Date.now(),
          toolsCount: 0,
          resourcesCount: 0,
          promptsCount: 0,
          detail: err.message,
        };
        this.registry.setHealth(e.id, "error", err.message);
        reports.push(report);
      }
    }
    return reports;
  }

  // ── Loading & Surfacing ───────────────────────────────────────────────────

  async loadEnabled(): Promise<void> {
    this.loaded.clear();
    for (const entry of this.registry.listEnabled()) {
      await this.loadOne(entry);
    }
  }

  private async loadOne(entry: McpRegistryEntry): Promise<void> {
    if (!entry.enabled) return;
    try {
      const client = await this.getOrCreateClient(entry);
      const caps = await client.connect();

      const toolDefs = await client.listTools();
      const resDefs = await client.listResources();
      const promptDefs = await client.listPrompts();

      const tools: Tool[] = toolDefs.map((d) => wrapMcpTool(client, entry.id, d));
      const resources: Tool[] = resDefs.map((d) => wrapMcpResource(client, entry.id, d));
      const prompts: Tool[] = promptDefs.map((d) => wrapMcpPrompt(client, entry.id, d));

      const result: McpLoadResult = {
        serverId: entry.id,
        tools,
        resources,
        prompts,
        capabilities: caps,
      };
      this.loaded.set(entry.id, result);

      // update registry inventory
      this.registry.patch(entry.id, {
        tools: toolDefs,
        resources: resDefs,
        prompts: promptDefs,
      });
    } catch (e: any) {
      this.loaded.delete(entry.id);
      this.registry.setHealth(entry.id, "error", e.message);
    }
  }

  private async getOrCreateClient(entry: McpRegistryEntry): Promise<McpClient> {
    if (this.clients.has(entry.id)) return this.clients.get(entry.id)!;

    const client = new McpClient({
      id: entry.id,
      transport: entry.transport,
      url: entry.url,
      command: entry.command,
      args: entry.args,
      env: entry.env,
      apiKeyEnv: entry.apiKeyEnv,
    });
    this.clients.set(entry.id, client);
    return client;
  }

  async unloadOne(id: string) {
    const c = this.clients.get(id);
    if (c) {
      try { await c.disconnect(); } catch {}
      this.clients.delete(id);
    }
    this.loaded.delete(id);
  }

  // ── Contribution to XR runtime ────────────────────────────────────────────

  mcpTools(): Tool[] {
    const out: Tool[] = [];
    for (const r of this.loaded.values()) {
      out.push(...r.tools, ...r.resources, ...r.prompts);
    }
    return out;
  }

  getLoaded(): McpLoadResult[] {
    return [...this.loaded.values()];
  }

  summary() {
    const all = this.registry.list();
    const enabled = all.filter((e) => e.enabled).length;
    const healthy = all.filter((e) => e.health === "healthy").length;
    return {
      installed: all.length,
      enabled,
      healthy,
      errored: all.filter((e) => e.health === "error").length,
    };
  }

  healthSummary() {
    return this.registry.list().map((e) => ({
      id: e.id,
      enabled: e.enabled,
      health: e.health,
      tools: e.tools?.length ?? 0,
      resources: e.resources?.length ?? 0,
      prompts: e.prompts?.length ?? 0,
    }));
  }
}
