/**
 * XR 4.2 — Trust and Isolation: Canonical Types
 *
 * These types describe the trust model that makes XR authority enforceable by
 * risk tier. A policy decision ("allowed") is NOT treated as sufficient: the
 * authority granted to an action must be materially constrained by the
 * environment in which the action executes.
 *
 * Design rules (mirror the execution fabric):
 *   - Discriminated unions only — no big bag of optional fields.
 *   - Everything here is safe to serialize: NO raw secrets, NO file handles,
 *     NO unbounded payloads. Credential material is referenced, never embedded.
 *   - Deterministic inputs only: a model may PROPOSE an action but must never
 *     choose its own risk tier or downgrade a placement requirement.
 */

// ── Risk tiers ────────────────────────────────────────────────────────────

/**
 * The smallest useful tier model. Semantics (labels may evolve, meanings must not):
 *
 *  - tier0_in_process: fast, in-process. No secrets, no arbitrary process
 *    creation, no unrestricted network, no irreversible side effects.
 *  - tier1_restricted: bounded local execution with an explicit workspace
 *    boundary, restricted env, bounded output/time, controlled network, and
 *    task-scoped permissions. This is PROCESS RESTRICTION — it is NOT a hard
 *    security boundary against a determined in-kernel attacker.
 *  - tier2_isolated: high-risk work that must run inside an ephemeral,
 *    enforceable boundary (OS sandbox/container) with no ambient host
 *    authority. Fails closed if no enforceable backend is available.
 */
export type RiskTier = "tier0_in_process" | "tier1_restricted" | "tier2_isolated";

export const RISK_TIER_ORDER: Record<RiskTier, number> = {
  tier0_in_process: 0,
  tier1_restricted: 1,
  tier2_isolated: 2,
};

/** True when `a` is at least as strict as `b`. */
export function tierAtLeast(a: RiskTier, b: RiskTier): boolean {
  return RISK_TIER_ORDER[a] >= RISK_TIER_ORDER[b];
}

// ── Placement ─────────────────────────────────────────────────────────────

/**
 * Concrete placement kinds. These extend (do not replace) the execution
 * fabric's Placement union. Only LOCAL placements ship in Phase 3; the
 * contract stays extensible for future worker/container/remote backends.
 */
export type PlacementKind =
  | "in_process"          // Tier 0: host process, fast path.
  | "restricted_process"  // Tier 1: confined child process (NOT a hard boundary).
  | "namespace_sandbox"   // Tier 2: OS namespace sandbox (bubblewrap / unshare).
  | "container"           // Tier 2: container runtime (docker/podman) when present.
  | "browser_isolated";   // Tier 2: isolated browser profile/process.

/** What a backend honestly claims to enforce. Used for verification + docs. */
export interface PlacementGuarantees {
  /** Hard kernel-level boundary (namespaces/container). */
  readonly kernelBoundary: boolean;
  /** Filesystem confinement is enforced by the OS, not by path checks alone. */
  readonly enforcedFilesystem: boolean;
  /** Network policy is enforced by the OS (net namespace / firewall). */
  readonly enforcedNetwork: boolean;
  /** Process tree is confined (PID namespace / process group kill). */
  readonly enforcedProcess: boolean;
  /** Ambient host environment/credentials are NOT inherited. */
  readonly noAmbientAuthority: boolean;
}

// ── Filesystem / network / process policy ─────────────────────────────────

export type FsAccess = "none" | "read" | "write";

export interface FsBinding {
  /** Host path (must be absolute and normalized before use). */
  readonly hostPath: string;
  /** Path inside the environment. Defaults to hostPath when omitted. */
  readonly mountPath?: string;
  readonly access: FsAccess;
}

