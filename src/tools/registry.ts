/**
 * XR — core tool CONTRIBUTION SOURCE.
 *
 * Phase 2 · T2: this module no longer is a registry. It declares the core
 * tool set and hands it to the one `ToolRegistryService`
 * (src/tools/registry-service.ts), which owns registration, namespacing,
 * collision arbitration and discovery for every kind.
 *
 * The helpers below (`toolsForMode`, `getTool`, `allTools`) are retained as a
 * thin compatibility surface for call-sites that only ever needed the core set
 * — notably older tests and CLI catalog listings. They are NOT an execution
 * path: the agent loop resolves through the registry service.
 */
import type { Mode, Tool } from "../core/types.ts";
import { readFileTool, writeFileTool } from "./files.ts";
import { listDirTool, deleteFileTool, shellTool } from "./system.ts";
import { fetchUrlTool, webSearchTool, checkPackageTool } from "./web.ts";
import { SYSTEM_TOOLS } from "../computer/system-control.ts";
import { computerControlTool } from "./control.ts";

const ALL: Tool[] = [
  // File operations
  readFileTool,
  writeFileTool,
  // Directory / system
  listDirTool,
  deleteFileTool,
  shellTool,
  // Web / live data
  fetchUrlTool,
  webSearchTool,
  checkPackageTool,
  // JARVIS system control (cross-platform)
  ...SYSTEM_TOOLS,
  // v0.8.1 — safe multi-step computer control (planner-driven)
  computerControlTool,
];

// Read-only tools — safe in plan/ask modes (no state change, no exec, no system access)
const READ_ONLY = ["read_file", "list_dir", "fetch_url", "web_search", "check_package", "system_apps", "system_clipboard_read"];

// Agent gets everything
const MODE_ALLOW: Record<Mode, string[]> = {
  agent: ALL.map((t) => t.name),
  plan: READ_ONLY,
  ask: READ_ONLY,
};

export function toolsForMode(mode: Mode): Tool[] {
  const allow = new Set(MODE_ALLOW[mode]);
  return ALL.filter((t) => allow.has(t.name));
}

export function getTool(name: string): Tool | undefined {
  return ALL.find((t) => t.name === name);
}

export function allTools(): Tool[] {
  return [...ALL];
}

/**
 * Phase 2 · T2 — the core kind's contribution to the single registry.
 *
 * `toolsForMode` is deliberately NOT used here: mode scoping is the registry's
 * responsibility now, so the registry receives the full core set once and
 * applies least-privilege at discovery time. Keeping one scoping rule in one
 * place is the whole point of the consolidation.
 */
export function coreToolContributions(): { kind: "core"; source: string; tools: Tool[] } {
  return { kind: "core", source: "core", tools: [...ALL] };
}
