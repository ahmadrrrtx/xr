/**
 * XR Phase 4 · Voice — offline native bindings (sherpa-onnx).
 *
 * The voice pipeline is local-first by policy (stt.ts / tts.ts). This module
 * binds the OPTIONAL sherpa-onnx package: an offline zipformer transducer
 * STT and Piper (VITS) neural voices that run entirely on-device — no cloud
 * account, no network, no telemetry.
 *
 * Deployment model (fail-closed, never fake):
 *   - The package lives OUTSIDE the repo dependency tree. Phase 15 downloads
 *     the WebAssembly build (npm `sherpa-onnx`, no native binary) into
 *     nativeModuleDir()/node_modules via src/voice/models.ts; operators may
 *     also `npm i sherpa-onnx` there by hand. CI and lean installs stay light.
 *   - Models live under voiceModelDir() in the catalogue layout (models.ts).
 *   - Missing package or models → `ok:false` / per-component `missing` lists
 *     with honest detail strings; the pipeline then falls back to whisper CLI
 *     / espeak / none, and the desktop shows the download card.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_STT_ID,
  DEFAULT_TTS_VOICE,
  ESPEAK_ENTRY,
  STT_ENTRIES,
  TTS_VOICES,
  filePath,
  findEntry,
  missingFiles,
  nativeModuleDir,
  voiceModelDir,
} from "./models.ts";

export { nativeModuleDir, voiceModelDir };

export interface NativeVoiceHandles {
  readonly recognize: (wav: Uint8Array) => { text: string; detail?: string };
  /** `speed` 0.5–2 (1 = natural); Piper has no pitch control. */
  readonly speak: (text: string, speed?: number) => { wav: Uint8Array; sampleRate: number } | null;
  readonly sttDetail: string;
  readonly ttsDetail: string;
  readonly ttsVoice: string;
}

export interface NativeVoiceProbe {
  readonly ok: boolean;
  readonly detail: string;
  readonly handles?: NativeVoiceHandles;
  /** Honest per-component gaps (empty = ready). */
  readonly missing: { runtime: string[]; stt: string[]; tts: string[] };
}

let cached: NativeVoiceProbe | null = null;
let cachedVoice = DEFAULT_TTS_VOICE;

/** Drop the probe cache (after a download or a voice change). */
export function resetNativeVoice(): void {
  cached = null;
}

/** Encode PCM f32 → 16-bit WAV so the result travels like any other engine TTS payload. */
function f32ToWav(samples: Float32Array | number[], rate: number): Uint8Array {
  const n = samples.length;
  const buf = new Uint8Array(44 + n * 2);
  const dv = new DataView(buf.buffer);
  const wstr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i); };
  wstr(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); wstr(8, "WAVE"); wstr(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wstr(36, "data"); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Where the espeak data for a voice lives (shared dir, or the pre-Phase-15 per-voice copy). */
function espeakDirFor(voiceDir: string): string | null {
  const shared = join(voiceModelDir(), ESPEAK_ENTRY.dir);
  if (missingFiles(ESPEAK_ENTRY).length === 0) return shared;
  const legacy = join(voiceDir, "espeak-ng-data");
  return existsSync(join(legacy, "phontab")) ? legacy : null;
}

/**
 * Load (once) the offline STT+TTS handles. Never throws; reports honestly.
 * Pass `ttsVoice` to bind a different catalogue voice (re-probes if changed).
 */
export function loadNativeVoice(force = false, ttsVoice: string = cachedVoice): NativeVoiceProbe {
  if (cached && !force && ttsVoice === cachedVoice) return cached;
  cachedVoice = ttsVoice;
  const modDir = nativeModuleDir();
  const stt = STT_ENTRIES.find((e) => e.id === DEFAULT_STT_ID) ?? STT_ENTRIES[0];
  const voice = findEntry("tts", ttsVoice) ?? TTS_VOICES[0];
  const sttMissing = missingFiles(stt);
  const voiceDir = join(voiceModelDir(), voice.dir);
  const espeakDir = espeakDirFor(voiceDir);
  const ttsMissing = [...missingFiles(voice), ...(espeakDir ? [] : ["espeak-ng-data"])];
  try {
    const req = createRequire(join(modDir, "noop.js"));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sherpa = req("sherpa-onnx");

    let recognizer: any = null;
    let sttDetail: string;
    if (sttMissing.length) {
      sttDetail = `offline STT models missing: ${sttMissing.join(", ")}`;
    } else {
      const [enc, dec, joiner, tokens] = stt.files.map((f) => filePath(stt, f));
      recognizer = sherpa.createOfflineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          transducer: { encoder: enc, decoder: dec, joiner },
          tokens,
          numThreads: 1,
          debug: false,
        },
      });
      sttDetail = "sherpa-onnx zipformer-small-en int8 (offline)";
    }

    let tts: any = null;
    let ttsDetail: string;
    if (ttsMissing.length) {
      ttsDetail = `offline TTS models missing: ${ttsMissing.join(", ")}`;
    } else {
      tts = sherpa.createOfflineTts({
        model: {
          vits: {
            model: filePath(voice, voice.files[0]),
            tokens: filePath(voice, voice.files[1]),
            dataDir: espeakDir,
          },
          numThreads: 1,
        },
      });
      ttsDetail = `sherpa-onnx piper ${voice.label ?? voice.id} (offline, ${tts.sampleRate} Hz)`;
    }

    const missing = { runtime: [], stt: sttMissing, tts: ttsMissing };
    if (!recognizer && !tts) {
      cached = { ok: false, detail: "sherpa-onnx present but no models installed", missing };
      return cached;
    }

    cached = {
      ok: true,
      detail: `sherpa-onnx ${String(sherpa.version ?? "wasm")}`,
      missing,
      handles: {
        sttDetail,
        ttsDetail,
        ttsVoice: voice.id,
        recognize: (wav: Uint8Array) => {
          if (!recognizer) return { text: "", detail: sttDetail };
          const stream = recognizer.createStream();
          const wave = sherpa.readWaveFromBinaryData(wav);
          if (!wave) return { text: "", detail: "unreadable wav" };
          stream.acceptWaveform(wave.sampleRate, wave.samples);
          recognizer.decode(stream);
          const res = recognizer.getResult(stream);
          stream.free?.();
          return { text: String(res?.text ?? "").trim() };
        },
        speak: (text: string, speed = 1) => {
          if (!tts) return null;
          const audio = tts.generate({ text, sid: 0, speed: Math.min(2, Math.max(0.5, speed)) });
          if (!audio?.samples?.length) return null;
          const rate: number = tts.sampleRate ?? 22050;
          return { wav: f32ToWav(audio.samples, rate), sampleRate: rate };
        },
      },
    };
    return cached;
  } catch (e) {
    cached = {
      ok: false,
      detail: `sherpa-onnx not installed at ${modDir} (${(e as Error).message.slice(0, 80)})`,
      missing: { runtime: ["sherpa-onnx"], stt: sttMissing, tts: ttsMissing },
    };
    return cached;
  }
}