export interface FilesystemPolicy {
  /** Read/write roots permitted inside the workspace. */
  readonly writableRoots: readonly string[];
  /** Read-only roots (e.g. shared resources, skill packs). */
  readonly readOnlyRoots: readonly string[];
  /** Explicitly blocked sensitive paths (always denied, highest precedence). */
  readonly blockedPaths: readonly string[];
  /** Extra explicit bindings for sandbox backends. */
  readonly bindings?: readonly FsBinding[];
  /** Use an ephemeral tmpfs scratch that is destroyed on cleanup. */
  readonly ephemeralScratch: boolean;
}

export type NetworkMode = "none" | "allowlist" | "open";

export interface NetworkPolicy {
  readonly mode: NetworkMode;
  /** Allowed hostnames/CIDRs when mode === "allowlist". */
  readonly allowlist: readonly string[];
  /** Block RFC1918/loopback/link-local destinations. */
  readonly blockPrivateNetworks: boolean;
  /** Whether redirects to non-allowlisted destinations are blocked. */
  readonly blockOffAllowlistRedirects: boolean;
}

export interface ProcessPolicy {
  /** Allowlist of executables; empty means "no arbitrary executables". */
  readonly allowedExecutables: readonly string[];
  /** Whether the action may spawn child processes at all. */
  readonly allowSpawn: boolean;
  /** Maximum process tree size (best-effort where enforceable). */
  readonly maxProcesses: number;
  /** Drop all ambient host environment variables; pass only `env`. */
  readonly stripAmbientEnv: boolean;
}

// ── Resource limits ───────────────────────────────────────────────────────

export interface ResourcePolicy {
  /** Wall-clock timeout in ms. */
  readonly wallClockMs: number;
  /** CPU time limit in seconds (where enforceable via rlimit). */
  readonly cpuSeconds?: number;
  /** Address-space limit in bytes (where enforceable via rlimit). */
  readonly memoryBytes?: number;
  /** Max output bytes captured from stdout+stderr. */
  readonly maxOutputBytes: number;
  /** Max temporary disk bytes (best-effort). */
  readonly maxTempBytes?: number;
  /** Max number of files the action may create (best-effort). */
  readonly maxFiles?: number;
}

// ── Credentials ───────────────────────────────────────────────────────────

export type CredentialMode =
  | "none"             // No credentials required.
  | "task_scoped"      // Broker injects a short-lived, task-bound reference.
  | "workspace"        // Workspace-scoped reference (longer lived).
  | "provider"         // Provider credential handled by the provider layer.
  | "interactive"      // Requires interactive user secret entry/approval.
  | "unavailable";     // Required credential cannot be safely provided → block.

/**
 * A credential REFERENCE. Never contains the raw secret. The broker resolves
 * references inside the environment boundary (e.g. via a short-lived file or
 * an env var set only on the sandboxed process), and revokes them on cleanup.
 */
export interface CredentialRef {
  readonly refId: string;
  readonly label: string;          // human-safe label, e.g. "github_token"
  readonly mode: CredentialMode;
  readonly scope: string;          // capability/action scope string
  readonly expiresAt?: number;
}

export interface CredentialScope {
  readonly mode: CredentialMode;
  readonly refs: readonly CredentialRef[];
  /** Names of env vars that will carry injected refs (names only, not values). */
  readonly envNames: readonly string[];
}

// ── Authority grant ───────────────────────────────────────────────────────

export interface AuthorityGrant {
  readonly grantId: string;
  readonly actor: string;                 // serialized actor identity
  readonly executionId: string;           // runId this grant is bound to
  readonly correlationId: string;
  readonly workspaceId: string;
  readonly capability: string;            // `${kind}:${name}`
  readonly tier: RiskTier;
  readonly fs: FilesystemPolicy;
  readonly net: NetworkPolicy;
  readonly proc: ProcessPolicy;
  readonly resources: ResourcePolicy;
  /** Mutable so the broker can attach scoped refs after grant creation. */
  credentials: CredentialScope;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly approvalRef?: string;          // approval request id, if any
  readonly policyVersion: string;         // classifier/policy config version
  revoked: boolean;
  revokedAt?: number;
  revokedReason?: string;
}

