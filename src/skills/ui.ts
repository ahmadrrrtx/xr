/**
 * XR 3.1 — Skills & Agents UI
 *
 * Human-readable skill display, agent profiles, MCP connection status.
 *
 * Spec: XR_DESIGN_SYSTEM.md §9 (cards)
 */

import { xrCyan, xrGreen, xrAmber, xrDim, xrBold, xrRed, xrViolet } from "../ui/theme.ts";
import { SYM } from "../ui/theme.ts";
import { wrapAnsi, clipAnsi } from "../ui/ansi.ts";
import { renderCompactAvatar } from "../ui/avatar.ts";
import type { AvatarState } from "../ui/avatar.ts";

// ── Skill Card ─────────────────────────────────────────────────────────────────

export interface SkillCard {
  id: string;
  name: string;
  description: string;
  capability: string;
  permissions: string[];
  source: "bundled" | "installed" | "custom";
  status: "available" | "installed" | "enabled" | "disabled";
  version?: string;
}

/**
 * Render a skill card
 */
export function renderSkillCard(skill: SkillCard, width: number, avatarState: AvatarState): string[] {
  const lines: string[] = [];
  const accent = skill.status === "enabled" ? xrGreen : skill.status === "installed" ? xrCyan : xrDim;

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 50)) + "┐"));
  lines.push(accent(`│ ${renderCompactAvatar(avatarState, "")} ${skill.name}`));
  lines.push(xrDim(`│  ${skill.description}`));

  if (skill.capability) {
    lines.push(xrDim(`│  Capability: ${skill.capability}`));
  }

  if (skill.permissions.length > 0) {
    lines.push(xrDim("│  Permissions:"));
    for (const perm of skill.permissions.slice(0, 3)) {
      lines.push(xrDim(`│    ${SYM.local} ${perm}`));
    }
    if (skill.permissions.length > 3) {
      lines.push(xrDim(`│    ... +${skill.permissions.length - 3} more`));
    }
  }

  const sourceIcon = skill.source === "bundled" ? SYM.local : SYM.info;
  lines.push(xrDim(`│  ${sourceIcon} ${skill.source}${skill.version ? ` v${skill.version}` : ""}`));
  lines.push(xrDim(`│  Status: ${skill.status}`));
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 50)) + "┘"));

  return lines;
}

/**
 * Render skills list
 */
export function renderSkillsList(
  skills: SkillCard[],
  width: number,
  avatarState: AvatarState,
  filter?: string,
): string[] {
  const lines: string[] = [];

  lines.push(xrBold("Skills & Capabilities"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 48))));
  lines.push(xrDim(`Total: ${skills.length} skills`));
  lines.push("");

  const filtered = filter
    ? skills.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()) ||
                       s.description.toLowerCase().includes(filter.toLowerCase()))
    : skills;

  if (filtered.length === 0) {
    lines.push(xrDim("No skills match your search."));
    return lines;
  }

  // Group by status
  const installed = filtered.filter(s => s.status === "installed" || s.status === "enabled");
  const available = filtered.filter(s => s.status === "available");

  if (installed.length > 0) {
    lines.push(xrBold("Installed"));
    lines.push(xrDim(""));
    for (const skill of installed.slice(0, 5)) {
      for (const line of renderSkillCard(skill, width - 2, avatarState)) {
        lines.push(line);
      }
      lines.push("");
    }
  }

  if (available.length > 0) {
    if (installed.length > 0) lines.push(xrDim(""));
    lines.push(xrBold("Available"));
    lines.push(xrDim(""));
    for (const skill of available.slice(0, 5)) {
      for (const line of renderSkillCard(skill, width - 2, avatarState)) {
        lines.push(line);
      }
      lines.push("");
    }
  }

  return lines;
}

// ── Agent Card ──────────────────────────────────────────────────────────────────

export interface AgentCard {
  id: string;
  name: string;
  purpose: string;
  capabilities: string[];
  status: "idle" | "running" | "waiting" | "completed" | "error";
  currentTask?: string;
  progress?: number;
  lastRun?: string;
}

/**
 * Render an agent card
 */
export function renderAgentCard(agent: AgentCard, width: number, avatarState: AvatarState): string[] {
  const lines: string[] = [];
  const accent = agent.status === "running" ? xrCyan
    : agent.status === "completed" ? xrGreen
    : agent.status === "error" ? xrRed
    : xrDim;

  const statusIcon = {
    idle: SYM.info,
    running: "⟳",
    waiting: SYM.warn,
    completed: SYM.ok,
    error: SYM.error,
  }[agent.status];

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 48)) + "┐"));
  lines.push(accent(`│ ${renderCompactAvatar(avatarState, "")} ${agent.name}`));
  lines.push(xrDim(`│  ${statusIcon} ${agent.status}`));

  if (agent.purpose) {
    lines.push(xrDim(`│  Purpose: ${agent.purpose}`));
  }

  if (agent.capabilities.length > 0) {
    lines.push(xrDim("│  Capabilities:"));
    for (const cap of agent.capabilities.slice(0, 3)) {
      lines.push(xrDim(`│    ${cap}`));
    }
    if (agent.capabilities.length > 3) {
      lines.push(xrDim(`│    ... +${agent.capabilities.length - 3}`));
    }
  }

  if (agent.currentTask) {
    lines.push(xrDim(`│  Task: ${agent.currentTask}`));
    if (agent.progress !== undefined) {
      const barWidth = Math.max(10, Math.min(30, width - 20));
      const filled = Math.round((agent.progress / 100) * barWidth);
      const bar = "█".repeat(filled) + "─".repeat(barWidth - filled);
      lines.push(xrDim(`│  ${bar} ${agent.progress}%`));
    }
  }

  if (agent.lastRun) {
    lines.push(xrDim(`│  Last run: ${agent.lastRun}`));
  }

  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 48)) + "┘"));

  return lines;
}

