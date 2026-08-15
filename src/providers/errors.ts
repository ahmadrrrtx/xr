/**
 * XR Phase 04 — Provider Error Normalization
 *
 * Different vendors produce different errors. XR needs one normalized error model.
 * Public errors must be actionable, safe, structured, never leak secrets.
 */

export type ProviderErrorKind =
  | "authentication_failure"
  | "rate_limit"
  | "timeout"
  | "unavailable"
  | "invalid_request"
  | "model_unavailable"
  | "unsupported_capability"
  | "provider_overload"
  | "network_failure"
  | "context_length"
  | "content_policy_refusal"
  /**
   * Phase 06 — the provider answered, but the answer is structurally invalid
   * (invalid JSON, missing required fields, unexpected events). NOT retryable
   * against the same provider; execution state must not be mutated from it and
   * success must never be claimed.
   */
  | "malformed_response"
  | "unknown_provider_failure";

export interface ProviderErrorDetails {
  /** Original status code where available */
  statusCode?: number;
  /** Retry-After header or vendor retry info in ms */
  retryAfterMs?: number;
  /** Provider-specific code */
  providerCode?: string;
  /** Safe provider message (redacted, no secrets) */
  providerMessage?: string;
  /** Whether this was a timeout vs cancellation distinction already handled by guard */
  isTimeout?: boolean;
  /** Whether abort */
  isCancellation?: boolean;
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly providerId: string;
  readonly modelId?: string;
  readonly retryable: boolean;
  readonly details: ProviderErrorDetails;
  /** True if this error should be retried (transient) */
  readonly isRetryable: boolean;

  constructor(
    kind: ProviderErrorKind,
    providerId: string,
    message: string,
    opts: {
      modelId?: string;
      retryable?: boolean;
      details?: ProviderErrorDetails;
    } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.providerId = providerId;
    this.modelId = opts.modelId;
    this.retryable = opts.retryable ?? isRetryableKind(kind);
    this.isRetryable = this.retryable;
    this.details = opts.details ?? {};
  }

  /** Safe, redacted, actionable JSON for API responses / audit */
  toSafeJson(): Record<string, unknown> {
    return {
      kind: this.kind,
      providerId: this.providerId,
      modelId: this.modelId,
      message: redactSecrets(this.message),
      retryable: this.retryable,
      statusCode: this.details.statusCode,
      providerCode: this.details.providerCode,
      retryAfterMs: this.details.retryAfterMs,
    };
  }
}

function isRetryableKind(kind: ProviderErrorKind): boolean {
  switch (kind) {
    case "rate_limit":
    case "timeout":
    case "unavailable":
    case "provider_overload":
    case "network_failure":
      return true;
    case "authentication_failure":
    case "invalid_request":
    case "model_unavailable":
    case "unsupported_capability":
    case "context_length":
    case "content_policy_refusal":
    case "malformed_response":
    case "unknown_provider_failure":
      return false;
    default:
      return false;
  }
}

/**
 * Normalize any thrown error into a ProviderError.
 * Preserves provider-specific details internally where safe, redacts secrets.
 * Preserves ProviderAbortError (cancellation/timeout) as-is so GAP-001 guards remain honest.
 */
