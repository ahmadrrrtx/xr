/**
 * XR Phase 11 — code-aware token approximation.
 *
 * XR has no tiktoken / official tokenizer. `stream-metrics.ts` falls back to
 * chars/4 and documents that as an estimate. The repo map MUST stay inside a
 * declared budget, so we use a deterministic estimator that is:
 *
 *   - better than raw character count for code (identifiers, punctuation);
 *   - NEVER claimed to be exact model tokens;
 *   - stable across runs (no locale / Unicode-normalization surprises).
 *
 * Measured (see benchmarks/repo-intelligence): this typically lands within
 * ~15–25% of chars/4 on mixed TS/Python, and is the budget authority for
 * `repo.map`. Reports must say "approximate tokens (xr-code-approx-v1)".
 */

export const TOKEN_ESTIMATOR_ID = "xr-code-approx-v1" as const;

/**
 * Count approximate tokens in `text`.
 *
 * Rules (deterministic):
 *   1. Newlines / whitespace runs are 0 (layout is free).
 *   2. A punctuation cluster (`=>`, `::`, `...`, single `{`, etc.) is 1.
 *   3. An identifier / number is 1, plus 1 extra per 5 chars after the first 4
 *      (so `ToolRegistryService` is more than one token, `id` is one).
 *   4. Other non-ASCII runs count as 1 + extras similarly.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c <= 32) {
      i += 1;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentPart(text.charCodeAt(j))) j += 1;
      const len = j - i;
      tokens += 1 + Math.max(0, Math.floor((len - 4) / 5));
      i = j;
      continue;
    }
    if (isDigit(c)) {
      let j = i + 1;
      while (j < n && (isDigit(text.charCodeAt(j)) || text.charCodeAt(j) === 46)) j += 1;
      tokens += 1;
      i = j;
      continue;
    }
    // punctuation / operator cluster
    let j = i + 1;
    while (j < n) {
      const d = text.charCodeAt(j);
      if (d <= 32 || isIdentStart(d) || isDigit(d)) break;
      j += 1;
    }
    tokens += 1;
    i = j;
  }
  return tokens;
}

function isIdentStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c >= 128;
}

function isIdentPart(c: number): boolean {
  return isIdentStart(c) || isDigit(c);
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

/** Split a task string into ranking terms (lowercase, de-punctuated). */
export function tokenizeQuery(text: string): string[] {
  const raw = text.toLowerCase().split(/[^a-z0-9_./-]+/g).filter((t) => t.length >= 2);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (STOP.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    for (const part of t.split(/[./_-]/g)) {
      if (part.length >= 3 && !STOP.has(part) && !seen.has(part)) {
        seen.add(part);
        out.push(part);
      }
    }
  }
  return out;
}

const STOP = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "your",
  "fix", "add", "make", "please", "just", "some", "have", "been",
  "improve", "update", "change", "using", "when", "what", "where",
]);