// ── Risk classification ───────────────────────────────────────────────────

/**
 * Deterministic inputs to classification. Adapters/callers populate this from
 * the action they intend to perform. A model cannot supply `requiredTier` to
 * downgrade — the classifier derives the tier from these objective fields.
 */
export interface TrustRequest {
  readonly capability: { kind: string; name: string; owner?: string };
  readonly actorKind: string;
  /** Free-form, already-redacted intent summary. */
  readonly summary: string;
  /** Does the action create arbitrary processes / run a shell? */
  readonly spawnsProcess: boolean;
  /** Does the action execute arbitrary/interpreted code? */
  readonly runsArbitraryCode: boolean;
  /** Network destinations the action will touch (hostnames/URLs). */
  readonly networkTargets: readonly string[];
  /** Filesystem paths the action will read/write. */
  readonly fsPaths: readonly string[];
  /** True if any fs path is outside the workspace root. */
  readonly touchesOutsideWorkspace: boolean;
  /** Does the action need credentials/secrets? */
  readonly needsCredentials: boolean;
  /** Reversibility of the action's side effects. */
  readonly reversible: boolean;
  /** True for irreversible/externally-consequential writes. */
  readonly irreversibleExternalWrite: boolean;
  /** Content is untrusted/hostile (e.g. arbitrary web page, untrusted plugin). */
  readonly untrustedContent: boolean;
  /**
   * True when the action legitimately requires HOST authority and CANNOT be
   * isolated (e.g. GUI/computer-use, host browser driving the real display).
   * Such Tier-2 actions are admitted with an explicit, recorded "host-authority
   * elevated-gate" decision (full approval + audit) instead of being placed in
   * a sandbox — but they are never treated as low-risk. Sandboxable high-risk
   * work (shell/code) leaves this false and must be isolated or blocked.
   */
  readonly requiresHostAuthority?: boolean;
  /** Existing control-plane risk (safe/sensitive/destructive) when available. */
  readonly controlRisk?: "safe" | "sensitive" | "destructive";
  /** Dry-run actions perform no side effects. */
  readonly dryRun: boolean;
  /** Workspace root (absolute) for containment checks. */
  readonly workspaceRoot: string;
  /** Explicit deployment profile (affects available backends). */
  readonly deploymentProfile?: string;
}

export interface RiskClassification {
  readonly tier: RiskTier;
  readonly reasons: readonly string[];
  /** True when the action cannot be executed safely in this environment. */
  readonly blocked: boolean;
  readonly blockReason?: string;
  readonly requiredApprovalLevel: "none" | "standard" | "elevated";
  readonly requiredCredentialMode: CredentialMode;
  readonly fs: FilesystemPolicy;
  readonly net: NetworkPolicy;
  readonly proc: ProcessPolicy;
  readonly resources: ResourcePolicy;
  /** Echo of the deterministic inputs used (for audit). */
  readonly inputs: TrustRequest;
  readonly classifierVersion: string;
}

// ── Placement decision ────────────────────────────────────────────────────

export type PlacementDecisionKind =
  | "admitted"        // environment available + verified, may execute.
  | "blocked"         // required isolation unavailable → fail closed.
  | "in_process_ok"   // tier0, no environment needed.
  | "quarantined";    // prior unresolved cleanup/escape → refuse.

export interface PlacementDecision {
  readonly kind: PlacementDecisionKind;
  readonly requestedTier: RiskTier;
  readonly placement: PlacementKind;
  readonly backendId?: string;            // selected backend instance id
  readonly environmentId?: string;        // provisioned environment id
  readonly reason: string;
  readonly remediation?: string;          // operator-facing fix when blocked
  readonly decidedAt: number;
  readonly policyVersion: string;
}

// ── Environment contract ──────────────────────────────────────────────────

export type EnvironmentLifecycleState =
  | "created"
  | "starting"
  | "ready"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "quarantined";

