/**
 * XR 4.4 — Universal Intelligence Plane types.
 *
 * Provider/model-neutral contracts for discovery, filtering, scoring,
 * routing decisions, fallback, and explainability.
 *
 * Design rules:
 *   - Discriminated unions where behavior branches.
 *   - Capability tri-state: "supported" | "unsupported" | "unknown".
 *   - No secrets, no raw prompts in decision records.
 *   - Extensible model classes without kernel changes.
 */

// ── Capability tri-state ──────────────────────────────────────────────────

/** Distinguish supported / unsupported / unknown (never treat unknown as true). */
export type CapabilitySupport = "supported" | "unsupported" | "unknown";

export type ModelClass =
  | "chat"
  | "completion"
  | "reasoning"
  | "code"
  | "tool_use"
  | "structured_output"
  | "vision"
  | "speech_to_text"
  | "text_to_speech"
  | "image_generation"
  | "image_understanding"
  | "embeddings"
  | "reranking"
  | "multimodal"
  | "unknown";

export type Modality = "text" | "image" | "audio" | "video" | "embedding";

export type Locality = "local" | "private" | "cloud" | "hybrid";

export type CostTier = "free" | "cheap" | "premium" | "enterprise" | "custom";

export type LatencyClass = "realtime" | "fast" | "standard" | "slow" | "unknown";

export type QualityClass = "basic" | "standard" | "high" | "frontier" | "unknown";

// ── Capability declaration ────────────────────────────────────────────────

export interface ModelCapabilities {
  chat: CapabilitySupport;
  completion: CapabilitySupport;
  reasoning: CapabilitySupport;
  code: CapabilitySupport;
  toolUse: CapabilitySupport;
  structuredOutput: CapabilitySupport;
  jsonMode: CapabilitySupport;
  functionCalling: CapabilitySupport;
  streaming: CapabilitySupport;
  vision: CapabilitySupport;
  imageUnderstanding: CapabilitySupport;
  imageGeneration: CapabilitySupport;
  speechToText: CapabilitySupport;
  textToSpeech: CapabilitySupport;
  embeddings: CapabilitySupport;
  reranking: CapabilitySupport;
  multimodal: CapabilitySupport;
}

export interface ContextLimits {
  /** Max input tokens; undefined = unknown. */
  maxInputTokens?: number;
  /** Max output tokens; undefined = unknown. */
  maxOutputTokens?: number;
  /** Combined context window when only one number is known. */
  contextWindow?: number;
}

export interface CostProfile {
  tier: CostTier;
  /** USD per 1M input tokens when known. */
  inPerMTok?: number;
  /** USD per 1M output tokens when known. */
  outPerMTok?: number;
  /** True when cost is exactly zero (local). */
  free: boolean;
}

export interface LatencyProfile {
  class: LatencyClass;
  /** Typical p50 latency ms when measured. */
  p50Ms?: number;
  /** Last observed latency ms. */
  lastMs?: number;
}

export interface QualityProfile {
  class: QualityClass;
  /** Optional static hint 0..1 — not a learned score. */
  staticScore?: number;
  reasoningBias?: number;
  codeBias?: number;
}

export interface LocalityProfile {
  locality: Locality;
  /** Data may leave the machine. */
  leavesMachine: boolean;
  /** Requires user-held credentials. */
  requiresCredential: boolean;
  /** Optional residency hint (e.g. "aws-us-east-1"). */
  region?: string;
}

export interface HealthSnapshot {
  ok: boolean;
  authOk: boolean;
  available: boolean;
  latencyMs?: number;
  detail?: string;
  /** When this snapshot was taken. */
  checkedAt: number;
  /** True when snapshot is from cache and may be stale. */
  stale?: boolean;
}

export interface HardwareRequirements {
  minRamGb?: number;
  gpuPreferred?: boolean;
  notes?: string;
}

// ── Descriptors ───────────────────────────────────────────────────────────

