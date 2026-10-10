/**
 * XR — Telegram voice notes → text, through the existing STT layer.
 *
 * Telegram voice notes are Ogg/Opus. Cloud backends (groq, openai) take Ogg
 * directly, so the bytes go straight through. Local backends need 16 kHz mono
 * WAV, which is produced with ffmpeg when it is installed. Without ffmpeg, or
 * without any speech model, the user gets a plain-language reply, never a
 * silent failure. Temp audio is written to a private temp dir and deleted in
 * a `finally`, even on error.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { commandExists } from "../util/process.ts";
import type { SpeechToText } from "../voice/stt.ts";

export const NO_MODEL_REPLY =
  "Voice messages require a speech model. Set one up in XR (Settings → Voice), then send the voice note again.";
export const NO_FFMPEG_REPLY =
  "Voice messages need ffmpeg for local speech recognition. Install ffmpeg, or enable a cloud speech model in XR settings.";

export type VoiceResult = { ok: true; text: string } | { ok: false; reply: string };

export interface VoiceDeps {
  stt: Pick<SpeechToText, "describeAsync" | "transcribe">;
  /** Test seam: ffmpeg presence. */
  hasFfmpeg?: () => Promise<boolean>;
  /** Test seam: ogg → 16 kHz mono wav. */
  convertToWav?: (ogg: Uint8Array, dir: string) => Promise<Uint8Array>;
}

const CLOUD = new Set(["groq", "openai"]);

async function defaultConvert(ogg: Uint8Array, dir: string): Promise<Uint8Array> {
  const inPath = join(dir, "voice.ogg");
  const outPath = join(dir, "voice.wav");
  await writeFile(inPath, ogg, { mode: 0o600 });
  await new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-i", inPath, "-ac", "1", "-ar", "16000", outPath],
      { timeout: 60_000 },
      (err) => (err ? reject(err) : resolve()),
    );
  });
  return new Uint8Array(await readFile(outPath));
}

export async function transcribeVoice(ogg: Uint8Array, deps: VoiceDeps): Promise<VoiceResult> {
  const desc = await deps.stt.describeAsync();
  if (!desc.available || desc.backend === "disabled") return { ok: false, reply: NO_MODEL_REPLY };

  if (CLOUD.has(desc.backend)) {
    const r = await deps.stt.transcribe(ogg, "audio/ogg");
    return r.ok && r.text.trim() ? { ok: true, text: r.text.trim() } : { ok: false, reply: "I couldn't transcribe that voice note." };
  }

  const hasFfmpeg = deps.hasFfmpeg ?? (() => commandExists("ffmpeg"));
  if (!(await hasFfmpeg())) return { ok: false, reply: NO_FFMPEG_REPLY };

  const dir = await mkdtemp(join(tmpdir(), "xr-tg-voice-"));
  try {
    const wav = await (deps.convertToWav ?? defaultConvert)(ogg, dir);
    const r = await deps.stt.transcribe(wav, "audio/wav");
    return r.ok && r.text.trim() ? { ok: true, text: r.text.trim() } : { ok: false, reply: "I couldn't transcribe that voice note." };
  } catch {
    return { ok: false, reply: "I couldn't transcribe that voice note." };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
