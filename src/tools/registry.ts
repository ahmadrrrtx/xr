/**
 * XR — tool registry with per-mode least-privilege allow-lists.
 * Ask mode = read-only; Plan mode = read-only; Agent mode = full.
 * (TRD §4 least-privilege; "Never Breaks" rule #3 fail-closed.)
 */
import type { Mode, Tool } from "../core/types.ts";
import { readFileTool, writeFileTool } from "./files.ts";
import { listDirTool, deleteFileTool, shellTool } from "./system.ts";
import { fetchUrlTool, webSearchTool, checkPackageTool } from "./web.ts";

const ALL: Tool[] = [
  readFileTool,
  writeFileTool,
  listDirTool,
  deleteFileTool,
  shellTool,
  fetchUrlTool,
  webSearchTool,
  checkPackageTool,
];

/** Read-only tools — safe in plan/ask modes (no state change, no exec). */
const READ_ONLY = ["read_file", "list_dir", "fetch_url", "web_search", "check_package"];

const MODE_ALLOW: Record<Mode, string[]> = {
  agent: ALL.map((t) => t.name), // full access
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
