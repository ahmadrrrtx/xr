/**
 * XR — research mode core types (v0.7).
 *
 * The research module is a CLEAN abstraction, intentionally decoupled from
 * provider auth, budget logic, voice, and control. It only depends on:
 *   - a Provider (to think)            — passed in by the caller
 *   - a web search/fetch capability    — passed in by the caller (egress-gated)
 *   - a sink for persistence/audit     — passed in by the caller
 *
 * This keeps research deterministic and testable: every layer takes its inputs
 * explicitly and returns plain data. No hidden globals.
 *
 * Design rules baked into these types:
 *   - SOURCE-FIRST: we collect Source[] before we ever synthesize.
 *   - CITATION-AWARE: every Note and every Claim references a sourceId.
 *   - NO FAKE CERTAINTY: notes are tagged fact | inference | opinion, and
 *     each note records whether the source was actually fetched/verified.
 */

/** How deep to research. */
export type ResearchDepth = "quick" | "deep";

/** Lifecycle of a research session. */
export type ResearchStatus =
  | "planning"
  | "searching"
  | "ranking"
  | "extracting"
  | "synthesizing"
  | "done"
  | "stopped"
  | "error";

/** Epistemic category of an extracted note. NEVER guess — default to "inference". */
export type Claim = "fact" | "inference" | "opinion";

/** How confident XR is in a note, based on source quality + corroboration. */
export type Confidence = "high" | "medium" | "low";

/** A research question generated during planning. */
export interface ResearchQuestion {
  id: string;
  text: string;
  /** Search queries proposed to answer this question. */
  queries: string[];
}

/** The plan: questions + a search strategy. Produced before any searching. */
export interface ResearchPlan {
  topic: string;
  /** A one-line restatement of what the user actually wants answered. */
  objective: string;
  questions: ResearchQuestion[];
  /** Free-form notes on strategy, scope, and what counts as a good source. */
  strategy: string;
  createdAt: number;
}

/** A discovered source. Metadata is captured where possible (UX: transparency). */
export interface Source {
  id: string; // stable short id, e.g. "s1"
  title: string;
  url: string;
  /** Hostname, used for trust scoring + dedupe. */
  domain: string;
  /** Search-engine snippet (NOT verified content). */
  snippet: string;
  /** Which query surfaced this source. */
  foundVia: string;
  /** 0..1 trust score from deterministic heuristics (see ranking.ts). */
  trust: number;
  /** Human-readable reason for the trust score. */
  trustReason: string;
  /** Did we actually fetch the page body? If false, only the snippet is known. */
  fetched: boolean;
  /** Cleaned page text, only present when fetched === true. */
  content?: string;
  /** When this source was discovered/fetched. */
  collectedAt: number;
}

/** A single extracted point, always tied to a source. */
export interface Note {
  id: string;
  /** The source this note came from. Required — no orphan notes. */
  sourceId: string;
  /** The extracted point, in XR's words. */
  text: string;
  claim: Claim;
  confidence: Confidence;
  /**
   * verified === true ONLY when the note was extracted from FETCHED content,
   * not from a search snippet. This backs the "never pretend to have checked"
   * rule: unverified notes are explicitly marked.
   */
  verified: boolean;
}

/** A detected disagreement between sources. */
export interface Contradiction {
  topic: string;
  /** Source ids that disagree. */
  sourceIds: string[];
  description: string;
}

/** Final synthesized output. */
export interface Synthesis {
  /** One or two sentences answering the question directly. */
  shortAnswer: string;
  /** 3–6 bullet executive summary. */
  executiveSummary: string[];
  /** Long-form, sectioned report body (markdown). */
  report: string;
  /** Things XR could NOT verify or that remain open. */
  openQuestions: string[];
  /** Honest confidence statement for the whole answer. */
  overallConfidence: Confidence;
}

/** The full research session: the suggested data model, materialized. */
export interface ResearchSession {
  id: string;
  topic: string;
  depth: ResearchDepth;
  status: ResearchStatus;
  plan?: ResearchPlan;
  sources: Source[];
  notes: Note[];
  contradictions: Contradiction[];
  synthesis?: Synthesis;
  /** Where the last export was written, if any. */
  exportPath?: string;
  /** Token/$ meter string captured at the end of the run. */
  meter?: string;
  createdAt: number;
  updatedAt: number;
}

/** Tunable limits per depth. Deterministic, not magic. */
export interface DepthBudget {
  /** Max distinct search queries to run. */
  maxQueries: number;
  /** Results requested per query. */
  resultsPerQuery: number;
  /** Max sources to keep after ranking. */
  maxSources: number;
  /** Max sources to actually fetch (full-text). */
  maxFetched: number;
  /** Research questions to generate in the plan. */
  maxQuestions: number;
}

export const DEPTH_BUDGETS: Record<ResearchDepth, DepthBudget> = {
  quick: {
    maxQueries: 3,
    resultsPerQuery: 5,
    maxSources: 8,
    maxFetched: 3,
    maxQuestions: 3,
  },
  deep: {
    maxQueries: 6,
    resultsPerQuery: 6,
    maxSources: 16,
    maxFetched: 8,
    maxQuestions: 6,
  },
};
