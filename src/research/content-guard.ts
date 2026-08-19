/**
 * XR Phase 10 — web content = untrusted data.
 *
 * Every scraped page, search snippet, crawl result and extracted field is
 * UNTRUSTED EXTERNAL DATA. Before it can reach model context it is:
 *   1. scanned for injection signatures (`scanUntrusted` — Phase 07),
 *   2. framed with an explicit DATA delimiter (`frameToolOutput` — GAP-003),
 *   3. audited when a signature is found (defense-in-depth, never a proof of
 *      safety — the scanner is non-blocking by design, matching Phase 07).
 *
 * This is the same tool-output framing model the agent loop already applies;
 * research reuses it instead of building a second one.
 */

import { frameToolOutput } from "../security/tool-output.ts";
import { scanUntrusted } from "../security/guard.ts";

export interface ResearchContentScan {
  flagged: boolean;
  signatures: string[];
  /** The framed content — safe to place in model context as DATA. */
  framed: string;
}

/**
 * Scan + frame a chunk of research content (page text, snippet, metadata,
 * extraction field) before it enters model context.
 */
export function guardResearchContent(kind: string, content: string): ResearchContentScan {
  const framed = frameToolOutput(kind, content ?? "");
  return { flagged: framed.flagged, signatures: framed.signatures, framed: framed.content };
}

/** Scan-only (no framing) — for auditing extracted fields cheaply. */
export function scanResearchContent(content: string): { flagged: boolean; signatures: string[] } {
  const res = scanUntrusted(content ?? "");
  return { flagged: res.flagged, signatures: res.signatures };
}