export interface EnvironmentInfo {
  readonly environmentId: string;
  readonly backendId: string;
  readonly placement: PlacementKind;
  readonly tier: RiskTier;
  readonly workspaceId: string;
  readonly executionId: string;
  readonly state: EnvironmentLifecycleState;
  readonly guarantees: PlacementGuarantees;
  readonly createdAt: number;
  readonly readyAt?: number;
  readonly stoppedAt?: number;
  readonly pid?: number;
  readonly failureReason?: string;
  readonly quarantined?: boolean;
  readonly quarantineReason?: string;
}

/** Result of running an executable spec inside an environment. */
export interface EnvironmentRunResult {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputTruncated: boolean;
  readonly durationMs: number;
  /** True if the environment believes a limit/boundary was hit or violated. */
  readonly boundaryEvent: boolean;
  readonly boundaryDetail?: string;
}

/** A command an environment can execute (high-risk action classes use this). */
export interface EnvironmentExecutable {
  readonly argv: readonly string[];
  readonly cwd: string;
  /** Explicit, already-sanitized env (names+values the broker approved). */
  readonly env: Record<string, string>;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  /** Optional stdin to feed the process. */
  readonly stdin?: string;
}

// ── Verification & cleanup ────────────────────────────────────────────────

export interface VerificationCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface VerificationResult {
  readonly verified: boolean;
  readonly expectedPlacement: PlacementKind;
  readonly actualPlacement: PlacementKind;
  readonly environmentId: string;
  readonly checks: readonly VerificationCheck[];
  readonly verifiedAt: number;
}

export type CleanupState =
  | "not_required"
  | "succeeded"
  | "partial"        // some resources cleaned, some not
  | "failed"         // cleanup failed → environment quarantined
  | "pending";

export interface CleanupResult {
  readonly state: CleanupState;
  readonly processesKilled: number;
  readonly credentialsRevoked: number;
  readonly tempRemoved: boolean;
  readonly detail?: string;
  readonly finishedAt: number;
}

// ── Aggregate trust record (attached to ExecutionRecord.trust) ────────────

export interface TrustRecord {
  readonly classification: {
    readonly tier: RiskTier;
    readonly reasons: readonly string[];
    readonly requiredApprovalLevel: "none" | "standard" | "elevated";
    readonly classifierVersion: string;
  };
  readonly decision: PlacementDecision;
  readonly authorityGrantId?: string;
  readonly credentialScope?: CredentialScope;
  readonly resources?: ResourcePolicy;
  readonly verification?: VerificationResult;
  readonly cleanup?: CleanupResult;
  readonly quarantined?: boolean;
}

// ── Bounds (safe persistence) ─────────────────────────────────────────────

export const TRUST_BOUNDS = {
  MAX_REASONS: 12,
  MAX_REASON_CHARS: 200,
  MAX_CHECKS: 16,
  MAX_ALLOWLIST: 64,
  MAX_FS_ROOTS: 32,
  MAX_BLOCKED_PATHS: 64,
  MAX_ENV_NAMES: 32,
  MAX_CRED_REFS: 16,
  DEFAULT_WALL_CLOCK_MS: 120_000,
  MAX_WALL_CLOCK_MS: 600_000,
  DEFAULT_MAX_OUTPUT_BYTES: 1_000_000,
  MAX_MAX_OUTPUT_BYTES: 16_000_000,
  DEFAULT_MEMORY_BYTES: 512 * 1024 * 1024,
  DEFAULT_CPU_SECONDS: 120,
  DEFAULT_MAX_PROCESSES: 64,
  GRANT_TTL_MS: 10 * 60 * 1000,
} as const;

/** Bump whenever classifier/policy semantics change. Recorded on every grant. */
export const TRUST_POLICY_VERSION = "xr-4.2.0/trust-v1";
export const TRUST_CLASSIFIER_VERSION = "xr-4.2.0/classifier-v1";
