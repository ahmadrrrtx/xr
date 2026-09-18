/**
 * XR Phase 4 · Voice — offline native bindings (sherpa-onnx).
 *
 * The voice pipeline is local-first by policy (stt.ts / tts.ts). This module
 * binds the OPTIONAL sherpa-onnx native package: an offline zipformer
 * transducer STT and a VITS/Piper neural TTS that run entirely on-device —
 * no cloud account, no network, no telemetry.
 *
 * Deployment model (fail-closed, never fake):
 *   - The npm package lives OUTSIDE the repo dependency tree (operators
 *     install it once, e.g. `npm i sherpa-onnx` in XR_VOICE_NATIVE_DIR or
 *     ~/.voice-native). CI and lean installs stay lightweight.
 *   - Models live under XR_VOICE_MODEL_DIR (default ~/.xr/voice): the int8
 *     zipformer-small-en set (~28 MB) and a Piper VITS voice (~63 MB).
 *   - Missing package or models → `available:false` with an honest detail
 *     string; the pipeline then falls back to whisper CLI / espeak / none.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface NativeVoiceHandles {
  readonly recognize: (wav: Uint8Array) => { text: string; detail?: string };
  readonly speak: (text: string) => { wav: Uint8Array; sampleRate: number } | null;
  readonly sttDetail: string;
  readonly ttsDetail: string;
}

export interface NativeVoiceProbe {
  readonly ok: boolean;
  readonly detail: string;
  readonly handles?: NativeVoiceHandles;
}

export function nativeModuleDir(): string {
  return process.env.XR_VOICE_NATIVE_DIR ?? join(homedir(), ".voice-native");
}

export function voiceModelDir(): string {
  return process.env.XR_VOICE_MODEL_DIR ?? join(homedir(), ".xr", "voice");
}

const STT_FILES = {
  encoder: "stt/sherpa-small-en/encoder-epoch-99-avg-1.int8.onnx",
  decoder: "stt/sherpa-small-en/decoder-epoch-99-avg-1.int8.onnx",
  joiner: "stt/sherpa-small-en/joiner-epoch-99-avg-1.int8.onnx",
  tokens: "stt/sherpa-small-en/tokens.txt",
};

const TTS_FILES = {
  model: "tts/piper-lessac/en_US-lessac-medium.onnx",
  tokens: "tts/piper-lessac/tokens.txt",
  dataDir: "tts/piper-lessac/espeak-ng-data",
};

let cached: NativeVoiceProbe | null = null;

/** Load (once) the offline STT+TTS handles. Never throws; reports honestly. */
export function loadNativeVoice(force = false): NativeVoiceProbe {
  if (cached && !force) return cached;
  const modDir = nativeModuleDir();
  const modelDir = voiceModelDir();
  try {
    const req = createRequire(join(modDir, "noop.js"));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sherpa = req("sherpa-onnx");

    const sttPaths = { ...STT_FILES };
    const sttMissing = Object.values(sttPaths).map((f) => join(modelDir, f)).filter((p) => !existsSync(p));
    const ttsPaths = { ...TTS_FILES };
    const ttsMissing = Object.values(ttsPaths).map((f) => join(modelDir, f)).filter((p) => !existsSync(p));

    let recognizer: any = null;
    let sttDetail: string;
    if (sttMissing.length) {
      sttDetail = `offline STT models missing: ${sttMissing.map((p) => p.split("/").pop()).join(", ")}`;
    } else {
      recognizer = sherpa.createOfflineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: join(modelDir, sttPaths.encoder),
            decoder: join(modelDir, sttPaths.decoder),
            joiner: join(modelDir, sttPaths.joiner),
          },
          tokens: join(modelDir, sttPaths.tokens),
          numThreads: 1,
          debug: false,
        },
      });
      sttDetail = "sherpa-onnx zipformer-small-en int8 (offline)";
    }

    let tts: any = null;
    let ttsDetail: string;
    if (ttsMissing.length) {
      ttsDetail = `offline TTS models missing: ${ttsMissing.map((p) => p.split("/").pop()).join(", ")}`;
    } else {
      tts = sherpa.createOfflineTts({
        model: {
          vits: {
            model: join(modelDir, ttsPaths.model),
            tokens: join(modelDir, ttsPaths.tokens),
            dataDir: join(modelDir, ttsPaths.dataDir),
          },
          numThreads: 1,
        },
      });
      ttsDetail = `sherpa-onnx piper lessac-medium (offline, ${tts.sampleRate} Hz)`;
    }

    if (!recognizer && !tts) {
      cached = { ok: false, detail: "sherpa-onnx present but no models installed" };
      return cached;
    }

    cached = {
      ok: true,
      detail: `sherpa-onnx ${String(sherpa.version ?? "?")}`,
      handles: {
        sttDetail,
        ttsDetail,
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
        speak: (text: string) => {
          if (!tts) return null;
          const audio = tts.generate({ text, sid: 0, speed: 1.0 });
          if (!audio?.samples?.length) return null;
          // Encode PCM f32 → wav bytes (16-bit) so the result travels like any
          // other engine TTS payload.
          const n = audio.samples.length;
          const rate: number = tts.sampleRate ?? 22050;
          const buf = new Uint8Array(44 + n * 2);
          const dv = new DataView(buf.buffer);
          const wstr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i); };
          wstr(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); wstr(8, "WAVE"); wstr(12, "fmt ");
          dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
          dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
          wstr(36, "data"); dv.setUint32(40, n * 2, true);
          for (let i = 0; i < n; i++) {
            const s = Math.max(-1, Math.min(1, audio.samples[i]));
            dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
          }
          return { wav: buf, sampleRate: rate };
        },
      },
    };
    return cached;
  } catch (e) {
    cached = { ok: false, detail: `sherpa-onnx not installed at ${modDir} (${(e as Error).message.slice(0, 80)})` };
    return cached;
  }
}
