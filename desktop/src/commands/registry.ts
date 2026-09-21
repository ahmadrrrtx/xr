/**
 * XR — Command registry (Phase 1 · audit D-08).
 *
 * BEFORE: the palette reached navigation + skills + runs only. Queries for
 * "mcp" and "ollama" returned ZERO results, and there was no `?` cheat-sheet
 * at all. Commands were declared inline in the palette, so nothing else could
 * reuse them.
 *
 * AFTER: one registry. The palette, the `?` cheat-sheet and any future context
 * menu read from here, so a command physically cannot exist in one surface and
 * not another.
 *
 * HONESTY LAW (Constitution Art. XIX / audit §"never fake it"):
 *   A command is registered ONLY when it performs a real action against the
 *   engine or real local state. No placeholder commands, no "coming soon"
 *   entries. Every `run` below is a real navigation, a real engine call, or a
 *   real local preference write.
 */

import type { Area } from "../components/AppShell";
import { api } from "../api/client";

export type CommandGroup =
  | "Actions"
  | "Go"
  | "Approvals"
  | "Models & Providers"
  | "Workspace"
  | "Settings"
  | "Skills"
  | "MCP"
  | "Plugins"
  | "Runs";

export interface Command {
  /** Stable id — used for recents, tests and dedupe. */
  id: string;
  group: CommandGroup;
  label: string;
  hint?: string;
  /** Extra search terms (synonyms) so "ollama" finds the model screen. */
  keywords?: string[];
  /** Keyboard shortcut for the cheat-sheet, display form (e.g. "⌘K"). */
  shortcut?: string;
  run: () => void | Promise<void>;
}

/** Extra search terms per destination so the audit's failing queries resolve. */
const AREA_KEYWORDS: Record<string, string[]> = {
  home: ["start", "dashboard", "overview", "compose", "goal"],
  projects: ["repository", "repo", "roots", "folders"],
  workbench: ["work", "chat", "talk", "ask", "task", "conversation", "editor", "code"],
  builder: ["preview", "deploy", "live"],
  research: ["browse", "sources", "citations", "web"],
  memory: ["recall", "facts", "context", "remember"],
  models: ["ollama", "lmstudio", "llamacpp", "vllm", "local", "provider", "byok", "openai", "anthropic"],
  diagnostics: ["health", "check", "doctor", "status", "fix", "repair"],
  control: ["computer", "mouse", "keyboard", "automat", "screen"],
  agents: ["multi-agent", "team", "workflow", "orchestrat", "delegate"],
  runs: ["history", "sessions", "log", "inspect"],
  library: ["skills", "mcp", "plugins", "extensions", "marketplace", "capabilit"],
  trust: ["approval", "security", "audit", "budget", "policy", "spend", "permission", "shield"],
  voice: ["speech", "tts", "stt", "microphone", "talk", "listen"],
  settings: ["preferences", "config", "theme", "density", "appearance", "notification", "shortcut"],
};

export interface RegistryDeps {
  /** Navigate to a top-level area. */
  onArea: (a: Area) => void;
  /** Seed a Work prompt (used for "New task"). */
  onNewTask: () => void;
  /** Start/stop the voice session. */
  onVoiceSession: () => void;
  /** Re-run first-run setup. */
  onOnboard: () => void;
  /** Seed a Work prompt with a skill invocation. */
  onRunSkill: (id: string, name: string) => void;
  /** Set theme; "system" follows the OS. */
  onTheme: (t: "dark" | "light" | "void" | "system") => void;
  /** Set density. */
  onDensity: (d: "compact" | "comfortable" | "spacious") => void;
  /** Toggle opt-in OS notifications. */
  onToggleNotifications: () => Promise<boolean> | boolean;
  notificationsEnabled: () => boolean;
  /** Open the cheat-sheet (registered so `?` is itself discoverable). */
  onCheatSheet: () => void;
  /** Refresh engine-derived caches after a mutation. */
  onRefresh?: () => void;
}

/** Area labels, kept in one place so the palette and cheat-sheet agree. */
export const AREA_LABELS: Array<[Area, string]> = [
  ["home", "Home"],
  ["workbench", "Workbench (editor + chat)"],
  ["builder", "Builder (preview)"],
  ["projects", "Projects"],
  ["research", "Research"],
  ["agents", "Multi-agent"],
  ["runs", "Runs history"],
  ["diagnostics", "Diagnostics"],
  ["models", "Model Center"],
  ["control", "Control Room"],
  ["memory", "Memory"],
  ["library", "Library"],
  ["trust", "Trust Center"],
  ["voice", "Voice mode"],
  ["settings", "Settings"],
];

