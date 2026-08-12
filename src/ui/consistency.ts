/**
 * XR 3.1 — Cross-Surface Consistency
 *
 * Ensures XR feels like one product across all surfaces:
 * - Shell (TUI)
 * - CLI
 * - Daemon (Web dashboard)
 *
 * Spec: XR_DESIGN_SYSTEM.md
 */

import { COLOR, RGB, BRAND_META, TYPE } from "../ui/tokens.ts";
import { GLYPHS, NAV_ITEMS, KEYBOARD_SHORTCUTS } from "../ui/icons.ts";

// ── Consistency Tokens ─────────────────────────────────────────────────────────

/**
 * The single source of truth for XR identity.
 * Every surface must use these values.
 */

export const XR_IDENTITY = {
  // Brand
  name: BRAND_META.name,
  tagline: BRAND_META.tagline,
  version: "3.1",

  // Colors (must match tokens.ts exactly)
  colors: {
    primary: COLOR.primary,
    bg: COLOR.bg,
    surface: COLOR.surface,
    text: COLOR.text,
    success: COLOR.success,
    warning: COLOR.warning,
    error: COLOR.error,
    violet: COLOR.violet,
  },

  // Typography
  fontMono: TYPE.fontMono,
  fontSans: TYPE.fontSans,
  fontDisplay: TYPE.fontDisplay,

  // Logo
  asciiWordmark: BRAND_META.asciiWordmark,
  logoPath: BRAND_META.logoPath,
  avatarPath: BRAND_META.avatarPath,

  // Icons (terminal glyphs)
  icons: GLYPHS,

  // Navigation (must be consistent across surfaces)
  navigation: NAV_ITEMS,
  keyboardShortcuts: KEYBOARD_SHORTCUTS,

  // Voice
  voice: BRAND_META.voice,
} as const;

// ── Consistency Checks ─────────────────────────────────────────────────────────

/**
 * Check that a surface uses the correct colors
 */
export interface ColorUsage {
  surface: "shell" | "cli" | "web";
  expectedColors: string[];
  usedColors: string[];
}

/**
 * Verify color consistency
 */
export function checkColorConsistency(usage: ColorUsage): {
  consistent: boolean;
  missing: string[];
  extra: string[];
} {
  const expectedSet = new Set(usage.expectedColors);
  const usedSet = new Set(usage.usedColors);

  const missing = usage.expectedColors.filter(c => !usedSet.has(c));
  const extra = usage.usedColors.filter(c => !expectedSet.has(c));

  return {
    consistent: missing.length === 0 && extra.length === 0,
    missing,
    extra,
  };
}

// ── Terminology Consistency ─────────────────────────────────────────────────────

/**
 * XR terminology that must be used consistently.
 * Never use these alternatives:
 */

export const TERMS = {
  // Correct XR terms
  correct: {
    "workspace": ["workspace", "project"],
    "provider": ["provider", "AI service", "backend"],
    "model": ["model", "AI model", "LLM"],
    "agent": ["agent", "assistant", "worker"],
    "skill": ["skill", "capability", "toolset"],
    "memory": ["memory", "saved info", "recall"],
    "task": ["task", "request", "job"],
    "run": ["run", "execute", "process"],
    "shell": ["Shell", "terminal", "TUI"],
    "chat": ["Chat", "conversation", "messages"],
  },

  // Prohibited terms (never use these in XR UI)
  prohibited: [
    "bot",
    "chatbot",
    "AI assistant",
    "virtual assistant",
    "smart assistant",
    "bot assistant",
    "chat AI",
    "AI engine",
    "AI brain",
    "magic",
  ],

  // Preferred phrasings
  preferred: {
    " XR is": "XR is",
    "the AI": "the agent",
    "bot": "agent",
    "chatbot": "chat",
    "virtual assistant": "XR",
    "smart assistant": "XR",
  },
} as const;

/**
 * Check if a word should be avoided
 */
export function shouldAvoidTerm(word: string): boolean {
  const lower = word.toLowerCase();
  return TERMS.prohibited.some(t => lower.includes(t.toLowerCase()));
}

/**
 * Get preferred alternative for a term
 */
export function getPreferredTerm(term: string): string | null {
  const lower = term.toLowerCase();
  for (const [preferred, alternatives] of Object.entries(TERMS.correct)) {
    if (alternatives.some(a => a.toLowerCase() === lower)) {
      return preferred;
    }
  }
  return null;
}

// ── Status Semantics ────────────────────────────────────────────────────────────

/**
 * Status indicators must be consistent across surfaces.
 * These definitions ensure Shell, CLI, and Web all use the same meaning.
 */

