/**
 * XR 4.0 — Kernel Error Taxonomy
 *
 * Structured, inspectable errors for kernel-level operations. Every error
 * carries a stable `code`, a human-readable `message`, and optional `context`
 * metadata. Codes are machine-parseable and safe for CLI, JSON, and daemon
 * output — they never include secret values or sensitive configuration.
 *
 * Design rules:
 *   - Codes are UPPER_SNAKE_CASE strings, stable across releases.
 *   - Messages are human-friendly and actionable.
 *   - Context is always safe to serialize (no secrets, no file handles).
 *   - Errors preserve the causal chain via `cause` (standard Error property).
 *   - Each class extends KernelError so callers can `instanceof` check.
 */

/** Stable error codes for kernel operations. */
export const KernelErrorCode = {
  // Lifecycle
  INVALID_LIFECYCLE_TRANSITION: "INVALID_LIFECYCLE_TRANSITION",
  DUPLICATE_BOOTSTRAP: "DUPLICATE_BOOTSTRAP",
  START_BEFORE_BOOTSTRAP: "START_BEFORE_BOOTSTRAP",
  DUPLICATE_START: "DUPLICATE_START",
  SHUTDOWN_BEFORE_BOOTSTRAP: "SHUTDOWN_BEFORE_BOOTSTRAP",
  DUPLICATE_SHUTDOWN: "DUPLICATE_SHUTDOWN",

  // Service registry
  SERVICE_NOT_FOUND: "SERVICE_NOT_FOUND",
  DUPLICATE_REGISTRATION: "DUPLICATE_REGISTRATION",
  DEPENDENCY_CYCLE: "DEPENDENCY_CYCLE",
  MISSING_DEPENDENCY: "MISSING_DEPENDENCY",
  STALE_SERVICE: "STALE_SERVICE",

  // Workspace
  WORKSPACE_SWITCH_FAILED: "WORKSPACE_SWITCH_FAILED",
  WORKSPACE_NOT_FOUND: "WORKSPACE_NOT_FOUND",
  WORKSPACE_STORE_CLOSED: "WORKSPACE_STORE_CLOSED",
  WORKSPACE_SWITCH_IN_PROGRESS: "WORKSPACE_SWITCH_IN_PROGRESS",

  // Background services
  BACKGROUND_JOB_NOT_FOUND: "BACKGROUND_JOB_NOT_FOUND",
  BACKGROUND_JOB_FAILED: "BACKGROUND_JOB_FAILED",
  BACKGROUND_JOB_DUPLICATE: "BACKGROUND_JOB_DUPLICATE",
  BACKGROUND_JOB_OWNER_MISMATCH: "BACKGROUND_JOB_OWNER_MISMATCH",

  // Configuration
  CONFIG_INVALID: "CONFIG_INVALID",
  CONFIG_RUNTIME_INIT_FAILED: "CONFIG_RUNTIME_INIT_FAILED",

  // General
  RUNTIME_NOT_READY: "RUNTIME_NOT_READY",
  RUNTIME_FAILED: "RUNTIME_FAILED",
  PROVIDER_REGISTRATION_FAILED: "PROVIDER_REGISTRATION_FAILED",
  PROVIDER_INIT_FAILED: "PROVIDER_INIT_FAILED",
  LIFECYCLE_HOOK_FAILED: "LIFECYCLE_HOOK_FAILED",
} as const;

export type KernelErrorCodeType = (typeof KernelErrorCode)[keyof typeof KernelErrorCode];

/** Context metadata attached to kernel errors. Always safe to serialize. */
export interface KernelErrorContext {
  /** Service token or name involved. */
  service?: string;
  /** Current lifecycle state at time of error. */
  state?: string;
  /** Target lifecycle state that was attempted. */
  targetState?: string;
  /** Workspace ID involved. */
  workspaceId?: string;
  /** Background job ID involved. */
  jobId?: string;
  /** Additional safe detail. */
  detail?: string;
  /** Dependency chain involved. */
  dependencies?: string[];
  /** Registration scope. */
  scope?: string;
  /** Phase of lifecycle when error occurred. */
  phase?: string;
  /** Timestamp of the error. */
  timestamp?: number;
}

