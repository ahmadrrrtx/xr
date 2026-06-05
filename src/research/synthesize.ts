/**
 * XR — synthesis + contradiction detection layer.
 *
 * Takes ranked sources + extracted notes and produces:
 *   - a short answer
 *   - an executive summary
 *   - a sectioned report
 *   - explicit open questions / uncertainty
 *   - detected contradictions between sources
 *
 * The synthesis prompt is built from REAL notes only and is instructed to cite
 * sources by their id (s1, s2, ...). The model is told never to introduce facts
 * that aren't in the notes — the report is grounded in collected evidence.
 *
 * On model failure we fall back to a deterministic synthesis assembled directly
 * from the notes, so a report is always produced.
 */
import type { StructuredCallDeps } from "./llm.ts";
import { structuredCall } from "./llm.ts";
import type { Source, Note, Synthesis, Contradiction, Confidence } from "./types.ts";

const SYSTEM = [
  "You are XR's research synthesizer. You write grounded, citation-aware research output.",
  "Reply with ONLY a JSON object:",
  `{"shortAnswer": string, "executiveSummary": [string], "report": string, "openQuestions": [string], "overallConfidence": "high"|"medium"|"low", "contradictions": [{"topic": string, "sourceIds": [string], "description": string}]}`,
  "Rules:",
  "- Ground EVERY claim in the provided notes. Do not add outside facts.",
  "- Cite sources inline using their ids in brackets, e.g. [s1] or [s2][s4].",
  "- Distinguish facts from inference and opinion where it matters.",
  "- 'report' is markdown with clear sections (## headings).",
  "- 'openQuestions' lists what the evidence could NOT resolve. Be honest.",
  "- 'overallConfidence' reflects source quality and corroboration, not how nice it sounds.",
  "- 'contradictions' lists genuine disagreements between sources; [] if none.",
  "- If evidence is thin, say so plainly. Never fabricate certainty.",
].join("\n");

export async function synthesize(
  deps: StructuredCallDeps,
  topic: string,
  objective: string,
  sources: Source[],
  notes: Note[],
): Promise<{ synthesis: Synthesis; contradictions: Contradiction[] }> {
  if (notes.length === 0) {
    return {
      synthesis: emptySynthesis(topic, sources),
      contradictions: [],
    };
  }

  const user = buildSynthesisPrompt(topic, objective, sources, notes);

  let parsed: any = null;
  try {
    const { data } = await structuredCall<any>(deps, SYSTEM, user);
    parsed = data;
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== "object") {
    return { synthesis: fallbackSynthesis(topic, sources, notes), contradictions: [] };
  }

  const contradictions: Contradiction[] = Array.isArray(parsed.contradictions)
    ? parsed.contradictions
        .filter((c: any) => c && typeof c.description === "string")
        .map((c: any) => ({
          topic: typeof c.topic === "string" ? c.topic : topic,
          sourceIds: Array.isArray(c.sourceIds) ? c.sourceIds.filter((s: any) => typeof s === "string") : [],
          description: c.description,
        }))
    : [];

  const synthesis: Synthesis = {
    shortAnswer:
      typeof parsed.shortAnswer === "string" && parsed.shortAnswer.trim()
        ? parsed.shortAnswer.trim()
        : fallbackSynthesis(topic, sources, notes).shortAnswer,
    executiveSummary: Array.isArray(parsed.executiveSummary)
      ? parsed.executiveSummary.filter((s: any) => typeof s === "string" && s.trim())
      : fallbackSynthesis(topic, sources, notes).executiveSummary,
    report:
      typeof parsed.report === "string" && parsed.report.trim()
        ? parsed.report.trim()
        : fallbackSynthesis(topic, sources, notes).report,
    openQuestions: Array.isArray(parsed.openQuestions)
      ? parsed.openQuestions.filter((s: any) => typeof s === "string" && s.trim())
      : [],
    overallConfidence: normConf(parsed.overallConfidence, notes),
  };

  return { synthesis, contradictions };
}

function buildSynthesisPrompt(topic: string, objective: string, sources: Source[], notes: Note[]): string {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const lines: string[] = [];
  lines.push(`Research topic: ${topic}`);
  lines.push(`Objective: ${objective}`);
  lines.push("");
  lines.push("Sources (cite by id):");
  for (const s of sources) {
    lines.push(`  [${s.id}] ${s.title} — ${s.domain} (trust ${s.trust.toFixed(2)}${s.fetched ? ", fetched" : ", snippet-only"})`);
  }
  lines.push("");
  lines.push("Evidence notes (the ONLY facts you may use):");
  for (const n of notes) {
    const src = byId.get(n.sourceId);
    const tag = `${n.claim}/${n.confidence}${n.verified ? "" : "/unverified"}`;
    lines.push(`  [${n.sourceId}] (${tag}) ${n.text}`);
  }
  lines.push("");
  lines.push("Write the synthesis as specified. Cite source ids in brackets for every claim.");
  return lines.join("\n");
}

function normConf(c: unknown, notes: Note[]): Confidence {
  if (c === "high" || c === "medium" || c === "low") return c;
  // Derive from evidence: lots of verified high-confidence notes ⇒ higher.
  const verified = notes.filter((n) => n.verified).length;
  if (verified >= 5) return "high";
  if (verified >= 2) return "medium";
  return "low";
}

/** Deterministic synthesis from notes alone (used when the model is unavailable). */
export function fallbackSynthesis(topic: string, sources: Source[], notes: Note[]): Synthesis {
  const facts = notes.filter((n) => n.claim === "fact");
  const opinions = notes.filter((n) => n.claim === "opinion");
  const bullets = (facts.length ? facts : notes).slice(0, 6).map((n) => `${n.text} [${n.sourceId}]`);

  const reportLines: string[] = [];
  reportLines.push(`## Summary`);
  reportLines.push(`This report was assembled deterministically from ${notes.length} note(s) across ${sources.length} source(s) (model synthesis was unavailable).`);
  reportLines.push("");
  reportLines.push(`## Key points`);
  for (const n of notes.slice(0, 20)) {
    reportLines.push(`- (${n.claim}/${n.confidence}${n.verified ? "" : ", unverified"}) ${n.text} [${n.sourceId}]`);
  }
  if (opinions.length) {
    reportLines.push("");
    reportLines.push(`## Opinions encountered`);
    for (const n of opinions.slice(0, 8)) reportLines.push(`- ${n.text} [${n.sourceId}]`);
  }

  return {
    shortAnswer: bullets[0] ?? `Insufficient verified evidence was collected on: ${topic}.`,
    executiveSummary: bullets,
    report: reportLines.join("\n"),
    openQuestions: ["Model synthesis was unavailable; conclusions are limited to raw extracted notes."],
    overallConfidence: notes.some((n) => n.verified) ? "low" : "low",
  };
}

function emptySynthesis(topic: string, sources: Source[]): Synthesis {
  const reason =
    sources.length === 0
      ? "No sources could be collected (search may be unavailable or the egress allow-list blocks it)."
      : "Sources were found but no evidence notes could be extracted from them.";
  return {
    shortAnswer: `XR could not gather enough evidence to answer: ${topic}.`,
    executiveSummary: [reason, "Try enabling/adding a SearXNG host to your egress allow-list, or run with --deep."],
    report: `## No conclusion\n\n${reason}\n\nXR will not fabricate an answer it has not verified.`,
    openQuestions: [`The entire question remains open: ${topic}`],
    overallConfidence: "low",
  };
}
