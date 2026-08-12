/**
 * XR 3.1 — Voice Experience
 *
 * Voice interaction with avatar states, floating mode support.
 *
 * Spec: XR_DESIGN_SYSTEM.md §12 (avatar states)
 */

import { xrCyan, xrGreen, xrAmber, xrDim, xrBold, xrRed } from "./theme.ts";
import { renderCompactAvatar, renderLargeAvatar, type AvatarState } from "./avatar.ts";
import { wrapAnsi, clipAnsi } from "./ansi.ts";
import { SYM } from "./theme.ts";

// ── Voice States ───────────────────────────────────────────────────────────────

export type VoiceState = "idle" | "activating" | "listening" | "processing" | "speaking" | "error" | "complete";

/**
 * Map voice state to avatar state
 */
export function voiceToAvatarState(voiceState: VoiceState): AvatarState {
  const map: Record<VoiceState, AvatarState> = {
    idle: "idle",
    activating: "thinking",
    listening: "listening",
    processing: "thinking",
    speaking: "speaking",
    error: "error",
    complete: "complete",
  };
  return map[voiceState];
}

// ── Voice UI Rendering ─────────────────────────────────────────────────────────

export interface VoiceUIOptions {
  state: VoiceState;
  width?: number;
  showTranscription?: boolean;
  transcription?: string;
  showQuickActions?: boolean;
}

/**
 * Render voice mode UI
 */
export function renderVoiceUI(options: VoiceUIOptions): string[] {
  const {
    state,
    width = 60,
    showTranscription = false,
    transcription = "",
    showQuickActions = true,
  } = options;

  const avatarState = voiceToAvatarState(state);
  const lines: string[] = [];

  // Large avatar display
  const avatarLines = renderLargeAvatar(avatarState, "XR");

  // Center the avatar display
  const padding = Math.max(0, Math.floor((width - 20) / 2));
  const pad = " ".repeat(padding);

  lines.push(pad + clipAnsi(avatarLines[0], width - padding * 2));
  lines.push(pad + clipAnsi(avatarLines[1], width - padding * 2));
  lines.push(pad + clipAnsi(avatarLines[2], width - padding * 2));
  lines.push(pad + clipAnsi(avatarLines[3], width - padding * 2));
  lines.push(pad + clipAnsi(avatarLines[4], width - padding * 2));

  // State label
  const stateLabel = state.charAt(0).toUpperCase() + state.slice(1);
  lines.push("");
  lines.push(pad + clipAnsi(
    `${renderCompactAvatar(avatarState, "")} ${xrDim(stateLabel)}`,
    width - padding * 2,
  ));

  // Transcription (when listening/processing)
  if (showTranscription && (state === "listening" || state === "processing")) {
    lines.push("");
    if (transcription) {
      const wrapped = wrapAnsi(transcription, width - 8);
      for (const line of wrapped.slice(0, 3)) {
        lines.push(pad + xrDim(`  ${line}`));
      }
      if (wrapped.length > 3) {
        lines.push(pad + xrDim("  ..."));
      }
    } else {
      lines.push(pad + xrDim("  (listening...)"));
    }
  }

  // Quick actions
  if (showQuickActions) {
    lines.push("");
    lines.push(pad + xrDim("─".repeat(Math.min(width - padding * 2 - 4, 30))));
    lines.push(pad + xrDim("  ⌘C Cancel    ⌘K Keyboard    ⎋ Close"));
  }

  return lines;
}

// ── Floating Voice Mode ────────────────────────────────────────────────────────

export interface FloatingVoiceOptions {
  state: VoiceState;
  compact?: boolean;
  width?: number;
}

/**
 * Render floating/minimized voice mode
 */
