/** XR Stage 7 — evidence extraction with quotes and claim normalization. */
import { randomUUID } from "node:crypto";
import type { StructuredCallDeps } from "./llm.ts";
import { structuredCall } from "./llm.ts";
import type { Source, Note, ClaimKind, Confidence, EvidenceStrength } from "./types.ts";

const SYSTEM = [
  "You are XR's evidence extractor. You read ONE source and extract an auditable evidence ledger.",
  "Reply with ONLY JSON: {\"evidence\": [{\"text\": string, \"quote\": string, \"kind\": \"fact\"|\"inference\"|\"opinion\"|\"uncertainty\", \"confidence\": \"high\"|\"medium\"|\"low\", \"relevance\": number}]}",
  "Rules:",
  "- Extract only points present in the provided source text/snippet.",
  "- quote must be a short exact quote when full text is available; omit only when impossible.",
  "- Do not invent statistics, dates, titles, authors, citations, or URLs.",
  "- Mark uncertainty when the source is ambiguous, partial, or caveated.",
  "- Prefer fewer high-signal evidence blocks over generic summaries.",
].join("\n");

export async function extractFromSource(deps: StructuredCallDeps, topic: string, source: Source, maxEvidence = 6): Promise<Note[]> {
  const body = source.fetched && source.content ? source.content : source.snippet;
  if (!body?.trim()) return [];

  const user = [
    `Research topic: ${topic}`,
    `Source id: ${source.id}`,
    `Title: ${source.title}`,
    `URL: ${source.url}`,
    `Domain: ${source.domain}`,
    `Source quality: ${source.quality.toFixed(2)} (${source.trustReason})`,
    source.fetched ? "Source type: FETCHED FULL/PARTIAL PAGE TEXT" : "Source type: SEARCH SNIPPET ONLY (not verified)",
    "",
    "Source text:",
    body.slice(0, 9000),
    "",
    `Return at most ${maxEvidence} evidence blocks.`,
  ].join("\n");

  let parsed: any = null;
  try { parsed = (await structuredCall<any>(deps, SYSTEM, user)).data; } catch { parsed = null; }
  const raw = Array.isArray(parsed?.evidence) ? parsed.evidence : Array.isArray(parsed?.notes) ? parsed.notes : Array.isArray(parsed) ? parsed : [];
  const notes: Note[] = [];
  for (const n of raw.slice(0, maxEvidence)) {
    if (!n || typeof n.text !== "string" || !n.text.trim()) continue;
    const confidence = source.fetched ? normConf(n.confidence) : downgrade(normConf(n.confidence));
    const kind = normKind(n.kind ?? n.claim);
    const quote = typeof n.quote === "string" && n.quote.trim() ? n.quote.trim().slice(0, 500) : findQuote(n.text, body);
    notes.push({
      id: `e_${randomUUID().slice(0, 8)}`,
      sourceId: source.id,
      text: sanitize(n.text, 900),
      quote,
      kind,
      claim: kind,
      confidence,
      strength: strengthFor(source, confidence),
      verified: source.fetched,
      relevance: clamp(Number(n.relevance ?? source.relevance ?? 0.5)),
      extractedAt: Date.now(),
    });
  }
  return notes;
}

export function deterministicExtract(topic: string, source: Source, maxEvidence = 4): Note[] {
  const body = (source.fetched && source.content ? source.content : source.snippet).replace(/\s+/g, " ").trim();
  if (!body) return [];
  const sentences = body.split(/(?<=[.!?])\s+/).filter((s) => s.length > 40 && s.length < 500);
  const topicTerms = topic.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2);
  const picked = sentences
    .map((s) => ({ s, score: topicTerms.filter((t) => s.toLowerCase().includes(t)).length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxEvidence);
  return picked.map(({ s }) => ({
    id: `e_${randomUUID().slice(0, 8)}`,
    sourceId: source.id,
    text: sanitize(s, 700),
    quote: sanitize(s, 400),
    kind: "fact",
    claim: "fact",
    confidence: source.fetched ? "medium" : "low",
    strength: source.fetched && source.trust >= 0.6 ? "moderate" : "weak",
    verified: source.fetched,
    relevance: source.relevance,
    extractedAt: Date.now(),
  }));
}

function normKind(c: unknown): ClaimKind { return c === "fact" || c === "opinion" || c === "uncertainty" ? c : "inference"; }
function normConf(c: unknown): Confidence { return c === "high" || c === "low" ? c : "medium"; }
function downgrade(c: Confidence): Confidence { return c === "high" ? "medium" : "low"; }
function strengthFor(source: Source, conf: Confidence): EvidenceStrength { if (source.fetched && source.trust >= 0.75 && conf === "high") return "strong"; if (source.fetched && conf !== "low") return "moderate"; return "weak"; }
function clamp(n: number): number { return Number(Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0.5)).toFixed(2)); }
function sanitize(s: string, max: number): string { return s.replace(/\s+/g, " ").trim().slice(0, max); }
function findQuote(text: string, body: string): string | undefined { const clean = sanitize(text, 120); return body.includes(clean) ? clean : undefined; }
