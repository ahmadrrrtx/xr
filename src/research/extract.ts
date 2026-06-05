/**
 * XR — evidence extraction layer.
 *
 * Reads collected sources and pulls out structured Notes. Each note is tied to
 * exactly one sourceId and tagged fact | inference | opinion with a confidence.
 *
 * Critical integrity rule: a note's `verified` flag is set by US (not the
 * model) based on whether the source content was actually FETCHED. If we only
 * have a search snippet, the note is marked unverified — XR never pretends to
 * have read a page it didn't fetch.
 */
import { randomUUID } from "node:crypto";
import type { StructuredCallDeps } from "./llm.ts";
import { structuredCall } from "./llm.ts";
import type { Source, Note, Claim, Confidence } from "./types.ts";

const SYSTEM = [
  "You are XR's evidence extractor. You read ONE source at a time and extract key points.",
  "Reply with ONLY a JSON object: {\"notes\": [{\"text\": string, \"claim\": \"fact\"|\"inference\"|\"opinion\", \"confidence\": \"high\"|\"medium\"|\"low\"}]}",
  "Rules:",
  "- Extract only points that are actually present in the provided source text/snippet.",
  "- Do NOT add outside knowledge. If the source is thin, return few or zero notes.",
  "- claim=fact: a concrete, checkable statement the source asserts.",
  "- claim=inference: a reasonable interpretation the source supports but does not state outright.",
  "- claim=opinion: a subjective judgment or recommendation.",
  "- confidence reflects how clearly the source supports the point.",
  "- Never invent statistics, quotes, or sources.",
].join("\n");

/** Extract notes for a single source. Returns [] on failure (never throws up). */
export async function extractFromSource(
  deps: StructuredCallDeps,
  topic: string,
  source: Source,
): Promise<Note[]> {
  // Use fetched content when available; otherwise the snippet (and mark unverified).
  const body = source.fetched && source.content ? source.content : source.snippet;
  if (!body || !body.trim()) return [];

  const user = [
    `Research topic: ${topic}`,
    `Source title: ${source.title}`,
    `Source domain: ${source.domain}`,
    source.fetched ? "Source type: FULL PAGE TEXT (verified by fetch)" : "Source type: SEARCH SNIPPET ONLY (not fetched)",
    "",
    "Source text:",
    body.slice(0, 6000),
  ].join("\n");

  let parsed: any = null;
  try {
    const { data } = await structuredCall<any>(deps, SYSTEM, user);
    parsed = data;
  } catch {
    return [];
  }

  const rawNotes = Array.isArray(parsed?.notes) ? parsed.notes : Array.isArray(parsed) ? parsed : [];
  const notes: Note[] = [];
  for (const n of rawNotes) {
    if (!n || typeof n.text !== "string" || !n.text.trim()) continue;
    notes.push({
      id: `n_${randomUUID().slice(0, 6)}`,
      sourceId: source.id,
      text: n.text.trim(),
      claim: normClaim(n.claim),
      // We DOWNGRADE confidence for snippet-only sources — they aren't verified.
      confidence: source.fetched ? normConf(n.confidence) : downgrade(normConf(n.confidence)),
      verified: source.fetched, // integrity rule: only fetched == verified
    });
  }
  return notes;
}

function normClaim(c: unknown): Claim {
  if (c === "fact" || c === "opinion") return c;
  return "inference"; // safe default: never over-claim "fact"
}

function normConf(c: unknown): Confidence {
  if (c === "high" || c === "low") return c;
  return "medium";
}

function downgrade(c: Confidence): Confidence {
  return c === "high" ? "medium" : "low";
}
