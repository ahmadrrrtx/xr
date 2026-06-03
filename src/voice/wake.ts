/**
 * XR — wake-word + voice-command parsing (pure, testable).
 *
 * Wake-word detection itself (audio) is handled by OpenWakeWord on-device; here
 * we implement the deterministic text-side logic: did a transcript start with
 * the wake phrase, and how do we interpret spoken confirmations.
 */

const WAKE_PATTERNS = [/^\s*(hey|ok|okay)\s+xr\b/i, /^\s*xr[, ]/i];

export interface WakeResult {
  triggered: boolean;
  /** The command text with the wake phrase stripped. */
  command: string;
}

export function detectWake(transcript: string): WakeResult {
  const t = (transcript ?? "").trim();
  for (const re of WAKE_PATTERNS) {
    if (re.test(t)) {
      return { triggered: true, command: t.replace(re, "").replace(/^[,\s]+/, "").trim() };
    }
  }
  return { triggered: false, command: "" };
}

export type Confirmation = "confirm" | "cancel" | "unclear";

/** Interpret a spoken yes/no for high-risk voice-confirm actions. */
export function parseConfirmation(transcript: string): Confirmation {
  const t = (transcript ?? "").toLowerCase().trim();
  if (/\b(confirm|yes|yeah|yep|approve|do it|go ahead|affirmative|sure)\b/.test(t)) return "confirm";
  if (/\b(cancel|no|nope|stop|abort|don't|do not|negative)\b/.test(t)) return "cancel";
  return "unclear";
}