export interface ProviderDescriptor {
  providerId: string;
  label: string;
  version?: string;
  kind: "hosted" | "local" | "custom";
  tier: CostTier;
  locality: LocalityProfile;
  defaultModelId: string;
  auth: {
    type: "none" | "bearer" | "apiKey" | "aws" | "google" | "multi";
    apiKeyEnv?: string;
    credentialAvailable: boolean;
  };
  baseUrl?: string;
  docsUrl?: string;
  description?: string;
  /** Provider-level capability floor (models may refine). */
  capabilities: ModelCapabilities;
  health?: HealthSnapshot;
}

export interface ModelDescriptor {
  /** Stable key: `${providerId}/${modelId}` */
  key: string;
  providerId: string;
  modelId: string;
  label: string;
  /** Primary model classes this model serves. */
  classes: ModelClass[];
  modalities: Modality[];
  capabilities: ModelCapabilities;
  context: ContextLimits;
  cost: CostProfile;
  latency: LatencyProfile;
  quality: QualityProfile;
  locality: LocalityProfile;
  hardware?: HardwareRequirements;
  /** Known limitations (safe strings). */
  limitations: string[];
  /** Whether the model is the provider default. */
  isDefault: boolean;
  health?: HealthSnapshot;
  /** Optional static tags for filtering. */
  tags: string[];
}

// ── Task requirements ─────────────────────────────────────────────────────

export type RoutingMode =
  | "manual"
  | "preferred_with_fallback"
  | "local_only"
  | "private_only"
  | "automatic"
  | "cost_constrained"
  | "latency_constrained"
  | "quality_constrained"
  | "disabled";

export interface TaskRequirements {
  /** Primary operation / model class needed. */
  modelClass: ModelClass;
  /** Required modalities (all must be met). */
  modalities?: Modality[];
  /** Capability hard requirements. */
  require?: {
    toolUse?: boolean;
    structuredOutput?: boolean;
    jsonMode?: boolean;
    streaming?: boolean;
    vision?: boolean;
    embeddings?: boolean;
    reasoning?: boolean;
    functionCalling?: boolean;
  };
  /** Minimum context window (tokens). */
  minContextTokens?: number;
  /** Soft latency preference. */
  latencyPreference?: LatencyClass | "any";
  /** Soft quality preference. */
  qualityPreference?: QualityClass | "any";
  /** Cost ceiling for this selection (USD estimate for typical call). */
  maxCostUsd?: number;
  /** Prefer free/local when scores tie. */
  preferFree?: boolean;
  /** Locality policy for this task. */
  localityPolicy?: "any" | "local_only" | "private_only" | "no_cloud";
  /** Explicit pins (highest precedence when set). */
  pin?: {
    providerId?: string;
    modelId?: string;
    /** When true, pin failure does not fallback unless allowFallbackOnPinFailure. */
    strict?: boolean;
  };
  /** Preferred provider/model (soft). */
  preferred?: {
    providerId?: string;
    modelId?: string;
  };
  /** Allow automatic fallback when primary fails. */
  allowFallback?: boolean;
  /** Allow cloud when local unavailable (requires explicit true under local defaults). */
  allowCloudFallback?: boolean;
  /** Disable historical score influence. */
  disableHistorical?: boolean;
  /** Human-readable task summary for explainability (no secrets). */
  summary?: string;
}

// ── Policy constraints (from config + trust + budget) ─────────────────────

export interface PolicyConstraints {
  routingMode: RoutingMode;
  localityPolicy: "any" | "local_only" | "private_only" | "no_cloud";
  allowFallback: boolean;
  allowCloudFallback: boolean;
  preferFree: boolean;
  maxCostUsd?: number;
  latencyPreference?: LatencyClass | "any";
  qualityPreference?: QualityClass | "any";
  disableHistorical: boolean;
  /** Workspace / deployment pin. */
  defaultProviderId?: string;
  defaultModelId?: string;
  fallbackProviderId?: string;
  fallbackModelId?: string;
  /** Mapped from legacy routingStrategy. */
  legacyStrategy?: string;
}

// ── Candidate evaluation ──────────────────────────────────────────────────

