/**
 * XR Phase 2 · T2 — build the one `ToolRegistryService` from all four
 * contribution sources.
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
  registry.registerTools(coreToolContributions());

  // ── 2. Plugins ────────────────────────────────────────────────────────────
  try {
    if (options.hosts?.pluginTools) {
      registry.registerTools({
        kind: "plugin",
        source: "plugins",
        tools: options.hosts.pluginTools(),
      });
    } else {
      const { PluginManager } = await import("../plugins/manager.ts");
      const manager = new PluginManager(options.store, cwd);
      await manager.loadEnabled();
      registry.registerTools({ kind: "plugin", source: "plugins", tools: manager.pluginTools() });
      const summary = manager.summary();
      if (summary.errored > 0) diagnostics.push(`${summary.errored} plugin(s) need attention`);
    }
  } catch (err) {
    diagnostics.push(`plugins unavailable: ${describe(err)}`);
  }

  // ── 3. MCP servers ────────────────────────────────────────────────────────
  try {
    if (options.hosts?.mcpTools) {
      registry.registerTools({ kind: "mcp", source: "mcp", tools: options.hosts.mcpTools() });
    } else {
      const { McpManager } = await import("../mcp/manager.ts");
      const manager = new McpManager(options.store, cwd);
      await manager.loadEnabled();
      registry.registerTools({ kind: "mcp", source: "mcp", tools: manager.mcpTools() });
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
      if (tools.length > 0) registry.registerTools({ kind: "core", source: "context-memory", tools });
    }
  } catch (err) {
    diagnostics.push(`memory tools unavailable: ${describe(err)}`);
  }

  return { registry, diagnostics };
}