/**
 * Build the static command set. Dynamic sources (engine skills, MCP servers,
 * plugins, live runs) are appended by `buildCommands` from real engine reads.
 */
export function staticCommands(deps: RegistryDeps): Command[] {
  const cmds: Command[] = [];

  /* ---------- Actions ---------- */
  cmds.push(
    {
      id: "action.new-task",
      group: "Actions",
      label: "New task",
      hint: "start a goal in Work",
      keywords: ["new", "task", "goal", "start", "chat"],
      run: deps.onNewTask,
    },
    {
      id: "action.voice-toggle",
      group: "Actions",
      label: "Toggle voice session",
      hint: "start or stop listening",
      keywords: ["voice", "mic", "speak", "listen", "speech"],
      run: deps.onVoiceSession,
    },
    {
      id: "action.refresh",
      group: "Actions",
      label: "Refresh engine data",
      hint: "re-read providers, runs, approvals",
      keywords: ["reload", "sync", "poll", "status"],
      run: () => deps.onRefresh?.(),
    },
    {
      id: "action.onboarding",
      group: "Actions",
      label: "Re-run onboarding",
      hint: "guided setup (safe to repeat)",
      keywords: ["setup", "wizard", "first run", "configure"],
      run: deps.onOnboard,
    },
    {
      id: "action.cheatsheet",
      group: "Actions",
      label: "Keyboard shortcuts",
      hint: "show the cheat-sheet",
      keywords: ["keys", "shortcuts", "help", "bindings"],
      shortcut: "?",
      run: deps.onCheatSheet,
    },
  );

  /* ---------- Go (navigation, with synonyms) ---------- */
  for (const [area, label] of AREA_LABELS) {
    cmds.push({
      id: `go.${area}`,
      group: "Go",
      label: `Go to ${label}`,
      keywords: AREA_KEYWORDS[area] ?? [],
      run: () => deps.onArea(area),
    });
  }

  /* ---------- Appearance (real local preferences) ---------- */
  for (const [id, label, kw] of [
    ["dark", "Theme: Dark", ["appearance", "night", "colour", "color"]],
    ["light", "Theme: Light", ["appearance", "day", "colour", "color"]],
    ["void", "Theme: Void (minimal)", ["appearance", "quiet", "minimal", "mono"]],
    ["system", "Theme: Follow system", ["appearance", "auto", "os", "colour", "color"]],
  ] as const) {
    cmds.push({
      id: `theme.${id}`,
      group: "Settings",
      label,
      keywords: ["theme", ...kw],
      run: () => deps.onTheme(id as "dark" | "light" | "void" | "system"),
    });
  }
  for (const [id, label] of [
    ["compact", "Density: Compact"],
    ["comfortable", "Density: Comfortable"],
    ["spacious", "Density: Spacious"],
  ] as const) {
    cmds.push({
      id: `density.${id}`,
      group: "Settings",
      label,
      keywords: ["density", "spacing", "size", "layout"],
      run: () => deps.onDensity(id as "compact" | "comfortable" | "spacious"),
    });
  }
  cmds.push({
    id: "settings.notifications",
    group: "Settings",
    label: "Toggle OS notifications",
    hint: "approval due + run finished",
    keywords: ["notify", "alerts", "desktop", "toast"],
    async run() {
      await deps.onToggleNotifications();
    },
  });

  return cmds;
}

/**
 * Compose static commands with live engine-derived ones.
 * Each dynamic source is best-effort: an unreachable engine degrades to fewer
 * commands rather than a broken palette (honest, never a fake entry).
 */
