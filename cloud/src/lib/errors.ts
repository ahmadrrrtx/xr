/**
 * XR Cloud — the error vocabulary.
 *
 * Every failure that reaches a client is one of these. Two rules hold:
 *
 *   1. **A client never learns more than it needs.** An auth failure is
 *      "Invalid credentials", never "no such user" vs "wrong password". A
 *      missing resource the caller may not read is "Not found", never
 *      "Forbidden" — the latter confirms the resource exists.
 *   2. **A client always learns enough to act.** Every error carries a stable
 *      machine `code` and, where relevant, a `repair` string naming the concrete
 *      next step (Constitution Art. X.3 — a degraded path names a repair).
 *
 * Deliberately NOT included: stack traces, driver messages, SQL, or anything
 * that would echo a secret. The handler in `middleware/error-handler.ts` maps an
 * unexpected throw to a generic 500 and logs the real cause server-side.
 */

export type CloudErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthorized"
  | "invalid_credentials"
  | "session_expired"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "gone"
  | "rate_limited"
  | "policy_denied"
  | "budget_exceeded"
  | "provider_disabled"
  | "byok_required"
  | "sso_enforced"
  | "csrf_failed"
  | "unavailable"
  | "internal";

export class CloudError extends Error {
  readonly status: number;
  readonly code: CloudErrorCode;
  readonly repair?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: CloudErrorCode,
    message: string,
    opts?: { repair?: string; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "CloudError";
    this.status = status;
    this.code = code;
    this.repair = opts?.repair;
    this.details = opts?.details;
  }
}

export const badRequest = (message: string, repair?: string): CloudError =>
  new CloudError(400, "bad_request", message, repair ? { repair } : undefined);

export const validationFailed = (details: Record<string, unknown>): CloudError =>
  new CloudError(422, "validation_failed", "Request validation failed.", {
    repair: "Correct the highlighted fields and retry. No partial write occurred.",
    details,
  });

export const unauthorized = (message = "Authentication required."): CloudError =>
  new CloudError(401, "unauthorized", message, {
    repair: "Sign in again with a magic link or your organization's SSO.",
  });

export const invalidCredentials = (): CloudError =>
  new CloudError(401, "invalid_credentials", "Invalid credentials.", {
    repair: "Request a new sign-in link. Links expire after 10 minutes and work once.",
  });

export const sessionExpired = (): CloudError =>
  new CloudError(401, "session_expired", "Your session has expired.", {
    repair: "Refresh the page to start a new session.",
  });

/**
 * `forbidden` and `notFound` accept an optional repair because most refusals in
 * this service are actionable: "you are not a member" is a dead end, "ask an
 * admin to invite this address" is not. The default repair is used when the
 * caller genuinely has nothing more to say — which is rare enough to be a signal.
 */
export const forbidden = (
  message = "You do not have access to this resource.",
  repair = "Ask an organization owner or admin to grant you access.",
): CloudError => new CloudError(403, "forbidden", message, { repair });

export const notFound = (what = "Resource", repair?: string): CloudError =>
  new CloudError(404, "not_found", `${what} not found.`, repair ? { repair } : undefined);

export const conflict = (
  message: string,
  repair?: string,
  details?: Record<string, unknown>,
): CloudError =>
  new CloudError(409, "conflict", message, {
    ...(repair ? { repair } : {}),
    ...(details ? { details } : {}),
  });

export const gone = (message: string): CloudError => new CloudError(410, "gone", message);

export const rateLimited = (retryAfterSeconds: number): CloudError =>
  new CloudError(429, "rate_limited", "Too many requests.", {
    repair: `Wait ${retryAfterSeconds} seconds and retry.`,
    details: { retryAfterSeconds },
  });

/** Team policy said no. Distinct from `forbidden` because policy is editable. */
export const policyDenied = (message: string, repair: string): CloudError =>
  new CloudError(403, "policy_denied", message, { repair });

export const budgetExceeded = (scope: "daily" | "monthly" | "team", repair: string): CloudError =>
  new CloudError(402, "budget_exceeded", `Your ${scope} budget for XR-managed models is exhausted.`, {
    repair,
    details: { scope },
  });

export const providerDisabled = (provider: string, allowed: readonly string[]): CloudError =>
  new CloudError(403, "provider_disabled", `Provider "${provider}" is not enabled for your team.`, {
    repair:
      allowed.length > 0
        ? `Use one of the providers your admin allows: ${allowed.join(", ")}. Or ask an admin to add ${provider}.`
        : "Ask an organization admin to enable this provider for the team.",
    details: { provider, allowed },
  });

export const byokRequired = (): CloudError =>
  new CloudError(403, "byok_required", "Your team requires bring-your-own-key.", {
    repair:
      "Add your own provider key in Settings → Models. Your team's admin has disabled XR-managed keys for cost control.",
  });

export const ssoEnforced = (orgId: string): CloudError =>
  new CloudError(403, "sso_enforced", "Your organization requires single sign-on.", {
    repair: `Sign in through your identity provider instead. Org: ${orgId}.`,
  });

export const csrfFailed = (): CloudError =>
  new CloudError(403, "csrf_failed", "Cross-site request blocked.", {
    repair: "Reload the page and retry. If this persists, clear cookies for this domain.",
  });

export const unavailable = (feature: string, detail: string): CloudError =>
  new CloudError(503, "unavailable", `${feature} is not available on this deployment.`, {
    repair: detail,
  });

export const internal = (): CloudError =>
  new CloudError(500, "internal", "Something went wrong on our side.", {
    repair: "Retry once. If it repeats, contact support with the request id from the response header.",
  });

/** The shape that goes over the wire. Stable — clients and docs depend on it. */
export interface ErrorBody {
  error: {
    code: CloudErrorCode;
    message: string;
    repair?: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

export function toErrorBody(error: CloudError, requestId?: string): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.repair ? { repair: error.repair } : {}),
      ...(error.details ? { details: error.details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };
}
