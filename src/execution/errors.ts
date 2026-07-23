/**
 * XR 4.1 — Execution Errors
 *
 * Structured errors for the Unified Execution Fabric. These extend the
 * Phase 1 KernelError taxonomy where it fits, and add execution-specific
 * codes that have no Phase 1 equivalent.
 */
import {
  KernelError,
  KernelErrorCode,
  type KernelErrorContext,
  type KernelErrorCodeType,
} from "../core/errors.ts";

/** Stable execution-specific error codes (extend Phase 1 set). */
export const ExecutionErrorCode = {
  ...KernelErrorCode,
  INVALID_EXECUTION_TRANSITION: "INVALID_EXECUTION_TRANSITION",
  UNAUTHORIZED_EXECUTION: "UNAUTHORIZED_EXECUTION",
  ACTION_VALIDATION_FAILED: "ACTION_VALIDATION_FAILED",
  DUPLICATE_ACTION: "DUPLICATE_ACTION",
  NON_IDEMPOTENT_RETRY_BLOCKED: "NON_IDEMPOTENT_RETRY_BLOCKED",
  EXECUTION_TIMEOUT: "EXECUTION_TIMEOUT",
  CANCELLATION_UNSUPPORTED: "CANCELLATION_UNSUPPORTED",
  OBSERVATION_NORMALIZATION_FAILED: "OBSERVATION_NORMALIZATION_FAILED",
  EXECUTION_PERSISTENCE_FAILED: "EXECUTION_PERSISTENCE_FAILED",
  EXECUTION_NOT_FOUND: "EXECUTION_NOT_FOUND",
  POLICY_REQUIRED: "POLICY_REQUIRED",
  APPROVAL_EXPIRED: "APPROVAL_EXPIRED",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
} as const;

export type ExecutionErrorCodeType = (typeof ExecutionErrorCode)[keyof typeof ExecutionErrorCode];

export interface ExecutionErrorContext extends KernelErrorContext {
  runId?: string;
  correlationId?: string;
  capability?: string;
  attempt?: number;
  state?: string;
  targetState?: string;
}

export class InvalidExecutionTransitionError extends KernelError {
  constructor(runId: string, from: string | null, to: string, detail?: string) {
    super(
      "INVALID_EXECUTION_TRANSITION" as KernelErrorCodeType,
      `Execution ${runId}: cannot transition from ${from ?? "<none>"} to ${to}${detail ? `: ${detail}` : "."}`,
      { service: "execution", detail, jobId: runId, state: from ?? undefined, targetState: to } as KernelErrorContext,
    );
    this.name = "InvalidExecutionTransitionError";
  }
}

export class UnauthorizedExecutionError extends KernelError {
  constructor(runId: string, reason: string) {
    super(
      "UNAUTHORIZED_EXECUTION" as KernelErrorCodeType,
      `Execution ${runId} is not authorized: ${reason}`,
      { service: "execution", detail: reason, jobId: runId } as KernelErrorContext,
    );
    this.name = "UnauthorizedExecutionError";
  }
}

export class ActionValidationError extends KernelError {
  constructor(runId: string, reason: string) {
    super(
      "ACTION_VALIDATION_FAILED" as KernelErrorCodeType,
      `Execution ${runId} action validation failed: ${reason}`,
      { service: "execution", detail: reason, jobId: runId } as KernelErrorContext,
    );
    this.name = "ActionValidationError";
  }
}

export class DuplicateActionError extends KernelError {
  constructor(runId: string, key: string) {
    super(
      "DUPLICATE_ACTION" as KernelErrorCodeType,
      `Execution ${runId} duplicates a previous action with idempotency key ${key}`,
      { service: "execution", detail: `idempotency_key=${key}`, jobId: runId } as KernelErrorContext,
    );
    this.name = "DuplicateActionError";
  }
}

export class NonIdempotentRetryBlockedError extends KernelError {
  constructor(runId: string, capability: string) {
    super(
      "NON_IDEMPOTENT_RETRY_BLOCKED" as KernelErrorCodeType,
      `Cannot retry execution ${runId} (${capability}): action is non-idempotent and side-effect status is unknown.`,
      { service: "execution", detail: capability, jobId: runId } as KernelErrorContext,
    );
    this.name = "NonIdempotentRetryBlockedError";
  }
}

export class ExecutionTimeoutError extends KernelError {
  constructor(runId: string, ms: number, stage: string) {
    super(
      "EXECUTION_TIMEOUT" as KernelErrorCodeType,
      `Execution ${runId} timed out after ${ms}ms (${stage}).`,
      { service: "execution", detail: `stage=${stage}, timeoutMs=${ms}`, jobId: runId } as KernelErrorContext,
    );
    this.name = "ExecutionTimeoutError";
  }
}

export class CancellationUnsupportedError extends KernelError {
  constructor(runId: string) {
    super(
      "CANCELLATION_UNSUPPORTED" as KernelErrorCodeType,
      `Execution ${runId}: cancellation was requested but the underlying action does not support forced cancellation.`,
      { service: "execution", jobId: runId } as KernelErrorContext,
    );
    this.name = "CancellationUnsupportedError";
  }
}

export class ExecutionPersistenceError extends KernelError {
  constructor(runId: string | null, cause?: Error) {
    super(
      "EXECUTION_PERSISTENCE_FAILED" as KernelErrorCodeType,
      `Execution${runId ? ` ${runId}` : ""} persistence failed — outcome may not be durable.`,
      { service: "execution", jobId: runId ?? undefined } as KernelErrorContext,
      cause,
    );
    this.name = "ExecutionPersistenceError";
  }
}

export class ExecutionNotFoundError extends KernelError {
  constructor(runId: string) {
    super(
      "SERVICE_NOT_FOUND" as KernelErrorCodeType,
      `Execution record \"${runId}\" not found.`,
      { service: "execution", jobId: runId } as KernelErrorContext,
    );
    this.name = "ExecutionNotFoundError";
  }
}

export class ApprovalExpiredError extends KernelError {
  constructor(runId: string, requestId: string) {
    super(
      "APPROVAL_EXPIRED" as KernelErrorCodeType,
      `Execution ${runId}: approval request ${requestId} expired before being answered.`,
      { service: "execution", detail: requestId, jobId: runId } as KernelErrorContext,
    );
    this.name = "ApprovalExpiredError";
  }
}

export class BudgetExceededError extends KernelError {
  constructor(runId: string, reason: string, meter?: string) {
    super(
      "BUDGET_EXCEEDED" as KernelErrorCodeType,
      `Execution ${runId} blocked by budget: ${reason}${meter ? ` (${meter})` : ""}.`,
      { service: "execution", detail: reason, jobId: runId } as KernelErrorContext,
    );
    this.name = "BudgetExceededError";
  }
}