export async function buildCommands(
  deps: RegistryDeps,
  sources: {
    skills?: Array<{ id: string; name?: string }>;
    runs?: Array<{ id: string; title?: string; prompt?: string }>;
    /* Phase 3 · omni palette — models, MCP servers and workspaces are
       searchable too. Every entry performs a REAL engine action
       (providers/set, workspaces/switch) or a real navigation. */
    models?: Array<{ provider: string; model: string; local?: boolean }>;
    mcp?: Array<{ id: string; name?: string; health?: string }>;
    workspaces?: Array<{ id?: string; name?: string }>;
  } = {},
): Promise<Command[]> {
  const cmds = staticCommands(deps);

  for (const s of sources.skills ?? []) {
    cmds.push({
      id: `skill.${s.id}`,
      group: "Skills",
      label: s.name ?? s.id,
      hint: "run in Work",
      keywords: ["skill", "capability", String(s.id)],
      run: () => deps.onRunSkill(String(s.id), String(s.name ?? s.id)),
    });
  }

  for (const r of sources.runs ?? []) {
    const label = (r.title || r.prompt?.slice(0, 60) || r.id) as string;
    cmds.push({
      id: `run.${r.id}`,
      group: "Runs",
      label,
      hint: "open run",
      keywords: ["run", "session", "history", String(r.id)],
      run: () => deps.onArea("runs"),
    });
  }

  for (const m of sources.models ?? []) {
    cmds.push({
      id: `model.${m.provider}/${m.model}`,
      group: "Models & Providers",
      label: `${m.provider} · ${m.model}`,
      hint: m.local ? "route engine to local provider" : "route engine to provider",
      keywords: ["model", "provider", "route", m.provider, m.local ? "local" : "cloud"],
      run: () => { void api.providersSet(m.provider).catch(() => undefined); deps.onRefresh?.(); },
    });
  }

  for (const s of sources.mcp ?? []) {
    cmds.push({
      id: `mcp.${s.id}`,
      group: "MCP",
      label: s.name ?? s.id,
      hint: `open in Library · ${s.health ?? "unknown"}`,
      keywords: ["mcp", "server", "tool", String(s.id)],
      run: () => deps.onArea("library"),
    });
  }

  for (const w of sources.workspaces ?? []) {
    if (!w.id) continue;
    cmds.push({
      id: `ws.${w.id}`,
      group: "Workspace",
      label: `Switch workspace: ${w.name ?? w.id}`,
      hint: "engine workspaces/switch",
      keywords: ["workspace", "project", "switch", String(w.id)],
      run: () => { void api.workspacesSwitch(String(w.id)).catch(() => undefined); deps.onRefresh?.(); },
    });
  }

  return cmds;
}

/**
 * Rank by: exact-ish label prefix → word-boundary match → keyword/substring.
 * Deterministic so tests can assert, and stable so results do not jitter
 * between keystrokes.
 */
export function rankCommands(all: Command[], query: string, limit = 40): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return all.slice(0, limit);

  const scored: Array<{ c: Command; score: number }> = [];
  for (const c of all) {
    const label = c.label.toLowerCase();
    const hay = [c.label, c.hint ?? "", ...(c.keywords ?? []), c.group].join(" ").toLowerCase();
    let score = -1;
    if (label === q) score = 100;
    else if (label.startsWith(q)) score = 80;
    else if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label)) score = 60;
    else if (label.includes(q)) score = 40;
    else if ((c.keywords ?? []).some((k) => k.toLowerCase().includes(q))) score = 30;
    else if (hay.includes(q)) score = 20;
    if (score >= 0) scored.push({ c, score });
  }
  // Stable order within equal scores: preserve group-then-id declaration order.
  scored.sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));
  return scored.slice(0, limit).map((s) => s.c);
}

/** Group commands for display, preserving the registry's group order. */
export const GROUP_ORDER: CommandGroup[] = [
  "Actions",
  "Go",
  "Approvals",
  "Models & Providers",
  "Workspace",
  "Skills",
  "MCP",
  "Plugins",
  "Runs",
  "Settings",
];

export function groupCommands(cmds: Command[]): Array<{ group: string; items: Command[] }> {
  const byGroup = new Map<string, Command[]>();
  for (const c of cmds) {
    if (!byGroup.has(c.group)) byGroup.set(c.group, []);
    byGroup.get(c.group)!.push(c);
  }
  const ordered: Array<{ group: string; items: Command[] }> = [];
  for (const g of GROUP_ORDER) if (byGroup.has(g)) ordered.push({ group: g, items: byGroup.get(g)! });
  for (const [g, items] of byGroup) if (!GROUP_ORDER.includes(g as CommandGroup)) ordered.push({ group: g, items });
  return ordered;
}