/**
 * Base class for all kernel errors. Carries a stable code, human message,
 * and optional safe context metadata.
 */
export class KernelError extends Error {
  readonly code: KernelErrorCodeType;
  readonly context: KernelErrorContext;

  constructor(
    code: KernelErrorCodeType,
    message: string,
    context: KernelErrorContext = {},
    cause?: Error,
  ) {
    super(message, { cause });
    this.name = "KernelError";
    this.code = code;
    this.context = { ...context, timestamp: context.timestamp ?? Date.now() };
  }

  /** Serialize to a safe, secret-free JSON object. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }

  /** Format for human-readable CLI output. */
  toDisplayString(): string {
    const parts = [`[${this.code}] ${this.message}`];
    if (this.context.service) parts.push(`  service: ${this.context.service}`);
    if (this.context.state) parts.push(`  state: ${this.context.state}`);
    if (this.context.targetState) parts.push(`  target: ${this.context.targetState}`);
    if (this.context.workspaceId) parts.push(`  workspace: ${this.context.workspaceId}`);
    if (this.context.jobId) parts.push(`  job: ${this.context.jobId}`);
    if (this.context.detail) parts.push(`  detail: ${this.context.detail}`);
    return parts.join("\n");
  }
}

// ── Specific error classes ──────────────────────────────────────────────────

export class LifecycleTransitionError extends KernelError {
  constructor(from: string, to: string, detail?: string) {
    super(
      KernelErrorCode.INVALID_LIFECYCLE_TRANSITION,
      `Cannot transition from ${from} to ${to}${detail ? `: ${detail}` : "."}`,
      { state: from, targetState: to, detail },
    );
    this.name = "LifecycleTransitionError";
  }
}

export class DuplicateBootstrapError extends KernelError {
  constructor() {
    super(
      KernelErrorCode.DUPLICATE_BOOTSTRAP,
      "Runtime has already been bootstrapped. Call shutdown() before re-bootstrapping.",
    );
    this.name = "DuplicateBootstrapError";
  }
}

export class StartBeforeBootstrapError extends KernelError {
  constructor() {
    super(
      KernelErrorCode.START_BEFORE_BOOTSTRAP,
      "Cannot start the runtime before bootstrap() has completed successfully.",
    );
    this.name = "StartBeforeBootstrapError";
  }
}

export class DuplicateStartError extends KernelError {
  constructor() {
    super(
      KernelErrorCode.DUPLICATE_START,
      "Runtime is already started.",
    );
    this.name = "DuplicateStartError";
  }
}

export class ShutdownBeforeBootstrapError extends KernelError {
  constructor() {
    super(
      KernelErrorCode.SHUTDOWN_BEFORE_BOOTSTRAP,
      "Cannot shut down a runtime that was never bootstrapped.",
    );
    this.name = "ShutdownBeforeBootstrapError";
  }
}

export class ServiceNotFoundError extends KernelError {
  constructor(serviceId: string, context?: Partial<KernelErrorContext>) {
    super(
      KernelErrorCode.SERVICE_NOT_FOUND,
      `Service "${serviceId}" not found in the registry. Ensure it is registered before resolution.`,
      { service: serviceId, ...context },
    );
    this.name = "ServiceNotFoundError";
  }
}

export class DuplicateRegistrationError extends KernelError {
  constructor(serviceId: string) {
    super(
      KernelErrorCode.DUPLICATE_REGISTRATION,
      `Service "${serviceId}" is already registered. Use allowOverride to replace, or unregister first.`,
      { service: serviceId },
    );
    this.name = "DuplicateRegistrationError";
  }
}

export class DependencyCycleError extends KernelError {
  constructor(cycle: string[]) {
    super(
      KernelErrorCode.DEPENDENCY_CYCLE,
      `Circular lifecycle dependency detected: ${cycle.join(" → ")}.`,
      { dependencies: cycle },
    );
    this.name = "DependencyCycleError";
  }
}

export class MissingDependencyError extends KernelError {
  constructor(serviceId: string, missingDep: string) {
    super(
      KernelErrorCode.MISSING_DEPENDENCY,
      `Service "${serviceId}" depends on "${missingDep}" which is not registered.`,
      { service: serviceId, dependencies: [missingDep] },
    );
    this.name = "MissingDependencyError";
  }
}

