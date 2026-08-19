/**
 * XR Phase 08 — Compatibility layer: legacy permission enums → unified model.
 */

import type { CapabilityPermission } from "./types.ts";

/**
 * Map legacy plugin PermissionScope (`fs:read`, `shell`, `control`, etc)
 * to unified CapabilityPermission.
 */
export function legacyPluginPermissionToUnified(scope: string): CapabilityPermission {
  const lower = scope.toLowerCase();
  switch (lower) {
    case "fs:read":
    case "fs-read":
    case "filesystem.read":
      return "filesystem.read";
    case "fs:write":
    case "fs-write":
    case "filesystem.write":
      return "filesystem.write";
    case "fs:delete":
      return "filesystem.delete";
    case "shell":
      return "runtime.shell";
    case "control":
    case "desktop":
    case "system":
      return "computer.desktop";
    case "browser":
      return "computer.browser";
    case "files_read":
      return "computer.file_read";
    case "files_write":
      return "computer.file_write";
    case "net":
    case "network":
      return "network.fetch";
    case "mcp":
      return "mcp.execute";
    case "provider":
      return "provider.chat";
    case "memory:read":
      return "memory.read";
    case "memory:write":
      return "memory.write";
    case "secrets":
      return "secrets.read";
    case "workflow:run":
      return "workflow.run";
    default:
      return "unknown";
  }
}

/**
 * Map skill PermissionScope to unified.
 */
export function legacySkillPermissionToUnified(scope: string): CapabilityPermission {
  return legacyPluginPermissionToUnified(scope);
}

/**
 * Map MCP PermissionScope to unified.
 */
export function legacyMcpPermissionToUnified(scope: string): CapabilityPermission {
  return legacyPluginPermissionToUnified(scope);
}

/**
 * Map tool name to implied unified permissions (for core tools).
 */
export function inferPermissionsFromToolName(name: string): CapabilityPermission[] {
  switch (name) {
    case "read_file":
    case "list_dir":
    case "repo_map":
    case "repo_search":
    case "repo_symbols":
    case "repo_dependencies":
    case "repo_context":
    case "repo_diff":
      return ["filesystem.read"];
    case "write_file":
      return ["filesystem.write"];
    case "delete_file":
      return ["filesystem.delete"];
    case "shell":
      return ["runtime.shell", "filesystem.read", "filesystem.write"];
    case "fetch_url":
    case "check_package":
      return ["network.fetch"];
    case "web_search":
    case "research_search":
      return ["network.search"];
    case "research_scrape":
    case "research_crawl":
    case "research_map":
    case "research_extract":
      return ["network.fetch"];
    case "system_open_app":
    case "system_clipboard_write":
    case "system_notify":
    case "system_apps":
    case "system_clipboard_read":
      return ["computer.desktop"];
    case "computer_control":
      return ["computer.input", "computer.desktop", "computer.browser", "computer.system"];
    default:
      return [];
  }
}

/**
 * Map legacy enums to unified in bulk, deduped.
 */
export function mapLegacyScopes(scopes: readonly string[]): CapabilityPermission[] {
  const out: CapabilityPermission[] = [];
  const seen = new Set<string>();
  for (const s of scopes) {
    const u = legacyPluginPermissionToUnified(s);
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

/**
 * Determine if a unified permission requires approval (dangerous).
 */
export function isDangerousPermission(perm: CapabilityPermission): boolean {
  const dangerous: CapabilityPermission[] = [
    "filesystem.write",
    "filesystem.delete",
    "runtime.shell",
    "runtime.execute",
    "computer.input",
    "computer.desktop",
    "computer.browser",
    "computer.system",
    "computer.file_write",
    "control",
    "mcp.execute",
    "browser.control",
    "secrets.read",
  ];
  return dangerous.includes(perm);
}

