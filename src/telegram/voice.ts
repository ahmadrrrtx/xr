/**
 * XR — Telegram voice notes → text, through the existing STT layer.
 *
 * The implementation moved to the shared chat runtime
 * (src/bots/voice-note.ts) in Phase 26 · PR 2. This module keeps the Phase 24
 * surface API and Telegram's own temp-dir prefix, so behavior and messages are
 * unchanged.
 */
import {
  transcribeVoiceNote,
  NO_MODEL_REPLY,
  NO_FFMPEG_REPLY,
  COULD_NOT_TRANSCRIBE_REPLY,
  type VoiceNoteDeps,
  type VoiceResult,
} from "../bots/voice-note.ts";

export { NO_MODEL_REPLY, NO_FFMPEG_REPLY, COULD_NOT_TRANSCRIBE_REPLY };
export type { VoiceResult };

export type VoiceDeps = Omit<VoiceNoteDeps, "tempPrefix">;

export function transcribeVoice(ogg: Uint8Array, deps: VoiceDeps): Promise<VoiceResult> {
  return transcribeVoiceNote(ogg, { ...deps, tempPrefix: "xr-tg-voice-" });
}
