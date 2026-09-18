/**
 * Phase 4 · Semantic end-of-turn classifier (voice backlog #6).
 *
 * Two-stage endpointing, per the researched voice-UX target (VAD + partial
 * classifier):
 *   stage 1 — acoustic: the existing silence tail (SILENCE_TAIL_MS).
 *   stage 2 — semantic: when the tail is reached, the latest (provisional)
 *             transcript is classified. If it ends mid-thought — a filler,
 *             conjunction, preposition, article, or auxiliary — the silence
 *             requirement is EXTENDED once (EXTENDED_TAIL_MS) so the user can
 *             finish; otherwise the turn is processed immediately.
 *
 * Pure heuristics on the transcript: no model calls, deterministic, testable.
 * Fail-open: anything unparseable is treated as COMPLETE so endpointing can
 * never hang a turn.
 */

export interface IncompleteVerdict {
  incomplete: boolean;
  reason: string;
}

/** Words that, at the end of an utterance, strongly suggest more is coming. */
const TRAILING_INCOMPLETE = new Set([
  // conjunctions / subordinators
  "and", "but", "or", "so", "because", "since", "while", "although", "though",
  "if", "when", "whenever", "whereas", "than", "that", "then", "once", "unless", "until",
  // prepositions
  "to", "of", "for", "with", "about", "into", "onto", "in", "on", "at", "from",
  "by", "as", "over", "under", "between", "after", "before", "during", "without",
  // articles / determiners / quantifiers
  "the", "a", "an", "my", "your", "his", "her", "its", "our", "their",
  "some", "any", "each", "every", "this", "these", "those", "another", "other",
  // auxiliaries / modals / copulas
  "is", "am", "are", "was", "were", "be", "been", "being",
  "will", "would", "can", "could", "shall", "should", "may", "might", "must",
  "have", "has", "had", "do", "does", "did",
  // fillers / hedges
  "um", "uh", "er", "hmm", "like", "basically", "actually", "literally", "well",
  "also", "plus", "maybe", "probably", "just", "kinda", "sorta",
]);

/**
 * Classify the latest transcript: is the speaker probably mid-turn?
 * Signals (strongest first): trailing comma/dash, terminal punctuation
 * (complete), trailing incomplete-word, else complete (fail-open).
 */
export function looksIncomplete(transcript: string): IncompleteVerdict {
  const t = (transcript ?? "").replace(/\s+/g, " ").trim();
  if (!t) return { incomplete: false, reason: "empty" };

  // Trailing comma / dash / ellipsis-free colon → the sentence is open.
  if (/[,;:—-]$/.test(t)) return { incomplete: true, reason: "trailing-comma" };

  // Terminal punctuation (allow closing quotes/brackets after it) → complete.
  if (/[.!?]["')\]]*$/.test(t)) return { incomplete: false, reason: "terminal-punctuation" };

  const last = t.toLowerCase().replace(/[^a-z' ]/g, "").trim().split(" ").pop() ?? "";
  const word = last.replace(/^'+|'+$/g, "");
  if (TRAILING_INCOMPLETE.has(word)) return { incomplete: true, reason: `trailing-word:${word}` };

  return { incomplete: false, reason: "complete" };
}

/** Default tails (ms). Base = acoustic; extended = one semantic reprieve. */
export const SILENCE_TAIL_BASE_MS = 700;
export const SILENCE_TAIL_EXTENDED_MS = 1500;
/** Wait at most this long past the base tail for the probe transcript. */
export const PROBE_GRACE_MS = 350;
/** Fire the provisional-transcript probe this far into the base tail. */
export const PROBE_AT_MS = 450;
