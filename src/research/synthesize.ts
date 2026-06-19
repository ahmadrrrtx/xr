/** XR Stage 7 — grounded synthesis, claim ledger and contradiction detection. */
import { randomUUID } from "node:crypto";
import type { StructuredCallDeps } from "./llm.ts";
import { structuredCall } from "./llm.ts";
import type { Source, Note, Synthesis, Contradiction, Confidence, ResearchClaim } from "./types.ts";

const SYSTEM = [
  "You are XR's research synthesizer. Write analyst-grade output using ONLY the evidence ledger.",
  "Reply with ONLY JSON:",
  `{"shortAnswer": string, "executiveSummary": [string], "report": string, "openQuestions": [string], "overallConfidence": "high"|"medium"|"low", "contradictions": [{"topic": string, "sourceIds": [string], "evidenceIds": [string], "description": string, "severity": "high"|"medium"|"low"}], "claims": [{"text": string, "kind": "fact"|"inference"|"opinion"|"uncertainty", "confidence": "high"|"medium"|"low", "sourceIds": [string], "evidenceIds": [string]}]}`,
  "Rules:",
  "- Cite source ids inline for every factual claim, e.g. [s1] or [s1][s3].",
  "- Do not use outside knowledge and do not create citations not present in Sources.",
  "- Separate facts, inference, uncertainty, and opinion.",
  "- Surface contradictions and evidence gaps instead of smoothing them over.",
  "- If evidence is weak or snippet-only, say so plainly.",
].join("\n");

export async function synthesize(deps: StructuredCallDeps, topic: string, objective: string, sources: Source[], notes: Note[]): Promise<{ synthesis: Synthesis; contradictions: Contradiction[]; claims: ResearchClaim[] }> {
  if (notes.length === 0) return { synthesis: emptySynthesis(topic, sources), contradictions: [], claims: [] };
  const deterministicContradictions = detectContradictions(notes);
  const deterministicClaims = buildClaims(notes, deterministicContradictions);
  let parsed: any = null;
  try { parsed = (await structuredCall<any>(deps, SYSTEM, buildPrompt(topic, objective, sources, notes))).data; } catch { parsed = null; }

  if (!parsed || typeof parsed !== "object") {
    return { synthesis: fallbackSynthesis(topic, sources, notes), contradictions: deterministicContradictions, claims: deterministicClaims };
  }

  const allowedSourceIds = new Set(sources.map((s) => s.id));
  const allowedEvidenceIds = new Set(notes.map((n) => n.id));
  const modelContradictions = Array.isArray(parsed.contradictions) ? parsed.contradictions.map((c: any) => normalizeContradiction(c, topic, allowedSourceIds, allowedEvidenceIds)).filter(Boolean) as Contradiction[] : [];
  const claims = Array.isArray(parsed.claims) ? parsed.claims.map((c: any) => normalizeClaim(c, notes, allowedSourceIds, allowedEvidenceIds)).filter(Boolean) as ResearchClaim[] : deterministicClaims;
  const contradictions = mergeContradictions([...deterministicContradictions, ...modelContradictions]);
  const fallback = fallbackSynthesis(topic, sources, notes);
  const synthesis: Synthesis = {
    shortAnswer: typeof parsed.shortAnswer === "string" && parsed.shortAnswer.trim() ? enforceCitations(parsed.shortAnswer.trim(), sources) : fallback.shortAnswer,
    executiveSummary: Array.isArray(parsed.executiveSummary) ? parsed.executiveSummary.filter((s: any) => typeof s === "string" && s.trim()).slice(0, 8).map((s: string) => enforceCitations(s, sources)) : fallback.executiveSummary,
    report: typeof parsed.report === "string" && parsed.report.trim() ? enforceCitations(parsed.report.trim(), sources) : fallback.report,
    openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions.filter((s: any) => typeof s === "string" && s.trim()).slice(0, 10) : fallback.openQuestions,
    overallConfidence: normConf(parsed.overallConfidence, notes),
  };
  return { synthesis, contradictions, claims };
}

