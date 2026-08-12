/**
 * XR 3.1 — Memory & Research UI
 *
 * Memory browser, research results display, automation management.
 *
 * Spec: XR_DESIGN_SYSTEM.md §9 (cards)
 */

import { xrCyan, xrGreen, xrAmber, xrDim, xrBold, xrRed } from "../../ui/theme.ts";
import { SYM } from "../../ui/theme.ts";
import { wrapAnsi, clipAnsi } from "../../ui/ansi.ts";
import { renderCompactAvatar } from "../../ui/avatar.ts";
import type { AvatarState } from "../../ui/avatar.ts";

// ── Memory Entry Card ───────────────────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  category: string;
  content: string;
  scope: "workspace" | "global" | "session";
  createdAt: number;
  accessedAt?: number;
  ttl?: number;  // seconds until expiry
  source?: string;  // "user" | "agent" | "observation"
  tags?: string[];
}

/**
 * Render a memory entry card
 */
export function renderMemoryEntry(
  entry: MemoryEntry,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];
  const accent = entry.source === "user" ? xrCyan : entry.source === "agent" ? xrViolet : xrDim;

  const age = getAge(entry.createdAt);
  const expiry = entry.ttl ? getExpiry(entry.createdAt, entry.ttl) : null;

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 50)) + "┐"));
  lines.push(accent(`│ ${renderCompactAvatar(avatarState, "")} ${entry.category}`));
  lines.push(xrDim("│"));
  lines.push(xrDim(`│ ${entry.content}`));

  // Truncate long content
  if (entry.content.length > 100) {
    lines.push(xrDim("│ ... (truncated)"));
  }

  lines.push(xrDim("│"));
  lines.push(xrDim(`│ ${SYM.info} ${age}`));

  if (expiry) {
    lines.push(xrDim(`│ ${SYM.warn} Expires: ${expiry}`));
  }

  if (entry.tags && entry.tags.length > 0) {
    lines.push(xrDim(`│ Tags: ${entry.tags.join(", ")}`));
  }

  lines.push(xrDim(`│ Source: ${entry.source ?? "unknown"}`));
  lines.push(xrDim(`│ Scope: ${entry.scope}`));
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 50)) + "┘"));

  return lines;
}

/**
 * Render memory browser
 */
export function renderMemoryBrowser(
  entries: MemoryEntry[],
  width: number,
  avatarState: AvatarState,
  category?: string,
  search?: string,
): string[] {
  const lines: string[] = [];

  lines.push(xrBold("Memory"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 48))));

  // Stats
  const total = entries.length;
  const byCategory = countByCategory(entries);
  lines.push(xrDim(`Total: ${total} entries`));
  if (Object.keys(byCategory).length > 0) {
    const catList = Object.entries(byCategory)
      .map(([cat, count]) => `${cat}: ${count}`)
      .join("  ·  ");
    lines.push(xrDim(`By category: ${catList}`));
  }
  lines.push("");

  // Filter
  let filtered = entries;
  if (category) {
    filtered = filtered.filter(e => e.category === category);
  }
  if (search) {
    const lower = search.toLowerCase();
    filtered = filtered.filter(e =>
      e.content.toLowerCase().includes(lower) ||
      e.category.toLowerCase().includes(lower) ||
      (e.tags && e.tags.some(t => t.toLowerCase().includes(lower)))
    );
  }

  if (filtered.length === 0) {
    lines.push(xrDim("No memories found."));
    if (search || category) {
      lines.push(xrDim("Try a different search or category."));
    }
    return lines;
  }

  // Show entries (most recent first)
  const sorted = [...filtered].sort((a, b) => b.createdAt - a.createdAt);

  for (const entry of sorted.slice(0, 10)) {
    for (const line of renderMemoryEntry(entry, width - 2, avatarState)) {
      lines.push(line);
    }
    lines.push("");
  }

  if (sorted.length > 10) {
    lines.push(xrDim(`... and ${sorted.length - 10} more entries`));
  }

  return lines;
}

// ── Research Result Card ────────────────────────────────────────────────────────

export interface ResearchResult {
  id: string;
  title: string;
  query: string;
  summary: string;
  sources: ResearchSource[];
  createdAt: number;
  wordCount: number;
}

export interface ResearchSource {
  title: string;
  url?: string;
  snippet: string;
  credibility?: "high" | "medium" | "low";
}

/**
 * Render a research result card
 */
