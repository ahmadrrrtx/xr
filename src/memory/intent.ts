/**
 * XR v0.9 — memory intent parser.
 *
 * Deterministic, dependency-free recognition of memory phrases in natural
 * language so chat AND voice share one source of truth:
 *
 *   "remember I prefer TypeScript and Bun"   → add (preference)
 *   "remember this project is called XR"      → add (project)
 *   "don't remember my email"                 → add exclusion
 *   "what do you know about my preferences?"  → recall/list
 *   "forget that I use vim"                    → forget (by content)
 *
 * It NEVER guesses silently — callers decide whether to confirm. The parser
 * only classifies; it does not touch the store.
 */
import type { MemoryCategory } from "./types.ts";

export type MemoryIntent =
  | { kind: "add"; content: string; category: MemoryCategory }
  | { kind: "forget"; query: string }
  | { kind: "recall"; query: string }
  | { kind: "none" };

const FORGET_RE =
  /^\s*(?:please\s+)?(?:forget|delete|remove)\s+(?:that\s+|the\s+)?(?:note\s+|memory\s+)?(?:about\s+)?(.+?)\s*[.?!]*\s*$/i;

const DONT_REMEMBER_RE =
  /^\s*(?:please\s+)?(?:don'?t|do not|never)\s+(?:remember|store|save|keep)\s+(.+?)\s*[.?!]*\s*$/i;

const REMEMBER_RE =
  /^\s*(?:please\s+)?(?:remember|note|keep in mind|memori[sz]e|save)\s+(?:that\s+)?(.+?)\s*[.?!]*\s*$/i;

const RECALL_RE =
  /^\s*(?:what (?:do )?you (?:know|remember)|what do you have|what'?s in (?:your )?memory|show (?:me )?(?:your )?memor(?:y|ies)|list (?:your )?memor(?:y|ies)|recall)\b(.*)$/i;

/** Classify a single line of user input as a memory intent. */
export function parseMemoryIntent(text: string): MemoryIntent {
  const line = text.trim();
  if (!line) return { kind: "none" };

  // Order matters: "don't remember" must beat "remember".
  const dont = line.match(DONT_REMEMBER_RE);
  if (dont) return { kind: "add", content: dont[1].trim(), category: "exclusion" };

  const recall = line.match(RECALL_RE);
  if (recall) return { kind: "recall", query: recall[1].trim() };

  const forget = line.match(FORGET_RE);
  if (forget) return { kind: "forget", query: forget[1].trim() };

  const remember = line.match(REMEMBER_RE);
  if (remember) {
    const content = remember[1].trim();
    return { kind: "add", content, category: classify(content) };
  }

  return { kind: "none" };
}

/**
 * Pick the most likely category from the remembered text. Conservative: when
 * unsure it falls back to "fact" (the most neutral bucket).
 */
export function classify(content: string): MemoryCategory {
  const c = content.toLowerCase();
  if (/\bproject\b|\bcalled\b|\brepo(sitory)?\b|\bcodebase\b/.test(c)) return "project";
  if (
    /\bi prefer\b|\bi like\b|\bi use\b|\bi want\b|\bmy (?:preferred|favou?rite|default)\b|\balways use\b|\bcoding style\b|\bprovider\b|\bmodel\b/.test(
      c,
    )
  )
    return "preference";
  if (/\bwhen i\b|\bworkflow\b|\bevery time\b|\bprocedure\b|\bsteps?\b|\bprocess\b/.test(c))
    return "workflow";
  return "fact";
}
