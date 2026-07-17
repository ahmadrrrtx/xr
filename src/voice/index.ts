/** XR Stage 8 — Voice Stack public API. */
import { SpeechToText, sttFromSettings } from "./stt.ts";
import { TextToSpeech, ttsFromSettings } from "./tts.ts";
import { VoiceHardware } from "./hardware.ts";
import { VoicePipeline } from "./pipeline.ts";
import { getVoiceSettings } from "./settings.ts";
import { VoiceActivityDetector } from "./vad.ts";
import { detectWake } from "./wake.ts";
import type { Store } from "../state/workspace-store.ts";
import type { VoiceHealthCheck, VoiceSettings } from "./types.ts";
import { defaultVoiceSettings } from "./types.ts";

export interface VoiceSessionOptions {
  store?: Store;
  stt?: SpeechToText;
  tts?: TextToSpeech;
  hardware?: VoiceHardware;
  settings?: VoiceSettings;
  onResponse?: (text: string) => Promise<void>;
}

export class VoiceSession {
  private settings: VoiceSettings;
  private stt: SpeechToText;
  private tts: TextToSpeech;
  private hw: VoiceHardware;
  private vad: VoiceActivityDetector;

  constructor(private opts: VoiceSessionOptions = {}) {
    this.settings = opts.settings ?? getVoiceSettings();
    this.stt = opts.stt ?? sttFromSettings(this.settings);
    this.tts = opts.tts ?? ttsFromSettings(this.settings);
    this.hw = opts.hardware ?? new VoiceHardware();
    this.vad = new VoiceActivityDetector(this.settings);
  }

  async listenForCommand(durationMs?: number): Promise<string | null> {
    try {
      console.log("[Voice] Listening…");
      const audio = await this.hw.recordWav({ durationMs: durationMs ?? this.settings.endpointing.maxUtteranceMs, inputDevice: this.settings.inputDevice });
      const vad = this.vad.analyze(audio);
      if (!vad.speech) {
        console.log(`[Voice] No speech detected (${vad.reason}).`);
        return null;
      }
      const result = await this.stt.transcribe(audio);
      if (result.ok && result.text) return result.text.trim();
      console.log(`[Voice] STT failed: ${result.detail ?? "unknown error"}`);
      return null;
    } catch (e) {
      console.error(`[Voice] Error listening: ${(e as Error).message}`);
      return null;
    }
  }

  async speak(text: string): Promise<void> {
    const result = await this.tts.speak(text);
    if (result.ok && result.audio) {
      const handle = this.hw.play(result.audio, { outputDevice: this.settings.outputDevice });
      await handle.done;
    } else {
      console.log(`[Voice] ${result.spokenText}`);
    }
    await this.opts.onResponse?.(result.spokenText);
  }

  async processVoiceInput(audioData: Uint8Array, mimeType = "audio/wav"): Promise<string> {
    const result = await this.stt.transcribe(audioData, mimeType);
    if (!result.ok) return `Sorry, I didn't catch that. (${result.detail})`;
    return result.text.trim();
  }

  makePipeline(store: Store): VoicePipeline {
    return new VoicePipeline({
      store,
      stt: this.stt,
      tts: this.tts,
      settings: this.settings,
      play: (audio) => this.hw.play(audio, { outputDevice: this.settings.outputDevice }),
      listen: () => this.hw.recordWav({ durationMs: this.settings.endpointing.maxUtteranceMs, inputDevice: this.settings.inputDevice }),
      requireWake: this.settings.mode === "wake-word" || this.settings.mode === "always-listen",
    });
  }
}

export function getVoiceConfig(): VoiceSettings {
  return { ...defaultVoiceSettings(), ...getVoiceSettings() };
}

export async function checkVoiceStack(settings = getVoiceSettings()): {
  stt: boolean;
  tts: boolean;
  wakeWord: boolean;
  details: string[];
  checks: VoiceHealthCheck[];
} {
  const hw = new VoiceHardware();
  const stt = sttFromSettings(settings).describe();
  const tts = ttsFromSettings(settings).describe();
  const checks: VoiceHealthCheck[] = [
    ...(await hw.health()),
    {
      id: "voice-stt",
      label: "Speech-to-text",
      state: stt.available ? "ok" : "warn",
      detail: `${stt.backend}: ${stt.detail}`,
      remediation: stt.available ? undefined : "Install Whisper/whisper.cpp or configure a local OpenAI-compatible STT endpoint.",
    },
    {
      id: "voice-tts",
      label: "Text-to-speech",
      state: tts.available ? "ok" : "warn",
      detail: `${tts.engine}: ${tts.detail}`,
      remediation: tts.available ? undefined : "Install Piper/Kokoro/espeak or configure XR_TTS_URL.",
    },
    {
      id: "voice-mode",
      label: "Voice mode",
      state: settings.enabled ? "ok" : "warn",
      detail: settings.enabled ? `${settings.mode}` : "disabled by default",
      remediation: settings.enabled ? undefined : "Run xr voice setup or xr voice start when you want voice.",
    },
    {
      id: "voice-privacy",
      label: "Voice privacy",
      state: !settings.alwaysListen && !settings.allowCloudStt ? "ok" : "warn",
      detail: `alwaysListen=${settings.alwaysListen}, cloudStt=${settings.allowCloudStt}, transcripts=${settings.transcriptPolicy}`,
      remediation: settings.alwaysListen ? "Always-listen should be opt-in only; use push-to-talk for safest default." : undefined,
    },
  ];
  const details = checks.map((c) => `${c.label}: ${c.state === "ok" ? "✓" : c.state === "warn" ? "!" : "✗"} ${c.detail}`);
  return { stt: stt.available, tts: tts.available, wakeWord: settings.mode === "wake-word" || settings.mode === "always-listen", details, checks };
}

export function routeVoiceCommand(text: string): { action: string; args: string } | null {
  const t = text.trim();
  const wake = detectWake(t);
  const command = wake.triggered ? wake.command : t;
  let m: RegExpMatchArray | null;
  if ((m = command.match(/^(?:research|investigate|compare)\s+(.+)$/i))) return { action: "research", args: m[1].trim() };
  if (/^(stop|cancel|abort)$/i.test(command)) return { action: "stop", args: "" };
  if ((m = command.match(/^(?:open|launch)\s+(.+)$/i))) return { action: "open_app", args: m[1].trim() };
  return null;
}

export type { VoiceSettings, VoiceHealthCheck } from "./types.ts";
export { SpeechToText, TextToSpeech, VoiceHardware };
export { detectWake, parseConfirmation, parseSpokenMetaCommand } from "./wake.ts";
