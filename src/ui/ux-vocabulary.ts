/**
 * Phase 12 — shared UX vocabulary.
 *
 * One identity across CLI / TUI / Dashboard / Chat. Surfaces present these
 * words; they do not invent a second status model. Backend execution remains
 * the source of truth — this module is labels, not state.
 *
 * Spec: docs/ux/XR_UX_ARCHITECTURE.md
 */

import { BRAND_META } from "./tokens.ts";

/** Canonical product identity. Never substitute a provider's name. */
export const XR_IDENTITY = {
  name: BRAND_META.name,
  tagline: BRAND_META.tagline,
  productLine: BRAND_META.productLine,
  voice: BRAND_META.voice,
} as const;

/**
 * Operating modes — ONE word per mode on every surface.
 * Dashboard historically painted "Ask/Plan/Research/Agent"; Research is a
 * composer flag (web tools), not a mode. The runtime Mode is agent|plan|ask.
 */
export const MODE_WORDS = ["ask", "plan", "agent"] as const;
export type ModeWord = (typeof MODE_WORDS)[number];

export function canonicalMode(raw: string | undefined | null): ModeWord {
  const x = String(raw ?? "").trim().toLowerCase();
  if (x === "agent") return "agent";
  if (x === "plan") return "plan";
  return "ask";
}

export function modeLabel(mode: ModeWord): string {
  if (mode === "agent") return "Agent";
  if (mode === "plan") return "Plan";
  return "Ask";
}

/**
 * Truthful run-status labels. Never "Loading…" for a long-running turn.
 * Keys match ChatStreamEvent.status plus a few UI-only composites.
 */
export const STREAM_STATUS_LABEL: Record<string, string> = {
  preparing: "Preparing",
  provider_selection: "Selecting provider",
  provider_ready: "Generating",
  generating: "Generating",
  running_tool: "Running tool",
  searching_web: "Searching web",
  reading_source: "Reading source",
  waiting_for_approval: "Waiting for approval",
  retrying: "Retrying",
  switching_provider: "Switching provider",
  compacting: "Compacting context",
  finishing: "Finishing",
  cancelled: "Cancellation requested",
  blocked: "Blocked by XR Shield",
  done: "Done",
  error: "Failed",
};

export function streamStatusLabel(status: string | undefined | null): string {
  if (!status) return STREAM_STATUS_LABEL.preparing!;
  return STREAM_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

/** Shown while Esc/Ctrl+C has been pressed but the loop has not yet stopped. */
export const CANCELLATION_BUSY_LABEL =
  "cancellation requested — waiting for checkpoint";

export const CANCELLATION_USER_COPY =
  "Cancellation requested. Waiting for a safe checkpoint…";

/** Locality words — same as dashboard badges and TUI status bar. */
export const LOCALITY_WORDS = ["LOCAL", "CLOUD", "OFFLINE", "SETUP"] as const;
export type LocalityWord = (typeof LOCALITY_WORDS)[number];

/** Security chip copy. Colour is never the only channel. */
export const SECURITY_COPY = {
  protected: "Protected",
  hardened: "Hardened",
  blocked: "Blocked by XR Shield",
  inspect: "Inspect policy",
} as const;

/**
 * Summarize tool arguments for chrome. Never dump secrets or giant blobs.
 * Prefer a single identifying field (path/url/query/command).
 */
export function summarizeToolArgs(args: unknown, max = 72): string {
  if (args == null) return "";
  if (typeof args === "string") {
    return args.length > max ? `${args.slice(0, max)}…` : args;
  }
  if (typeof args !== "object") return String(args);
  const rec = args as Record<string, unknown>;
  const prefer = ["path", "file", "query", "url", "command", "cmd", "target", "name", "id"];
  for (const k of prefer) {
    const v = rec[k];
    if (typeof v === "string" && v.length > 0) {
      return v.length > max ? `${v.slice(0, max)}…` : v;
    }
  }
  try {
    const json = JSON.stringify(args);
    if (!json || json === "{}") return "";
    return json.length > max ? `${json.slice(0, max)}…` : json;
  } catch {
    return "";
  }
}

/** Tools whose results are cited as sources, not generic tool cards. */
export const SOURCE_TOOL_NAMES = new Set([
  "web_search",
  "fetch_url",
  "research_search",
  "research_scrape",
  "research_crawl",
  "research_map",
  "research_extract",
]);

export function isSourceTool(name: string | undefined | null): boolean {
  const n = String(name ?? "");
  if (SOURCE_TOOL_NAMES.has(n)) return true;
  return /search|scrape|crawl|fetch_url|research/i.test(n);
}

/**
 * Keyboard contract shared by TUI and Dashboard.
 * Platform: Ctrl on Windows/Linux, Cmd (metaKey) on macOS — both bound.
 */
export const SHORTCUTS = {
  palette: "Ctrl+K",
  paletteMac: "⌘K",
  provider: "Alt+P",
  interrupt: "Esc",
  send: "Enter",
  newline: "Shift+Enter",
  help: "?",
  commandMode: "/",
  agentDetail: "Ctrl+T",
  modeCycle: "Shift+Tab",
} as const;

/** Empty-state teaching copy. Never "No data." */
export const EMPTY_COPY = {
  sessions: {
    heading: "No sessions yet.",
    action: "Start your first task — ask XR to analyze this repository.",
  },
  memory: {
    heading: "No memory yet.",
    action: "Memory appears as XR learns durable context you ask it to keep.",
  },
  research: {
    heading: "No research yet.",
    action: 'Ask XR to research a topic, or run: xr research "…"',
  },
  tools: {
    heading: "No tool activity yet.",
    action: "Tool calls appear here when XR reads, writes, or searches.",
  },
  approvals: {
    heading: "No pending authorizations.",
    action: "Dangerous tools pause here. The model cannot approve itself.",
  },
} as const;

export const ERROR_COPY = {
  genericForbidden: "Something went wrong.",
  timeout: (ms: number) => `Provider request timed out after ${(ms / 1000).toFixed(1)}s.`,
  fallback: "XR switched to the configured fallback provider.",
  blocked: "Tool execution was blocked by workspace policy. No changes were made.",
  offline: "Provider unreachable. Try /model or start a local runtime.",
} as const;
