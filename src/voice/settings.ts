/** XR Stage 8 — voice settings helpers and transcript privacy. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { XR_HOME, loadConfig, saveConfig } from "../config/config.ts";
import type { VoiceSettings, VoiceTranscriptEntry, VoiceTestResult } from "./types.ts";
import { defaultVoiceSettings } from "./types.ts";

const TRANSCRIPT_PATH = join(XR_HOME, "voice-transcripts.jsonl");

export function getVoiceSettings(): VoiceSettings {
  const { config } = loadConfig();
  return { ...defaultVoiceSettings(), ...(config.voice as any), endpointing: { ...defaultVoiceSettings().endpointing, ...(config.voice as any)?.endpointing } };
}

export function saveVoiceSettings(settings: VoiceSettings): void {
  const { config } = loadConfig();
  config.voice = { ...(config.voice as any), ...settings } as any;
  saveConfig(config);
}

export function patchVoiceSettings(patch: Partial<VoiceSettings>): VoiceSettings {
  const next = { ...getVoiceSettings(), ...patch, endpointing: { ...getVoiceSettings().endpointing, ...(patch.endpointing ?? {}) } };
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
