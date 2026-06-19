/** XR Stage 7 — collaborative research planning. */
import { randomUUID } from "node:crypto";
import type { StructuredCallDeps } from "./llm.ts";
import { structuredCall } from "./llm.ts";
import type { DepthBudget, ResearchMode, ResearchPlan, ResearchQuestion } from "./types.ts";

const SYSTEM = [
  "You are XR's research planner. Create a source-first plan before any conclusions are formed.",
  "Reply with ONLY JSON: {\"objective\": string, \"strategy\": string, \"sourceRequirements\": [string], \"questions\": [{\"text\": string, \"queries\": [string]}]}",
  "Rules:",
  "- Prefer primary/official/current sources when possible.",
  "- Include queries that expose disagreements and negative evidence.",
  "- For compare mode include criteria and direct comparison queries.",
  "- For factcheck mode include exact-claim and primary-source queries.",
].join("\n");

export async function makePlan(deps: StructuredCallDeps, topic: string, budget: DepthBudget, mode: ResearchMode = "quick"): Promise<ResearchPlan> {
  const user = [`Topic: ${topic}`, `Mode: ${mode}`, `Max questions: ${budget.maxQuestions}`, "Design the research plan now."].join("\n");
  let parsed: any = null;
  try { parsed = (await structuredCall<any>(deps, SYSTEM, user)).data; } catch { parsed = null; }
  const questions = normalizeQuestions(parsed?.questions, budget.maxQuestions);
  if (!questions.length) return fallbackPlan(topic, mode);
  return {
    topic,
    objective: typeof parsed?.objective === "string" && parsed.objective.trim() ? parsed.objective.trim() : `Research: ${topic}`,
    mode,
    strategy: typeof parsed?.strategy === "string" && parsed.strategy.trim() ? parsed.strategy.trim() : "Gather authoritative sources first, extract evidence, then synthesize with citations and contradictions.",
    sourceRequirements: Array.isArray(parsed?.sourceRequirements) ? parsed.sourceRequirements.filter((s: any) => typeof s === "string" && s.trim()).slice(0, 8) : defaultRequirements(mode),
    questions,
    createdAt: Date.now(),
  };
}

function normalizeQuestions(raw: unknown, max: number): ResearchQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ResearchQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q.text !== "string" || !q.text.trim()) continue;
    const queries = Array.isArray(q.queries) ? q.queries.filter((s: unknown) => typeof s === "string" && s.trim()).map((s: string) => s.trim().slice(0, 280)) : [];
    out.push({ id: `q_${randomUUID().slice(0, 6)}`, text: q.text.trim(), queries: queries.length ? queries : [q.text.trim()] });
    if (out.length >= max) break;
  }
  return out;
}

export function fallbackPlan(topic: string, mode: ResearchMode = "quick"): ResearchPlan {
  const t = topic.trim();
  const questions: ResearchQuestion[] = [
    { id: `q_${randomUUID().slice(0, 6)}`, text: `What are the most authoritative current sources on ${t}?`, queries: [t, `${t} official documentation`, `${t} primary source`] },
    { id: `q_${randomUUID().slice(0, 6)}`, text: `What key facts are established about ${t}?`, queries: [`${t} facts`, `${t} latest 2026`] },
    { id: `q_${randomUUID().slice(0, 6)}`, text: `What disagreements or limitations exist for ${t}?`, queries: [`${t} controversy`, `${t} limitations`, `${t} criticism`] },
  ];
  if (mode === "compare") questions.push({ id: `q_${randomUUID().slice(0, 6)}`, text: `How do the options compare?`, queries: [`${t} comparison`, `${t} vs`] });
  if (mode === "factcheck") questions.unshift({ id: `q_${randomUUID().slice(0, 6)}`, text: `Can the exact claim be verified from primary sources?`, queries: [`"${t}"`, `${t} source`] });
  return { topic: t, objective: `${mode} research: ${t}`, mode, strategy: "Fallback source-first strategy: discover authoritative/current sources, fetch what is permitted, extract evidence with quotes, detect contradictions, then synthesize only from evidence.", sourceRequirements: defaultRequirements(mode), questions, createdAt: Date.now() };
}

export function queriesFromPlan(plan: ResearchPlan, maxQueries: number): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const q of plan.questions) for (const query of q.queries) {
    const key = query.toLowerCase().trim();
    if (key && !seen.has(key)) { seen.add(key); ordered.push(query.trim()); }
    if (ordered.length >= maxQueries) return ordered;
  }
  return ordered;
}

function defaultRequirements(mode: ResearchMode): string[] {
  const base = ["prefer official or primary sources", "record freshness/verification time", "do not use uncited claims", "surface contradictions"];
  if (mode === "factcheck") base.unshift("find the original source of the claim");
  if (mode === "compare") base.unshift("collect comparable criteria for each option");
  return base;
}
