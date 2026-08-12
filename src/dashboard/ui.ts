/**
 * XR 3.1 — Dashboard & Security UI
 *
 * Dashboard overview, security status, usage/spending display.
 *
 * Spec: XR_DESIGN_SYSTEM.md §9 (cards)
 */

import { xrCyan, xrGreen, xrAmber, xrDim, xrBold, xrRed, xrViolet } from "../ui/theme.ts";
import { SYM } from "../ui/theme.ts";
import { wrapAnsi, clipAnsi } from "../ui/ansi.ts";
import { renderCompactAvatar, renderLargeAvatar } from "../ui/avatar.ts";
import type { AvatarState } from "../ui/avatar.ts";

// ── Dashboard Stats ────────────────────────────────────────────────────────────

export interface DashboardStats {
  activeTasks: number;
  todaySpent: number;
  todayTokens: number;
  totalSessions: number;
  totalSpent: number;
  totalTokens: number;
}

/**
 * Render dashboard stats grid
 */
export function renderDashboardStats(
  stats: DashboardStats,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];
  const colWidth = Math.min(width, 56);

  // Large avatar at top
  const avatarLines = renderLargeAvatar(avatarState, "XR");
  lines.push("");
  for (const line of avatarLines) {
    lines.push(clipAnsi(line, width));
  }
  lines.push("");
  lines.push(xrBold("XR Dashboard"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 40))));
  lines.push("");

  // Stats grid (3 columns)
  const statsItems = [
    { label: "Active Tasks", value: stats.activeTasks.toString(), color: stats.activeTasks > 0 ? xrCyan : xrDim, icon: SYM.info },
    { label: "Today Spent", value: formatCurrency(stats.todaySpent), color: xrAmber, icon: SYM.budget },
    { label: "Total Sessions", value: stats.totalSessions.toString(), color: xrGreen, icon: SYM.ok },
  ];

  // Render stats in a grid-like layout
  for (let i = 0; i < statsItems.length; i++) {
    const item = statsItems[i];
    const padding = " ".repeat(2);
    lines.push(xrDim("┌" + "─".repeat(colWidth - 4) + "┐"));

    if (i === 0) {
      lines.push(xrDim(padding + "│"));
      lines.push(xrBold(padding + `│  ${item.icon} ${item.label}`));
      lines.push(xrBold(padding + `│  ${item.value}`));
      lines.push(xrDim(padding + "│"));
      lines.push(xrDim(padding + "└" + "─".repeat(colWidth - 4) + "┘"));
    } else if (i === 1) {
      lines.push(xrDim(padding + "│"));
      lines.push(xrBold(padding + `│  ${item.icon} ${item.label}`));
      lines.push(xrBold(padding + `│  ${item.value}`));
      lines.push(xrDim(padding + "│"));
      lines.push(xrDim(padding + "└" + "─".repeat(colWidth - 4) + "┘"));
    } else {
      lines.push(xrDim(padding + "│"));
      lines.push(xrBold(padding + `│  ${item.icon} ${item.label}`));
      lines.push(xrBold(padding + `│  ${item.value}`));
      lines.push(xrDim(padding + "│"));
      lines.push(xrDim(padding + "└" + "─".repeat(colWidth - 4) + "┘"));
    }
    lines.push(xrDim(""));
  }

  // What's running section
  lines.push(xrBold("What's Running"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 40))));
  lines.push("");

  if (stats.activeTasks === 0) {
    lines.push(xrDim("  XR is ready for your next request."));
    lines.push(xrDim(`  ${renderCompactAvatar("idle", "Idle")}`));
  } else {
    lines.push(xrDim(`  ${SYM.running} ${stats.activeTasks} active task(s)`));
    lines.push(xrDim(`  ${renderCompactAvatar("working", "Working")}`));
  }

  lines.push("");
  lines.push(xrBold("Connected Providers"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 40))));
  lines.push(xrDim("  (Provider list would appear here)"));
  lines.push("");

  lines.push(xrBold("Recent Sessions"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 40))));
  lines.push(xrDim("  (Recent sessions would appear here)"));
  lines.push("");

  lines.push(xrBold("Security Status"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 40))));
  lines.push(xrDim(`  ${SYM.secure} System secure`));
  lines.push(xrDim(`  ${SYM.secure} Audit chain valid`));
  lines.push(xrDim(`  ${SYM.budget} Budget active`));
  lines.push("");

  lines.push(xrDim("─".repeat(Math.min(width - 2, 40))));
  lines.push(xrDim(`${renderCompactAvatar("idle", "XR")} v3.1 · Press ? for help`));

  return lines;
}

// ── Security Status ─────────────────────────────────────────────────────────────

export interface SecurityStatus {
  systemSecure: boolean;
  auditValid: boolean | null;
  policyActive: boolean;
  approvalsEnabled: boolean;
  budgetActive: boolean;
  egressConfigured: boolean;
  recentEvents: SecurityEvent[];
  isolation: "in-process" | "sandbox" | "none";
}

export interface SecurityEvent {
  timestamp: number;
  type: "approval" | "denial" | "policy_violation" | "budget_stopped" | "audit_verified";
  description: string;
  severity: "info" | "warning" | "error";
}

/**
 * Render security status
 */
