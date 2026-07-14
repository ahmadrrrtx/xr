/**
 * XR 3.1 — Canonical icon / glyph vocabulary
 *
 * Same glyph, same meaning, everywhere (Shell + Control Center).
 * Spec: docs/xr-3.1/XR-3.1-DESIGN-SYSTEM.md §8.2
 *
 * Chrome uses this set only. Emojis are reserved for user content.
 */

import { isTextOnly, xrCyan, xrGreen, xrAmber, xrRed, xrDim, xrViolet } from "./theme.ts";

export type GlyphId =
  | "dashboard"
  | "chat"
  | "sessions"
  | "workspaces"
  | "status"
  | "budget"
  | "provider"
  | "model"
  | "memory"
  | "research"
  | "plugins"
  | "skills"
  | "voice"
  | "shield"
  | "audit"
  | "settings"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "running"
  | "local"
  | "terminal"
  | "computer"
  | "notifications"
  | "palette"
  | "search"
  | "send"
  | "mcp"
  | "activity"
  | "home";

const GLYPH: Record<GlyphId, string> = {
  dashboard:     "⬡",
  home:          "⬡",
  chat:          "›",
  sessions:      "◌",
  workspaces:    "▣",
  status:        "◎",
  activity:      "◎",
  budget:        "◈",
  provider:      "☁",
  model:         "◇",
  memory:        "◉",
  research:      "◆",
  plugins:       "⌁",
  skills:        "⬢",
  voice:         "🎤",
  shield:        "⛨",
  audit:         "≡",
  settings:      "···",
  success:       "✓",
  warning:       "!",
  error:         "✗",
  info:          "·",
  running:       "⟳",
  local:         "⬢",
  terminal:      "▸",
  computer:      "◪",
  notifications: "◌",
  palette:       "⌘",
  search:        "/",
  send:          "↑",
  mcp:           "◇",
};

const TEXT_LABEL: Partial<Record<GlyphId, string>> = {
  success: "[OK]",
  warning: "[!]",
  error:   "[ERR]",
  info:    "[i]",
  running: "[RUN]",
  local:   "[LOCAL]",
  provider:"[CLOUD]",
  shield:  "[SEC]",
  budget:  "[$]",
  memory:  "[MEM]",
  voice:   "[MIC]",
  plugins: "[PLG]",
  research:"[RSH]",
  skills:  "[SKL]",
  settings:"[…]",
  notifications: "[N]",
  palette: "[K]",
};

/** Raw glyph (or text-only label). No color. */
export function glyph(id: GlyphId): string {
  if (isTextOnly() && TEXT_LABEL[id]) return TEXT_LABEL[id]!;
  return GLYPH[id] ?? "·";
}

/** Colored glyph for chrome */
export function icon(id: GlyphId, tone: "cyan" | "green" | "amber" | "red" | "dim" | "violet" | "default" = "default"): string {
  const g = glyph(id);
  switch (tone) {
    case "cyan":   return xrCyan(g);
    case "green":  return xrGreen(g);
    case "amber":  return xrAmber(g);
    case "red":    return xrRed(g);
    case "violet": return xrViolet(g);
    case "dim":    return xrDim(g);
    default:       return g;
  }
}

/** Status indicator: always glyph + optional text (color is never sole channel) */
export function statusMark(level: "ok" | "warn" | "error" | "info" | "running"): string {
  switch (level) {
    case "ok":      return icon("success", "green");
    case "warn":    return icon("warning", "amber");
    case "error":   return icon("error", "red");
    case "running": return icon("running", "cyan");
    default:        return icon("info", "cyan");
  }
}

/** Sidebar nav item definitions — single order across Shell + Control Center */
export interface NavItemDef {
  id: string;
  label: string;
  glyph: GlyphId;
  section: "workspace" | "tools" | "trust" | "prefs";
  shortcut?: string;
}

export const NAV_ITEMS: NavItemDef[] = [
  { id: "home",       label: "Overview",    glyph: "dashboard",  section: "workspace", shortcut: "g d" },
  { id: "chat",       label: "Chat",        glyph: "chat",       section: "workspace", shortcut: "g c" },
  { id: "sessions",   label: "Sessions",    glyph: "sessions",   section: "workspace", shortcut: "g s" },
  { id: "workspaces", label: "Workspaces",  glyph: "workspaces", section: "workspace", shortcut: "g w" },
  { id: "status",     label: "Status",      glyph: "status",     section: "workspace" },
  { id: "research",   label: "Research",    glyph: "research",   section: "tools",     shortcut: "g r" },
  { id: "marketplace",label: "Marketplace", glyph: "skills",     section: "tools",     shortcut: "g m" },
  { id: "plugins",    label: "Plugins",     glyph: "plugins",    section: "tools",     shortcut: "g p" },
  { id: "mcp",        label: "MCP Servers", glyph: "mcp",        section: "tools" },
  { id: "computer",   label: "Computer",    glyph: "computer",   section: "tools" },
  { id: "activity",   label: "Activity",    glyph: "activity",   section: "tools",     shortcut: "g t" },
  { id: "shield",     label: "Shield",      glyph: "shield",     section: "trust",     shortcut: "g x" },
  { id: "audit",      label: "Audit Log",   glyph: "audit",      section: "trust",     shortcut: "g a" },
  { id: "budget",     label: "Budget",      glyph: "budget",     section: "trust",     shortcut: "g b" },
  { id: "memory",     label: "Memory",      glyph: "memory",     section: "trust" },
  { id: "settings",   label: "Settings",    glyph: "settings",   section: "prefs",     shortcut: "g ." },
];

export const SECTION_LABELS: Record<NavItemDef["section"], string> = {
  workspace: "WORKSPACE",
  tools:     "TOOLS",
  trust:     "TRUST",
  prefs:     "PREFS",
};

/** Shell primary views (subset of NAV_ITEMS for terminal density) */
export const SHELL_VIEW_ORDER = [
  "home",
  "chat",
  "sessions",
  "workspaces",
  "research",
  "activity",
  "audit",
  "memory",
  "status",
  "settings",
] as const;

export type ShellViewId = typeof SHELL_VIEW_ORDER[number];
