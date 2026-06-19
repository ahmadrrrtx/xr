/** XR Stage 8 — VAD and endpointing. */
import { analyzeVad, hasEnoughSpeech, type TurnDetectionResult } from "./audio.ts";
import type { VoiceSettings } from "./types.ts";

export interface VadDecision {
  speech: boolean;
  confidence: number;
  reason: string;
  analysis: TurnDetectionResult;
}

export class VoiceActivityDetector {
  constructor(private settings: Pick<VoiceSettings, "vadBackend" | "endpointing">) {}

  analyze(wav: Uint8Array): VadDecision {
    if (this.settings.vadBackend === "none") {
      const analysis = analyzeVad(wav, { threshold: this.settings.endpointing.energyThreshold });
      return { speech: true, confidence: 0.5, reason: "VAD disabled", analysis };
    }
    const analysis = analyzeVad(wav, { threshold: this.settings.endpointing.energyThreshold });
    const speech = hasEnoughSpeech(wav, {
      threshold: this.settings.endpointing.energyThreshold,
      minSpeechMs: Math.min(250, this.settings.endpointing.minSilenceMs),
    });
    const confidence = Math.max(0, Math.min(1, analysis.rms / Math.max(0.0001, this.settings.endpointing.energyThreshold)));
    return {
      speech,
      confidence,
      reason: speech ? `speech ${analysis.speechMs}ms rms=${analysis.rms.toFixed(4)}` : `no speech rms=${analysis.rms.toFixed(4)}`,
      analysis,
    };
  }
}

export class TurnDetector {
  constructor(private settings: Pick<VoiceSettings, "endpointing">) {}

  isComplete(transcript: string, trailingSilenceMs: number): boolean {
    const t = transcript.trim();
    if (!t) return trailingSilenceMs >= this.settings.endpointing.maxSilenceMs;
    if (trailingSilenceMs >= this.settings.endpointing.maxSilenceMs) return true;
    if (trailingSilenceMs < this.settings.endpointing.minSilenceMs) return false;
    if (/[.!?]$/.test(t)) return true;
    if (/\b(stop|cancel|confirm|yes|no|repeat|say again)\b$/i.test(t)) return true;
    return false;
  }
}
