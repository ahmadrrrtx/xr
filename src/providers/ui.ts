/**
 * XR 3.1 — Provider & Model UI
 *
 * Visual provider cards, model picker, hardware profile display.
 *
 * Spec: XR_DESIGN_SYSTEM.md §9 (cards)
 */

import { xrCyan, xrGreen, xrAmber, xrDim, xrBold, xrRed } from "../../ui/theme.ts";
import { SYM } from "../../ui/theme.ts";
import { wrapAnsi, clipAnsi } from "../../ui/ansi.ts";
import { renderCompactAvatar } from "../../ui/avatar.ts";
import type { AvatarState } from "../../ui/avatar.ts";
import type { ProviderInfo, ModelInfo } from "./types.ts";

// ── Provider Card ──────────────────────────────────────────────────────────────

export interface ProviderCard {
  id: string;
  name: string;
  type: "local" | "cloud";
  defaultModel: string;
  status: "available" | "configured" | "not-configured" | "error";
  apiKeyEnv?: string;
  description?: string;
  latency?: number;  // ms, if known
}

/**
 * Render a provider card in terminal
 */
export function renderProviderCard(
  provider: ProviderCard,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];
  const accent = provider.type === "local" ? xrGreen : provider.status === "configured" ? xrCyan : xrAmber;

  // Card header
  const statusIcon = provider.status === "configured" ? SYM.ok
    : provider.status === "available" ? SYM.info
    : provider.status === "error" ? SYM.error
    : SYM.warn;

  const statusText = provider.status === "configured" ? "Configured"
    : provider.status === "available" ? "Available"
    : provider.status === "error" ? "Error"
    : "Not configured";

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 44)) + "┐"));
  lines.push(accent(`│ ${renderCompactAvatar(avatarState, "")} ${provider.name}`));
  lines.push(xrDim(`│  ${provider.type === "local" ? "⬡ Local" : "☁ Cloud"}  ·  ${provider.defaultModel}`));
  lines.push(xrDim(`│  ${statusIcon} ${statusText}`));
  if (provider.latency) {
    lines.push(xrDim(`│  Latency: ~${provider.latency}ms`));
  }
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 44)) + "┘"));

  return lines;
}

/**
 * Render provider list as cards
 */
export function renderProviderList(
  providers: ProviderCard[],
  width: number,
  avatarState: AvatarState,
  activeId?: string,
): string[] {
  const lines: string[] = [];

  lines.push(xrBold("Providers"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 48))));
  lines.push("");

  for (const provider of providers) {
    const isActive = provider.id === activeId;
    for (const line of renderProviderCard(provider, width - 2, avatarState)) {
      lines.push(isActive ? xrBold(line) : line);
    }
    lines.push("");
  }

  return lines;
}

// ── Model Card ─────────────────────────────────────────────────────────────────

export interface ModelCard {
  name: string;
  provider: string;
  type: "local" | "cloud";
  contextWindow?: number;  // tokens
  capability?: string;
  status: "available" | "selected" | "loading" | "error";
  sizeGB?: number;
  ramGb?: number;
  reason?: string;
}

/**
 * Render a model card in terminal
 */
export function renderModelCard(
  model: ModelCard,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];
  const accent = model.status === "selected" ? xrGreen : model.type === "local" ? xrCyan : xrAmber;

  const statusIcon = model.status === "selected" ? "★"
    : model.status === "loading" ? "⟳"
    : model.status === "error" ? "✗"
    : "○";

  const statusText = model.status === "selected" ? "Selected"
    : model.status === "loading" ? "Downloading"
    : model.status === "error" ? "Error"
    : "Available";

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 50)) + "┐"));
  lines.push(accent(`│ ${statusIcon} ${model.name}`));
  lines.push(xrDim(`│  ${model.provider}  ·  ${model.type === "local" ? "Local" : "Cloud"}`));
  if (model.contextWindow) {
    lines.push(xrDim(`│  Context: ${model.contextWindow.toLocaleString()} tokens`));
  }
  if (model.sizeGB !== undefined) {
    lines.push(xrDim(`│  Size: ${model.sizeGB} GB`));
  }
  if (model.ramGb !== undefined) {
    lines.push(xrDim(`│  RAM: ~${model.ramGb} GB`));
  }
  if (model.reason) {
    lines.push(xrDim(`│  ${model.reason}`));
  }
  if (model.capability) {
    lines.push(xrDim(`│  Capability: ${model.capability}`));
  }
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 50)) + "┘"));

  return lines;
}

// ── Hardware Profile ────────────────────────────────────────────────────────────

export interface HardwareProfile {
  cpuCores: number;
  memoryGb: number;
  storageGb: number;
  os: string;
  arch: string;
  hasOllama: boolean;
  ollamaRunning: boolean;
  recommendedLocal: boolean;
}

/**
 * Render hardware profile card
 */