export type RejectionCode =
  | "capability_unsupported"
  | "capability_unknown"
  | "modality_missing"
  | "context_too_small"
  | "locality_policy"
  | "budget"
  | "credential_missing"
  | "health_unavailable"
  | "user_pin"
  | "user_restriction"
  | "hardware"
  | "disabled"
  | "not_found";

export interface RejectionReason {
  code: RejectionCode;
  message: string;
  detail?: string;
}

export interface ScoreBreakdown {
  taskFit: number;
  quality: number;
  latency: number;
  cost: number;
  locality: number;
  preference: number;
  historical: number;
  availability: number;
  total: number;
  /** Human-readable factor notes. */
  notes: string[];
}

export interface CandidateEvaluation {
  model: ModelDescriptor;
  compatible: boolean;
  rejections: RejectionReason[];
  score?: ScoreBreakdown;
}

// ── Routing decision ──────────────────────────────────────────────────────

export interface FallbackStep {
  providerId: string;
  modelId: string;
  reason: string;
}

export interface RoutingDecision {
  /** Schema/version for durable records. */
  version: 1;
  /** Decision id (stable for this selection). */
  decisionId: string;
  timestamp: number;
  mode: RoutingMode;
  /** Effective requirements after merging policy. */
  requirements: TaskRequirements;
  constraints: PolicyConstraints;
  /** Selected candidate (absent when none). */
  selected?: {
    providerId: string;
    modelId: string;
    key: string;
    score?: ScoreBreakdown;
  };
  /** Ordered fallback chain (not including selected). */
  fallbackChain: FallbackStep[];
  /** Rejected / filtered candidates (bounded). */
  rejected: Array<{
    providerId: string;
    modelId: string;
    reasons: RejectionReason[];
  }>;
  /** Top scored-but-not-selected (bounded). */
  considered: Array<{
    providerId: string;
    modelId: string;
    score: ScoreBreakdown;
  }>;
  /** True when selection came from explicit pin. */
  manual: boolean;
  /** True when no compatible candidate exists. */
  unavailable: boolean;
  /** Safe explanation for UX. */
  explanation: string;
  /** Factors that drove the choice. */
  factors: string[];
  /** Confidence 0..1 based on data completeness. */
  confidence: number;
  /** Optional handoff when nothing safe is available. */
  humanHandoff?: {
    required: boolean;
    reason: string;
  };
}

/** Durable, secret-free decision record for execution/audit. */
export interface RoutingDecisionRecord {
  decisionId: string;
  version: 1;
  timestamp: number;
  mode: RoutingMode;
  providerId?: string;
  modelId?: string;
  manual: boolean;
  unavailable: boolean;
  explanation: string;
  factors: string[];
  fallbackChain: FallbackStep[];
  localityPolicy: PolicyConstraints["localityPolicy"];
  confidence: number;
  /** Rejected count only (full list may be large). */
  rejectedCount: number;
  humanHandoff?: boolean;
}

// ── Historical metrics ────────────────────────────────────────────────────

export interface OutcomeSample {
  providerId: string;
  modelId: string;
  modelClass: ModelClass;
  success: boolean;
  latencyMs?: number;
  costUsd?: number;
  /** tool_call / structured_output validity when applicable. */
  structuredOk?: boolean;
  at: number;
  workspaceHash?: string;
}

export interface ModelOutcomeStats {
  providerId: string;
  modelId: string;
  modelClass: ModelClass;
  samples: number;
  successRate: number;
  avgLatencyMs?: number;
  avgCostUsd?: number;
  structuredOkRate?: number;
  /** 0..1 coverage/confidence. */
  confidence: number;
  lastAt?: number;
}

// ── Service I/O ───────────────────────────────────────────────────────────

export interface RouteRequest {
  requirements?: Partial<TaskRequirements>;
  /** Explicit overrides (pin). */
  provider?: string;
  model?: string;
  /** Force a routing mode for this call. */
  mode?: RoutingMode;
  /** When true, do not construct provider — decision only. */
  dryRun?: boolean;
}

export interface RouteResult {
  decision: RoutingDecision;
  record: RoutingDecisionRecord;
}