export function renderResearchResult(
  result: ResearchResult,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 52)) + "┐"));
  lines.push(xrCyan(`│ ${renderCompactAvatar(avatarState, "")} ${result.title}`));
  lines.push(xrDim("│"));
  lines.push(xrDim(`│ ${result.summary}`));

  // Truncate long summary
  if (result.summary.length > 200) {
    lines.push(xrDim("│ ... (truncated)"));
  }

  lines.push(xrDim("│"));
  lines.push(xrDim(`│ ${SYM.info} ${result.wordCount} words  ·  ${result.sources.length} sources`));

  if (result.sources.length > 0) {
    lines.push(xrDim("│"));
    lines.push(xrDim("│ Sources:"));
    for (const source of result.sources.slice(0, 3)) {
      const cred = source.credibility ? `(${source.credibility})` : "";
      lines.push(xrDim(`│   ${cred} ${source.title}`));
      if (source.url) {
        lines.push(xrDim(`│   ${xrDim(source.url)}`));
      }
    }
    if (result.sources.length > 3) {
      lines.push(xrDim(`│   ... +${result.sources.length - 3} more`));
    }
  }

  lines.push(xrDim(`│ Created: ${getAge(result.createdAt)}`));
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 52)) + "┘"));

  return lines;
}

/**
 * Render research list
 */
export function renderResearchList(
  results: ResearchResult[],
  width: number,
  avatarState: AvatarState,
  query?: string,
): string[] {
  const lines: string[] = [];

  lines.push(xrBold("Research"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 48))));
  lines.push(xrDim(`Total: ${results.length} reports`));
  lines.push("");

  if (results.length === 0) {
    lines.push(xrDim("No research yet."));
    lines.push(xrDim("Try: xr research <topic>"));
    return lines;
  }

  // Show most recent
  const sorted = [...results].sort((a, b) => b.createdAt - a.createdAt);

  for (const result of sorted.slice(0, 5)) {
    for (const line of renderResearchResult(result, width - 2, avatarState)) {
      lines.push(line);
    }
    lines.push("");
  }

  if (sorted.length > 5) {
    lines.push(xrDim(`... and ${sorted.length - 5} more reports`));
  }

  return lines;
}

// ── Automation Card ─────────────────────────────────────────────────────────────

export interface Automation {
  id: string;
  name: string;
  trigger: string;
  action: string;
  status: "active" | "paused" | "error" | "disabled";
  lastRun?: string;
  nextRun?: string;
  runCount?: number;
}

/**
 * Render automation card
 */
export function renderAutomationCard(
  automation: Automation,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];
  const accent = automation.status === "active" ? xrGreen
    : automation.status === "paused" ? xrAmber
    : automation.status === "error" ? xrRed
    : xrDim;

  const statusIcon = {
    active: SYM.ok,
    paused: SYM.warn,
    error: SYM.error,
    disabled: SYM.info,
  }[automation.status];

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 46)) + "┐"));
  lines.push(accent(`│ ${renderCompactAvatar(avatarState, "")} ${automation.name}`));
  lines.push(xrDim(`│  ${statusIcon} ${automation.status}`));

  lines.push(xrDim(`│  Trigger: ${automation.trigger}`));
  lines.push(xrDim(`│  Action: ${automation.action}`));

  if (automation.lastRun) {
    lines.push(xrDim(`│  Last run: ${automation.lastRun}`));
  }
  if (automation.nextRun) {
    lines.push(xrDim(`│  Next run: ${automation.nextRun}`));
  }
  if (automation.runCount !== undefined) {
    lines.push(xrDim(`│  Run count: ${automation.runCount}`));
  }

  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 46)) + "┘"));

  return lines;
}

/**
 * Render automations list
 */
export function renderAutomationsList(
  automations: Automation[],
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  lines.push(xrBold("Automations"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 44))));

  const active = automations.filter(a => a.status === "active");
  const other = automations.filter(a => a.status !== "active");

  lines.push("");
  lines.push(xrDim(`Active: ${active.length}  ·  Paused/Disabled: ${other.length}`));

  if (automations.length === 0) {
    lines.push("");
    lines.push(xrDim("No automations configured."));
    lines.push(xrDim("Create one with: xr automation create"));
    return lines;
  }

  for (const auto of automations) {
    for (const line of renderAutomationCard(auto, width - 2, avatarState)) {
      lines.push(line);
    }
    lines.push("");
  }

  return lines;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function getAge(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function getExpiry(createdAt: number, ttl: number): string {
  const expiry = new Date(createdAt + ttl * 1000);
  return expiry.toLocaleDateString();
}

function countByCategory(entries: MemoryEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  }
  return counts;
}
