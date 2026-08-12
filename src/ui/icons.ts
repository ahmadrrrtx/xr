/**
 * XR 3.1 — Navigation Icons and Structure
 *
 * Defines navigation items, icons, and view ordering for Shell and web.
 *
 * Spec: XR_INFORMATION_ARCHITECTURE.md §2
 */

// ── Icon Glyphs (terminal-compatible) ─────────────────────────────────────────

export type GlyphId =
  | "chat"
  | "sessions"
  | "research"
  | "agents"
  | "workflows"
  | "automation"
  | "memory"
  | "files"
  | "skills"
  | "providers"
  | "models"
  | "settings"
  | "dashboard"
  | "security"
  | "usage"
  | "home"
  | "status"
  | "arrow"
  | "chevron";

/**
 * Icon glyphs for terminal rendering.
 * These are Unicode characters that render well in most terminals.
 */
export const GLYPHS: Record<GlyphId, string> = {
  // Navigation
  chat:       "💬",
  sessions:   "📋",
  research:   "🔬",
  agents:     "🤖",
  workflows:  "⚡",
  automation: "🔄",
  memory:     "🧠",
  files:      "📁",
  skills:     "🛠",
  providers:  "☁",
  models:     "💾",
  settings:   "⚙",
  dashboard:  "📊",
  security:   "🔒",
  usage:      "💰",
  home:       "⌂",

  // UI
  status:     "●",
  arrow:      "›",
  chevron:    "›",
};

// ── Navigation Items ───────────────────────────────────────────────────────────

export interface NavItem {
  id: string;
  label: string;
  glyph: GlyphId;
  section: NavSection;
  shortcut?: string;
  description?: string;
}

export type NavSection =
  | "navigation"
  | "agents"
  | "knowledge"
  | "setup"
  | "system";

/**
 * Section labels for display
 */
export const SECTION_LABELS: Record<NavSection, string> = {
  navigation: "NAVIGATION",
  agents: "AGENTS",
  knowledge: "KNOWLEDGE",
  setup: "SETUP",
  system: "SYSTEM",
};

/**
 * Complete navigation item list
 */
export const NAV_ITEMS: NavItem[] = [
  // Navigation
  { id: "chat",        label: "Chat",          glyph: "chat",       section: "navigation", shortcut: "g c", description: "Main conversation" },
  { id: "sessions",    label: "Sessions",      glyph: "sessions",   section: "navigation", shortcut: "g s", description: "Recent tasks and chats" },
  { id: "research",    label: "Research",      glyph: "research",   section: "navigation", shortcut: "g r", description: "Research reports" },

  // Agents
  { id: "agents",      label: "Agents",        glyph: "agents",     section: "agents",     shortcut: "g a", description: "Manage agents" },
  { id: "workflows",   label: "Workflows",     glyph: "workflows",  section: "agents",     shortcut: "g wf", description: "Multi-agent workflows" },
  { id: "automation",  label: "Automations",   glyph: "automation", section: "agents",     shortcut: "g auto", description: "Scheduled tasks" },

  // Knowledge
  { id: "memory",      label: "Memory",        glyph: "memory",     section: "knowledge",  shortcut: "g m", description: "What XR remembers" },
  { id: "files",       label: "Files",         glyph: "files",      section: "knowledge",  shortcut: "g f", description: "File browser" },
  { id: "skills",      label: "Skills",        glyph: "skills",     section: "knowledge",  shortcut: "g k", description: "Available capabilities" },

  // Setup
  { id: "providers",   label: "Providers",     glyph: "providers",  section: "setup",      shortcut: "g p", description: "Cloud providers" },
  { id: "models",      label: "Models",        glyph: "models",     section: "setup",      shortcut: "g mdl", description: "Local models" },
  { id: "settings",    label: "Settings",      glyph: "settings",   section: "setup",      shortcut: "g sgt", description: "Preferences" },

  // System
  { id: "dashboard",   label: "Dashboard",     glyph: "dashboard",  section: "system",     shortcut: "g d", description: "Overview and status" },
  { id: "security",    label: "Security",      glyph: "security",   section: "system",     shortcut: "g sec", description: "Security status" },
  { id: "usage",       label: "Usage",         glyph: "usage",      section: "system",     shortcut: "g u", description: "Spending and usage" },
  { id: "home",        label: "Home",          glyph: "home",       section: "system",     shortcut: "g d", description: "Overview" },
];

// ── Shell View Order ───────────────────────────────────────────────────────────

/**
 * Ordered list of views for Shell sidebar.
 * This determines the display order in the terminal.
 */
export const SHELL_VIEW_ORDER: string[] = [
  // Navigation
  "chat",
  "sessions",
  "research",

  // Agents
  "agents",
  "workflows",
  "automation",

  // Knowledge
  "memory",
  "files",
  "skills",

  // Setup
  "providers",
  "models",
  "settings",

  // System
  "dashboard",
  "security",
  "usage",
];

// ── Icon Rendering ─────────────────────────────────────────────────────────────

/**
 * Get icon glyph for a view ID
 */
export function icon(viewId: string): string {
  const item = NAV_ITEMS.find((n) => n.id === viewId);
  return item ? GLYPHS[item.glyph] : GLYPHS.status;
}

/**
 * Get icon for a glyph ID
 */
export function getGlyph(glyph: GlyphId): string {
  return GLYPHS[glyph] ?? GLYPHS.status;
}

// ── Keyboard Shortcuts ─────────────────────────────────────────────────────────

/**
 * All keyboard shortcuts for Shell
 */