export function renderHardwareProfile(
  hardware: HardwareProfile,
  width: number,
): string[] {
  const lines: string[] = [];

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 40)) + "┐"));
  lines.push(xrCyan(`│ Your Computer`));
  lines.push(xrDim("│"));
  lines.push(xrDim(`│ ● CPU: ${hardware.cpuCores} cores`));
  lines.push(xrDim(`│ ● Memory: ${hardware.memoryGb} GB`));
  lines.push(xrDim(`│ ● Storage: ${hardware.storageGb} GB available`));
  lines.push(xrDim(`│ ● OS: ${hardware.os}`));
  lines.push(xrDim(`│ ● Architecture: ${hardware.arch}`));
  lines.push(xrDim("│"));
  if (hardware.hasOllama) {
    const status = hardware.ollamaRunning ? `${SYM.ok} Running` : `${SYM.warn} Installed`;
    lines.push(xrDim(`│ ● Ollama: ${status}`));
  } else {
    lines.push(xrDim(`│ ● Ollama: ${SYM.info} Not detected`));
  }
  lines.push(xrDim(`│ ${hardware.recommendedLocal ? SYM.ok : SYM.info} Local models supported`));
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 40)) + "┘"));

  return lines;
}

/**
 * Render hardware summary as compact line
 */
export function renderHardwareSummary(hardware: HardwareProfile): string {
  return `${hardware.cpuCores} cores · ${hardware.memoryGb}GB RAM · ${hardware.storageGb}GB storage · ${hardware.os}`;
}

// ── Provider/Model Status ───────────────────────────────────────────────────────

/**
 * Get status indicator for current provider/model
 */
export function renderProviderModelStatus(
  provider: string,
  model: string,
  isLocal: boolean,
  width: number,
): string {
  const indicator = isLocal ? SYM.local : SYM.cloud;
  const label = isLocal ? "Local" : "Cloud";

  return clipAnsi(
    `${renderCompactAvatar("idle", "")} ${indicator} ${xrCyan(provider)} / ${xrDim(model)} (${label})`,
    width,
  );
}

/**
 * Render quick-switch hint
 */
export function renderQuickSwitchHint(width: number): string {
  return clipAnsi(
    `${xrDim("Alt+P change provider")}${xrDim("  ·  ")}/model ${xrDim("change model")}${xrDim("  ·  ")}? ${xrDim("help")}`,
    width,
  );
}

// ── Model Recommendation ────────────────────────────────────────────────────────

export interface ModelRecommendation {
  name: string;
  reason: "recommended" | "alternative" | "heavy";
  description: string;
  sizeGB: number;
  ramGb: number;
  contextWindow: number;
  downloadSize: string;
}

/**
 * Render model recommendation list
 */
export function renderModelRecommendations(
  recommendations: ModelRecommendation[],
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  lines.push(xrBold("Recommended for your computer"));
  lines.push(xrDim("─".repeat(Math.min(width - 2, 48))));
  lines.push("");

  for (const model of recommendations) {
    const isRecommended = model.reason === "recommended";
    const marker = isRecommended ? "★ " : "  ";

    lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 50)) + "┐"));

    if (isRecommended) {
      lines.push(xrCyan(`│ ${renderCompactAvatar(avatarState, "")} ${marker}${model.name}  [RECOMMENDED]`));
    } else {
      lines.push(xrDim(`│ ${marker}${model.name}`));
    }

    lines.push(xrDim(`│  ${model.description}`));
    lines.push(xrDim(`│  Size: ${model.sizeGB} GB  ·  RAM: ~${model.ramGb} GB`));
    lines.push(xrDim(`│  Context: ${model.contextWindow.toLocaleString()} tokens`));
    lines.push(xrDim(`│  Download: ${model.downloadSize}`));
    lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 50)) + "┘"));
    lines.push("");
  }

  return lines;
}

// ── Provider Setup State ────────────────────────────────────────────────────────

export interface ProviderSetupState {
  step: "select" | "key" | "test" | "done" | "error";
  providerId?: string;
  model?: string;
  error?: string;
}

/**
 * Render provider setup progress
 */
export function renderProviderSetupState(
  state: ProviderSetupState,
  width: number,
  avatarState: AvatarState,
): string[] {
  const lines: string[] = [];

  const stepLabels: Record<ProviderSetupState["step"], string> = {
    select: "Choose a provider",
    key: "Enter API key",
    test: "Testing connection...",
    done: "Provider ready!",
    error: "Something went wrong",
  };

  const stepIcon: Record<ProviderSetupState["step"], string> = {
    select: SYM.info,
    key: SYM.info,
    test: "⟳",
    done: SYM.ok,
    error: SYM.error,
  };

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 44)) + "┐"));
  lines.push(xrCyan(`│ ${renderCompactAvatar(avatarState, "")} ${stepIcon[state.step]} ${stepLabels[state.step]}`));
  if (state.providerId) {
    lines.push(xrDim(`│ Provider: ${state.providerId}`));
  }
  if (state.model) {
    lines.push(xrDim(`│ Model: ${state.model}`));
  }
  if (state.error) {
    lines.push(xrRed(`│ Error: ${state.error}`));
  }
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 44)) + "┘"));

  return lines;
}
