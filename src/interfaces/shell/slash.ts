/**
 * Phase 12 — TUI slash-command dispatch.
 *
 * Only commands in src/ui/slash-catalog.ts (and a few TUI-only view aliases
 * that map to real views) are handled. Unknown commands tell the user to
 * try /help — they are never silently forwarded to the model as if they ran.
 */

import { loadConfig, saveConfig } from "../../config/config.ts";
import { knownProviders } from "../../providers/factory.ts";
import { detectRuntime } from "../../local/runtimes.ts";
import { formatSlashHelp } from "../../ui/slash-catalog.ts";
import type { ShellViewId } from "../../ui/icons.ts";
import type { ChatMessage, ModeState, Severity, ShellState } from "./types.ts";

export interface SlashDeps {
  setView: (state: ShellState, view: ShellViewId) => void;
  notify: (state: ShellState, level: Severity, title: string, detail?: string) => void;
  appendMessage: (state: ShellState, role: ChatMessage["role"], content: string, meta?: string) => void;
  runSecurityLab: (state: ShellState) => Promise<void>;
  exportAudit: (state: ShellState) => Promise<void>;
}

export async function dispatchSlash(state: ShellState, input: string, deps: SlashDeps): Promise<void> {
  const [rawName, ...rest] = input.slice(1).split(/\s+/);
  const name = rawName?.toLowerCase() ?? "";
  const args = rest.join(" ").trim();

  switch (name) {
    case "help":
    case "?":
      deps.appendMessage(state, "assistant", formatSlashHelp("tui"), "help");
      state.overlay = "help";
      state.helpSeen++;
      break;
    case "status":
      deps.setView(state, "status");
      break;
    case "workspace":
    case "workspaces":
      state.overlay = "startup";
      state.startupSection = "workspace";
      deps.setView(state, "workspaces");
      break;
    case "sessions":
    case "session":
      deps.setView(state, "sessions");
      break;
    case "logs":
    case "audit":
      deps.setView(state, "audit");
      break;
    case "context":
    case "memory":
      deps.setView(state, "memory");
      break;
    case "activity":
    case "tools":
      deps.setView(state, "activity");
      if (name === "tools") {
        deps.appendMessage(
          state,
          "assistant",
          "Tools execute through XR's capability registry — the same policy, approval, and audit path as CLI. Activity (g t) is the live timeline.",
          "tools",
        );
      }
      break;
    case "permissions": {
      const { config } = loadConfig();
      const req = (config.security.requireApproval ?? []).join(", ") || "none listed";
      deps.appendMessage(
        state,
        "assistant",
        [
          "Permissions",
          `• requireApproval: ${req}`,
          `• hardened: ${config.security.hardened ? "yes" : "no"}`,
          "XR Shield is always enforced. The model cannot grant itself capabilities.",
        ].join("\n"),
        "security",
      );
      deps.setView(state, "chat");
      break;
    }
    case "research":
      deps.setView(state, "research");
      if (args) {
        deps.appendMessage(
          state,
          "assistant",
          `To run research on “${args}”, send that as a normal task in agent mode (web tools are policy-gated) or use: xr research "${args}"`,
          "research",
        );
      }
      break;
    case "home":
    case "overview":
      deps.setView(state, "home");
      break;
    case "settings":
    case "config":
      deps.setView(state, "settings");
      break;
    case "palette":
      state.overlay = "palette";
      state.paletteQuery = "";
      state.paletteIndex = 0;
      break;
    case "notifications":
    case "notice":
      state.overlay = "notifications";
      break;
    case "quick":
      state.overlay = "quick";
      break;
    case "doctor":
      deps.appendMessage(
        state,
        "assistant",
        "Live status is on the Status view. The full diagnostic is `xr doctor` in the CLI — /doctor does not invent a dashboard doctor pass.",
        "guide",
      );
      deps.setView(state, "status");
      break;
    case "plan": {
      state.mode = "plan";
      const { config } = loadConfig();
      config.defaults.mode = "plan";
      saveConfig(config);
      deps.notify(state, "ok", "Mode updated", "plan — XR will propose, not execute");
      if (args) {
        deps.appendMessage(
          state,
          "assistant",
          `Plan mode is on. Send the task in the composer:\n${args}`,
          "plan",
        );
      }
      break;
    }
    case "models":
    case "local": {
      const { config } = loadConfig();
      const local: any = config.localModels;
      const runtime = local.runtime ?? "ollama";
      const status = await detectRuntime(runtime);
      deps.appendMessage(state, "assistant", [
        "Local models",
        `• runtime: ${status.label} (${status.id})`,
        `• selected: ${local.selected ?? config.defaults.model ?? "none"}`,
        `• health: ${status.healthy ? "healthy" : status.running ? "running" : status.installed ? "installed" : "not found"}`,
        `• models: ${(status.models ?? []).slice(0, 6).join(", ") || "none"}`,
      ].join("\n"), "models");
      deps.setView(state, "chat");
      break;
    }
    case "dashboard":
    case "serve":
      deps.appendMessage(state, "assistant", "Run `xr serve` then open http://127.0.0.1:3141 for Control Center.", "guide");
      deps.setView(state, "chat");
      break;
    case "mode": {
      const next = args as ModeState;
      if (!["agent", "plan", "ask"].includes(next)) {
        deps.notify(state, "warn", "Usage", "/mode agent|plan|ask");
        break;
      }
      state.mode = next;
      const { config } = loadConfig();
      config.defaults.mode = next;
      saveConfig(config);
      deps.notify(state, "ok", "Mode updated", next);
      break;
    }
    case "model":
    case "provider": {
      const parts = args.split(/\s+/).filter(Boolean);
      if (!parts.length) {
        state.overlay = "model";
        state.dirty = true;
        deps.notify(state, "info", "Change model", `Active: ${state.provider} / ${state.model}`);
        break;
      }
      const provider = parts[0];
      if (!provider || !knownProviders().includes(provider)) {
        deps.notify(state, "warn", "Unknown provider", knownProviders().join(", "));
        deps.appendMessage(
          state,
          "assistant",
          `Unknown provider "${provider}".\nKnown: ${knownProviders().join(", ")}\n\nTry:\n  /model ollama qwen2.5:7b\n  /model openai gpt-4o-mini\n  xr providers list\n  xr models list`,
          "system",
        );
        break;
      }
      state.provider = provider;
      if (parts[1]) state.model = parts[1]!;
      const { config } = loadConfig();
      config.defaults.provider = state.provider;
      config.defaults.model = state.model;
      if (provider === "ollama" || provider === "lmstudio" || provider === "jan" || provider === "localai" || provider === "vllm") {
        const local: any = config.localModels ?? {};
        local.enabled = true;
        local.selected = state.model;
        local.provider = provider;
        config.localModels = local;
      }
      saveConfig(config);
      deps.notify(state, "ok", "Model updated", `${state.provider} / ${state.model}`);
      deps.appendMessage(
        state,
        "assistant",
        `Active model is now ${state.provider} / ${state.model}.\nStatus bar and sidebar always show the current model.\nSwitch again with Alt+P or /model <provider> [model].`,
        "system",
      );
      break;
    }
    case "budget": {
      if (!args) {
        const { config } = loadConfig();
        const cost = state.store.costSummary();
        deps.appendMessage(state, "assistant", [
          "Budget summary",
          `• per-task cap: ${config.budget.perTaskUsd > 0 ? `$${config.budget.perTaskUsd}` : "none"}`,
          `• total spent: $${cost.totalUsd.toFixed(4)}`,
          `• total tokens: ${cost.totalTokens.toLocaleString()}`,
        ].join("\n"), "budget");
        deps.setView(state, "chat");
        break;
      }
      const next = Number.parseFloat(args);
      if (!Number.isFinite(next)) {
        deps.notify(state, "warn", "Usage", "/budget 0.25");
        break;
      }
      state.budget = next;
      const { config } = loadConfig();
      config.budget.perTaskUsd = next;
      saveConfig(config);
      deps.notify(state, "ok", "Budget updated", `$${next.toFixed(2)}`);
      break;
    }
    case "security-lab":
      await deps.runSecurityLab(state);
      break;
    case "export-audit":
      await deps.exportAudit(state);
      break;
    case "clear":
      state.chat = state.chat.slice(0, 1);
      deps.notify(state, "info", "Chat cleared");
      break;
    case "inspect":
      state.showInspector = !state.showInspector;
      deps.notify(state, "info", state.showInspector ? "Inspector shown" : "Inspector hidden");
      break;
    case "compact":
      deps.appendMessage(
        state,
        "assistant",
        "Context compaction is performed by the context engine when the token budget requires it. There is no /compact HTTP switch — XR will not pretend to compact.",
        "guide",
      );
      break;
    case "exit":
    case "quit":
      state.overlay = "exit";
      break;
    default:
      deps.notify(state, "warn", "Unknown slash command", `/${name} — try /help`);
      break;
  }
  state.dirty = true;
}

/** Tab-complete candidates — keep in lockstep with dispatch + catalog. */
export const SLASH_COMPLETE = [
  "help", "status", "mode", "model", "provider", "budget", "sessions", "session",
  "workspace", "audit", "memory", "research", "plan", "tools", "permissions",
  "doctor", "clear", "exit",
];
