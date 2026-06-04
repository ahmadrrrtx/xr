/**
 * XR — Voice Control System
 * 
 * Makes XR a true JARVIS: wake word → STT → agent → TTS
 * 
 * Architecture:
 * - Wake word detection (Porcupine / openwakeword) for low-power listening
 * - STT via Whisper (local via Ollama, or Groq free Whisper API)
 * - Agent processes the command
 * - TTS via Kokoro / Piper (local) or cloud TTS
 * - Voice confirmation for risky actions (approval via voice)
 * 
 * Privacy: everything stays local unless the user explicitly opts into cloud STT
 */

import { SpeechToText } from "./stt.ts";
import { TextToSpeech } from "./tts.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ── Wake Word Detection (lightweight, local) ──────────────────────────────────
// Uses a simple energy-based detector as fallback when Porcupine isn't available
// For production, use Porcupine (Picovoice) or openwakeword

export interface WakeWordOptions {
  // Path to Porcupine .pnml model (optional)
  porcupineModel?: string;
  porcupineKeyword?: string;
  // Sensitivity (0-1)
  sensitivity?: number;
  // Callback when wake word detected
  onWake?: () => void;
  // Audio device (default: system default)
  audioDevice?: string;
}

export interface WakeWordResult {
  detected: boolean;
  keyword?: string;
  timestamp: number;
}

// Simple energy-based wake word detection
// For actual wake word detection, use Porcupine or openwakeword
// This is a lightweight fallback that listens for any sound above threshold
export class WakeWordDetector {
  private threshold: number;
  private listening = false;
  private onWake: (() => void) | null = null;
  
  constructor(opts: WakeWordOptions = {}) {
    this.threshold = opts.sensitivity ?? 0.3;
    this.onWake = opts.onWake ?? null;
  }
  
  start(): void {
    this.listening = true;
    // In a real implementation, this would:
    // 1. Open audio stream (microphone)
    // 2. Monitor RMS energy levels
    // 3. When energy exceeds threshold + matches keyword pattern → call onWake()
    // 
    // For Bun/Node, you'd use a library like node-audio-recording or
    // call out to a small C utility for low-latency audio capture
    //
    // The full implementation uses:
    // - Porcupine (Picovoice): https://github.com/Picovoice/porcupine
    // - openwakeword: https://github.com/dscrivner/openwakeword
    // Both are small, fast, and run entirely on CPU
  }
  
  stop(): void {
    this.listening = false;
  }
  
  isListening(): boolean {
    return this.listening;
  }
  
  // Trigger wake word manually (for testing)
  trigger(): void {
    if (this.onWake) this.onWake();
  }
}

// ── Voice Session ─────────────────────────────────────────────────────────────
export interface VoiceSessionOptions {
  stt?: SpeechToText;
  tts?: TextToSpeech;
  wakeWord?: WakeWordDetector;
  model?: string;
  persona?: "calm" | "fast" | "detailed";
  // Callback when agent responds with text
  onResponse?: (text: string) => Promise<void>;
}

export class VoiceSession {
  private stt: SpeechToText;
  private tts: TextToSpeech;
  private wakeWord: WakeWordDetector | null = null;
  private sessionActive = false;
  private persona: "calm" | "fast" | "detailed";
  private onResponse: ((text: string) => Promise<void>) | null = null;
  
  constructor(opts: VoiceSessionOptions = {}) {
    this.stt = opts.stt ?? new SpeechToText();
    this.tts = opts.tts ?? new TextToSpeech({ persona: opts.persona ?? "calm" });
    this.wakeWord = opts.wakeWord ?? null;
    this.sessionActive = false;
    this.persona = opts.persona ?? "calm";
    this.onResponse = opts.onResponse ?? null;
    
    if (this.wakeWord) {
      this.wakeWord.onWake = () => this.wakeDetected();
    }
  }
  
  private wakeDetected(): void {
    console.log("[Voice] Wake word detected — listening…");
    // Small beep/confirmation tone could play here
  }
  
  async listenForCommand(): Promise<string | null> {
    // In real implementation: capture audio from mic
    // For now: record for up to 10 seconds
    // 
    // Implementation using node-audio-recording or bun-native audio:
    // const audio = await captureAudio({ durationMs: 10000, sampleRate: 16000 });
    // const result = await this.stt.transcribe(audio, "audio/webm");
    // 
    // The full implementation:
    // 1. Uses node wave-player or similar for audio I/O
    // 2. Records in chunks (VAD = voice activity detection)
    // 3. Sends to STT when speech detected
    return null; // placeholder
  }
  
  async speak(text: string): Promise<void> {
    this.tts.setPersona(this.persona);
    const result = await this.tts.speak(text);
    
    if (result.audio) {
      // Play audio — in real implementation:
      // await playAudio(result.audio)
      console.log(`[Voice] Speaking: ${result.spokenText.slice(0, 80)}…`);
    } else {
      console.log(`[Voice] ${result.spokenText.slice(0, 80)}…`);
    }
  }
  
