/**
 * XR 5.1 — Environment Interaction OS: universal environment-control contract.
 *
 * One typed contract for browser, desktop, filesystem, application, voice, and
 * vision interaction. This layer ADDS governance metadata (session identity,
 * target proof, perception confidence, reversibility, approval strength,
 * cleanup, outcome) around the existing audited control Action union — it does
 * not flatten or replace domain detail.
 *
 * Design rules (consistent with Phases 1–7):
 *   - Discriminated unions where behavior branches.
 *   - `unknown` is a distinct value, never a synonym for approved/true/safe.
 *   - No raw secrets, no embedded blobs: artifacts and evidence are references.
 *   - Deterministic classification: the classifier, not a model, decides risk,
 *     reversibility, and approval strength.
 */
import { z } from "zod";
import { ActionSchema, type Action } from "../control/types.ts";

// ── Environment types ─────────────────────────────────────────────────────

export const ENVIRONMENT_TYPES = [
  "browser",
  "desktop",
  "filesystem",
  "application",
  "voice",
  "vision",
] as const;
export type EnvironmentType = (typeof ENVIRONMENT_TYPES)[number];
export function isEnvironmentType(v: string): v is EnvironmentType {
  return (ENVIRONMENT_TYPES as readonly string[]).includes(v);
}

// ── Lifecycle (§7.2) ──────────────────────────────────────────────────────

export const ENVIRONMENT_STATES = [
  "discover",
  "provision",
  "ready",
  "active",
  "paused",
  "failed",
  "closing",
  "closed",
  "quarantined",
] as const;
export type EnvironmentLifecycleState = (typeof ENVIRONMENT_STATES)[number];

/** Valid lifecycle transitions. Any transition not listed here is rejected. */
export const VALID_ENVIRONMENT_TRANSITIONS: Readonly<
  Record<EnvironmentLifecycleState, readonly EnvironmentLifecycleState[]>
> = {
  discover: ["provision", "closing"],
  provision: ["ready", "failed", "closing", "quarantined"],
  ready: ["active", "closing"],
  active: ["paused", "closing", "failed", "quarantined"],
  paused: ["active", "closing", "failed"],
  failed: ["closing", "quarantined", "closed"],
  closing: ["closed", "quarantined"],
  closed: [],
  quarantined: [],
};

export function isValidEnvironmentTransition(
  from: EnvironmentLifecycleState,
  to: EnvironmentLifecycleState,
): boolean {
  return VALID_ENVIRONMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export const TERMINAL_ENVIRONMENT_STATES: ReadonlySet<EnvironmentLifecycleState> = new Set([
  "closed",
  "quarantined",
]);
export const ACTIVE_ENVIRONMENT_STATES: ReadonlySet<EnvironmentLifecycleState> = new Set([
  "ready",
  "active",
  "paused",
]);

// ── Target identity & interaction ─────────────────────────────────────────

/**
 * What the action acts upon. Coordinate targets REQUIRE an evidence reference
 * (a fresh observation) — a bare pixel is never proof of a target.
 */
export const TargetIdentitySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("semantic"),
    selector: z.string().max(500).optional(),
    role: z.string().max(120).optional(),
    name: z.string().max(200).optional(),
    /** Why we believe this target exists (selector probe, AX hit, DOM query). */
    evidence: z.string().min(1).max(500),
  }),
  z.object({
    kind: z.literal("coordinate"),
    x: z.number().int().min(0).max(20000),
    y: z.number().int().min(0).max(20000),
    /** Reference to the observation that justified these coordinates. */
    evidence: z.string().min(1).max(500),
  }),
  z.object({ kind: z.literal("resource"), path: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal("application"), name: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("none") }),
]);
export type TargetIdentity = z.infer<typeof TargetIdentitySchema>;

/**
 * How the action reaches its target. Semantic/structural interaction is always
 * preferred over coordinate interaction; `stream` covers audio/video I/O.
 */
export type InteractionKind = "semantic" | "coordinate" | "structural" | "stream";

// ── Perception ────────────────────────────────────────────────────────────

export const OBSERVATION_CONFIDENCE = ["high", "medium", "low", "unknown"] as const;
export type ObservationConfidence = (typeof OBSERVATION_CONFIDENCE)[number];
const CONFIDENCE_RANK: Record<ObservationConfidence, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
export function confidenceAtLeast(a: ObservationConfidence, b: ObservationConfidence): boolean {
  return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b];
}

