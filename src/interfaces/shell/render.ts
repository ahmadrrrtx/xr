/**
 * XR 3.1 Shell — frame renderer
 * Assembles header · sidebar · main · inspector · composer · status
 */

import { xrBold, xrCyan, xrDim, xrGreen, xrAmber, xrRed, xrViolet } from "../../ui/theme.ts";
import { padAnsi, clipAnsi, hline, visibleLength, wrapAnsi } from "../../ui/ansi.ts";
import {
  badge, statusDot, spinnerFrame, emptyState, listRow, sectionHeader,
  navItem, composerPrompt, statusBar, overlayFrame, helpBindings,
  messagePrefix, card, keyHintRow, toastLine, progressBar,
} from "../../ui/primitives.ts";
import { SHELL_VIEW_ORDER, NAV_ITEMS, SECTION_LABELS, icon, type GlyphId } from "../../ui/icons.ts";
import { renderOfficialBannerFrame, renderCompactBrand } from "../../ui/brand.ts";
import { isLocal } from "../../cost/pricing.ts";
import type { ShellState, ChatMessage, Severity } from "./types.ts";
import type { LayoutGeom } from "./layout.ts";
import { loadConfig } from "../../config/config.ts";
import { MemoryStore } from "../../memory/store.ts";

function humanTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function humanDate(ts: number): string {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function timelineIcon(level: Severity): string {
  return level === "ok" ? xrGreen("✓") : level === "warn" ? xrAmber("!") : level === "error" ? xrRed("✗") : xrCyan("·");
}

// ── Header ────────────────────────────────────────────────────────────────────

export function renderHeader(state: ShellState, cols: number): string[] {
  const brand = `${xrBold(xrCyan("XR"))}${xrDim(" · ")}${xrCyan("AI Operating System")}`;
  const right = xrDim(`v3.1`);
  const gap = Math.max(1, cols - visibleLength(brand) - visibleLength(right));
  const line1 = clipAnsi(brand + " ".repeat(gap) + right, cols);

  const ws = xrCyan(state.workspaceId);
  const sess = xrDim(state.sessionTitle || "new session");
  const mode = state.mode === "agent" ? xrCyan("agent") : state.mode === "plan" ? xrViolet("plan") : xrDim("ask");
  const line2 = clipAnsi(
    `${xrDim("workspace")} ${ws}  ${xrDim("›")}  ${sess}  ${xrDim("·")}  ${mode}`,
    cols,
  );
  return [line1, line2];
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function renderSidebar(state: ShellState, width: number, height: number, iconOnly: boolean): string[] {
  const rows: string[] = [];
  if (!iconOnly) {
    const brand = renderCompactBrand();
    rows.push(padAnsi(clipAnsi(`${brand[0]} ${xrBold("XR")}`, width), width));
    rows.push(padAnsi(xrDim("Shell"), width));
  } else {
    rows.push(padAnsi(xrCyan("XR"), width));
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
    rows.push(navItem(def.glyph, def.label, { active, focused, width, iconOnly }));
  }

  // Provider pill at bottom — always show active model + how to change
  while (rows.length < height - 3) rows.push(padAnsi("", width));
  const conn = isLocal(state.provider) ? statusDot("local") : statusDot("cloud");
  if (!iconOnly) {
    rows.push(padAnsi(clipAnsi(`${conn} ${state.provider}`, width), width));
    rows.push(padAnsi(clipAnsi(xrDim(state.model), width), width));
    rows.push(padAnsi(clipAnsi(xrDim("Alt+P change model"), width), width));
  } else {
    rows.push(padAnsi(conn, width));
    rows.push(padAnsi(xrDim("M"), width));
    rows.push(padAnsi(xrDim("?"), width));
  }
  while (rows.length < height) rows.push(padAnsi("", width));
  return rows.slice(0, height);
}

// ── Main views ────────────────────────────────────────────────────────────────

function renderHome(state: ShellState, width: number, height: number): string[] {
  const lines: string[] = [];
  const brand = renderCompactBrand();
  lines.push(`${brand[0]}  ${xrBold("XR")}${xrDim(" — ")}${xrCyan("one operating system")}`);
  lines.push(`${brand[1]}  ${xrDim("composer · status · palette · everywhere")}`);
  lines.push("");

  const sessions = state.sessions.slice(0, 5).map((s) =>
    `${xrDim(humanDate(s.created_at))} ${s.title.slice(0, 28)} ${xrDim(`(${s.mode})`)}`,
  );
  lines.push(...card("Recent sessions", sessions.length ? sessions : [xrDim("No sessions yet — ask XR anything")], Math.min(width, 56)));
  lines.push("");

  const ws = state.wm.listWorkspaces().slice(0, 5).map((w) =>
    `${w.id === state.workspaceId ? xrGreen("●") : xrDim("○")} ${w.id} ${xrDim(w.name)}`,
  );
  lines.push(...card("Workspaces", ws, Math.min(width, 56)));
  lines.push("");
  lines.push(keyHintRow([
    ["Ctrl+K", "palette"],
    ["g c", "chat"],
    ["/", "compose"],
    ["?", "help"],
  ], width));

  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderChat(state: ShellState, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push(`${xrBold("Chat")}${xrDim(" · ")}${state.sessionTitle || "new session"}${xrDim(" · ")}${state.mode}`);
  lines.push(xrDim(hline(Math.max(10, width - 2))));

  const usable = Math.max(20, width - 2);
  const messages = state.chat.slice(-40);
  const rendered: string[] = [];
  for (const msg of messages) {
    const head = `${messagePrefix(msg.role)} ${xrDim(humanTime(msg.at))}${msg.meta ? xrDim(` · ${msg.meta}`) : ""}`;
    rendered.push(head);
    for (const w of wrapAnsi(msg.content, usable - 2)) rendered.push(`  ${w}`);
    rendered.push("");
  }
  // scroll from bottom
  const start = Math.max(0, rendered.length - (height - 2) - state.chatScroll);
  const window = rendered.slice(start, start + height - 2);
  lines.push(...window);
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

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

function renderResearch(state: ShellState, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push(`${xrBold("Research")}${xrDim(" · citable reports")}`);
  lines.push(xrDim(hline(Math.max(10, width - 2))));
  if (!state.research.length) {
    lines.push(...emptyState("No research runs yet", "Use /research or: xr research \"topic\"", "open Control Center for full report UI"));
  } else {
    for (const r of state.research) {
      lines.push(`  ${xrCyan("◆")} ${r.topic.slice(0, 40)} ${xrDim(`${r.depth}/${r.status} · ${humanDate(r.updated_at)}`)}`);
    }
  }
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderActivity(state: ShellState, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push(`${xrBold("Activity")}${xrDim(" · tool timeline & metrics")}`);
  lines.push(xrDim(hline(Math.max(10, width - 2))));
  lines.push(`${xrDim("agent")} ${state.busy ? spinnerFrame(state.spinnerIndex, state.busyLabel) : xrDim("idle")}`);
  lines.push(`${xrDim("spend")} $${state.totalSpent.toFixed(4)}  ${xrDim("tokens")} ${state.totalTokens.toLocaleString()}`);
  lines.push("");
  for (const e of state.timeline.slice(0, height - 6)) {
    lines.push(`${timelineIcon(e.level)} ${xrDim(humanTime(e.at))} ${e.title}`);
    if (e.detail) lines.push(`  ${clipAnsi(e.detail, width - 4)}`);
  }
  if (!state.timeline.length) lines.push(...emptyState("No activity yet", "Run a task to see the timeline"));
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderAudit(state: ShellState, width: number, height: number): string[] {
  const entries = state.store.recentAudit(16);
  const lines: string[] = [];
  const chain = state.auditValid == null ? xrDim("…") : state.auditValid ? xrGreen("✓ chain intact") : xrRed("✗ chain broken");
  lines.push(`${xrBold("Audit Log")}  ${chain}`);
  lines.push(xrDim(hline(Math.max(10, width - 2))));
  if (!entries.length) {
    lines.push(...emptyState("No audit entries yet", "Actions you take will appear here"));
  } else {
    for (const e of entries) {
      lines.push(`${xrDim(humanDate(e.created_at))} ${xrBold(e.event)}`);
      lines.push(`  ${clipAnsi(String(e.detail).replace(/\s+/g, " "), width - 4)}`);
    }
  }
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderMemory(state: ShellState, width: number, height: number): string[] {
  const mem = new MemoryStore(state.store);
  const entries = mem.list().slice(0, 12);
  const lines: string[] = [];
  lines.push(`${xrBold("Memory")}${xrDim(" · durable knowledge")}`);
  lines.push(xrDim(hline(Math.max(10, width - 2))));
  if (!entries.length) {
    lines.push(...emptyState("No memory entries", "Say \"remember …\" or use xr memory add"));
  } else {
    for (const e of entries) {
      lines.push(`  ${xrDim(e.category.padEnd(10))} ${clipAnsi(e.content, width - 16)}`);
    }
  }
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderStatus(state: ShellState, width: number, height: number): string[] {
  const { config } = loadConfig();
  const mem = new MemoryStore(state.store);
  const health = mem.health();
  const lines: string[] = [];
  lines.push(`${xrBold("System status")}`);
  lines.push(xrDim(hline(Math.max(10, width - 2))));
  const rows = [
    ["workspace", state.workspaceId, "cyan"],
    ["cwd", state.cwd, "dim"],
    ["provider", state.provider, isLocal(state.provider) ? "green" : "amber"],
    ["model", state.model, isLocal(state.provider) ? "green" : "amber"],
    ["mode", state.mode, "cyan"],
    ["budget", state.budget > 0 ? `$${state.totalSpent.toFixed(4)} / $${state.budget.toFixed(2)}` : (isLocal(state.provider) ? "local / free" : "uncapped"), "amber"],
    ["memory", config.memory.enabled ? `${health.total} entries` : "disabled", config.memory.enabled ? "green" : "red"],
    ["research", `${state.research.length} recent`, "cyan"],
    ["voice", config.voice.enabled ? config.voice.mode : "off", config.voice.enabled ? "green" : "dim"],
    ["plugins", config.plugins.enabled ? "enabled" : "off", config.plugins.enabled ? "green" : "dim"],
    ["mcp", config.mcpServers.length ? `${config.mcpServers.length} server(s)` : "none", config.mcpServers.length ? "cyan" : "dim"],
    ["audit", state.auditValid ? "intact" : "unknown", state.auditValid ? "green" : "dim"],
    ["agent", state.busy ? state.busyLabel : "idle", state.busy ? "cyan" : "dim"],
  ] as const;
  for (const [k, v, tone] of rows) {
    const val =
      tone === "green" ? xrGreen(v) :
      tone === "amber" ? xrAmber(v) :
      tone === "red" ? xrRed(v) :
      tone === "cyan" ? xrCyan(v) :
      xrDim(v);
    lines.push(`${xrDim(k.padEnd(12))} ${val}`);
  }
  lines.push("");
  lines.push(xrDim("Change model: Alt+P · /model <provider> [model] · xr providers set"));
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

function renderSettings(state: ShellState, width: number, height: number): string[] {
  const { config } = loadConfig();
  const lines: string[] = [];
  lines.push(`${xrBold("Settings")}${xrDim(" · runtime ergonomics (slash or palette to change)")}`);
  lines.push(xrDim(hline(Math.max(10, width - 2))));
  lines.push(`${xrDim("active")}    ${xrCyan(`${state.provider} / ${state.model}`)}`);
  lines.push(`${xrDim("provider")}  ${config.defaults.provider}`);
  lines.push(`${xrDim("model")}     ${config.defaults.model}`);
  lines.push(`${xrDim("fallback")}  ${config.defaults.fallbackProvider
    ? `${config.defaults.fallbackProvider}/${config.defaults.fallbackModel ?? "default"}`
    : "none"}`);
  lines.push(`${xrDim("budget")}    ${config.budget.perTaskUsd > 0 ? `$${config.budget.perTaskUsd}` : "none"}`);
  lines.push(`${xrDim("memory")}    ${config.memory.enabled ? "on" : "off"}`);
  lines.push(`${xrDim("voice")}     ${config.voice.enabled ? config.voice.mode : "off"}`);
  lines.push(`${xrDim("approvals")} ${(config.security.requireApproval ?? []).join(", ") || "none"}`);
  lines.push("");
  lines.push(xrDim("Change model:"));
  lines.push(`  ${xrCyan("/model <provider> [model]")}  ${xrDim("or Alt+P")}`);
  lines.push(`  ${xrCyan("xr providers set <id> [model]")}`);
  lines.push(`  ${xrCyan("xr models set <runtime> <model>")}`);
  lines.push("");
  lines.push(xrDim("Other shortcuts:"));
  lines.push(`  ${xrCyan("/mode agent|plan|ask")}`);
  lines.push(`  ${xrCyan("/budget 0.25")}`);
  lines.push(`  ${xrCyan("xr serve")}  ${xrDim("→ Control Center → Models → Change model")}`);
  while (lines.length < height) lines.push("");
  return lines.slice(0, height);
}

export function renderMain(state: ShellState, width: number, height: number): string[] {
  switch (state.view) {
    case "chat": return renderChat(state, width, height);
    case "sessions": return renderSessions(state, width, height);
    case "workspaces": return renderWorkspaces(state, width, height);
    case "research": return renderResearch(state, width, height);
    case "activity": return renderActivity(state, width, height);
    case "audit": return renderAudit(state, width, height);
    case "memory": return renderMemory(state, width, height);
    case "status": return renderStatus(state, width, height);
    case "settings": return renderSettings(state, width, height);
    case "home":
    default: return renderHome(state, width, height);
  }
}

// ── Inspector ─────────────────────────────────────────────────────────────────

export function renderInspector(state: ShellState, width: number, height: number): string[] {
  const lines: string[] = [];
  lines.push(...card("Inspector", [
    `${xrDim("provider")} ${state.provider}`,
    `${xrDim("model")} ${clipAnsi(state.model, width - 12)}`,
    `${xrDim("workspace")} ${state.workspaceId}`,
    `${xrDim("mode")} ${state.mode}`,
    `${xrDim("spend")} $${state.totalSpent.toFixed(4)}`,
    `${xrDim("tokens")} ${state.totalTokens.toLocaleString()}`,
    `${xrDim("status")} ${state.busy ? spinnerFrame(state.spinnerIndex, state.busyLabel) : "idle"}`,
  ], width, state.focus === "inspector"));
  lines.push("");
  const feed = state.timeline.slice(0, 8).map((e) =>
    `${timelineIcon(e.level)} ${humanTime(e.at)} ${clipAnsi(e.title, width - 12)}`,
  );
  lines.push(...card("Activity", feed.length ? feed : [xrDim("No activity yet")], width));
  // Latest notice toast strip
  if (state.notices[0]) {
    lines.push("");
    lines.push(toastLine(
      state.notices[0].level === "ok" ? "ok" :
      state.notices[0].level === "warn" ? "warn" :
      state.notices[0].level === "error" ? "error" : "info",
      state.notices[0].title,
      width,
    ));
  }
  while (lines.length < height) lines.push("");
  return lines.slice(0, height).map((l) => padAnsi(clipAnsi(l, width), width));
}

// ── Composer ──────────────────────────────────────────────────────────────────

export function renderComposer(state: ShellState, width: number): string[] {
  const prompt = composerPrompt(state.mode, state.busy);
  const promptLen = visibleLength(prompt);
  const contentW = Math.max(8, width - promptLen - 1);
  const input = state.input;
  // Show cursor as block when focused
  let display = input;
  if (state.focus === "composer" && !state.busy) {
    const cur = Math.min(state.cursor, input.length);
    const before = input.slice(0, cur);
    const ch = input[cur] ?? " ";
    const after = input.slice(cur + 1);
    display = before + "\x1b[7m" + ch + "\x1b[27m" + after;
  }
  const wrapped = wrapAnsi(display || "", contentW).slice(0, 1);
  const first = `${prompt} ${wrapped[0] ?? ""}`;
  const placeholder = !state.input
    ? xrDim("Ask XR anything, or type / for commands…")
    : "";
  const second = state.input
    ? xrDim("Shift+Enter newline · Enter send · Tab complete · Esc interrupt")
    : placeholder;
  const hint = state.helpSeen < 3
    ? xrDim("Ctrl+K palette · g-chords navigate · ? help")
    : (state.notices[0] ? toastLine(
        state.notices[0].level === "ok" ? "ok" :
        state.notices[0].level === "warn" ? "warn" :
        state.notices[0].level === "error" ? "error" : "info",
        state.notices[0].title,
        width,
      ) : xrDim(""));
  return [
    clipAnsi(first, width),
    clipAnsi(second, width),
    clipAnsi(hint, width),
  ];
}

// ── Status bar ────────────────────────────────────────────────────────────────

export function renderStatusBar(state: ShellState, width: number): string {
  const conn = isLocal(state.provider) ? statusDot("local") : statusDot("cloud");
  const spendTone =
    state.budget > 0 && state.totalSpent >= state.budget * 0.95 ? "red" as const :
    state.budget > 0 && state.totalSpent >= state.budget * 0.8 ? "amber" as const :
    "dim" as const;
  const activity = state.busy
    ? spinnerFrame(state.spinnerIndex, state.busyLabel)
    : xrDim("idle");
  const audit =
    state.auditValid == null ? xrDim("audit ·") :
    state.auditValid ? xrGreen("✓") : xrRed("✗");
  const nCount = state.notices.length;
  const bell = nCount > 0 ? xrAmber(`◌${nCount}`) : xrDim("◌");

  // Always-visible model chip: label "model" + provider/id so users never wonder
  // what is active or how to change it (Alt+P / /model).
  const modelChipValue = `${state.provider}/${state.model}`;
  const modelTone = isLocal(state.provider) ? "green" as const : "amber" as const;
  // On narrow terminals keep the model id; on wider ones show the change hint.
  const showHint = width >= 100;
  const rightHint = state.gPending
    ? "g…"
    : showHint
      ? "Alt+P change model"
      : undefined;

  return statusBar([
    { label: "", value: `${conn} ${state.workspaceId}`, tone: isLocal(state.provider) ? "green" : "amber" },
    { label: "", value: state.mode, tone: "cyan" },
    { label: "model", value: modelChipValue, tone: modelTone },
    { label: "", value: `$${state.totalSpent.toFixed(4)}`, tone: spendTone },
    { label: "", value: activity, tone: "cyan" },
    { label: "", value: audit, tone: "dim" },
    { label: "", value: bell, tone: "dim" },
  ], width, rightHint);
}

// ── Overlays ──────────────────────────────────────────────────────────────────

export function renderStartupOverlay(state: ShellState, cols: number, rows: number): string[] {
  const contentW = Math.min(88, cols - 8);
  const lines: string[] = [];
  const art = renderOfficialBannerFrame(state.spinnerIndex);
  // progressive reveal during boot
  const artLines = state.bootPhase < 6 ? art.slice(0, Math.max(4, Math.floor(art.length * (state.bootPhase + 1) / 6))) : art;
  for (const line of artLines) lines.push(clipAnsi(line, contentW));
  lines.push("");
  lines.push(xrBold("Welcome to XR"));
  lines.push(xrDim("Select a workspace, then press Enter. Esc dismisses."));
  lines.push("");
  lines.push(state.startupSection === "workspace" ? xrCyan("[workspaces]") : xrDim(" workspaces "));
  for (const [i, ws] of state.wm.listWorkspaces().entries()) {
    const mark = i === state.workspaceIndex && state.startupSection === "workspace" ? xrCyan("›") : " ";
    const active = ws.id === state.workspaceId ? xrGreen("active") : xrDim("ready");
    lines.push(`${mark} ${ws.id.padEnd(14)} ${active} ${xrDim(ws.name)}`);
  }
  lines.push("");
  lines.push(state.startupSection === "session" ? xrCyan("[sessions]") : xrDim(" sessions "));
  if (state.sessions.length) {
    for (const [i, s] of state.sessions.slice(0, 6).entries()) {
      const mark = i === state.sessionIndex && state.startupSection === "session" ? xrCyan("›") : " ";
      lines.push(`${mark} ${clipAnsi(s.title, 28)} ${xrDim(`${s.mode} · ${humanDate(s.created_at)}`)}`);
    }
  } else {
    lines.push(xrDim("  No sessions yet — your first task starts one."));
  }
  lines.push("");
  lines.push(xrDim("Tab switches lists · ↑/↓ move · Enter continue"));
  return overlayFrame("Startup", lines, cols, rows, contentW);
}

export function renderPaletteOverlay(state: ShellState, items: Array<{ label: string; description: string; shortcut?: string }>, cols: number, rows: number): string[] {
  const body: string[] = [
    `${xrCyan("› ")}${state.paletteQuery || xrDim("type to search commands, views, settings…")}`,
    "",
  ];
  const view = items.slice(0, 12);
  for (const [i, item] of view.entries()) {
    const sel = i === state.paletteIndex;
    const mark = sel ? xrCyan("›") : " ";
    const lab = sel ? xrBold(xrCyan(item.label)) : item.label;
    const sc = item.shortcut ? xrDim(item.shortcut.padStart(8)) : "";
    body.push(`${mark} ${lab}  ${xrDim(item.description)}${sc ? "  " + sc : ""}`);
  }
  if (!view.length) body.push(xrDim("No matches."));
  return overlayFrame("Command palette", body, cols, rows, Math.min(72, cols - 8));
}

export function renderNotificationsOverlay(state: ShellState, cols: number, rows: number): string[] {
  const body: string[] = [xrDim("Recent runtime notices"), ""];
  if (!state.notices.length) body.push(xrDim("No notifications yet."));
  for (const n of state.notices.slice(0, 12)) {
    body.push(`${timelineIcon(n.level)} ${n.title} ${xrDim("· " + humanDate(n.at))}`);
    if (n.detail) body.push(`  ${n.detail}`);
  }
  return overlayFrame("Notifications", body, cols, rows);
}

export function renderQuickOverlay(cols: number, rows: number): string[] {
  const body = [
    xrDim("Highest-frequency operations"),
    "",
    `${xrCyan("/status")}     system overview`,
    `${xrCyan("/workspace")}  workspace picker`,
    `${xrCyan("/sessions")}   recent chats`,
    `${xrCyan("/audit")}      audit chain`,
    `${xrCyan("/export-audit")} signed report`,
    `${xrCyan("/security-lab")} injection lab`,
    `${xrCyan("/dashboard")}  Control Center guide`,
    `${xrCyan("/mode")}       agent | plan | ask`,
    `${xrCyan("/model")}      change model (or Alt+P)`,
    `${xrCyan("/model ollama qwen2.5:7b")}  set primary`,
  ];
  return overlayFrame("Quick actions", body, cols, rows, 64);
}

export function renderConfirmOverlay(state: ShellState, cols: number, rows: number): string[] {
  const body = [
    state.confirm?.title ?? "Confirm",
    "",
    ...(state.confirm?.detail ? wrapAnsi(state.confirm.detail, 56) : []),
    "",
    xrDim(`Enter/Y = ${state.confirm?.defaultYes ? "approve" : "confirm"} · N/Esc = cancel`),
  ];
  return overlayFrame("Approval", body, cols, rows, 68);
}

export function renderHelpOverlay(cols: number, rows: number): string[] {
  return overlayFrame("Keyboard", helpBindings(60), cols, rows, 68);
}

export function renderModeOverlay(state: ShellState, cols: number, rows: number): string[] {
  const modes: Array<[string, string, string]> = [
    ["agent", "Execute tools, shell, write files. Approvals enforced.", "cyan"],
    ["plan",  "Produce a plan. No tool execution.", "violet"],
    ["ask",   "Answer only. Read-only. Cheap.", "dim"],
  ];
  const body = modes.map(([m, d]) => {
    const sel = state.mode === m;
    return `${sel ? xrGreen("●") : xrDim("○")} ${sel ? xrBold(m) : m}  ${xrDim(d)}`;
  });
  body.push("", xrDim("Shift+Tab cycles · Enter selects · Esc closes"));
  return overlayFrame("Mode", body, cols, rows, 64);
}

export function renderModelOverlay(state: ShellState, cols: number, rows: number): string[] {
  const { config } = loadConfig();
  const body = [
    `${xrBold("Active")}  ${xrCyan(`${state.provider}`)}  ${xrDim("→")}  ${xrBold(state.model)}`,
    "",
    xrDim("Change right now (Shell):"),
    `  ${xrCyan("/model <provider> [model]")}   ${xrDim("e.g. /model ollama llama3.2")}`,
    `  ${xrCyan("/model openai gpt-4o-mini")}  ${xrDim("requires key: xr providers add openai")}`,
    `  ${xrCyan("Alt+P")}  ${xrDim("reopen this picker anytime")}`,
    "",
    xrDim("Change from CLI (persists to config):"),
    `  ${xrCyan("xr providers set <id> [model]")}   ${xrDim("primary cloud/local route")}`,
    `  ${xrCyan("xr models set <runtime> <model>")} ${xrDim("local runtime selection")}`,
    `  ${xrCyan("xr models list")} · ${xrCyan("xr providers list")}`,
    "",
    `${xrDim("config default")} ${config.defaults.provider}/${config.defaults.model}`,
    `${xrDim("fallback")}       ${config.defaults.fallbackProvider
      ? `${config.defaults.fallbackProvider}/${config.defaults.fallbackModel ?? "default"}`
      : "none"}`,
    "",
    xrDim("Control Center: xr serve → Providers or Models → Change model"),
    xrDim("Status bar always shows: model <provider>/<id>"),
  ];
  return overlayFrame("Change model / provider", body, cols, rows, 72);
}

export function renderExitOverlay(cols: number, rows: number): string[] {
  return overlayFrame("Exit XR?", [
    "Press y or Enter to exit.",
    "Press N or Esc to stay.",
    "",
    xrDim("Ctrl+D on empty input also exits."),
  ], cols, rows, 48);
}

// ── Full frame assembly ───────────────────────────────────────────────────────

export function assembleFrame(
  state: ShellState,
  geom: LayoutGeom,
  paletteItems: Array<{ label: string; description: string; shortcut?: string }>,
): string[] {
  const { cols, rows, headerH, composerH, statusH, bodyH, sidebarW, inspectorW, mainW, showSidebar, showInspector, iconRail } = geom;

  if (state.overlay === "startup") return renderStartupOverlay(state, cols, rows);
  if (state.overlay === "palette") return renderPaletteOverlay(state, paletteItems, cols, rows);
  if (state.overlay === "notifications") return renderNotificationsOverlay(state, cols, rows);
  if (state.overlay === "quick") return renderQuickOverlay(cols, rows);
  if (state.overlay === "confirm") return renderConfirmOverlay(state, cols, rows);
  if (state.overlay === "help") return renderHelpOverlay(cols, rows);
  if (state.overlay === "mode") return renderModeOverlay(state, cols, rows);
  if (state.overlay === "model") return renderModelOverlay(state, cols, rows);
  if (state.overlay === "exit") return renderExitOverlay(cols, rows);

  const header = renderHeader(state, cols);
  while (header.length < headerH) header.push("");

  const sidebar = showSidebar ? renderSidebar(state, sidebarW, bodyH, iconRail) : [];
  const main = renderMain(state, mainW, bodyH);
  const inspector = showInspector ? renderInspector(state, inspectorW, bodyH) : [];

  const focusBorder = (pane: string) => state.focus === pane ? xrCyan("│") : xrDim("│");

  const body: string[] = [];
  for (let i = 0; i < bodyH; i++) {
    let row = "";
    if (showSidebar) {
      row += padAnsi(sidebar[i] ?? "", sidebarW) + ` ${focusBorder("sidebar")} `;
    }
    row += padAnsi(main[i] ?? "", mainW);
    if (showInspector) {
      row += ` ${focusBorder("inspector")} ` + padAnsi(inspector[i] ?? "", inspectorW);
    }
    body.push(clipAnsi(row, cols));
  }

  const composer = renderComposer(state, cols);
  const status = renderStatusBar(state, cols);

  const frame = [
    ...header.slice(0, headerH),
    ...body,
    xrDim(hline(cols)),
    ...composer.slice(0, composerH),
    status,
  ];
  // Exact rows
  while (frame.length < rows) frame.push("");
  return frame.slice(0, rows);
}
