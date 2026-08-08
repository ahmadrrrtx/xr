/**
 * XR Phase 5 · T1 — Deterministic task-difficulty estimation.
 *
 * Principle adopted (docs/historical/phases/phase5-routing/03-RESEARCH-NOTES.md · R1, RouteLLM
 * ICLR 2025): route to the CHEAPEST model whose measured capability meets the
 * task's difficulty. We adopt the principle deterministically — no learned
 * preference model, no model call, nothing opaque (Art. IV.5; the learned
 * router stays optional research, never the default).
 *
 * The estimator reads only secret-free, observable task features:
 *   · the task summary string (length, structure, keyword classes, code marks)
 *   · the declared requirements (capabilities, context demand, model class)
 *
 * Every contributing signal is returned so the routing decision can LIST why
 * a task was judged easy or hard (Art. VII.3 — routing is explainable).
 * Pure, bounded, <1ms — the Phase 3 route-decision p95<20ms budget is safe.
 */

import type { ModelClass, TaskRequirements } from "./types.ts";

export interface DifficultyEstimate {
  /** 0..1 — 0 trivial, 1 frontier. */
  score: number;
  /** Explainable signals that contributed (safe strings). */
  signals: string[];
  /** Fidelity floor this difficulty implies (capability gate, 0..1). */
  requiredFidelity: number;
  /** True when estimated from requirements only (no summary text). */
  requirementsOnly: boolean;
}

export interface DifficultyOptions {
  /** Override the fidelity-floor mapping (from config). */
  fidelityFloors?: { easy: number; standard: number; hard: number; frontier: number };
}

const DEFAULT_FLOORS = { easy: 0.4, standard: 0.6, hard: 0.75, frontier: 0.85 };

/** Keyword classes with their weight — inspectable, additive only. */
const KEYWORD_CLASSES: Array<{ label: string; weight: number; pattern: RegExp }> = [
  {
    label: "analysis/design intent",
    weight: 0.15,
    pattern:
      /\b(analy[sz]e|design|architect|refactor|prove|optimi[sz]e|compare|evaluate|debug|diagnose|investigate|multi[- ]step|plan|strategy|trade[- ]?off)\b/i,
  },
  {
    label: "synthesis intent",
    weight: 0.08,
    pattern: /\b(summari[sz]e|explain|describe|write|draft|generate|create|list)\b/i,
  },
  {
    label: "precision intent",
    weight: 0.1,
    pattern: /\b(exact|precise|correct|verify|validate|guarantee|formal|proof|edge cases?)\b/i,
  },
];

const CODE_MARKS = /(`{1,3}|\{|\}|=>|\bfunction\b|\bclass\b|\bdef\b|\bimport\b|;)/;

/**
 * Estimate task difficulty deterministically.
 * When no summary is provided, estimates from requirements only (base 0.4).
 */
export function estimateDifficulty(
  requirements: Partial<TaskRequirements>,
  opts: DifficultyOptions = {},
): DifficultyEstimate {
  const floors = { ...DEFAULT_FLOORS, ...opts.fidelityFloors };
  const signals: string[] = [];
  let score = 0.2; // base: a real task asked of an agent

  const summary = requirements.summary?.trim() ?? "";
  const requirementsOnly = summary.length === 0;
  if (requirementsOnly) {
    score = 0.4;
    signals.push("no task text — requirements-only estimate");
  }

  // ── Text features ──────────────────────────────────────────────────────
  if (summary) {
    if (summary.length > 600) {
      score += 0.15;
      signals.push(`long task (${summary.length} chars)`);
    } else if (summary.length > 200) {
      score += 0.08;
      signals.push("medium task length");
    }
    if (/\n|^\s*[-*\d]+[.)\]]/m.test(summary)) {
      score += 0.1;
      signals.push("structured/multi-part task");
    }
    if (CODE_MARKS.test(summary)) {
      score += 0.1;
      signals.push("code present");
    }
    for (const cls of KEYWORD_CLASSES) {
      if (cls.pattern.test(summary)) {
        score += cls.weight;
        signals.push(cls.label);
      }
    }
  }

  // ── Requirement features ───────────────────────────────────────────────
  const req = requirements.require ?? {};
  if (requirements.modelClass === "reasoning" || req.reasoning) {
    score += 0.2;
    signals.push("reasoning required");
  }
  if ((requirements.modelClass as ModelClass) === "code") {
    score += 0.1;
    signals.push("code class");
  }
  if (req.toolUse) {
    score += 0.1;
    signals.push("tool-use required");
  }
  if (req.structuredOutput || req.jsonMode) {
    score += 0.05;
    signals.push("structured output required");
  }
  if (req.vision) {
    score += 0.1;
    signals.push("vision required");
  }
  if (req.extensions?.length) {
    score += 0.1;
    signals.push(`extension capabilities required (${req.extensions.length})`);
  }
  const ctx = requirements.minContextTokens ?? 0;
  if (ctx > 100_000) {
    score += 0.25;
    signals.push(`very large context (${ctx})`);
  } else if (ctx > 32_000) {
    score += 0.15;
    signals.push(`large context (${ctx})`);
  }

  score = Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000;

  const requiredFidelity =
    score < 0.3 ? floors.easy
    : score < 0.6 ? floors.standard
    : score < 0.8 ? floors.hard
    : floors.frontier;

  return { score, signals, requiredFidelity, requirementsOnly };
}

/** Human label for UX surfaces. */
export function difficultyLabel(score: number): "easy" | "standard" | "hard" | "frontier" {
  return score < 0.3 ? "easy" : score < 0.6 ? "standard" : score < 0.8 ? "hard" : "frontier";
}

/** Fidelity floor implied by a difficulty score (used for explicit overrides too). */
export function fidelityFloorFor(score: number, opts: DifficultyOptions = {}): number {
  const floors = { ...DEFAULT_FLOORS, ...opts.fidelityFloors };
  return score < 0.3 ? floors.easy : score < 0.6 ? floors.standard : score < 0.8 ? floors.hard : floors.frontier;
}