export function renderFloatingVoice(options: FloatingVoiceOptions): string[] {
  const {
    state,
    compact = true,
    width = 30,
  } = options;

  const avatarState = voiceToAvatarState(state);
  const lines: string[] = [];

  if (compact) {
    // Compact floating mode (small avatar + status)
    lines.push(clipAnsi(
      `${renderCompactAvatar(avatarState, "")} ${xrBold("XR")}`,
      width,
    ));
    lines.push(clipAnsi(
      xrDim(voiceStateLabel(state)),
      width,
    ));
    lines.push(clipAnsi(
      xrDim("─────────"),
      width,
    ));
    lines.push(clipAnsi(
      xrDim("⎋ Close  ⌘C Stop"),
      width,
    ));
  } else {
    // Larger floating mode
    lines.push(...renderVoiceUI({
      state,
      width,
      showQuickActions: true,
    }));
  }

  return lines;
}

// ── Voice State Labels ──────────────────────────────────────────────────────────

export function voiceStateLabel(state: VoiceState): string {
  const labels: Record<VoiceState, string> = {
    idle: "Ready for voice",
    activating: "Activating...",
    listening: "Listening...",
    processing: "Processing...",
    speaking: "Speaking...",
    error: "Voice error",
    complete: "Done",
  };
  return labels[state];
}

// ── Voice Waveform (terminal) ──────────────────────────────────────────────────

/**
 * Render a simple waveform visualization for listening state
 */
export function renderWaveform(width: number, intensity: number = 0.5): string[] {
  const lines: string[] = [];
  const bars = Math.min(width, 40);
  const frame = Math.floor(Date.now() / 200) % 4;

  for (let i = 0; i < bars; i++) {
    const barHeight = Math.sin((i / bars) * Math.PI + frame) * intensity;
    const height = Math.max(1, Math.round(barHeight * 5));
    const bar = "░".repeat(height) + "▒".repeat(Math.max(0, 3 - height));
    lines.push(clipAnsi(`  ${bar}`, width));
  }

  return lines;
}

// ── Voice Activation Hint ───────────────────────────────────────────────────────

/**
 * Render hint for how to use voice
 */
export function renderVoiceHint(width: number): string[] {
  const lines: string[] = [];

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 44)) + "┐"));
  lines.push(xrCyan("│ Voice Commands"));
  lines.push(xrDim("│"));
  lines.push(xrDim("│ Say something to XR..."));
  lines.push(xrDim("│"));
  lines.push(xrDim("│ Commands:"));
  lines.push(xrDim("│   \"XR, what files are here?\""));
  lines.push(xrDim("│   \"XR, help me with this code\""));
  lines.push(xrDim("│   \"XR, stop\""));
  lines.push(xrDim("│"));
  lines.push(xrDim("│ Press"));
  lines.push(xrBold("│   Voice button or Ctrl+V"));
  lines.push(xrDim("│"));
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 44)) + "┘"));

  return lines;
}

// ── Voice Permission Request ────────────────────────────────────────────────────

export interface VoicePermissionRequest {
  needsMicrophone: boolean;
  needsComputerControl: boolean;
  needsNetwork: boolean;
}

/**
 * Render voice permission request
 */
export function renderVoicePermissions(
  perms: VoicePermissionRequest,
  width: number,
): string[] {
  const lines: string[] = [];

  lines.push(xrDim("┌" + "─".repeat(Math.min(width - 2, 44)) + "┐"));
  lines.push(xrCyan("│ Voice Setup"));
  lines.push(xrDim("│"));
  lines.push(xrDim("│ XR needs permission to:"));

  if (perms.needsMicrophone) {
    lines.push(`│ ${SYM.local} ${xrGreen("✓")} Access microphone (for voice)`);
  }
  if (perms.needsComputerControl) {
    lines.push(`│ ${SYM.warn} ${xrAmber("!"))} Control computer (for actions)`);
  }
  if (perms.needsNetwork) {
    lines.push(`│ ${SYM.cloud} ${xrAmber("☁"))} Use internet (for cloud models)`);
  }

  lines.push(xrDim("│"));
  lines.push(xrDim("│ ${SYM.local} ${xrGreen(\"Everything stays local unless you use cloud.\")}"));
  lines.push(xrDim("│"));
  lines.push(xrDim("└" + "─".repeat(Math.min(width - 2, 44)) + "┘"));

  return lines;
}
