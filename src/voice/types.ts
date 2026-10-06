/**
 * XR Stage 8 — Voice Stack shared types.
 *
 * These types define the durable, local-first voice contract.  They are kept
 * independent from the CLI so dashboard/TUI/desktop frontends can share the
 * same schema and safety rules.
 */

export type VoiceMode = "off" | "push-to-talk" | "wake-word" | "always-listen";
export type VoiceSttBackend = "auto" | "sherpa" | "http" | "groq" | "openai" | "whisper-cli" | "whispercpp" | "disabled";
export type VoiceTtsBackend = "auto" | "sherpa" | "http" | "piper" | "kokoro-cli" | "system" | "say" | "espeak" | "powershell" | "openai" | "disabled";
export type VoiceWakeSensitivity = "low" | "medium" | "high";
export type VoiceActivation = "hold" | "tap" | "always";

/**
 * Phase 15 · desktop-only preferences. The engine never reads them; they are
 * persisted here so one settings record owns voice (mirrored by the desktop
 * store for instant UI).
 */
export interface VoiceDesktopPrefs {
  micDeviceId: string | null;
  /** 0–200 (%), applied in the capture graph. */
  inputGain: number;
  activation: VoiceActivation;
  /** −5…+5 semitones, applied on playback (Piper voices have no pitch control). */
  ttsPitch: number;
  /** 10–300 s; the session ends after this much silence ("Goodbye"). */
  autoExitSilenceSec: number;
  showTranscripts: boolean;
  theaterImmersive: boolean;
  chatMicTarget: "screen" | "docked";
  holdGlobalHotkey: boolean;
}

export function defaultVoiceDesktopPrefs(): VoiceDesktopPrefs {
  return {
    micDeviceId: null,
    inputGain: 100,
    activation: "tap",
    ttsPitch: 0,
    autoExitSilenceSec: 30,
    showTranscripts: true,
    theaterImmersive: false,
    chatMicTarget: "screen",
    holdGlobalHotkey: false,
  };
}
export type VoiceVadBackend = "energy" | "silero-external" | "none";
export type VoiceWakeBackend = "text" | "openwakeword-external" | "none";
export type VoiceInterruptionPolicy = "barge-in" | "finish-sentence" | "disabled";
export type VoiceConfirmationPolicy = "always-risky" | "always" | "never-execute-risky";
export type VoiceTranscriptPolicy = "off" | "session" | "local-private";

export interface VoiceDeviceRef {
  id: string;
  label: string;
  kind: "input" | "output";
  isDefault?: boolean;
  transport?: string;
  detail?: string;
}

export interface VoiceHealthCheck {
  id: string;
  label: string;
  state: "ok" | "warn" | "fail";
  detail: string;
  remediation?: string;
}

export interface VoiceTestResult {
  ok: boolean;
  at: string;
  inputDevice?: string;
  outputDevice?: string;
  sttBackend?: string;
  ttsBackend?: string;
  transcript?: string;
  detail?: string;
}

export interface VoiceSettings {
  enabled: boolean;
  mode: VoiceMode;
  inputDevice?: string;
  outputDevice?: string;
  sttBackend: VoiceSttBackend;
  sttUrl?: string;
  sttModel: string;
  sttLanguage?: string;
  ttsBackend: VoiceTtsBackend;
  ttsUrl?: string;
  ttsVoice: string;
  ttsPersona: "calm" | "fast" | "detailed";
  vadBackend: VoiceVadBackend;
  wakeBackend: VoiceWakeBackend;
  wakeWord: string;
  pushToTalkKey: string;
  alwaysListen: boolean;
  interruptionPolicy: VoiceInterruptionPolicy;
  confirmationPolicy: VoiceConfirmationPolicy;
  microphonePermission: "unknown" | "granted" | "denied";
  speakerPermission: "unknown" | "granted" | "denied";
  transcriptPolicy: VoiceTranscriptPolicy;
  transcriptRetentionDays: number;
  fallbackTextMode: boolean;
  allowCloudStt: boolean;
  allowCloudTts: boolean;
  noiseSuppression: boolean;
  endpointing: {
    minSilenceMs: number;
    maxSilenceMs: number;
    speechPaddingMs: number;
    maxUtteranceMs: number;
    energyThreshold: number;
    /** Phase 4 · semantic end-of-turn: provisional-transcript classifier
     * extends the silence tail (minSilenceMs → maxSilenceMs) when the
     * utterance looks mid-thought. Default true. */
    semantic?: boolean;
  };
  deviceMetadata: Record<string, unknown>;
  lastTestResult?: VoiceTestResult;
  lastUsedAt?: string;
  /** Phase 9 voice v2 flags (off by default). */
  streamingStt?: boolean;
  serverVad?: boolean;
  sentenceTts?: boolean;
  bargeInCancelsRun?: boolean;
  spokenStatus?: boolean;
  /** Phase 15 · 0.7–1.3, native Piper speed (1 = natural). */
  ttsSpeed?: number;
  /** Phase 15 · maps to the speech energy threshold the session uses. */
  wakeSensitivity?: VoiceWakeSensitivity;
  wakeSound?: boolean;
  profanityFilter?: boolean;
  desktop?: VoiceDesktopPrefs;
}

export interface VoiceTranscriptEntry {
  at: string;
  role: "user" | "assistant" | "system";
  text: string;
  mode: VoiceMode;
  sttBackend?: string;
  ttsBackend?: string;
}

export function defaultVoiceSettings(): VoiceSettings {
  return {
    enabled: false,
    mode: "push-to-talk",
    sttBackend: "auto",
    sttModel: "base.en",
    ttsBackend: "auto",
    ttsVoice: "default",
    ttsPersona: "calm",
    vadBackend: "energy",
    wakeBackend: "text",
    wakeWord: "hey xr",
    pushToTalkKey: "enter",
    alwaysListen: false,
    interruptionPolicy: "barge-in",
    confirmationPolicy: "always-risky",
    microphonePermission: "unknown",
    speakerPermission: "unknown",
    transcriptPolicy: "session",
    transcriptRetentionDays: 7,
    fallbackTextMode: true,
    allowCloudStt: false,
    allowCloudTts: false,
    noiseSuppression: true,
    endpointing: {
      minSilenceMs: 650,
      maxSilenceMs: 1500,
      speechPaddingMs: 250,
      maxUtteranceMs: 15000,
      energyThreshold: 0.012,
      semantic: true,
    },
    deviceMetadata: {},
    ttsSpeed: 1,
    wakeSensitivity: "medium",
    wakeSound: true,
    profanityFilter: false,
    desktop: defaultVoiceDesktopPrefs(),
  };
}
