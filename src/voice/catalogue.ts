/**
 * XR Phase 15 — what the Voice screen can pick from.
 *
 * Shapes the model/voice catalogue (src/voice/models.ts) plus the local-binary
 * and cloud options into the wire form GET /api/voice/models and /voices
 * return: honest `bytes` from the measured catalogue, `installed` from disk,
 * cloud entries only `available` when a key is configured, and every cloud
 * price marked an estimate (Constitution Art. IV.5).
 */
import { commandExists } from "../util/process.ts";
import {
  ESPEAK_ENTRY,
  RUNTIME_ENTRY,
  STT_ENTRIES,
  TTS_VOICES,
  entryBytes,
  entryInstalled,
} from "./models.ts";

export async function modelCatalogue(): Promise<Record<string, unknown>> {
  const [whisperCli, whisperCpp] = await Promise.all([commandExists("whisper"), commandExists("whisper-cli")]);
  const hasKey = (env: string) => Boolean(process.env[env]);
  return {
    runtime: { ...RUNTIME_ENTRY, bytes: entryBytes(RUNTIME_ENTRY), installed: entryInstalled(RUNTIME_ENTRY), files: undefined },
    stt: [
      ...STT_ENTRIES.map((e) => ({ id: e.id, kind: "offline", name: e.name, detail: e.detail, bytes: entryBytes(e), installed: entryInstalled(e), downloadable: true })),
      { id: "whispercpp", kind: "local-binary", name: "Whisper (whisper.cpp)", detail: whisperCpp ? "whisper-cli found on PATH" : "Install whisper.cpp (whisper-cli) and set XR_WHISPERCPP_MODEL", available: whisperCpp, downloadable: false },
      { id: "whisper-cli", kind: "local-binary", name: "Whisper (openai-whisper CLI)", detail: whisperCli ? "whisper found on PATH" : "Install the openai-whisper CLI", available: whisperCli, downloadable: false },
      { id: "groq", kind: "cloud", name: "Cloud · Groq whisper-large-v3-turbo", detail: hasKey("GROQ_API_KEY") ? "key configured · ≈$0.04 per audio hour (estimate)" : "Add a Groq key in Settings → Models", available: hasKey("GROQ_API_KEY"), downloadable: false },
      { id: "openai", kind: "cloud", name: "Cloud · OpenAI gpt-4o-mini-transcribe", detail: hasKey("OPENAI_API_KEY") ? "key configured · ≈$0.18 per audio hour (estimate)" : "Add an OpenAI key in Settings → Models", available: hasKey("OPENAI_API_KEY"), downloadable: false },
    ],
    espeak: { id: ESPEAK_ENTRY.id, bytes: entryBytes(ESPEAK_ENTRY), installed: entryInstalled(ESPEAK_ENTRY) },
  };
}

export function voiceCatalogue(): Record<string, unknown>[] {
  const openai = Boolean(process.env.OPENAI_API_KEY);
  return [
    ...TTS_VOICES.map((v) => ({
      id: v.id,
      label: v.label,
      name: v.name,
      gender: v.gender,
      accent: v.accent,
      detail: v.detail,
      kind: "offline",
      bytes: entryBytes(v) + (entryInstalled(ESPEAK_ENTRY) ? 0 : entryBytes(ESPEAK_ENTRY)),
      installed: entryInstalled(v) && entryInstalled(ESPEAK_ENTRY),
      downloadable: true,
    })),
    ...["alloy", "nova", "onyx", "shimmer"].map((id) => ({
      id,
      label: `OpenAI ${id}`,
      name: "OpenAI tts-1",
      kind: "cloud",
      detail: openai ? "cloud · ≈$15 per million characters (estimate)" : "Add an OpenAI key in Settings → Models",
      available: openai,
      installed: false,
      downloadable: false,
    })),
  ];
}
