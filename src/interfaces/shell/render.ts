/**
 * XR 3.1 Shell — frame renderer (ENHANCED)
 * Assembles header · sidebar · main · inspector · composer · status
 *
 * Enhancements:
 * - Avatar presence in header and sidebar
 * - State visualization
 * - Improved visual hierarchy
 */

import { xrBold, xrCyan, xrDim, xrGreen, xrAmber, xrRed, xrViolet } from "../../ui/theme.ts";
import { padAnsi, clipAnsi, hline, visibleLength, wrapAnsi } from "../../ui/ansi.ts";
import {
  badge, statusDot, spinnerFrame, emptyState, listRow, sectionHeader,
  navItem, composerPrompt, statusBar, overlayFrame, helpBindings,
  messagePrefix, card, keyHintRow, toastLine, progressBar, modePaint,
} from "../../ui/primitives.ts";
import { SHELL_VIEW_ORDER, NAV_ITEMS, SECTION_LABELS, icon, type GlyphId } from "../../ui/icons.ts";
import { renderCompactAvatar, renderHeaderAvatar, renderLargeAvatar, type AvatarState } from "../../ui/avatar.ts";
import { isLocal } from "../../cost/pricing.ts";
import type { ShellState, ChatMessage, Severity } from "./types.ts";
import type { LayoutGeom } from "./layout.ts";

// ── Avatar-aware Header ──────────────────────────────────────────────────────

export function renderHeader(state: ShellState, cols: number): string[] {
  const brand = `${xrBold(xrCyan("XR"))}${xrDim(" · ")}${xrCyan("AI Operating System")}`;
  const right = xrDim(`v3.1`);
  const gap = Math.max(1, cols - visibleLength(brand) - visibleLength(right));
  const line1 = clipAnsi(brand + " ".repeat(gap) + right, cols);

  const ws = xrCyan(state.workspaceId);
  const sess = xrDim(state.sessionTitle || "new session");

  // Avatar state indicator integrated into header
  const avatarLines = renderHeaderAvatar(state.avatarState);

  // Build mode indicator with avatar context
  const mode = modePaint(state.mode);

  // Line 2: workspace · session · mode · avatar state
  const avatarIndicator = state.avatarState !== "idle"
    ? `${ xrDim("·") } ${ renderCompactAvatar(state.avatarState, state.avatarStateLabel()) }`
    : "";

  const line2 = clipAnsi(
    `${xrDim("workspace")} ${ws}  ${xrDim("›")}  ${sess}  ${xrDim("·")}  ${mode}${avatarIndicator}`,
    cols,
  );

  // Return lines: brand line, then avatar lines + mode info
  if (avatarLines.length >= 2 && cols >= 80) {
    // Integrated avatar display in header (when space allows)
    const avatarLine = clipAnsi(
      `${avatarLines[0]}   ${xrDim("workspace")} ${ws}  ${xrDim("›")}  ${sess}`,
      cols,
    );
    const modeLine = clipAnsi(
      `${avatarLines[1]}   ${mode}  ${state.provider} / ${state.model}`,
      cols,
    );
    return [line1, avatarLine, modeLine];
  }

  return [line1, line2];
}

// ── Avatar-enhanced Sidebar ──────────────────────────────────────────────────

