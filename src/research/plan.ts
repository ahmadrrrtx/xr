/**
 * XR — research planning layer.
 *
 * Turns a raw topic into a structured ResearchPlan: an objective, research
 * questions, search queries, and a strategy. This runs BEFORE any searching,
 * enforcing the source-first / plan-first workflow.
 *
 * The plan is also useful on its own (`xr research plan "topic"`).
 *
 * If the model fails or returns junk, we fall back to a deterministic plan
 * derived from the topic, so research never hard-crashes (UX: graceful
 * fallback, reliability over cleverness).
 */
import { randomUUID } from "node:crypto";
import type { StructuredCallDeps } from "./llm.ts";
import { structuredCall } from "./llm.ts";
import type { ResearchPlan, ResearchQuestion, DepthBudget } from "./types.ts";

const SYSTEM = [
  "You are XR's research planner. You design rigorous, source-first research plans.",
  "Reply with ONLY a JSON object, no prose, no markdown fences, of the shape:",
  `{"objective": string, "strategy": string, "questions": [{"text": string, "queries": [string]}]}`,
  "Rules:",
  "- objective: one sentence restating exactly what the user wants answered.",
  "- questions: specific, answerable sub-questions that together cover the topic.",
  "- queries: concrete web-search query strings (2-4 words to a short phrase) for each question.",
  "- strategy: 2-3 sentences on scope, what counts as a high-quality source, and what to be careful about.",
  "Do not answer the question yourself. Only plan how to research it.",
].join("\n");

export async function makePlan(
  deps: StructuredCallDeps,
  topic: string,
  budget: DepthBudget,
): Promise<ResearchPlan> {
  const user = [
    `Topic: ${topic}`,
    `Generate at most ${budget.maxQuestions} research questions.`,
    `Generate at most ${budget.resultsPerQuery} short search queries total across all questions, prioritizing the most useful ones.`,
  ].join("\n");

  let parsed: any = null;
  try {
    const { data } = await structuredCall<any>(deps, SYSTEM, user);
    parsed = data;
  } catch {
    parsed = null;
  }

  const questions = normalizeQuestions(parsed?.questions, budget.maxQuestions);
  if (questions.length === 0) {
    return fallbackPlan(topic);
  }

  return {
    topic,
    objective:
      typeof parsed?.objective === "string" && parsed.objective.trim()
        ? parsed.objective.trim()
        : `Research: ${topic}`,
    strategy:
      typeof parsed?.strategy === "string" && parsed.strategy.trim()
        ? parsed.strategy.trim()
        : "Prefer authoritative, recent, primary sources. Cross-check claims across multiple sources. Flag uncertainty.",
    questions,
    createdAt: Date.now(),
  };
}

function normalizeQuestions(raw: unknown, max: number): ResearchQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ResearchQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q.text !== "string" || !q.text.trim()) continue;
    const queries = Array.isArray(q.queries)
      ? q.queries.filter((s: unknown) => typeof s === "string" && s.trim()).map((s: string) => s.trim())
      : [];
    out.push({
      id: `q_${randomUUID().slice(0, 6)}`,
      text: q.text.trim(),
      queries: queries.length ? queries : [q.text.trim()],
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Deterministic fallback when the model is unavailable or unusable. */
export function fallbackPlan(topic: string): ResearchPlan {
  const t = topic.trim();
  return {
    topic: t,
    objective: `Research: ${t}`,
    strategy:
      "Model planning was unavailable; using a generic strategy. Prefer authoritative and recent sources, and cross-check key claims.",
    questions: [
      { id: `q_${randomUUID().slice(0, 6)}`, text: `Overview: ${t}`, queries: [t] },
      {
        id: `q_${randomUUID().slice(0, 6)}`,
        text: `Key facts and current state of: ${t}`,
        queries: [`${t} latest`, `${t} comparison`],
      },
      {
        id: `q_${randomUUID().slice(0, 6)}`,
        text: `Trade-offs, criticisms, or downsides of: ${t}`,
        queries: [`${t} pros and cons`, `${t} criticism`],
      },
    ],
    createdAt: Date.now(),
  };
}

/** Flatten a plan into the ordered list of unique queries to run, capped. */
export function queriesFromPlan(plan: ResearchPlan, maxQueries: number): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const q of plan.questions) {
    for (const query of q.queries) {
      const key = query.toLowerCase().trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        ordered.push(query.trim());
      }
      if (ordered.length >= maxQueries) return ordered;
    }
  }
  return ordered;
}
