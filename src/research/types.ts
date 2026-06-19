/**
 * XR Stage 7 — Research Engine types.
 *
 * Source-first data model: every conclusion must trace back to a checked source
 * or be explicitly marked as inference/uncertainty. These plain JSON types are
 * persisted as one ResearchSession blob by Store, so Stage 7 can evolve without
 * risky DB migrations for every internal field.
 */

export type ResearchMode = "quick" | "deep" | "compare" | "factcheck" | "briefing";
export type ResearchDepth = "quick" | "deep";

export type ResearchStatus =
  | "planning"
  | "discovering"
  | "ranking"
  | "fetching"
  | "extracting"
  | "checking"
  | "synthesizing"
  | "refreshing"
  | "done"
  | "stopped"
  | "error";

export type ClaimKind = "fact" | "inference" | "opinion" | "uncertainty";
export type Claim = ClaimKind;
export type Confidence = "high" | "medium" | "low";
export type SourceType = "official" | "primary" | "academic" | "news" | "docs" | "community" | "blog" | "reference" | "unknown";
export type Freshness = "fresh" | "recent" | "stale" | "unknown";
export type EvidenceStrength = "strong" | "moderate" | "weak";
export type OutputFormat = "markdown" | "html" | "json";

export interface ResearchQuestion {
  id: string;
  text: string;
  queries: string[];
}

export interface ResearchPlan {
  topic: string;
  objective: string;
  mode: ResearchMode;
  questions: ResearchQuestion[];
  strategy: string;
  sourceRequirements: string[];
  createdAt: number;
}

export interface SourceFreshness {
  checkedAt: number;
  lastModified?: string;
  apparentDate?: string;
  ageDays?: number;
  score: number;
  label: Freshness;
  reason: string;
}

export interface SourceMetadata {
  title: string;
  url: string;
  canonicalUrl?: string;
  domain: string;
  type: SourceType;
  snippet: string;
  foundVia: string;
  discoveredAt: number;
  fetchedAt?: number;
  httpStatus?: number;
  contentType?: string;
  contentLength?: number;
  lastVerifiedAt?: number;
}

export interface Source {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  foundVia: string;
  type: SourceType;
  trust: number;
  relevance: number;
  freshness: SourceFreshness;
  quality: number;
  trustReason: string;
  rankingReason: string;
  fetched: boolean;
  verified: boolean;
  fetchError?: string;
  content?: string;
  metadata: SourceMetadata;
  collectedAt: number;
}

export interface EvidenceBlock {
  id: string;
  sourceId: string;
  claimId?: string;
  text: string;
  quote?: string;
  kind: ClaimKind;
  confidence: Confidence;
  strength: EvidenceStrength;
  verified: boolean;
  relevance: number;
  extractedAt: number;
}

export interface Note extends EvidenceBlock {
  claim: ClaimKind;
}

export interface ResearchClaim {
  id: string;
  text: string;
  kind: ClaimKind;
  confidence: Confidence;
  sourceIds: string[];
  evidenceIds: string[];
  corroboratedBy: string[];
  contradictedBy: string[];
  status: "supported" | "contested" | "weak" | "unverified";
}

export interface Contradiction {
  id: string;
  topic: string;
  sourceIds: string[];
  evidenceIds: string[];
  description: string;
  severity: "high" | "medium" | "low";
  status: "open" | "resolved";
}

export interface Synthesis {
  shortAnswer: string;
  executiveSummary: string[];
  report: string;
  openQuestions: string[];
  overallConfidence: Confidence;
}

export interface ReportVersion {
  id: string;
  format: OutputFormat;
  path?: string;
  sha256: string;
  createdAt: number;
}

export interface RefreshRecord {
  id: string;
  refreshedAt: number;
  previousUpdatedAt: number;
  sourcesChecked: number;
  changedSources: string[];
  notesAdded: number;
  status: "done" | "partial" | "error";
  message: string;
}

export interface ComparisonOutput {
  id: string;
  subjects: string[];
  criteria: string[];
  matrix: Array<Record<string, string>>;
  verdict: string;
  createdAt: number;
}

export interface ResearchSession {
  id: string;
  topic: string;
  query: string;
  mode: ResearchMode;
  depth: ResearchDepth;
  status: ResearchStatus;
  plan?: ResearchPlan;
  sources: Source[];
  sourceSets: Array<{ id: string; name: string; sourceIds: string[]; createdAt: number }>;
  evidence: EvidenceBlock[];
  notes: Note[];
  claims: ResearchClaim[];
  contradictions: Contradiction[];
  summary?: Synthesis;
  synthesis?: Synthesis;
  finalReport?: string;
  reportVersions: ReportVersion[];
  refreshHistory: RefreshRecord[];
  comparison?: ComparisonOutput;
  exportPath?: string;
  tags: string[];
  projectId?: string;
  liveSourcesOnly: boolean;
  lastRefreshedAt?: number;
  meter?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DepthBudget {
  maxQueries: number;
  resultsPerQuery: number;
  maxSources: number;
  maxFetched: number;
  maxQuestions: number;
  maxEvidencePerSource: number;
}

export const DEPTH_BUDGETS: Record<ResearchDepth, DepthBudget> = {
  quick: { maxQueries: 4, resultsPerQuery: 6, maxSources: 10, maxFetched: 5, maxQuestions: 4, maxEvidencePerSource: 5 },
  deep: { maxQueries: 10, resultsPerQuery: 8, maxSources: 28, maxFetched: 16, maxQuestions: 8, maxEvidencePerSource: 8 },
};