export function normalizeProviderError(
  err: unknown,
  providerId: string,
  modelId?: string,
): ProviderError | (Error & { name: string; kind?: string; providerId?: string }) {
  // Already ProviderError → preserve
  if (err instanceof ProviderError) return err;

  // ProviderAbortError from request-guard — MUST stay as ProviderAbortError for GAP-001
  // so isCancellation/isTimeout distinguish honestly. Gateway may still wrap it
  // elsewhere, but adapter layer must not convert it.
  const anyErr = err as any;
  if (anyErr?.name === "ProviderAbortError") {
    return err as any;
  }

  const rawMessage = (err instanceof Error ? err.message : String(err)).slice(0, 500);

  // Redact potential secrets from message
  const message = redactSecrets(rawMessage);

  // HTTP status extraction
  const statusMatch = rawMessage.match(/HTTP\s+(\d{3})/i);
  const statusCode = statusMatch ? Number(statusMatch[1]) : undefined;

  // Classify by status and message
  if (statusCode === 401 || statusCode === 403 || /api key|unauthorized|authentication|invalid_api_key|invalid.*key/i.test(rawMessage)) {
    return new ProviderError("authentication_failure", providerId, `Authentication failed for provider ${providerId}: check API key`, {
      modelId,
      details: { statusCode, providerMessage: message },
    });
  }
  if (statusCode === 429 || /rate limit|too many requests/i.test(rawMessage)) {
    // Try extract retry-after
    const retryMatch = rawMessage.match(/retry.*?(\d+)/i);
    const retryAfterMs = retryMatch ? Number(retryMatch[1]) * 1000 : undefined;
    return new ProviderError("rate_limit", providerId, `Rate limited by provider ${providerId}`, {
      modelId,
      details: { statusCode: 429, providerMessage: message, retryAfterMs },
    });
  }
  if (statusCode === 404 || /model.*not.*found|unknown model|model.*unavailable/i.test(rawMessage)) {
    return new ProviderError("model_unavailable", providerId, `Model ${modelId ?? "unknown"} not available on provider ${providerId}`, {
      modelId,
      details: { statusCode, providerMessage: message },
    });
  }
  if (/context.*length|too many tokens|maximum context/i.test(rawMessage)) {
    return new ProviderError("context_length", providerId, `Context length exceeded for provider ${providerId}`, {
      modelId,
      details: { statusCode, providerMessage: message },
    });
  }
  if (/content.*policy|refusal|blocked.*content|harmful/i.test(rawMessage)) {
    return new ProviderError("content_policy_refusal", providerId, `Content refused by provider ${providerId} policy`, {
      modelId,
      details: { statusCode, providerMessage: message },
    });
  }
  if (statusCode === 400 || /invalid.*request|bad.*request/i.test(rawMessage)) {
    return new ProviderError("invalid_request", providerId, `Invalid request to provider ${providerId}: ${message}`, {
      modelId,
      details: { statusCode, providerMessage: message },
    });
  }
  if (statusCode === 502 || statusCode === 503 || statusCode === 504 || /overload|unavailable|service.*unavailable|gateway/i.test(rawMessage)) {
    const kind: ProviderErrorKind = /overload/i.test(rawMessage) ? "provider_overload" : "unavailable";
    return new ProviderError(kind, providerId, `Provider ${providerId} ${kind === "provider_overload" ? "overloaded" : "unavailable"}`, {
      modelId,
      details: { statusCode, providerMessage: message },
    });
  }
  if (/network|ECONN|ENOTFOUND|fetch failed|connection/i.test(rawMessage)) {
    return new ProviderError("network_failure", providerId, `Network failure contacting provider ${providerId}`, {
      modelId,
      details: { statusCode, providerMessage: message },
    });
  }

  // Fallback unknown
  return new ProviderError("unknown_provider_failure", providerId, `Provider ${providerId} error: ${message}`, {
    modelId,
    details: { statusCode, providerMessage: message },
  });
}

function redactSecrets(text: string): string {
  // Redact API keys, bearer tokens, sk- etc.
  return text
    .replace(/(?:api[_-]?key|bearer|token)\s*[:=]\s*['\"]?([A-Za-z0-9-_]{20,})['\"]?/gi, "$1=[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{10,}/gi, "sk-[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9-_]{20,}/gi, "Bearer [REDACTED]")
    .replace(/key\s+sk-[A-Za-z0-9_-]+/gi, "key [REDACTED]");
}

export function redactText(text: string): string {
  return redactSecrets(text);
}

/**
 * Phase 06 · Step 29 — canonical error for a structurally invalid provider
 * answer (invalid JSON, missing required fields, unexpected events).
 * Non-retryable against the same provider; callers must NOT mark the turn
 * successful and must NOT mutate execution state from the malformed payload.
 */
export function malformedProviderResponseError(providerId: string, detail?: string, modelId?: string): ProviderError {
  return new ProviderError(
    "malformed_response",
    providerId,
    `provider ${providerId} returned a malformed response${detail ? ` (${redactSecrets(detail.slice(0, 160))})` : ""}`,
    { modelId, retryable: false, details: { providerMessage: "malformed response" } },
  );
}

/** Helper: should this error be retried? */
export function isRetryableProviderError(err: unknown): boolean {
  if (err instanceof ProviderError) return err.retryable;
  // ProviderAbortError timeout is retryable, cancellation is not
  const anyErr = err as any;
  if (anyErr?.name === "ProviderAbortError") {
    return anyErr.kind === "timeout";
  }
  return false;
}

/** Helper: is this a non-retryable error that should never be auto-retried? */
export function isNonRetryableProviderError(err: unknown): boolean {
  if (err instanceof ProviderError) return !err.retryable;
  const kind = (err as any)?.kind;
  if (kind === "authentication_failure" || kind === "invalid_request" || kind === "unsupported_capability") return true;
  return false;
}
