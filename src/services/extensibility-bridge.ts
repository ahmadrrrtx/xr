/**
 * XR — Extensibility bridge for interactive surfaces (Phase 0 · T8).
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * The one-shot CLI (`xr run …`) executes through `AgentService`, which loads
 * plugins and MCP servers and passes them to the agent as `extraTools`, plus
 * skill context as a system prompt. The three interactive surfaces did not:
 *
 *   src/interfaces/shell/app.ts:552  → runAgent(task, mode, { … })   no extraTools
 *   src/telegram/bot.ts:176          → runAgent(cmd.text, "agent", …) no extraTools
 *   src/voice/pipeline.ts:152        → runAgent(command, "agent", …)  no extraTools
 *
 * So a plugin the user installed and an MCP server they connected were visible
 * from `xr run` and invisible in the Shell, Telegram and Voice — the
 * extensibility moat drifting away from the surface people actually use
 * (Commandment 4: no surface bypasses the shared path).
 *
 * ── The bridge (scope-guarded) ──────────────────────────────────────────────
 *
 * Phase 0 explicitly forbids unifying the execution envelope — that is Phase 2.
 * This module therefore does the minimum that makes the surfaces reach the same
 * extensibility layer: it resolves plugin tools, MCP tools and skill context
 * from the SAME managers the CLI uses, and returns them for the caller to pass
 * into its existing `runAgent` call.
 *
 * It introduces no new execution path, no new abstraction over the agent loop,
 * and no second registry. When the kernel's `AgentService` is available it
 * defers to those already-loaded services rather than constructing anything.
 */

import type { Tool } from "../core/types.ts";
import type { Store } from "../state/workspace-store.ts";

export interface ExtensibilityContext {
  /** Plugin + MCP tools to merge into `AgentDeps.extraTools`. */
  extraTools: Tool[];
  /** Skill-derived system prompt, or "" when no skill matched. */
  skillPrompt: string;
  /** Diagnostics for the surface to display; never thrown. */
  diagnostics: string[];
}

const EMPTY: ExtensibilityContext = { extraTools: [], skillPrompt: "", diagnostics: [] };

/**
 * Resolve the extensibility context for an interactive surface.
 *
 * Best-effort by design: a broken plugin must degrade the tool list, never
 * prevent the user from running a task. Every failure is reported through
 * `diagnostics` so the surface can surface it instead of hiding it.
 *
 * @param store The surface's active workspace store — reused so the bridge
 *              never opens a second database connection.
 * @param task  The user's task text, used to select relevant skills.
 */
export async function resolveExtensibility(store: Store, task: string): Promise<ExtensibilityContext> {
  const diagnostics: string[] = [];
  const extraTools: Tool[] = [];
  let skillPrompt = "";

  const cwd = process.cwd();

  // ── Plugins ────────────────────────────────────────────────────────────────
  try {
    const { PluginManager } = await import("../plugins/manager.ts");
    const manager = new PluginManager(store, cwd);
    await manager.loadEnabled();
    const tools = manager.pluginTools();
    extraTools.push(...tools);
    const summary = manager.summary();
    if (summary.errored > 0) {
      diagnostics.push(`${summary.errored} plugin(s) need attention`);
    }
  } catch (err) {
    diagnostics.push(`plugins unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── MCP servers ────────────────────────────────────────────────────────────
  try {
    const { McpManager } = await import("../mcp/manager.ts");
    const manager = new McpManager(store, cwd);
    await manager.loadEnabled();
    extraTools.push(...manager.mcpTools());
  } catch (err) {
    diagnostics.push(`MCP unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Skills ─────────────────────────────────────────────────────────────────
  // Skills carry their own marketplace store, exactly as SkillService wires
  // them for the CLI, so the surface gets the same skill selection logic.
  try {
    const { SkillMarketplace } = await import("../skills/marketplace.ts");
    const { SkillMarketplaceStore } = await import("../skills/marketplace-store.ts");
    const { UnifiedSkillRuntime } = await import("../skills/runtime.ts");
    const runtime = new UnifiedSkillRuntime(new SkillMarketplace(new SkillMarketplaceStore()));
    const ctx = runtime.executionContext(task, 4);
    if (ctx?.prompt) skillPrompt = ctx.prompt;
  } catch (err) {
    diagnostics.push(`skills unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { extraTools, skillPrompt, diagnostics };
}

/** Safe fallback used when a surface cannot resolve a store. */
export function emptyExtensibility(): ExtensibilityContext {
  return { ...EMPTY, extraTools: [], diagnostics: [] };
}