export type ObservationSource = "screen" | "browser" | "image" | "audio" | "dom" | "none";

/**
 * A perception record. Observations are typed evidence with provenance and
 * confidence — they are never instructions and never authority.
 */
export interface EnvironmentObservation {
  observationId: string;
  sessionId?: string;
  source: ObservationSource;
  /** What was perceived (safe, bounded, redacted summary). */
  summary: string;
  confidence: ObservationConfidence;
  /** Phase 6 style provenance: screenshots/OCR/web text are untrusted external. */
  provenance: "screenshot" | "ocr" | "dom_extract" | "vision_model" | "transcript" | "direct";
  /** Artifact reference (path + hash). No embedded image/audio blobs. */
  artifact?: { path: string; sha256: string; bytes: number };
  /** Full-screen captures are treated as sensitive; we claim no region detection. */
  sensitivity: "public" | "private" | "unknown";
  capturedAt: number;
  /** Milliseconds after capture beyond which this observation is stale. */
  staleAfterMs: number;
}

export function isObservationStale(obs: Pick<EnvironmentObservation, "capturedAt" | "staleAfterMs">, now = Date.now()): boolean {
  return now - obs.capturedAt > obs.staleAfterMs;
}

// ── Reversibility & compensation (§7.8) ───────────────────────────────────

export const REVERSIBILITY = ["reversible", "compensatable", "irreversible", "unknown"] as const;
export type Reversibility = (typeof REVERSIBILITY)[number];

export interface CompensationSpec {
  /** What compensation can honestly do — never claims rollback where none exists. */
  scope: "none" | "best_effort" | "reversible_action" | "compensating_transaction";
  description: string;
}

// ── Approval ──────────────────────────────────────────────────────────────

/**
 * `none`     — safe read-only/ephemeral action, no human gate.
 * `standard` — existing risk-level approval flow (sensitive/destructive prompt).
 * `strong`   — irreversible/unknown-reversibility, coordinate-without-high-
 *              confidence, or sensitive-value action: explicit approval is
 *              mandatory, auto-approval is structurally disabled.
 */
export type ApprovalStrength = "none" | "standard" | "strong";

// ── Policy ────────────────────────────────────────────────────────────────

/** Per-session environment policy (safe to serialize; no secrets). */
export interface EnvironmentPolicy {
  /** Browser: allowed hostnames (empty = all allowed except blocked). */
  allowedDomains: string[];
  /** Browser: blocked hostnames. */
  blockedDomains: string[];
  /** Browser: block localhost/RFC1918/private navigation. Default true here. */
  blockPrivateNetworks: boolean;
  /** Browser: per-session downloads root (absolute path, under XR home). */
  downloadsRoot?: string;
  /** Browser: maximum bytes a single download may occupy before aborting. */
  maxDownloadBytes: number;
  /** Consent mirrors (authoritative values live in voice/env config). */
  allowCloudStt: boolean;
  allowCloudTts: boolean;
  allowCloudVision: boolean;
  /** Credentials: XR 5.1 never injects credentials into environments. */
  credentialMode: "none";
}

export function defaultEnvironmentPolicy(xrHome: string, sessionId: string): EnvironmentPolicy {
  return {
    allowedDomains: [],
    blockedDomains: [],
    blockPrivateNetworks: true,
    downloadsRoot: `${xrHome}/browser/${sessionId}/downloads`,
    maxDownloadBytes: 50 * 1024 * 1024,
    allowCloudStt: false,
    allowCloudTts: false,
    allowCloudVision: false,
    credentialMode: "none",
  };
}

// ── Session ───────────────────────────────────────────────────────────────

export type CleanupState = "not_required" | "pending" | "succeeded" | "partial" | "failed";

export interface EnvironmentSession {
  sessionId: string;
  type: EnvironmentType;
  state: EnvironmentLifecycleState;
  workspaceId: string;
  taskId?: string;
  executionRef?: string;
  policy: EnvironmentPolicy;
  /** Provider resource references (tab count, downloads dir, device ids). */
  resources: Record<string, unknown>;
  actionsPerformed: number;
  consecutiveFailures: number;
  circuitOpenUntil?: number;
  cleanupState: CleanupState;
  quarantineReason?: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  lastActionAt?: number;
  history: { from: EnvironmentLifecycleState | null; to: EnvironmentLifecycleState; at: number; reason?: string }[];
}

