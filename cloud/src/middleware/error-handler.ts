/**
 * XR Cloud — the last line.
 *
 * Everything that escapes a handler lands here. Two obligations:
 *
 *   - **To the client:** a stable, actionable JSON body. Never a stack trace,
 *     never a driver message, never an echoed input value.
 *   - **To the operator:** the real cause, with the request id that the client
 *     also received, so one grep joins the two halves.
 *
 * The split is deliberate. A `CloudError` is a decision the service made and its
 * message was written for a user; anything else is a defect, and a defect's
 * message was written for nobody in particular and often contains a SQL fragment
 * or a file path. The default answer to "unexpected" is therefore a generic 500
 * (Constitution Art. IV.2 — never a fake success, and never a leak dressed as
 * helpfulness).
 */

import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import { CloudError, internal, toErrorBody, validationFailed } from "../lib/errors.ts";
import { getLogger, scrub } from "../lib/logger.ts";

export const errorHandler: ErrorHandler = (error, c) => {
  // Resolved per-error rather than at import time — see lib/logger.ts.
  const logger = getLogger();
  const requestId = c.get("requestId") ?? "unknown";
  const path = new URL(c.req.url).pathname;
  const method = c.req.method;

  if (error instanceof CloudError) {
    // Expected refusals are logged at info/warn, not error. A rate limit is not
    // an incident; an unhandled throw is.
    const level = error.status >= 500 ? "error" : "info";
    logger[level](
      { requestId, method, path, code: error.code, status: error.status },
      "request refused",
    );
    if (error.status === 429) {
      const retry = error.details?.retryAfterSeconds;
      if (typeof retry === "number") c.header("Retry-After", String(retry));
    }
    return c.json(toErrorBody(error, requestId), error.status as 400);
  }

  if (error instanceof HTTPException) {
    logger.warn({ requestId, method, path, status: error.status }, "http exception");
    return c.json(
      {
        error: {
          code: "bad_request" as const,
          message: error.message || "Bad request.",
          requestId,
        },
      },
      error.status,
    );
  }

  // A Zod-shaped error that reached here means a route validated outside the
  // helpers. Report it as a validation failure rather than a 500 — that is the
  // truthful classification.
  if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues: unknown }).issues)) {
    const issues = (error as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues;
    const details: Record<string, string> = {};
    for (const issue of issues) {
      details[issue.path.map(String).join(".") || "(root)"] = issue.message;
    }
    const shaped = validationFailed(details);
    return c.json(toErrorBody(shaped, requestId), 422);
  }

  // Unexpected. Log everything, tell the client nothing.
  logger.error(
    {
      requestId,
      method,
      path,
      err: scrub(error),
      stack: error instanceof Error ? scrub(error.stack ?? "") : undefined,
    },
    "unhandled error",
  );
  return c.json(toErrorBody(internal(), requestId), 500);
};