export class StaleServiceError extends KernelError {
  constructor(serviceId: string, detail?: string) {
    super(
      KernelErrorCode.STALE_SERVICE,
      `Service "${serviceId}" is stale${detail ? `: ${detail}` : ". It belongs to a closed workspace or stopped runtime."}`,
      { service: serviceId, detail },
    );
    this.name = "StaleServiceError";
  }
}

export class WorkspaceSwitchFailedError extends KernelError {
  constructor(fromId: string, toId: string, step: string, cause?: Error) {
    super(
      KernelErrorCode.WORKSPACE_SWITCH_FAILED,
      `Workspace switch from "${fromId}" to "${toId}" failed during: ${step}.`,
      { workspaceId: toId, detail: `failed at step: ${step}` },
      cause,
    );
    this.name = "WorkspaceSwitchFailedError";
  }
}

export class WorkspaceNotFoundError extends KernelError {
  constructor(workspaceId: string) {
    super(
      KernelErrorCode.WORKSPACE_NOT_FOUND,
      `Workspace "${workspaceId}" not found. Create it first with: xr workspace create ${workspaceId}`,
      { workspaceId },
    );
    this.name = "WorkspaceNotFoundError";
  }
}

export class BackgroundJobNotFoundError extends KernelError {
  constructor(jobId: string) {
    super(
      KernelErrorCode.BACKGROUND_JOB_NOT_FOUND,
      `Background job "${jobId}" not found.`,
      { jobId },
    );
    this.name = "BackgroundJobNotFoundError";
  }
}

export class BackgroundJobDuplicateError extends KernelError {
  constructor(jobId: string) {
    super(
      KernelErrorCode.BACKGROUND_JOB_DUPLICATE,
      `Background job "${jobId}" is already registered. Unregister it first.`,
      { jobId },
    );
    this.name = "BackgroundJobDuplicateError";
  }
}

export class BackgroundJobOwnerMismatchError extends KernelError {
  constructor(jobId: string, expectedOwner: string, actualOwner: string) {
    super(
      KernelErrorCode.BACKGROUND_JOB_OWNER_MISMATCH,
      `Background job "${jobId}" is owned by "${actualOwner}", not "${expectedOwner}".`,
      { jobId, detail: `expected owner: ${expectedOwner}, actual: ${actualOwner}` },
    );
    this.name = "BackgroundJobOwnerMismatchError";
  }
}

export class RuntimeNotReadyError extends KernelError {
  constructor(detail?: string) {
    super(
      KernelErrorCode.RUNTIME_NOT_READY,
      `Runtime is not ready${detail ? `: ${detail}` : "."}`,
      { detail },
    );
    this.name = "RuntimeNotReadyError";
  }
}

export class RuntimeFailedError extends KernelError {
  constructor(detail?: string, cause?: Error) {
    super(
      KernelErrorCode.RUNTIME_FAILED,
      `Runtime has entered a failed state${detail ? `: ${detail}` : "."}`,
      { detail },
      cause,
    );
    this.name = "RuntimeFailedError";
  }
}

export class ProviderRegistrationFailedError extends KernelError {
  constructor(providerId: string, cause?: Error) {
    super(
      KernelErrorCode.PROVIDER_REGISTRATION_FAILED,
      `Provider "${providerId}" failed during registration.`,
      { service: providerId },
      cause,
    );
    this.name = "ProviderRegistrationFailedError";
  }
}

export class ProviderInitFailedError extends KernelError {
  constructor(providerId: string, cause?: Error) {
    super(
      KernelErrorCode.PROVIDER_INIT_FAILED,
      `Provider "${providerId}" failed during async initialization.`,
      { service: providerId },
      cause,
    );
    this.name = "ProviderInitFailedError";
  }
}

export class LifecycleHookFailedError extends KernelError {
  constructor(service: string, phase: string, cause?: Error) {
    super(
      KernelErrorCode.LIFECYCLE_HOOK_FAILED,
      `Lifecycle ${phase} hook failed for service "${service}".`,
      { service, phase },
      cause,
    );
    this.name = "LifecycleHookFailedError";
  }
}
