/** XR Stage 8 — voice settings helpers and transcript privacy. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { XR_HOME, loadConfig, saveConfig } from "../config/config.ts";
import type { VoiceActivation, VoiceSettings, VoiceTranscriptEntry, VoiceTestResult } from "./types.ts";
import { defaultVoiceSettings } from "./types.ts";

const TRANSCRIPT_PATH = join(XR_HOME, "voice-transcripts.jsonl");

export function getVoiceSettings(): VoiceSettings {
  const { config } = loadConfig();
  const defaults = defaultVoiceSettings();
  const stored = (config.voice ?? {}) as Partial<VoiceSettings>;
  return {
    ...defaults,
    ...stored,
    endpointing: { ...defaults.endpointing, ...(stored.endpointing ?? {}) },
    desktop: { ...defaults.desktop!, ...(stored.desktop ?? {}) },
  };
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/**
 * Phase 15 · validate a settings patch from the desktop (`POST /voice/settings`).
 * Unknown keys are dropped; numbers are clamped to their documented ranges.
 */
export function sanitizeVoicePatch(input: Record<string, unknown>): Partial<VoiceSettings> {
  const out: Partial<VoiceSettings> = {};
  const str = (k: string, allowed?: readonly string[]) => {
    const v = input[k];
    if (typeof v === "string" && v.length <= 200 && (!allowed || allowed.includes(v))) (out as Record<string, unknown>)[k] = v;
  };
  const bool = (k: string) => { if (typeof input[k] === "boolean") (out as Record<string, unknown>)[k] = input[k]; };
  str("mode", ["off", "push-to-talk", "wake-word", "always-listen"]);
  str("sttBackend", ["auto", "sherpa", "http", "groq", "openai", "whisper-cli", "whispercpp", "disabled"]);
  str("ttsBackend", ["auto", "sherpa", "http", "piper", "kokoro-cli", "system", "say", "espeak", "powershell", "openai", "disabled"]);
  str("sttModel");
  str("sttLanguage");
  str("ttsVoice");
  str("wakeWord");
  str("wakeSensitivity", ["low", "medium", "high"]);
  for (const k of ["enabled", "allowCloudStt", "allowCloudTts", "noiseSuppression", "wakeSound", "profanityFilter", "sentenceTts", "spokenStatus"]) bool(k);
  if (input.ttsSpeed !== undefined) out.ttsSpeed = clamp(input.ttsSpeed, 0.7, 1.3, 1);
  if (input.desktop && typeof input.desktop === "object") {
    const d = input.desktop as Record<string, unknown>;
    const prev = getVoiceSettings().desktop!;
    out.desktop = {
      micDeviceId: typeof d.micDeviceId === "string" || d.micDeviceId === null ? (d.micDeviceId as string | null) : prev.micDeviceId,
      inputGain: d.inputGain === undefined ? prev.inputGain : clamp(d.inputGain, 0, 200, 100),
      activation: ["hold", "tap", "always"].includes(String(d.activation)) ? (d.activation as VoiceActivation) : prev.activation,
      ttsPitch: d.ttsPitch === undefined ? prev.ttsPitch : clamp(d.ttsPitch, -5, 5, 0),
      autoExitSilenceSec: d.autoExitSilenceSec === undefined ? prev.autoExitSilenceSec : clamp(d.autoExitSilenceSec, 10, 300, 30),
      showTranscripts: typeof d.showTranscripts === "boolean" ? d.showTranscripts : prev.showTranscripts,
      theaterImmersive: typeof d.theaterImmersive === "boolean" ? d.theaterImmersive : prev.theaterImmersive,
      chatMicTarget: d.chatMicTarget === "docked" || d.chatMicTarget === "screen" ? d.chatMicTarget : prev.chatMicTarget,
      holdGlobalHotkey: typeof d.holdGlobalHotkey === "boolean" ? d.holdGlobalHotkey : prev.holdGlobalHotkey,
    };
  }
  return out;
}

export function saveVoiceSettings(settings: VoiceSettings): void {
  const { config } = loadConfig();
  config.voice = { ...(config.voice as any), ...settings } as any;
  saveConfig(config);
}

export function patchVoiceSettings(patch: Partial<VoiceSettings>): VoiceSettings {
  const current = getVoiceSettings();
  const next = { ...current, ...patch, endpointing: { ...current.endpointing, ...(patch.endpointing ?? {}) }, desktop: { ...current.desktop!, ...(patch.desktop ?? {}) } };
  if (next.mode !== "always-listen") next.alwaysListen = false;
  if (!next.enabled) next.mode = next.mode === "always-listen" ? "push-to-talk" : next.mode;
  saveVoiceSettings(next);
  return next;
}

export function recordVoiceTest(result: VoiceTestResult): void {
  const settings = getVoiceSettings();
  settings.lastTestResult = result;
  saveVoiceSettings(settings);
}

export function markVoiceUsed(): void {
  const settings = getVoiceSettings();
  settings.lastUsedAt = new Date().toISOString();
  saveVoiceSettings(settings);
}

export function appendTranscript(entry: VoiceTranscriptEntry, settings = getVoiceSettings()): void {
  if (settings.transcriptPolicy !== "local-private") return;
  mkdirSync(XR_HOME, { recursive: true });
  const line = JSON.stringify(entry).replace(/\n/g, " ") + "\n";
  try {
    const existing = existsSync(TRANSCRIPT_PATH) ? readFileSync(TRANSCRIPT_PATH, "utf8") : "";
    writeFileSync(TRANSCRIPT_PATH, existing + line, { mode: 0o600 });
    try { chmodSync(TRANSCRIPT_PATH, 0o600); } catch {}
  } catch {}
}

export function readTranscriptHistory(limit = 50): VoiceTranscriptEntry[] {
  if (!existsSync(TRANSCRIPT_PATH)) return [];
  return readFileSync(TRANSCRIPT_PATH, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-Math.max(1, limit))
    .map((line) => {
      try { return JSON.parse(line) as VoiceTranscriptEntry; } catch { return null; }
    })
    .filter((x): x is VoiceTranscriptEntry => !!x);
}