function buildPrompt(topic: string, objective: string, sources: Source[], notes: Note[]): string {
  const lines: string[] = [`Research topic: ${topic}`, `Objective: ${objective}`, "", "Sources (ONLY these ids may be cited):"];
  for (const s of sources) lines.push(`[${s.id}] ${s.title} — ${s.url} — type=${s.type}, trust=${s.trust.toFixed(2)}, freshness=${s.freshness.label}, ${s.fetched ? "fetched" : "snippet-only"}`);
  lines.push("", "Evidence ledger:");
  for (const n of notes) lines.push(`[${n.id}] [${n.sourceId}] (${n.kind}/${n.confidence}/${n.strength}${n.verified ? "" : "/unverified"}) ${n.text}${n.quote ? ` | quote: "${n.quote}"` : ""}`);
  lines.push("", "Write the synthesis. Every factual sentence in report must cite source ids from the list above.");
  return lines.join("\n");
}

export function detectContradictions(notes: Note[]): Contradiction[] {
  const out: Contradiction[] = [];
  const norm = (s: string) => s.toLowerCase();
  const pairs: Array<[RegExp, RegExp, string]> = [
    [/\bincrease[ds]?|higher|grew|growth|faster|better|supports?|enabled?\b/i, /\bdecrease[ds]?|lower|fell|decline|slower|worse|does not support|disabled?\b/i, "directional disagreement"],
    [/\bsafe|secure|recommended|stable\b/i, /\bunsafe|insecure|not recommended|unstable|deprecated\b/i, "safety/recommendation disagreement"],
    [/\bavailable|supported|released\b/i, /\bunavailable|unsupported|not released|removed\b/i, "availability disagreement"],
  ];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      if (notes[i].sourceId === notes[j].sourceId) continue;
      const a = norm(notes[i].text), b = norm(notes[j].text);
      const overlap = tokenOverlap(a, b);
      if (overlap < 0.18) continue;
      for (const [pos, neg, label] of pairs) {
        if ((pos.test(a) && neg.test(b)) || (neg.test(a) && pos.test(b))) {
          out.push({ id: `c_${randomUUID().slice(0, 8)}`, topic: label, sourceIds: [notes[i].sourceId, notes[j].sourceId], evidenceIds: [notes[i].id, notes[j].id], description: `${notes[i].text} / ${notes[j].text}`, severity: notes[i].verified && notes[j].verified ? "medium" : "low", status: "open" });
          break;
        }
      }
    }
  }
  return mergeContradictions(out).slice(0, 12);
}

export function buildClaims(notes: Note[], contradictions: Contradiction[] = []): ResearchClaim[] {
  const byText = new Map<string, ResearchClaim>();
  for (const n of notes) {
    const key = n.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
    const existing = byText.get(key);
    if (existing) {
      if (!existing.sourceIds.includes(n.sourceId)) existing.sourceIds.push(n.sourceId);
      existing.evidenceIds.push(n.id);
      existing.corroboratedBy = existing.sourceIds.slice(1);
      existing.confidence = upgrade(existing.confidence, n.confidence);
    } else {
      byText.set(key, { id: `cl_${randomUUID().slice(0, 8)}`, text: n.text, kind: n.kind, confidence: n.confidence, sourceIds: [n.sourceId], evidenceIds: [n.id], corroboratedBy: [], contradictedBy: [], status: n.verified ? "supported" : "unverified" });
    }
  }
  for (const c of contradictions) {
    for (const claim of byText.values()) {
      if (claim.evidenceIds.some((id) => c.evidenceIds.includes(id))) { claim.status = "contested"; claim.contradictedBy = [...new Set([...claim.contradictedBy, ...c.sourceIds.filter((id) => !claim.sourceIds.includes(id))])]; }
    }
  }
  return Array.from(byText.values()).slice(0, 40);
}

export function fallbackSynthesis(topic: string, sources: Source[], notes: Note[]): Synthesis {
  const verified = notes.filter((n) => n.verified);
  const base = (verified.length ? verified : notes).slice(0, 8);
  const bullets = base.map((n) => `${n.text} [${n.sourceId}]`);
  const report = [
    "## Summary",
    `XR assembled this report from ${notes.length} evidence block(s) across ${sources.length} source(s).`,
    verified.length ? `${verified.length} evidence block(s) came from fetched source text.` : "No evidence block was fully verified from fetched page text; treat findings as tentative.",
    "",
    "## Key findings",
    ...base.map((n) => `- (${n.kind}/${n.confidence}${n.verified ? "" : ", unverified"}) ${n.text} [${n.sourceId}]`),
  ].join("\n");
  return { shortAnswer: bullets[0] ?? `Insufficient verified evidence was collected on: ${topic}.`, executiveSummary: bullets.length ? bullets : [`Evidence was too thin to answer ${topic}.`], report, openQuestions: ["Run a deeper refresh or add primary URLs if you need stronger confidence."], overallConfidence: verified.length >= 4 ? "medium" : "low" };
}