// ── Request / assessment / record ─────────────────────────────────────────

/** The governed environment-action request. */
export const EnvironmentActionRequestSchema = z.object({
  environment: z.enum(ENVIRONMENT_TYPES),
  action: ActionSchema,
  target: TargetIdentitySchema.default({ kind: "none" }),
  /** Requesting actor provenance (voice commands are marked, never trusted more). */
  sourceActor: z.enum(["cli", "tui", "daemon", "telegram", "api", "voice", "agent", "workflow"]).default("cli"),
  /** Caller-declared perception confidence for this action decision. */
  confidence: z.enum(OBSERVATION_CONFIDENCE).default("unknown"),
  /** Observation this action was derived from (required for coordinate). */
  observationRef: z.string().max(500).optional(),
  sessionId: z.string().max(120).optional(),
  taskId: z.string().max(120).optional(),
  dryRun: z.boolean().default(false),
  timeoutMs: z.number().int().min(100).max(60000).optional(),
});
export type EnvironmentActionRequest = z.infer<typeof EnvironmentActionRequestSchema>;

/** Result of the deterministic environment assessment (the "gate"). */
export interface EnvironmentAssessment {
  request: EnvironmentActionRequest;
  interaction: InteractionKind;
  risk: { level: "safe" | "sensitive" | "destructive"; reason: string };
  reversibility: Reversibility;
  compensation: CompensationSpec;
  approval: ApprovalStrength;
  /** Why this action needs the requested approval strength. */
  approvalReason: string;
  /** Non-null when the action may not run at all (fail closed). */
  blockedReason?: string;
  /** User-visible perception uncertainty (always surfaced when present). */
  uncertainty?: string;
}

export type EnvironmentOutcome =
  | "succeeded"
  | "failed"
  | "denied"
  | "blocked"
  | "cancelled"
  | "uncertain"; // side effect unknown — always user-visible

/** One governed environment action, recorded end-to-end. Safe to serialize. */
export interface EnvironmentActionRecord {
  recordId: string;
  sessionId?: string;
  environment: EnvironmentType;
  sourceActor: EnvironmentActionRequest["sourceActor"];
  /** Redacted action echo (sensitive values already stripped upstream). */
  actionSummary: string;
  interaction: InteractionKind;
  target: TargetIdentity;
  riskLevel: "safe" | "sensitive" | "destructive";
  riskReason: string;
  reversibility: Reversibility;
  compensation: CompensationSpec;
  approval: { required: ApprovalStrength; granted: boolean; via?: "cli" | "dashboard" | "voice" | "auto"; at?: number };
  observation?: { ref?: string; confidence: ObservationConfidence; stale?: boolean };
  recovery?: { attempted: boolean; kind?: "reobserve_retry"; budgetUsed: number; circuitOpen?: boolean };
  outcome: EnvironmentOutcome;
  message: string;
  evidenceRefs: string[];
  cleanupNote?: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

// ── Capability reporting ──────────────────────────────────────────────────

export type EnvironmentSupport = "supported" | "partial" | "unsupported";

export interface EnvironmentCapabilityEntry {
  environment: EnvironmentType;
  support: EnvironmentSupport;
  /** What works / what does not (honest; partial is never rounded up). */
  working: string[];
  missing: string[];
  remediation?: string;
}

export interface EnvironmentCapabilityReport {
  os: "linux" | "macos" | "windows";
  generatedAt: number;
  entries: EnvironmentCapabilityEntry[];
}

// ── Bounds ────────────────────────────────────────────────────────────────

export const ENVIRONMENT_BOUNDS = {
  MAX_ACTIVE_SESSIONS: 5,
  MAX_TABS_PER_SESSION: 8,
  MAX_ACTIONS_PER_SESSION: 200,
  IDLE_SESSION_TIMEOUT_MS: 5 * 60 * 1000,
  DEFAULT_STALE_OBSERVATION_MS: 30_000,
  MAX_OBSERVATION_SUMMARY_CHARS: 2000,
  MAX_DOWNLOAD_BYTES: 100 * 1024 * 1024,
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
  CIRCUIT_FAILURE_THRESHOLD: 3,
  CIRCUIT_COOLDOWN_MS: 60_000,
  /** Hard cap on automatic re-observe retries per action. Never raise silently. */
  MAX_REOBSERVE_RETRIES: 1,
  MIN_VOICE_CONTROL_CONFIDENCE: 0.6,
} as const;