export function renderSidebar(state: ShellState, width: number, height: number, iconOnly: boolean): string[] {
  const rows: string[] = [];

  if (!iconOnly) {
    // Avatar + brand header
    const avatarArt = renderCompactAvatar(state.avatarState);
    rows.push(padAnsi(clipAnsi(`${avatarArt}  ${xrBold("XR")}`, width), width));
    rows.push(padAnsi(xrDim("Shell"), width));
    rows.push(padAnsi(xrDim(""), width)); // spacer
  } else {
    rows.push(padAnsi(xrCyan("XR"), width));
    rows.push(padAnsi(renderCompactAvatar(state.avatarState), width));
    rows.push(padAnsi("", width));
  }

  let lastSection = "";
  for (const viewId of SHELL_VIEW_ORDER) {
    const def = NAV_ITEMS.find((n) => n.id === viewId) ?? {
      id: viewId, label: viewId, glyph: "status" as GlyphId, section: "workspace" as const,
    };
    if (!iconOnly && def.section !== lastSection) {
      lastSection = def.section;
      rows.push(padAnsi(sectionHeader(SECTION_LABELS[def.section]), width));
    }
    const idx = SHELL_VIEW_ORDER.indexOf(viewId);
    const active = state.view === viewId;
    const focused = state.focus === "sidebar" && state.sidebarIndex === idx;

    // Enhanced nav item with avatar state context
    const avatarBadge = active && state.avatarState !== "idle"
      ? xrDim(` [${state.avatarState}]`)
      : "";

    rows.push(navItem(def.glyph, def.label + avatarBadge, { active, focused, width, iconOnly }));
  }

  // Provider pill at bottom — always show active model + how to change
  while (rows.length < height - 4) rows.push(padAnsi("", width));

  const conn = isLocal(state.provider) ? statusDot("local") : statusDot("cloud");

  // Avatar presence in sidebar footer
  const avatarFooter = iconOnly
    ? ""
    : `${ renderCompactAvatar(state.avatarState, "XR") }`;

  if (!iconOnly) {
    rows.push(padAnsi(clipAnsi(`${conn} ${state.provider}`, width), width));
    rows.push(padAnsi(clipAnsi(xrDim(state.model), width), width));
    rows.push(padAnsi(clipAnsi(`${avatarFooter}  ${xrDim("Alt+P change model")}`, width), width));
  } else {
    rows.push(padAnsi(conn, width));
    rows.push(padAnsi(xrDim("M"), width));
    rows.push(padAnsi(xrDim("?"), width));
  }

  while (rows.length < height) rows.push(padAnsi("", width));
  return rows.slice(0, height);
}

// ── Avatar-aware Home View ───────────────────────────────────────────────────