function emptySynthesis(topic: string, sources: Source[]): Synthesis {
  const reason = sources.length === 0 ? "No live sources could be collected." : "Sources were found but no evidence could be extracted.";
  return { shortAnswer: `XR could not gather enough evidence to answer: ${topic}.`, executiveSummary: [reason, "XR will not fabricate an answer or citations."], report: `## No conclusion\n\n${reason}\n\nXR will not fabricate an answer it has not verified.`, openQuestions: [`The entire question remains open: ${topic}`], overallConfidence: "low" };
}

function normalizeContradiction(c: any, topic: string, sourceIds: Set<string>, evidenceIds: Set<string>): Contradiction | null {
  if (!c || typeof c.description !== "string" || !c.description.trim()) return null;
  return { id: `c_${randomUUID().slice(0, 8)}`, topic: typeof c.topic === "string" ? c.topic : topic, sourceIds: Array.isArray(c.sourceIds) ? c.sourceIds.filter((s: any) => sourceIds.has(s)) : [], evidenceIds: Array.isArray(c.evidenceIds) ? c.evidenceIds.filter((s: any) => evidenceIds.has(s)) : [], description: c.description.trim(), severity: c.severity === "high" || c.severity === "low" ? c.severity : "medium", status: "open" };
}
function normalizeClaim(c: any, notes: Note[], sourceIds: Set<string>, evidenceIds: Set<string>): ResearchClaim | null {
  if (!c || typeof c.text !== "string" || !c.text.trim()) return null;
  const ev: string[] = Array.isArray(c.evidenceIds) ? c.evidenceIds.filter((s: unknown): s is string => typeof s === "string" && evidenceIds.has(s)) : [];
  const src: string[] = Array.isArray(c.sourceIds) ? c.sourceIds.filter((s: unknown): s is string => typeof s === "string" && sourceIds.has(s)) : notes.filter((n) => ev.includes(n.id)).map((n) => n.sourceId);
  return { id: `cl_${randomUUID().slice(0, 8)}`, text: c.text.trim(), kind: c.kind === "fact" || c.kind === "opinion" || c.kind === "uncertainty" ? c.kind : "inference", confidence: c.confidence === "high" || c.confidence === "low" ? c.confidence : "medium", sourceIds: [...new Set(src)], evidenceIds: ev, corroboratedBy: [], contradictedBy: [], status: src.length ? "supported" : "weak" };
}
function normConf(c: unknown, notes: Note[]): Confidence { if (c === "high" || c === "medium" || c === "low") return c; const verified = notes.filter((n) => n.verified).length; return verified >= 6 ? "high" : verified >= 2 ? "medium" : "low"; }
function enforceCitations(s: string, sources: Source[]): string { const allowed = new Set(sources.map((x) => x.id)); return s.replace(/\[s\d+\]/g, (m) => allowed.has(m.slice(1, -1)) ? m : ""); }
function tokenOverlap(a: string, b: string): number { const ta = new Set(a.split(/[^a-z0-9]+/).filter((x) => x.length > 3)); const tb = new Set(b.split(/[^a-z0-9]+/).filter((x) => x.length > 3)); if (!ta.size || !tb.size) return 0; let both = 0; for (const t of ta) if (tb.has(t)) both++; return both / Math.min(ta.size, tb.size); }
function mergeContradictions(cs: Contradiction[]): Contradiction[] { const seen = new Set<string>(); const out: Contradiction[] = []; for (const c of cs) { const key = [...c.sourceIds].sort().join("|") + c.topic; if (!seen.has(key)) { seen.add(key); out.push(c); } } return out; }
function upgrade(a: Confidence, b: Confidence): Confidence { return a === "high" || b === "high" ? "high" : a === "medium" || b === "medium" ? "medium" : "low"; }
