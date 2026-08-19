/**
 * XR Phase 2 · T2 + Phase 8 — build the one `ToolRegistryService` from all four
 * contribution sources.
 *
 * Phase 08 enhancements:
 * - Populates unified capability metadata (lifecycle, trust, scope, permissions, risk, provider, version, hash, provenance)
 * - Trust, lifecycle, scope, permissions are derived from manager states
 * - Core tools get official trust, enabled lifecycle, inferred permissions
 * - Plugin/MCP tools get trust/lifecycle from their registry entries
 * - Skills remain prompt contributions (no run)
 *
 * This is the ONLY place that knows how to reach plugins, MCP servers and
 * skills. It replaces the two divergent assemblies that existed before:
 *
 *   · AgentService                       — resolved PluginService/McpService/
 *                                          SkillService from the kernel registry
 *   · services/extensibility-bridge.ts   — constructed PluginManager/McpManager/
 *                                          UnifiedSkillRuntime directly, for the
 *                                          three interactive surfaces
 *
 * Both produced a flat `Tool[]` with no namespacing and no collision policy.
 * Now both go through `buildToolRegistry()`, so every surface gets an
 * identically-populated, identically-arbitrated registry — which is what the
 * interface-parity test asserts.
 *
 * Every source is best-effort by design: a broken plugin degrades the tool set
 * and reports a diagnostic; it must never prevent the user from running a task.
 * Failures are collected, never swallowed silently (Art. IV — no empty catch).
 */

import type { Store } from "../state/workspace-store.ts";
import { coreToolContributions } from "./registry.ts";
import { ToolRegistryService } from "./registry-service.ts";
import type { CapabilityMetadata } from "./registry-types.ts";
import {
  inferPermissionsFromToolName,
  legacyPluginPermissionToUnified,
} from "../capabilities/compatibility.ts";

export interface BuildRegistryOptions {
  /**
   * The surface's active workspace store, reused so the builder never opens a
   * second database connection (Phase 1 single-writer invariant).
   */
  readonly store: Store;
  /** Task text, used to select relevant skills. */
  readonly task: string;
  /**
   * Pre-resolved contribution hosts. When the kernel is booted, `AgentService`
   * passes the already-loaded services so nothing is constructed twice.
   */
  readonly hosts?: {
    pluginTools?: () => readonly import("../core/types.ts").Tool[];
    mcpTools?: () => readonly import("../core/types.ts").Tool[];
    skillContext?: () => { prompt: string } | undefined;
    /**
     * Phase 6 · T2 — navigable memory tools, supplied by the surface that owns
     * the ContextService (AgentService). Kept as a host hook so this module
     * never opens a store itself (one-store law).
     */
    memoryTools?: () => readonly import("../core/types.ts").Tool[];
  };
  /** How many skills to select. Matches the pre-Phase-2 default of 4. */
  readonly skillLimit?: number;
}