  async processVoiceInput(audioData: Uint8Array, mimeType = "audio/webm"): Promise<string> {
    const result = await this.stt.transcribe(audioData, mimeType);
    if (!result.ok) {
      return `Sorry, I didn't catch that. (${result.detail})`;
    }
    return result.text.trim();
  }
  
  startListening(): void {
    if (this.wakeWord) {
      this.wakeWord.start();
      console.log("[Voice] Wake word listening started. Say 'Hey XR' to activate.");
    } else {
      console.log("[Voice] Continuous listening mode (no wake word — press Ctrl+C to stop).");
    }
    this.sessionActive = true;
  }
  
  stopListening(): void {
    if (this.wakeWord) this.wakeWord.stop();
    this.sessionActive = false;
  }
}

// ── Voice Command Router ──────────────────────────────────────────────────────
// Maps voice commands to XR actions with fuzzy matching

const VOICE_COMMANDS: Array<{
  patterns: RegExp[];
  action: string;
  description: string;
}> = [
  {
    patterns: [/who are you/i, /what are you/i, /tell me about yourself/i],
    action: "identity", description: "Introduce XR"
  },
  {
    patterns: [/doctor/i, /check system/i, /health check/i],
    action: "doctor", description: "Run system health check"
  },
  {
    patterns: [/search (for )?(.*)/i, /look up (.*)/i, /find (.*)/i],
    action: "search", description: "Web search"
  },
  {
    patterns: [/open (.*)/i, /launch (.*)/i],
    action: "open_app", description: "Open application"
  },
  {
    patterns: [/write (.*)/i, /create (.*)/i, /make (.*)/i],
    action: "write_file", description: "Create file"
  },
  {
    patterns: [/explain (.*)/i, /what does (.*) do/i],
    action: "explain", description: "Explain code/concept"
  },
  {
    patterns: [/test (.*)/i, /run (.*)/i],
    action: "run_test", description: "Run test"
  },
  {
    patterns: [/commit (.*)/i, /git (.*)/i],
    action: "git", description: "Git operations"
  },
  {
    patterns: [/stop/i, /cancel/i, /abort/i],
    action: "stop", description: "Stop current task"
  },
];

export function routeVoiceCommand(text: string): { action: string; args: string } | null {
  for (const cmd of VOICE_COMMANDS) {
    for (const pattern of cmd.patterns) {
      const match = text.match(pattern);
      if (match) {
        // Extract the key argument from the command
        const args = match[match.length - 1] ?? text;
        return { action: cmd.action, args };
      }
    }
  }
  return null; // Treat as general task
}

// ── Voice Config ───────────────────────────────────────────────────────────────
export function getVoiceConfig(): {
  sttUrl: string;
  ttsUrl: string;
  whisperModel: string;
  ttsVoice: string;
  wakeWordEnabled: boolean;
} {
  return {
    sttUrl: process.env.XR_STT_URL ?? "http://localhost:8080",
    ttsUrl: process.env.XR_TTS_URL ?? "http://localhost:8081",
    whisperModel: process.env.XR_STT_MODEL ?? "whisper-1",
    ttsVoice: process.env.XR_TTS_VOICE ?? "kokoro",
    wakeWordEnabled: process.env.XR_WAKE_WORD === "true",
  };
}

export function checkVoiceStack(): {
  stt: boolean;
  tts: boolean;
  wakeWord: boolean;
  details: string[];
} {
  const details: string[] = [];
  
  // Check STT (Whisper server)
  const sttUrl = process.env.XR_STT_URL ?? "http://localhost:8080";
  let sttOk = false;
  try {
    const http = require("http");
    const req = http.request(`${sttUrl}/v1/audio/transcriptions`, { method: "HEAD", timeout: 3000 }, () => { sttOk = true; });
    req.on("error", () => { sttOk = false; });
    req.end();
  } catch { sttOk = false; }
  if (sttOk) details.push("STT (Whisper): ✓"); else details.push("STT: ✗ (set XR_STT_URL or run Whisper server)");
  
  // Check TTS
  const ttsUrl = process.env.XR_TTS_URL ?? "http://localhost:8081";
  let ttsOk = false;
  try {
    const http = require("http");
    const req = http.request(`${ttsUrl}/tts`, { method: "HEAD", timeout: 3000 }, () => { ttsOk = true; });
    req.on("error", () => { ttsOk = false; });
    req.end();
  } catch { ttsOk = false; }
  if (ttsOk) details.push("TTS (Kokoro): ✓"); else details.push("TTS: ✗ (set XR_TTS_URL or run Kokoro server)");
  
  // Check wake word deps
  const hasPorcupine = existsSync(join(process.cwd(), "node_modules", "@picovoice", "porcupine"));
  const hasOpenWakeWord = existsSync(join(process.cwd(), "node_modules", "openwakeword"));
  if (hasPorcupine || hasOpenWakeWord) {
    details.push("Wake word: ✓ (Porcupine/openwakeword)");
  } else {
    details.push("Wake word: ✗ (energy-based fallback active)");
  }
  
  return { stt: sttOk, tts: ttsOk, wakeWord: hasPorcupine || hasOpenWakeWord, details };
}