/**
 * Render agents list
 */
export function renderAgentsList(
  agents: AgentCard[],
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  lines.push(xrBold("Agents"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 44))));
  lines.push("");

  if (agents.length === 0) {
    lines.push(xrDim("No agents configured."));
    lines.push(xrDim("Create one with: xr agents create <name>"));
    return lines;
  }

  for (const agent of agents) {
    for (const line of renderAgentCard(agent, width - 2, avatarState)) {
      lines.push(line);
    }
    lines.push("");
  }

  return lines;
}

// ── MCP Connection Card ─────────────────────────────────────────────────────────

export interface MCPServer {
  name: string;
  transport: "stdio" | "sse" | "http";
  status: "connected" | "disconnected" | "error";
  tools: string[];
  lastConnected?: string;
  error?: string;
}

/**
 * Render MCP server card
 */
export function renderMCPServerCard(server: MCPServer, width: number): string[] {
  const lines: string[] = [];
  const accent = server.status === "connected" ? xrGreen : server.status === "error" ? xrRed : xrAmber;

  const statusIcon = server.status === "connected" ? SYM.ok
    : server.status === "error" ? SYM.error
    : SYM.warn;

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 44)) + "┐"));
  lines.push(accent(`│ ${statusIcon} ${server.name}`));
  lines.push(xrDim(`│  Transport: ${server.transport}`));
  lines.push(xrDim(`│  Status: ${server.status}`));

  if (server.tools.length > 0) {
    lines.push(xrDim(`│  Tools: ${server.tools.length} available`));
    for (const tool of server.tools.slice(0, 3)) {
      lines.push(xrDim(`│    ${tool}`));
    }
    if (server.tools.length > 3) {
      lines.push(xrDim(`│    ... +${server.tools.length - 3}`));
    }
  }

  if (server.lastConnected) {
    lines.push(xrDim(`│  Last connected: ${server.lastConnected}`));
  }

  if (server.error) {
    lines.push(xrRed(`│  Error: ${server.error}`));
  }

  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 44)) + "┘"));

  return lines;
}

/**
 * Render MCP connections list
 */
export function renderMCPList(
  servers: MCPServer[],
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  lines.push(xrBold("MCP Connections"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 44))));

  const connected = servers.filter(s => s.status === "connected");
  const disconnected = servers.filter(s => s.status !== "connected");

  lines.push("");
  lines.push(xrDim(`Connected: ${connected.length}  ·  Disconnected: ${disconnected.length}`));

  if (connected.length > 0) {
    lines.push("");
    lines.push(xrBold("Connected"));
    for (const server of connected) {
      for (const line of renderMCPServerCard(server, width - 2)) {
        lines.push(line);
      }
      lines.push("");
    }
  }

  if (disconnected.length > 0) {
    lines.push(xrDim(""));
    lines.push(xrBold("Disconnected/Error"));
    for (const server of disconnected) {
      for (const line of renderMCPServerCard(server, width - 2)) {
        lines.push(line);
      }
      lines.push("");
    }
  }

  return lines;
}

// ── Human-Readable Descriptions ─────────────────────────────────────────────────

/**
 * Convert technical capability to human-readable description
 */
export function humanizeCapability(capability: string): string {
  const map: Record<string, string> = {
    "files.read": "Read files",
    "files.write": "Create and edit files",
    "files.delete": "Delete files",
    "git.status": "Check git status",
    "git.commit": "Make git commits",
    "git.push": "Push to remote",
    "shell.execute": "Run terminal commands",
    "browser.open": "Open web pages",
    "browser.screenshot": "Take screenshots",
    "memory.read": "Read saved memories",
    "memory.write": "Save memories",
    "search.web": "Search the web",
    "search.files": "Search files",
    "code.edit": "Edit code",
    "code.create": "Create code files",
    "code.test": "Run tests",
    "api.request": "Make API requests",
    "email.send": "Send emails",
    "calendar.read": "Read calendar",
    "database.query": "Query databases",
  };

  return map[capability] ?? capability;
}

/**
 * Group capabilities by category
 */
export function groupCapabilities(capabilities: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {
    Files: [],
    Git: [],
    Shell: [],
    Web: [],
    Memory: [],
    Code: [],
    API: [],
    Other: [],
  };

  for (const cap of capabilities) {
    if (cap.startsWith("files.")) groups.Files.push(cap);
    else if (cap.startsWith("git.")) groups.Git.push(cap);
    else if (cap.startsWith("shell.")) groups.Shell.push(cap);
    else if (cap.startsWith("browser.") || cap.startsWith("web.")) groups.Web.push(cap);
    else if (cap.startsWith("memory.")) groups.Memory.push(cap);
    else if (cap.startsWith("code.") || cap.startsWith("edit.")) groups.Code.push(cap);
    else if (cap.startsWith("api.") || cap.startsWith("http.")) groups.API.push(cap);
    else groups.Other.push(cap);
  }

  // Remove empty groups
  for (const key of Object.keys(groups)) {
    if (groups[key].length === 0) delete groups[key];
  }

  return groups;
}
