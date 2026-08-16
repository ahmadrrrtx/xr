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
import { CapabilityProvenanceStore } from "../platform/capabilities/provenance.ts";
import { capabilityId } from "../platform/capabilities/types.ts";
import { McpAllowlist } from "./allowlist.ts";
import { scanMcpToolDescription } from "../security/guard.ts";

/** Phase 7 · T1 — best-effort provenance recording from the MCP plane. */
function recordMcpProvenance(record: (store: CapabilityProvenanceStore) => void): void {
  try {
    record(new CapabilityProvenanceStore());
  } catch (e) {
    console.warn(`[provenance] mcp event not recorded: ${(e as Error).message}`);
  }
}

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

  private authorityProblem(entry: McpRegistryEntry): string | null {
    if (entry.lifecycleState === "quarantined") return `server is quarantined: ${entry.quarantineReason ?? "review required"}`;
    const declared = entry.declaredPermissions ?? [];
    const granted = entry.grantedPermissions ?? [];
    const denied = new Set([
      ...(((this.config as any).capabilities?.deniedPermissions ?? []) as string[]),
      ...(((this.config as any).mcp?.deniedPermissions ?? []) as string[]),
    ]);
    const missing = declared.filter((p) => !granted.includes(p));
    const deniedDeclared = declared.filter((p) => denied.has(p));
    if (deniedDeclared.length) return `declared permission denied by policy: ${deniedDeclared.join(", ")}`;
    if (missing.length) return `declared permission not approved: ${missing.join(", ")}`;
    return null;
  }

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
    recordMcpProvenance((p) => p.recordEvent(capabilityId("mcp", entry.id), "install", {
      actor: "user",
      detail: `v${entry.version} (${entry.transport}, ${entry.localOrRemote})`,
      outcome: { status: "success", detail: "registered; default-deny until enabled + allowlisted" },
    }));
    return { ok: true, entry };
  }

  enable(id: string): { ok: boolean; reason?: string } {
    const e = this.registry.get(id);
    if (!e) return { ok: false, reason: "server not found" };
    const problem = this.authorityProblem(e);
    if (problem) return { ok: false, reason: problem };
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

  setPermissions(id: string, permissions: McpPermissionScope[]): { ok: boolean; reason?: string; granted?: McpPermissionScope[] } {
    const e = this.registry.get(id);
    if (!e) return { ok: false, reason: "server not found" };
    const declared = new Set(e.declaredPermissions ?? []);
    const denied = new Set((((this.config as any).capabilities?.deniedPermissions ?? []) as string[]));
    const granted = permissions.filter((p) => declared.has(p) && !denied.has(p));
    this.registry.setPermissions(id, granted);
    this.registry.record(id, "permissions", granted.join(","));
    this.store.audit("mcp.permissions", { id, granted });
    return { ok: true, granted };
  }

  async quarantine(id: string, reason: string): Promise<{ ok: boolean; reason?: string }> {
    const e = this.registry.get(id);
    if (!e) return { ok: false, reason: "server not found" };
    await this.unloadOne(id);
    this.registry.quarantine(id, reason);
    this.registry.record(id, "quarantine", reason);
    this.store.audit("mcp.quarantine", { id, reason });
    return { ok: true };
  }

  remove(id: string): { ok: boolean; reason?: string } {
    const e = this.registry.get(id);
    if (!e) return { ok: false, reason: "server not found" };
    this.unloadOne(id); // sync best-effort
    this.registry.remove(id);
    this.store.audit("mcp.remove", { id });
    recordMcpProvenance((p) => p.recordEvent(capabilityId("mcp", id), "remove", { actor: "user", detail: "server uninstalled", outcome: { status: "success" } }));
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
    // Phase 7 · T6 — SIGNED ALLOWLIST gate (default-deny): enabled is
    // necessary but not sufficient. A server not on the validly-signed
    // allowlist is refused at load (fail-closed).
    const allow = this.allowlistGate(entry.id);
    if (!allow.ok) {
      this.loaded.delete(entry.id);
      this.registry.setHealth(entry.id, "untrusted", allow.reason);
      this.registry.record(entry.id, "allowlist_denied", allow.reason);
      this.store.audit("mcp.allowlist_denied", { id: entry.id, reason: allow.reason });
      return;
    }
    const problem = this.authorityProblem(entry);
    if (problem) {
      this.loaded.delete(entry.id);
      this.registry.setHealth(entry.id, entry.lifecycleState === "quarantined" ? "untrusted" : "error", problem);
      this.registry.record(entry.id, "load_error", problem);
      this.store.audit("mcp.load_error", { id: entry.id, reason: problem });
      return;
    }
    try {
      const client = await this.getOrCreateClient(entry);
      const caps = await client.connect();

      const toolDefs = await client.listTools();
      const resDefs = await client.listResources();
      const promptDefs = await client.listPrompts();

      // Phase 07 · MCP tool-description poisoning. Descriptions are
      // attacker-controlled text from an external server; treat them as
      // untrusted DATA. Scan each, audit any injection match, and prepend a
      // warning into the description the model sees. This NEVER changes
      // authority: permissions/allowlists/credentials live in checkAction,
      // McpAllowlist, and the capability system, not in a description string.
      const tools: Tool[] = toolDefs.map((d) => {
        const scan = scanMcpToolDescription(d);
        if (scan.poisoned) {
          this.store.audit("mcp.tool_description_poisoned", {
            server: entry.id,
            tool: d.name,
            signatures: scan.signatures,
          });
        }
        return wrapMcpTool(client, entry.id, { ...d, description: scan.description });
      });
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

      // update registry inventory + honest health (a successful load clears
      // any earlier untrusted/error state — Phase 7 · T6)
      this.registry.patch(entry.id, {
        tools: toolDefs,
        resources: resDefs,
        prompts: promptDefs,
        health: "healthy",
        healthDetail: `loaded via signed allowlist${client.isIsolated ? " (isolated)" : ""}`,
        lastHealthCheckAt: Date.now(),
      });
    } catch (e: any) {
      this.loaded.delete(entry.id);
      this.registry.setHealth(entry.id, "error", e.message);
    }
  }

  /**
   * Phase 7 · T6 — allowlist gate with local override support (the config
   * `mcp.allowlist.enabled: false` can disable the gate ONLY explicitly;
   * default is enforced). Uses the shared allowlist store.
   */
  private allowlistGate(id: string): { ok: boolean; reason: string } {
    const cfg = this.config as { mcp?: { allowlist?: { enabled?: boolean } } };
    if (cfg.mcp?.allowlist?.enabled === false) {
      return { ok: true, reason: "allowlist gate explicitly disabled by operator config (mcp.allowlist.enabled=false)" };
    }
    try {
      const r = new McpAllowlist().isAllowed(id);
      return { ok: r.ok, reason: r.reason ?? "allowlist gate" };
    } catch (e) {
      return { ok: false, reason: `allowlist gate error (fail-closed): ${(e as Error).message}` };
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