function renderHome(state: ShellState, width: number, height: number): string[] {
  const lines: string[] = [];

  // Welcome with avatar
  const avatarLines = renderLargeAvatar(state.avatarState, "XR");
  const brand = `${avatarLines[0]}  ${xrBold("XR")}`;

  lines.push(clipAnsi(brand, width));
  lines.push(clipAnsi(avatarLines[1] + `  ${xrDim("—")} ${xrCyan("one operating system")}`, width));
  lines.push(clipAnsi(xrDim("composer · status · palette · everywhere"), width));
  lines.push("");

  // Sessions card
  const sessions = state.sessions.slice(0, 5).map((s) =>
    `${xrDim(humanDate(s.created_at))} ${s.title.slice(0, 28)} ${xrDim("(")}${modePaint(s.mode)}${xrDim(")")}`,
  );
  lines.push(...card("Recent sessions", sessions.length ? sessions : [xrDim("No sessions yet — ask XR anything")], Math.min(width, 56), state.avatarState));
  lines.push("");

  // Workspaces card
  const ws = state.wm.listWorkspaces().slice(0, 5).map((w) =>
    `${w.id === state.workspaceId ? xrGreen("●") : xrDim("○")} ${w.id} ${xrDim(w.name)}`,
  );
  lines.push(...card("Workspaces", ws, Math.min(width, 56), state.avatarState));
  lines.push("");
  lines.push(keyHintRow([
    ["Ctrl+K", "palette"],
    ["g c", "chat"],
    ["/", "compose"],
    ["?", "help"],
  ], width));

  // Avatar status indicator
  if (state.avatarState !== "idle") {
    lines.push("");
    lines.push(clipAnsi(
      `${renderCompactAvatar(state.avatarState, "XR is")} ${state.avatarStateLabel()}`,
      width,
    ));
  }

  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

// ── Avatar-aware Chat View ───────────────────────────────────────────────────

function renderChat(state: ShellState, width: number, height: number): string[] {
  const lines: string[] = [];

  // Chat header with avatar state
  const avatarIndicator = state.avatarState !== "idle"
    ? `  ${renderCompactAvatar(state.avatarState, state.avatarStateLabel())}`
    : "";

  lines.push(clipAnsi(
    `${xrBold("Chat")}${xrDim(" · ")}${state.sessionTitle || "new session"}${xrDim(" · ")}${state.mode}${avatarIndicator}`,
    width,
  ));
  lines.push(xrDim(hline(Math.max(10, width - 2))));

  const usable = Math.max(20, width - 2);
  const messages = state.chat.slice(-40);
  const rendered: string[] = [];

  for (const msg of messages) {
    // Avatar prefix for XR messages
    const head = `${messagePrefix(msg.role)}${msg.role === "assistant" ? " " + renderCompactAvatar(state.avatarState, "XR") : ""} ${xrDim(humanTime(msg.at))}${msg.meta ? xrDim(` · ${msg.meta}`) : ""}`;

    rendered.push(head);
    for (const w of wrapAnsi(msg.content, usable - 2)) rendered.push(`  ${w}`);
    rendered.push("");
  }

  // Scroll from bottom
  const start = Math.max(0, rendered.length - (height - 2) - state.chatScroll);
  const window = rendered.slice(start, start + height - 2);
  lines.push(...window);

  // Avatar status bar at bottom of chat (when busy)
  if (state.busy || state.avatarState !== "idle") {
    lines.push("");
    lines.push(clipAnsi(
      `${renderCompactAvatar(state.avatarState, state.avatarStateLabel())} ${state.busyLabel || state.avatarStateLabel()}`,
      width,
    ));
  }

  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

// ── Sessions View ────────────────────────────────────────────────────────────

function renderSessions(state: ShellState, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push(`${xrBold("Sessions")}${xrDim(" · resume, inspect, export")}`);
  lines.push(xrDim(hline(Math.max(10, width - 2))));

  if (!state.sessions.length) {
    lines.push(...emptyState("No sessions yet", "Ask XR anything to start one", "press / to focus composer"));
  } else {
    for (const [i, s] of state.sessions.entries()) {
      lines.push(listRow(s.title.slice(0, 34), {
        selected: i === state.sessionIndex && state.focus === "main",
        meta: `#${s.id} · ${s.mode} · ${s.status} · ${humanDate(s.created_at)}`,
        width,
      }));
    }
  }

  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

// ── Workspaces View ──────────────────────────────────────────────────────────

function renderWorkspaces(state: ShellState, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push(`${xrBold("Workspaces")}${xrDim(" · isolated context, memory, audit")}`);
  lines.push(xrDim(hline(Math.max(10, width - 2))));

  for (const [i, ws] of state.wm.listWorkspaces().entries()) {
    lines.push(listRow(ws.id, {
      selected: i === state.workspaceIndex && state.focus === "main",
      active: ws.id === state.workspaceId,
      meta: `${ws.name} · ${ws.rootDir}`,
      width,
    }));
  }
  lines.push("");
  lines.push(xrDim("Ctrl+W reopen picker · xr workspace create <id>"));

  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

// ── Research View ────────────────────────────────────────────────────────────

function renderResearch(state: ShellState, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push(`${xrBold("Research")}${xrDim(" · citable reports")}`);
  lines.push(xrDim(hline(Math.max(10, width - 2))));

  if (!state.research.length) {
    lines.push(...emptyState("No research yet", "Ask XR to research something", "xr research <query>"));
  } else {
    for (const [i, r] of state.research.entries()) {
      lines.push(listRow(r.title.slice(0, 38), {
        selected: i === state.researchIndex && state.focus === "main",
        meta: `#${r.id} · ${humanDate(r.created_at)} · ${r.sourceCount} sources`,
        width,
      }));
    }
  }

  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function humanTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function humanDate(ts: number): string {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function timelineIcon(level: Severity): string {
  return level === "ok" ? xrGreen("✓") : level === "warn" ? xrAmber("!") : level === "error" ? xrRed("✗") : xrCyan("·");
}

// ── Card with avatar context ─────────────────────────────────────────────────

function card(title: string, items: string[], width: number, avatarState: AvatarState): string[] {
  const lines: string[] = [];
  const titleColor = avatarState === "error" ? xrRed
    : avatarState === "complete" ? xrGreen
    : avatarState === "working" ? xrViolet
    : xrCyan;

  lines.push(padAnsi(clipAnsi(titleColor(`┌─ ${title}`), width), width));
  lines.push(padAnsi(clipAnsi(xrDim("│"), width), width));

  for (const item of items) {
    lines.push(padAnsi(clipAnsi(`│  ${item}`, width), width));
  }

  lines.push(padAnsi(clipAnsi(`└${hline(Math.max(2, width - 6))}`, width), width));

  return lines;
}

// ── Export avatar helpers for external use ───────────────────────────────────

export { renderCompactAvatar, renderHeaderAvatar, renderLargeAvatar, getWebAvatarConfig, avatarStateLabel, isStateActive, avatarAnimationHint, type AvatarState, type AvatarRenderOptions } from "../../ui/avatar.ts";