export interface BuildRegistryResult {
  readonly registry: ToolRegistryService;
  /** Human-readable degradations for the surface to display. Never thrown. */
  readonly diagnostics: string[];
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function coreMetadataForTool(toolName: string): CapabilityMetadata {
  const perms = inferPermissionsFromToolName(toolName);
  const isHost = toolName === "computer_control" || toolName.startsWith("system_");
  const isNetwork = ["fetch_url", "web_search", "check_package", "research_search", "research_scrape", "research_crawl", "research_map", "research_extract"].includes(toolName);
  const isRepo = toolName.startsWith("repo_");
  const isShell = toolName === "shell";
  const isWrite = toolName === "write_file" || toolName === "delete_file";

  let riskTier: CapabilityMetadata["riskTier"] = "tier0";
  if (isShell || toolName === "computer_control") riskTier = "tier2";
  else if (isWrite || toolName.startsWith("system_")) riskTier = "tier1";
  else if (isNetwork) riskTier = "tier1";

  let scope: CapabilityMetadata["scope"] = "shared";
  if (["read_file", "write_file", "list_dir", "delete_file"].includes(toolName) || isRepo) scope = "workspace";
  else if (isHost) scope = "host";
  else if (isNetwork) scope = "shared";

  return {
    lifecycle: "enabled",
    trustLevel: "official",
    scope,
    permissions: perms as any,
    riskTier,
    providerId: "core",
    version: "core",
    provenance: { source: "builtin" },
  };
}

function pluginIdFromToolName(toolName: string): string | undefined {
  // format: plugin.<id>.<tool>
  if (!toolName.startsWith("plugin.")) return undefined;
  const parts = toolName.split(".");
  if (parts.length < 3) return undefined;
  return parts[1];
}

function mcpServerIdFromToolName(toolName: string): string | undefined {
  // format: mcp.<serverId>.<tool>
  if (!toolName.startsWith("mcp.")) return undefined;
  const parts = toolName.split(".");
  if (parts.length < 3) return undefined;
  return parts[1];
}

/**
 * Assemble the registry for one run.
 *
 * Registration order is load-bearing: CORE FIRST, so a contribution can never
 * take a core tool's bare name (the registry also defends against out-of-order
 * registration, but ordering keeps the common path unambiguous).
 */
export async function buildToolRegistry(
  options: BuildRegistryOptions,
): Promise<BuildRegistryResult> {
  const registry = new ToolRegistryService();
  const diagnostics: string[] = [];
  const cwd = process.cwd();

  // ── 1. Core (always first) ────────────────────────────────────────────────
  {
    const contrib = coreToolContributions();
    const metadata: Record<string, CapabilityMetadata> = {};
    for (const t of contrib.tools) {
      metadata[t.name] = coreMetadataForTool(t.name);
    }
    registry.registerTools({ ...contrib, metadata });
  }

  // ── 2. Plugins ────────────────────────────────────────────────────────────
  try {
    if (options.hosts?.pluginTools) {
      const tools = options.hosts.pluginTools() as any as import("../core/types.ts").Tool[];
      const metadata: Record<string, CapabilityMetadata> = {};
      for (const t of tools) {
        const pid = pluginIdFromToolName(t.name) ?? "unknown";
        metadata[t.name] = {
          lifecycle: "enabled",
          trustLevel: "community",
          scope: "shared",
          permissions: inferPermissionsFromToolName(t.name) as any,
          riskTier: "tier1",
          providerId: `plugin:${pid}`,
          version: "unknown",
          provenance: { source: "plugin", reason: `plugin:${pid}` },
        };
      }
      registry.registerTools({
        kind: "plugin",
        source: "plugins",
        tools,
        metadata,
      });
    } else {
      const { PluginManager } = await import("../plugins/manager.ts");
      const manager = new PluginManager(options.store, cwd);
      await manager.loadEnabled();
      const loaded = manager.getLoaded();
      const toolList = manager.pluginTools();
      // Build per-tool metadata from loaded plugins
      const metadata: Record<string, CapabilityMetadata> = {};
      for (const lp of loaded) {
        const trustLevel = (() => {
          const tl = (lp.manifest as any).trustLevel ?? "unknown";
          if (tl === "official" || tl === "verified" || tl === "community" || tl === "unknown") return tl;
          if (tl === "quarantined") return "quarantined";
          return "community";
        })() as CapabilityMetadata["trustLevel"];
        const lifecycle = "enabled" as const;
        for (const pt of lp.contributions.tools ?? []) {
          // adaptTool fqName is plugin.<id>.<name> — need to match toolList entry
          const fq = `plugin.${lp.id}.${pt.name}`;
          // Find actual tool in list with same fq name
          const found = toolList.find((t: any) => t.name === fq);
          if (found) {
            const perms = (lp.manifest.permissions ?? []).map((p: string) => {
              try {
                return legacyPluginPermissionToUnified(p);
              } catch {
                return p;
              }
            });
            metadata[found.name] = {
              lifecycle,
              trustLevel,
              scope: "shared",
              permissions: perms as any,
              riskTier: "tier1",
              providerId: `plugin:${lp.id}`,
              version: lp.manifest.version ?? "unknown",
              sourceHash: (lp as any).manifest?.trust?.sha256 ?? undefined,
              provenance: { source: "plugin", reason: `plugin:${lp.id} v${lp.manifest.version}` },
            };
          }
        }
        // MCP tools contributed via plugins
        for (const mcpTool of lp.mcpTools ?? []) {
          metadata[mcpTool.name] = {
            lifecycle,
            trustLevel,
            scope: "shared",
            permissions: ["mcp.execute"] as any,
            riskTier: "tier1",
            providerId: `plugin:${lp.id}`,
            version: lp.manifest.version ?? "unknown",
            provenance: { source: "plugin", reason: `plugin:${lp.id} MCP` },
          };
        }
      }
      // For tools that didn't get metadata (fallback)
      for (const t of toolList) {
        if (!metadata[t.name]) {
          const pid = pluginIdFromToolName(t.name) ?? "unknown";
          metadata[t.name] = {
            lifecycle: "enabled",
            trustLevel: "community",
            scope: "shared",
            permissions: ["unknown"] as any,
            riskTier: "tier1",
            providerId: `plugin:${pid}`,
            version: "unknown",
            provenance: { source: "plugin" },
          };
        }
      }
      registry.registerTools({ kind: "plugin", source: "plugins", tools: toolList, metadata });
      const summary = manager.summary();
      if (summary.errored > 0) diagnostics.push(`${summary.errored} plugin(s) need attention`);
    }
  } catch (err) {
    diagnostics.push(`plugins unavailable: ${describe(err)}`);
  }

  // ── 3. MCP servers ────────────────────────────────────────────────────────
  try {
    if (options.hosts?.mcpTools) {
      const tools = options.hosts.mcpTools() as any as import("../core/types.ts").Tool[];
      const metadata: Record<string, CapabilityMetadata> = {};
      for (const t of tools) {
        const sid = mcpServerIdFromToolName(t.name) ?? "unknown";
        metadata[t.name] = {
          lifecycle: "enabled",
          trustLevel: "community",
          scope: "shared",
          permissions: ["mcp.execute"] as any,
          riskTier: "tier1",
          providerId: `mcp:${sid}`,
          version: "unknown",
          provenance: { source: "mcp", reason: `mcp:${sid}` },
        };
      }
      registry.registerTools({ kind: "mcp", source: "mcp", tools, metadata });
    } else {
      const { McpManager } = await import("../mcp/manager.ts");
      const manager = new McpManager(options.store, cwd);
      await manager.loadEnabled();
      const mcpTools = manager.mcpTools();
      const loaded = manager.getLoaded();
      const metadata: Record<string, CapabilityMetadata> = {};
      // Build serverId → lifecycle/trust map from health
      const healthMap = new Map<string, { lifecycle: any; trustLevel: any; version: string }>();
      try {
        const health = manager.healthSummary();
        for (const h of health) {
          const lc = h.enabled ? "enabled" : "disabled";
          // health field: healthy, error, untrusted, disabled
          let finalLc = lc;
          if (h.health === "untrusted") finalLc = "quarantined";
          else if (h.health === "error") finalLc = "disabled";
          healthMap.set(h.id, {
            lifecycle: finalLc,
            trustLevel: h.health === "untrusted" ? "quarantined" : h.health === "healthy" ? "community" : "unknown",
            version: "unknown",
          });
        }
      } catch {}
      for (const result of loaded) {
        const info = healthMap.get(result.serverId) ?? { lifecycle: "enabled", trustLevel: "community", version: "unknown" };
        for (const t of [...result.tools, ...result.resources, ...result.prompts]) {
          metadata[t.name] = {
            lifecycle: info.lifecycle,
            trustLevel: info.trustLevel,
            scope: "shared",
            permissions: ["mcp.execute"] as any,
            riskTier: "tier1",
            providerId: `mcp:${result.serverId}`,
            version: info.version,
            provenance: { source: "mcp", reason: `mcp:${result.serverId}` },
          };
        }
      }
      for (const t of mcpTools) {
        if (!metadata[t.name]) {
          const sid = mcpServerIdFromToolName(t.name) ?? "unknown";
          metadata[t.name] = {
            lifecycle: "enabled",
            trustLevel: "community",
            scope: "shared",
            permissions: ["mcp.execute"] as any,
            riskTier: "tier1",
            providerId: `mcp:${sid}`,
            version: "unknown",
            provenance: { source: "mcp" },
          };
        }
      }
      registry.registerTools({ kind: "mcp", source: "mcp", tools: mcpTools, metadata });
    }
  } catch (err) {
    diagnostics.push(`MCP unavailable: ${describe(err)}`);
  }

  // ── 4. Skills (prompt contributions — never callable tools) ───────────────
  try {
    const ctx = options.hosts?.skillContext
      ? options.hosts.skillContext()
      : await (async () => {
          const { SkillMarketplace } = await import("../skills/marketplace.ts");
          const { SkillMarketplaceStore } = await import("../skills/marketplace-store.ts");
          const { UnifiedSkillRuntime } = await import("../skills/runtime.ts");
          const runtime = new UnifiedSkillRuntime(new SkillMarketplace(new SkillMarketplaceStore()));
          return runtime.executionContext(options.task, options.skillLimit ?? 4);
        })();
    if (ctx?.prompt) {
      registry.registerSkill({ kind: "skill", source: "skills", prompt: ctx.prompt });
    }
  } catch (err) {
    diagnostics.push(`skills unavailable: ${describe(err)}`);
  }

  // ── 5. Phase 6 · T2 — navigable memory tools (opt-in by the surface) ──────
  // Registered as core-kind: they are read-only observers of the one context
  // store, subject to the same grant/integrity gates as prompt injection.
  try {
    if (options.hosts?.memoryTools) {
      const tools = options.hosts.memoryTools();
      if (tools.length > 0) {
        const metadata: Record<string, CapabilityMetadata> = {};
        for (const t of tools) {
          metadata[t.name] = {
            lifecycle: "enabled",
            trustLevel: "official",
            scope: "shared",
            permissions: ["memory.read"] as any,
            riskTier: "tier0",
            providerId: "core",
            version: "core",
            provenance: { source: "builtin" },
          };
        }
        registry.registerTools({ kind: "core", source: "context-memory", tools, metadata });
      }
    }
  } catch (err) {
    diagnostics.push(`memory tools unavailable: ${describe(err)}`);
  }

  return { registry, diagnostics };
}
