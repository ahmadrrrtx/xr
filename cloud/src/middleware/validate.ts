/**
 * XR Cloud — request validation.
 *
 * One helper, one rule: **every** body, query and path parameter that reaches a
 * handler has been through a Zod schema, and what the handler receives is the
 * *parsed output*, never the raw input.
 *
 * Two details that matter more than they look:
 *
 *   1. **Unknown keys are stripped, not merged.** Zod objects drop unrecognised
 *      keys by default. That means mass-assignment ("POST /members with
 *      `{\"role\":\"owner\"}` on a route that did not intend to accept a role")
 *      is not a mistake a handler can make, because the extra key is gone before
 *      the handler sees it.
 *   2. **Validation errors are `422` with field details, not `400`.** The client
 *      can point at the field. The repair string says no partial write happened,
 *      which is true — validation runs before any transaction opens.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { ZodType, z } from "zod";

import { validationFailed } from "../lib/errors.ts";

export interface Parsed<T> {
  data: T;
}

/** Flatten Zod issues into `{ "field.path": "message" }`. */
function issuesOf(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map((p) => String(p)).join(".") || "(root)";
    out[key] = issue.message;
  }
  return out;
}

export async function parseBody<T extends ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw validationFailed({ "(body)": "Body must be valid JSON." });
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw validationFailed(issuesOf(result.error));
  return result.data;
}

export function parseQuery<T extends ZodType>(c: Context, schema: T): z.infer<T> {
  const raw = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) throw validationFailed(issuesOf(result.error));
  return result.data;
}

/**
 * Form-encoded bodies are parsed with the same schema, because
 * `application/x-www-form-urlencoded` is what a browser posts without JavaScript
 * and it must not be a second, less-checked path into the same handlers.
 */
export async function parseForm<T extends ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: Record<string, string>;
  try {
    const form = await c.req.formData();
    raw = Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  } catch {
    throw validationFailed({ "(body)": "Body must be a form submission." });
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw validationFailed(issuesOf(result.error));
  return result.data;
}

/**
 * Raw body access for webhook verification. Signature verification needs the
 * exact bytes Stripe signed; re-serialising parsed JSON changes whitespace and
 * breaks the HMAC, which is a classic and very confusing bug.
 */
export async function rawBody(c: Context): Promise<string> {
  return await c.req.text();
}

/** Guard used by `createRoute`-style helpers when a param must exist. */
export function requiredParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value) throw validationFailed({ [name]: "Missing path parameter." });
  return value;
}

export const noop: MiddlewareHandler = async (_c, next) => {
  await next();
};