export const KEYBOARD_SHORTCUTS = [
  { key: "Ctrl+K", action: "Open command palette", category: "navigation" },
  { key: "Ctrl+C", action: "Cancel current operation", category: "action" },
  { key: "Escape", action: "Close overlay / cancel", category: "action" },
  { key: "Alt+P", action: "Change provider/model", category: "setup" },
  { key: "?", action: "Toggle help", category: "help" },
  { key: "g c", action: "Go to Chat", category: "navigation" },
  { key: "g s", action: "Go to Sessions", category: "navigation" },
  { key: "g w", action: "Go to Workspaces", category: "navigation" },
  { key: "g a", action: "Go to Agents", category: "navigation" },
  { key: "g m", action: "Go to Memory", category: "navigation" },
  { key: "g p", action: "Go to Providers", category: "navigation" },
  { key: "g d", action: "Go to Dashboard", category: "navigation" },
  { key: "/", action: "Focus composer", category: "action" },
  { key: "/new", action: "New session", category: "action" },
  { key: "/help", action: "Show help", category: "help" },
  { key: "/model", action: "Change model", category: "setup" },
  { key: "/providers", action: "Open providers", category: "setup" },
  { key: "/settings", action: "Open settings", category: "setup" },
];

/**
 * Get shortcuts by category
 */
export function shortcutsByCategory(category: string): typeof KEYBOARD_SHORTCUTS {
  return KEYBOARD_SHORTCUTS.filter((s) => s.category === category);
}

// ── Command Palette ────────────────────────────────────────────────────────────

/**
 * Command palette items for Ctrl+K
 */
export interface CommandPaletteItem {
  id: string;
  label: string;
  description: string;
  section: string;
  shortcut?: string;
  keywords: string[];
}

/**
 * Generate command palette items
 */
export function getCommandPaletteItems(): CommandPaletteItem[] {
  return [
    // Navigation
    { id: "nav-chat", label: "Open Chat", description: "Conversation workspace", section: "Navigation", shortcut: "g c", keywords: ["chat", "conversation", "messages"] },
    { id: "nav-sessions", label: "Open Sessions", description: "Recent tasks", section: "Navigation", shortcut: "g s", keywords: ["sessions", "history", "tasks"] },
    { id: "nav-research", label: "Open Research", description: "Research reports", section: "Navigation", shortcut: "g r", keywords: ["research", "reports", "search"] },
    { id: "nav-home", label: "Open Dashboard", description: "Overview", section: "Navigation", shortcut: "g d", keywords: ["dashboard", "home", "overview"] },

    // Agents
    { id: "nav-agents", label: "Manage Agents", description: "View and control agents", section: "Agents", shortcut: "g a", keywords: ["agents", "agent", "multi-agent"] },
    { id: "nav-workflows", label: "Workflows", description: "Multi-agent workflows", section: "Agents", shortcut: "g wf", keywords: ["workflows", "workflow", "multi-agent"] },
    { id: "nav-automation", label: "Automations", description: "Scheduled tasks", section: "Agents", shortcut: "g auto", keywords: ["automation", "automations", "scheduled"] },

    // Knowledge
    { id: "nav-memory", label: "Memory", description: "What XR remembers", section: "Knowledge", shortcut: "g m", keywords: ["memory", "remember", "recall"] },
    { id: "nav-files", label: "Files", description: "File browser", section: "Knowledge", shortcut: "g f", keywords: ["files", "file", "browser", "explore"] },
    { id: "nav-skills", label: "Skills", description: "Available capabilities", section: "Knowledge", shortcut: "g k", keywords: ["skills", "skill", "capabilities"] },

    // Setup
    { id: "nav-providers", label: "Providers", description: "Cloud providers", section: "Setup", shortcut: "g p", keywords: ["providers", "provider", "api key", "cloud"] },
    { id: "nav-models", label: "Models", description: "Local models", section: "Setup", shortcut: "g mdl", keywords: ["models", "model", "local", "ollama"] },
    { id: "nav-settings", label: "Settings", description: "Preferences", section: "Setup", shortcut: "g sgt", keywords: ["settings", "config", "preferences", "options"] },

    // System
    { id: "nav-security", label: "Security", description: "Security status", section: "System", shortcut: "g sec", keywords: ["security", "safe", "protect", "lock"] },
    { id: "nav-usage", label: "Usage", description: "Spending and usage", section: "System", shortcut: "g u", keywords: ["usage", "spending", "budget", "cost", "tokens"] },

    // Actions
    { id: "action-new-session", label: "New Session", description: "Start fresh conversation", section: "Actions", shortcut: "/new", keywords: ["new", "session", "fresh", "clear"] },
    { id: "action-change-provider", label: "Change Provider", description: "Switch AI provider", section: "Actions", shortcut: "Alt+P", keywords: ["provider", "change", "switch", "model"] },
    { id: "action-toggle-help", label: "Help", description: "Show keyboard help", section: "Actions", shortcut: "?", keywords: ["help", "?", "commands", "keyboard"] },
  ];
}

/**
 * Search command palette items
 */
export function searchPaletteItems(query: string): CommandPaletteItem[] {
  if (!query.trim()) {
    return getCommandPaletteItems();
  }

  const lowerQuery = query.toLowerCase();
  return getCommandPaletteItems().filter((item) => {
    return (
      item.label.toLowerCase().includes(lowerQuery) ||
      item.description.toLowerCase().includes(lowerQuery) ||
      item.keywords.some((k) => k.toLowerCase().includes(lowerQuery)) ||
      item.section.toLowerCase().includes(lowerQuery)
    );
  });
}