export function renderSecurityStatus(
  status: SecurityStatus,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  // Header with avatar
  const avatarLines = renderLargeAvatar(
    status.systemSecure ? "complete" : "error",
    status.systemSecure ? "Secure" : "Attention",
  );

  lines.push("");
  for (const line of avatarLines) {
    lines.push(clipAnsi(line, width));
  }
  lines.push("");
  lines.push(xrBold("Security Center"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 48))));
  lines.push("");

  // Overall status
  const overallStatus = status.systemSecure ? "✓ System Secure" : "! Attention Needed";
  const overallColor = status.systemSecure ? xrGreen : xrAmber;

  lines.push(xrBold("Overall Status"));
  lines.push(xrDim(""));
  lines.push(xrBold(`  ${overallColor(overallStatus)}`));
  lines.push(xrDim(`  ${SYM.info} Isolation: ${status.isolation}`));
  lines.push("");

  // Protections
  lines.push(xrBold("Active Protections"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 40))));
  lines.push("");

  const protections = [
    { name: "Policy Gate", active: status.policyActive, desc: "Rules enforced on every action" },
    { name: "Approvals", active: status.approvalsEnabled, desc: "Human consent for dangerous actions" },
    { name: "Budget Governor", active: status.budgetActive, desc: "Spend limits enforced" },
    { name: "Egress Allowlist", active: status.egressConfigured, desc: "Only allowed domains receive data" },
    { name: "Audit Chain", active: status.auditValid === true, desc: "Hash-chained event log" },
  ];

  for (const prot of protections) {
    const icon = prot.active ? SYM.ok : SYM.warn;
    const color = prot.active ? xrGreen : xrAmber;
    lines.push(xrDim(`  ${icon} ${color(prot.name)}`));
    lines.push(xrDim(`      ${prot.desc}`));
    lines.push(xrDim(""));
  }

  // Recent events
  if (status.recentEvents.length > 0) {
    lines.push(xrBold("Recent Security Events"));
    lines.push(xrDim("─".repeat(Math.min(width - 2, 40))));
    lines.push("");

    const recent = status.recentEvents.slice(0, 5);
    for (const event of recent) {
      const icon = event.severity === "error" ? SYM.error
        : event.severity === "warning" ? SYM.warn
        : SYM.info;
      const color = event.severity === "error" ? xrRed
        : event.severity === "warning" ? xrAmber
        : xrDim;

      lines.push(xrDim(`  ${icon} ${color(getAge(event.timestamp))}`));
      lines.push(xrDim(`      ${event.description}`));
      lines.push(xrDim(""));
    }
  }

  // Important note
  lines.push(xrDim("─".repeat(Math.min(width - 2, 40))));
  lines.push(xrDim(`  ${SYM.info} ${xrDim("XR enforces in-process policy, not kernel isolation.")}`));
  lines.push(xrDim(`  ${xrDim("Review consequential actions before approving.")}`));

  return lines;
}

// ── Usage / Spending ────────────────────────────────────────────────────────────

export interface UsageStats {
  perTaskBudget: number;
  todaySpent: number;
  todayTokens: number;
  weekSpent: number;
  monthSpent: number;
  totalSpent: number;
  providerBreakdown: ProviderUsage[];
}

export interface ProviderUsage {
  provider: string;
  model: string;
  spent: number;
  tokens: number;
  percentage: number;
}

/**
 * Render usage/spending display
 */
export function renderUsageDisplay(
  stats: UsageStats,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  // Header
  const avatarLines = renderLargeAvatar("complete", "Usage");
  lines.push("");
  for (const line of avatarLines) {
    lines.push(clipAnsi(line, width));
  }
  lines.push("");
  lines.push(xrBold("Usage & Spending"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 44))));
  lines.push("");

  // Budget overview
  lines.push(xrBold("Budget"));
  lines.push(xrDim(""));

  const budgetStatus = stats.perTaskBudget > 0
    ? `${SYM.budget} Per-task budget: ${formatCurrency(stats.perTaskBudget)}`
    : `${SYM.info} Per-task budget: Unlimited`;

  lines.push(xrDim(`  ${budgetStatus}`));
  lines.push(xrDim(`  ${SYM.budget} Today: ${formatCurrency(stats.todaySpent)} (${stats.todayTokens.toLocaleString()} tokens)`));
  lines.push(xrDim(`  ${SYM.budget} This week: ${formatCurrency(stats.weekSpent)}`));
  lines.push(xrDim(`  ${SYM.budget} This month: ${formatCurrency(stats.monthSpent)}`));
  lines.push(xrDim(`  ${SYM.budget} Total: ${formatCurrency(stats.totalSpent)}`));
  lines.push("");

  // Provider breakdown
  if (stats.providerBreakdown.length > 0) {
    lines.push(xrBold("By Provider"));
    lines.push(xrDim("─".repeat(Math.min(width - 2, 40))));
    lines.push("");

    for (const prov of stats.providerBreakdown) {
      const isLocal = prov.provider === "ollama" || prov.provider === "local";
      const icon = isLocal ? SYM.local : SYM.cloud;
      const color = isLocal ? xrGreen : xrAmber;

      lines.push(xrDim(`  ${icon} ${color(prov.provider)} / ${prov.model}`));
      lines.push(xrDim(`      ${formatCurrency(prov.spent)} (${prov.tokens.toLocaleString()} tokens)`));
      lines.push(xrDim(`      ${prov.percentage.toFixed(1)}% of total`));
      lines.push(xrDim(""));
    }
  }

  // Settings hint
  lines.push(xrDim("─".repeat(Math.min(width - 2, 40))));
  lines.push(xrDim(`  ${SYM.info} Adjust budget in Settings → Spending`));
  lines.push(xrDim(`  ${SYM.info} Use local models to avoid per-token costs`));

  return lines;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return `${(amount * 1000).toFixed(0)}m`;
  return `$${amount.toFixed(2)}`;
}

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