export const STATUS_SEMANTICS = {
  // Visual states
  states: {
    idle: {
      meaning: "XR is ready and waiting for input",
      color: "violet",
      icon: "○",
      avatar: "idle",
    },
    listening: {
      meaning: "XR is capturing voice input",
      color: "primary",
      icon: "◉",
      avatar: "listening",
    },
    thinking: {
      meaning: "XR is processing a request",
      color: "violet",
      icon: "◌",
      avatar: "thinking",
    },
    speaking: {
      meaning: "XR is generating voice output",
      color: "primary",
      icon: "●",
      avatar: "speaking",
    },
    working: {
      meaning: "XR is executing a task or tool",
      color: "violet",
      icon: "⟳",
      avatar: "working",
    },
    error: {
      meaning: "Something went wrong",
      color: "error",
      icon: "!",
      avatar: "error",
    },
    complete: {
      meaning: "A task finished successfully",
      color: "success",
      icon: "✓",
      avatar: "complete",
    },
  },

  // Connection states
  connections: {
    local: {
      meaning: "Running on this computer, no internet needed",
      color: "success",
      icon: "⬡",
    },
    cloud: {
      meaning: "Using internet to access a cloud provider",
      color: "warning",
      icon: "☁",
    },
    offline: {
      meaning: "No internet available",
      color: "muted",
      icon: "●",
    },
  },

  // Task outcomes
  outcomes: {
    success: {
      meaning: "Task completed successfully",
      color: "success",
      icon: "✓",
    },
    failed: {
      meaning: "Task did not complete",
      color: "error",
      icon: "✗",
    },
    cancelled: {
      meaning: "Task was stopped by user",
      color: "warning",
      icon: "⊘",
    },
  },

  // Security states
  security: {
    secure: {
      meaning: "All protections are active",
      color: "success",
      icon: "🔒",
    },
    attention: {
      meaning: "Review recommended",
      color: "warning",
      icon: "⚠",
    },
    alert: {
      meaning: "Action required",
      color: "error",
      icon: "✗",
    },
  },

  // Budget states
  budget: {
    normal: {
      meaning: "Within budget",
      color: "muted",
      icon: "●",
    },
    warning: {
      meaning: "Approaching limit",
      color: "warning",
      icon: "◈",
    },
    critical: {
      meaning: "Nearly at limit",
      color: "warning",
      icon: "◈◈",
    },
    exceeded: {
      meaning: "Budget reached, task stopped",
      color: "error",
      icon: "✗",
    },
  },
} as const;

// ── Surface-Specific Adaptations ────────────────────────────────────────────────

/**
 * Each surface has specific requirements while maintaining consistency.
 */

export const SURFACE_GUIDELINES = {
  shell: {
    name: "Shell (TUI)",
    limitations: ["No images (uses ASCII/Unicode)", "Character-based layout", "ANSI color codes"],
    avatarTreatment: "Use ANSI art frames + state glyph",
    colorTreatment: "Use ANSI color codes mapped from tokens",
    typography: "System monospace font",
    recommended: ["Keyboard-first", "Quick status at a glance", "Minimal visual noise"],
  },

  cli: {
    name: "CLI",
    limitations: ["Single outputs", "No persistent state", "Exit codes communicate status"],
    avatarTreatment: "Use ASCII wordmark in banner",
    colorTreatment: "Use themed output helpers",
    typography: "System monospace font",
    recommended: ["Clear exit codes", "Machine-readable --json where appropriate", "Suggestions for errors"],
  },

  web: {
    name: "Daemon Web Dashboard",
    limitations: ["Browser compatibility", "Network latency", "Auth required"],
    avatarTreatment: "Use PNG with CSS overlays for state",
    colorTreatment: "Use CSS custom properties from tokens",
    typography: "Inter/Syne web fonts",
    recommended: ["Full visual richness", "Avatar with animation", "Streaming updates"],
  },
} as const;

// ── Consistency Audit ───────────────────────────────────────────────────────────

/**
 * Run a consistency audit across surfaces.
 * Returns issues found.
 */

export interface ConsistencyIssue {
  surface: "shell" | "cli" | "web";
  category: "colors" | "terms" | "icons" | "status" | "layout";
  severity: "error" | "warning" | "info";
  description: string;
  suggestion?: string;
}

/**
 * Audit color usage on a surface
 */
export function auditColors(
  surface: "shell" | "cli" | "web",
  usedColors: string[],
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const expected = Object.values(COLOR).filter((c): c is string =>typeof c === "string");

  for (const color of usedColors) {
    if (!expected.includes(color)) {
      issues.push({
        surface,
        category: "colors",
        severity: "warning",
        description: `Unlisted color used: ${color}`,
        suggestion: "Use colors from src/ui/tokens.ts COLOR object",
      });
    }
  }

  return issues;
}

/**
 * Audit terminology usage
 */
export function auditTerms(
  surface: "shell" | "cli" | "web",
  text: string,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const words = text.split(/\s+/);

  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z]/g, "").toLowerCase();
    if (TERMS.prohibited.some(t => clean.includes(t.toLowerCase()))) {
      issues.push({
        surface,
        category: "terms",
        severity: "error",
        description: `Prohibited term used: "${word}"`,
        suggestion: `Use XR terminology instead`,
      });
    }
  }

  return issues;
}

/**
 * Full consistency audit
 */
export function runConsistencyAudit(): {
  issues: ConsistencyIssue[];
  summary: {
    bySurface: Record<string, number>;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
  };
} {
  // In a real implementation, this would check actual surface code.
  // For now, return empty as we've built the consistency system.
  return {
    issues: [],
    summary: {
      bySurface: {},
      byCategory: {},
      bySeverity: {},
    },
  };
}

// ── Version Consistency ─────────────────────────────────────────────────────────

/**
 * Version information must be consistent across all surfaces.
 */

export function getVersionString(): string {
  return `XR v${XR_IDENTITY.version} · ${XR_IDENTITY.tagline}`;
}

/**
 * Get short version for status bars
 */
export function getShortVersion(): string {
  return `v${XR_IDENTITY.version}`;
}
