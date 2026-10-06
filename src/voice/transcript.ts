/**
 * XR Phase 15 · Voice — transcript shaping (pure, deterministic).
 *
 * The offline zipformer-small-en recogniser emits UPPERCASE text without
 * punctuation ("WHAT IS TWO PLUS TWO"). The desktop shows transcripts to the
 * user and the LLM reads them, so they are sentence-cased here — nothing is
 * invented, only casing changes. The profanity filter is an optional,
 * explicitly basic English list (the settings copy says so).
 */

/** Sentence-case an all-caps transcript; leave mixed-case text untouched. */
export function normalizeTranscript(raw: string): string {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/[a-z]/.test(text)) return text;
  const lower = text.toLowerCase();
  let out = "";
  let capitalize = true;
  for (const ch of lower) {
    out += capitalize && /[a-z]/.test(ch) ? ch.toUpperCase() : ch;
    if (/[a-z0-9]/.test(ch)) capitalize = false;
    if (/[.!?]/.test(ch)) capitalize = true;
  }
  return out.replace(/\bi\b/g, "I").replace(/\bi'(m|ve|ll|d)\b/g, "I'$1");
}

const BASIC_PROFANITY = [
  "fuck", "fucking", "fucked", "shit", "shitty", "bullshit", "asshole", "bitch", "bastard", "damn", "dick", "crap", "piss", "cunt", "motherfucker", "wanker", "bollocks",
];
const PROFANITY_RE = new RegExp(`\\b(${BASIC_PROFANITY.join("|")})\\b`, "gi");

/** Replace listed words with their first letter + asterisks (keeps length cues). */
export function maskProfanity(text: string): string {
  return (text ?? "").replace(PROFANITY_RE, (w) => w[0] + "*".repeat(Math.max(1, w.length - 1)));
}

export interface TranscriptShapeOptions {
  profanityFilter?: boolean;
}

export function shapeTranscript(raw: string, opts: TranscriptShapeOptions = {}): string {
  const normalized = normalizeTranscript(raw);
  return opts.profanityFilter ? maskProfanity(normalized) : normalized;
}

/**
 * Cloud voice pricing (USD) — published list prices, labelled "estimate" on
 * every surface (Constitution Art. IV.5). Local models cost $0 and never
 * produce an entry.
 */
export const CLOUD_VOICE_PRICING = {
  "groq:whisper-large-v3-turbo": { perHourUsd: 0.04 },
  "openai:gpt-4o-mini-transcribe": { perHourUsd: 0.18 },
  "openai:tts-1": { perMillionCharsUsd: 15 },
} as const;

export function estimateSttUsd(backend: "groq" | "openai", audioSeconds: number): number {
  const key = backend === "groq" ? "groq:whisper-large-v3-turbo" : "openai:gpt-4o-mini-transcribe";
  return Math.round(((audioSeconds / 3600) * CLOUD_VOICE_PRICING[key].perHourUsd) * 1e6) / 1e6;
}

export function estimateTtsUsd(chars: number): number {
  return Math.round(((chars / 1_000_000) * CLOUD_VOICE_PRICING["openai:tts-1"].perMillionCharsUsd) * 1e6) / 1e6;
}
