/**
 * XR — tool registry with per-mode least-privilege allow-lists.
 * Ask mode = read-only; Plan mode = read-only; Agent mode = full.
 */
import type { Mode, Tool } from "../core/types.ts";
import { readFileTool, writeFileTool } from "./files.ts";
import { listDirTool, deleteFileTool, shellTool } from "./system.ts";
import { fetchUrlTool, webSearchTool, checkPackageTool } from "./web.ts";
import { 
  SYSTEM_TOOLS,
  get_open_appsTool, open_appTool, clipboard_readTool, clipboard_writeTool,
  system_volumeTool, system_screenshotTool, system_notifyTool,
  system_batteryTool, system_mediaTool, system_trashTool, system_wifiTool
} from "../computer/system-control.ts";

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
];

// Read-only tools — safe in plan/ask modes (no state change, no exec, no system access)
const READ_ONLY = ["read_file", "list_dir", "fetch_url", "web_search", "check_package", "system_apps", "system_clipboard_read", "system_volume", "system_screenshot", "system_battery", "system_wifi"];

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
