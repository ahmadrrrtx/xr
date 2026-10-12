/**
 * XR — plain-text chunking for chat surfaces (Phase 26 shared layer).
 *
 * Every platform caps message length (Discord 2000, WhatsApp ~1500, Telegram
 * 4096 with its own MarkdownV2-aware splitter). This module is the surface-
 * neutral half: split plain text at a natural boundary, mark the continuation
 * so the reader knows more is coming, and never leave a code fence open when a
 * balanced cut was possible.
 *
 * Telegram does NOT use this for MarkdownV2 bodies — escaping changes the byte
 * length, so `telegram/markdown.ts` owns that splitter. This is for surfaces
 * whose formatting does not survive a re-split (Discord/WhatsApp markdown, and
 * anywhere the text is plain).
 */

export interface ChunkOptions {
  /** Hard cap for one message, continuation marker included. */
  maxLength: number;
  /** Appended to every chunk that is not the last one. Counts against maxLength. */
  continuation?: string;
}

/** Infinite-loop guard: a pathological separator cannot spin the splitter. */
const MAX_CHUNKS = 200;

/**
 * Split `text` into chunks no longer than `maxLength`. Preference order for a
 * cut: paragraph break, line break, space, hard cut. The separator stays with
 * the earlier chunk, so a chunk never starts with a blank line.
 */
export function chunkText(text: string, opts: ChunkOptions): string[] {
  const maxLength = Math.max(1, Math.floor(opts.maxLength));
  const continuation = opts.continuation ?? "";
  if (text.length <= maxLength) return [text];

  const budget = Math.max(1, maxLength - continuation.length);
  const out: string[] = [];
  let rest = text;

  while (rest.length > maxLength && out.length < MAX_CHUNKS) {
    const rawCut = pickCut(rest, budget);
    const piece = splitFenceSafe(rest, rawCut, budget);
    if (piece.length === 0) break; // defensive: never loop on an empty piece
    out.push(piece.replace(/\s+$/, "") + continuation);
    rest = rest.slice(piece.length).replace(/^\s+/, "");
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

/** Where to cut: the latest natural boundary in the back half of the budget. */
function pickCut(text: string, budget: number): number {
  const hard = Math.min(budget, text.length);
  const head = text.slice(0, hard);
  const floor = Math.floor(hard / 2);
  for (const sep of ["\n\n", "\n", " "]) {
    const at = head.lastIndexOf(sep);
    if (at >= floor) return at + sep.length;
  }
  return hard;
}

/**
 * Keep a cut outside a fenced code block when possible: if the proposed cut
 * would land inside a fence, cut before the fence opened instead. A single
 * fence longer than the budget cannot be helped — the hard cut stands and the
 * platform renders the open fence as a code block anyway.
 */
function splitFenceSafe(text: string, cut: number, budget: number): string {
  const head = text.slice(0, cut);
  const opener = unmatchedFenceStart(head);
  if (opener === -1) return head;
  const floor = Math.floor(budget * 0.25);
  return opener >= floor ? text.slice(0, opener) : head;
}

/** Index of the last unmatched ``` opener in `head`, or -1 when balanced. */
function unmatchedFenceStart(head: string): number {
  let search = 0;
  let openAt = -1;
  let open = false;
  for (;;) {
    const at = head.indexOf("```", search);
    if (at === -1) break;
    if (!open) {
      openAt = at;
      open = true;
    } else {
      openAt = -1;
      open = false;
    }
    search = at + 3;
  }
  return openAt;
}
