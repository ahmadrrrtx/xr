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
  // XR 4.5 — the remaining verbs a consent-first memory system needs (§8.1).
  // Distinguishing these means "stop using it" and "erase it" are never the
  // same action, and neither is ever inferred silently.
  | { kind: "revoke"; query: string }
  | { kind: "correct"; query: string; replacement: string }
  | { kind: "export"; target?: string }
  | { kind: "inspect"; query: string }
  | { kind: "none" };

const FORGET_RE =
  /^\s*(?:please\s+)?(?:forget|delete|remove)\s+(?:that\s+|the\s+)?(?:note\s+|memory\s+)?(?:about\s+)?(.+?)\s*[.?!]*\s*$/i;

const DONT_REMEMBER_RE =
  /^\s*(?:please\s+)?(?:don'?t|do not|never)\s+(?:remember|store|save|keep)\s+(.+?)\s*[.?!]*\s*$/i;

const REMEMBER_RE =
  /^\s*(?:please\s+)?(?:remember|note|keep in mind|memori[sz]e|save)\s+(?:that\s+)?(.+?)\s*[.?!]*\s*$/i;

/** "revoke ..." / "stop using ..." — withdraw consent, keep the record. */
const REVOKE_RE =
  /^\s*(?:please\s+)?(?:revoke|withdraw|unapprove|stop using|stop remembering)\s+(?:consent\s+(?:for|to)\s+)?(?:that\s+|the\s+)?(?:memory\s+|note\s+)?(?:about\s+)?(.+?)\s*[.?!]*\s*$/i;

/** "actually X is Y" / "correct X to Y" — replace, preserving lineage. */
const CORRECT_RE =
  /^\s*(?:please\s+)?(?:correct|update|change|fix)\s+(?:that\s+|the\s+)?(?:memory\s+|note\s+)?(?:about\s+)?(.+?)\s+(?:to|with|into)\s+(.+?)\s*[.?!]*\s*$/i;

/** "actually, <new fact>" — a correction whose target is inferred by search. */
const ACTUALLY_RE = /^\s*(?:no,?\s+)?actually,?\s+(.+?)\s*[.?!]*\s*$/i;

/** "export my memory" — portability. */
const EXPORT_RE =
  /^\s*(?:please\s+)?(?:export|download|give me|dump)\s+(?:my\s+|your\s+|the\s+)?(?:memor(?:y|ies)|context|data)\b\s*(?:to\s+(\S+))?\s*[.?!]*\s*$/i;

/** "why did you ... " / "where did you learn ..." — provenance inspection. */
const INSPECT_RE =
  /^\s*(?:why\s+(?:did|do)\s+you\s+(?:know|remember|recall|say|use)|where\s+did\s+you\s+(?:learn|get|find)|how\s+do\s+you\s+know|what'?s?\s+the\s+source\s+(?:of|for))\b\s*(.*)$/i;

const RECALL_RE =
  /^\s*(?:what (?:do )?you (?:know|remember)|what do you have|what'?s in (?:your )?memory|show (?:me )?(?:your )?memor(?:y|ies)|list (?:your )?memor(?:y|ies)|recall)\b(.*)$/i;

/** Classify a single line of user input as a memory intent. */
export function parseMemoryIntent(text: string): MemoryIntent {
  const line = text.trim();
  if (!line) return { kind: "none" };

  // Order matters: "don't remember" must beat "remember".
  const dont = line.match(DONT_REMEMBER_RE);
  if (dont) return { kind: "add", content: dont[1].trim(), category: "exclusion" };

  // XR 4.5 — provenance questions must beat plain recall ("how do you know X?"
  // is an inspection request, not a request to recall X).
  const inspect = line.match(INSPECT_RE);
  if (inspect) return { kind: "inspect", query: (inspect[1] ?? "").trim() };

  const exp = line.match(EXPORT_RE);
  if (exp) return { kind: "export", ...(exp[1] ? { target: exp[1].trim() } : {}) };

  // Revoke must beat forget: "stop using" withdraws consent, it does not erase.
  const revoke = line.match(REVOKE_RE);
  if (revoke) return { kind: "revoke", query: revoke[1].trim() };

  const correct = line.match(CORRECT_RE);
  if (correct) {
    return { kind: "correct", query: correct[1].trim(), replacement: correct[2].trim() };
  }

  const recall = line.match(RECALL_RE);
  if (recall) return { kind: "recall", query: recall[1].trim() };

  const forget = line.match(FORGET_RE);
  if (forget) return { kind: "forget", query: forget[1].trim() };

  // "actually, <new fact>" — a correction with an inferred target. Placed after
  // the explicit forms so it never shadows them.
  const actually = line.match(ACTUALLY_RE);
  if (actually) {
    const replacement = actually[1].trim();
    return { kind: "correct", query: replacement, replacement };
  }

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
