/**
 * XR Stage 8 — wake-word and spoken control parsing.
 *
 * Audio wake-word detection can be delegated to openWakeWord externally. This
 * module provides deterministic transcript-side gating and confirmations.
 */

export interface WakeResult {
  triggered: boolean;
  command: string;
  wakeWord: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function wakePatterns(wakeWord = "hey xr"): RegExp[] {
  const normalized = wakeWord.trim().replace(/\s+/g, " ");
  const parts = normalized.split(" ").map(escapeRegExp).join("\\s+");
  return [
    new RegExp(`^\\s*(?:${parts})\\b[,.!?:;\\s]*`, "i"),
    /^\s*(?:ok|okay)\s+xr\b[,.!?:;\s]*/i,
    /^\s*xr\b[,.!?:;\s]*/i,
  ];
}

export function detectWake(transcript: string, wakeWord = "hey xr"): WakeResult {
  const t = (transcript ?? "").trim();
  for (const re of wakePatterns(wakeWord)) {
    if (re.test(t)) return { triggered: true, command: t.replace(re, "").trim(), wakeWord };
  }
  return { triggered: false, command: "", wakeWord };
}

export type Confirmation = "confirm" | "cancel" | "unclear";

export function parseConfirmation(transcript: string): Confirmation {
  const t = (transcript ?? "").toLowerCase().trim();
  if (/\b(confirm|confirmed|yes|yeah|yep|approve|approved|do it|go ahead|affirmative|sure|proceed)\b/.test(t)) return "confirm";
  if (/\b(cancel|cancelled|no|nope|stop|abort|don't|do not|negative|never mind|nevermind)\b/.test(t)) return "cancel";
  return "unclear";
}

export type SpokenMetaCommand = "stop" | "cancel" | "repeat" | "say-again" | "mute" | "unmute" | "none";

export function parseSpokenMetaCommand(transcript: string): SpokenMetaCommand {
  const t = (transcript ?? "").toLowerCase().trim();
  if (/^(stop|stop talking|quiet|be quiet|shut up|pause)\b/.test(t)) return "stop";
  if (/^(cancel|abort|never mind|nevermind)\b/.test(t)) return "cancel";
  if (/\b(repeat that|repeat|say that again)\b/.test(t)) return "repeat";
  if (/\b(say again|what did you say)\b/.test(t)) return "say-again";
  if (/\b(mute voice|voice off|stop listening)\b/.test(t)) return "mute";
  if (/\b(unmute voice|voice on)\b/.test(t)) return "unmute";
  return "none";
}
