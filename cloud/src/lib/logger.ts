/**
 * XR Cloud — structured logging.
 *
 * Constitution Art. XXI: observability records **structure only** — kind, name,
 * ids, outcome — never payloads. This file is where that promise is enforced
 * mechanically rather than by reviewer discipline:
 *
 *   - `redactPaths` covers the credential-bearing keys that appear on our own
 *     objects (headers, cookies, tokens, secrets, memory bodies, prompt text).
 *   - `scrub()` is exported so route code can sanitise anything before it puts it
 *     in a log field, and the error handler uses it for unhandled throws.
 *   - There is no transport that ships anywhere. Logs go to stdout as JSON and
 *     stop there. There is no third-party analytics SDK in this dependency tree,
 *     which is the load-bearing part of "zero telemetry" — it is not a policy,
 *     it is an absent import.
 */

import { pino } from "pino";

import { loadEnv } from "../env.ts";

/** Keys whose values are never logged, at any depth pino's redactor can reach. */
const REDACT_KEYS = [
  "password",
  "passwordHash",
  "password_hash",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "refreshHash",
  "refresh_hash",
  "tokenHash",
  "token_hash",
  "clientSecret",
  "client_secret",
  "oidcClientSecretEnc",
  "samlIdpCertEnc",
  "secret",
  "apiKey",
  "api_key",
  "keyHash",
  "key_hash",
  "orgKey",
  "org_key",
  "orgKeyWrapped",
  "org_key_wrapped",
  "bodyCiphertext",
  "body_ciphertext",
  "privateKey",
  "authorization",
  "cookie",
  "set-cookie",
  "stripeSecret",
  "XR_KEY_ENCRYPTION_KEY",
  "JWT_SECRET",
];

function redactPaths(): string[] {
  const paths: string[] = [];
  for (const key of REDACT_KEYS) {
    paths.push(key);
    paths.push(`*.${key}`);
    paths.push(`*.*.${key}`);
    paths.push(`req.headers.${key.toLowerCase()}`);
    paths.push(`res.headers.${key.toLowerCase()}`);
  }
  return paths;
}

export type Logger = ReturnType<typeof createLogger>;

export function createLogger(opts?: { level?: string; name?: string }) {
  const env = loadEnv();
  return pino({
    name: opts?.name ?? "xr-cloud",
    level: opts?.level ?? env.LOG_LEVEL,
    redact: { paths: redactPaths(), censor: "[redacted]" },
    base: { service: "xr-cloud" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

/**
 * Lazy singleton.
 *
 * This MUST NOT be evaluated at module load. `logger.ts` is imported by the
 * bootstrap chain before an entrypoint has had a chance to set its environment,
 * so a top-level `createLogger()` reads an empty `process.env` and throws
 * `EnvError` from a module import — the least debuggable way for a service to
 * fail. The first caller that actually wants to log pays for it.
 */
let cachedLogger: Logger | undefined;

export function getLogger(): Logger {
  cachedLogger ??= createLogger();
  return cachedLogger;
}

/**
 * Strip anything that could carry a secret or a payload out of an arbitrary
 * value before it is logged. Depth- and entry-bounded (Art. XII · Rule 3):
 * a hostile object graph must not be able to blow up a log line.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…[truncated]` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return { name: value.name, message: scrub(value.message, depth + 1) };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (n++ >= 50) break;
      out[k] = REDACT_KEYS.includes(k) ? "[redacted]" : scrub(v, depth + 1);
    }
    return out;
  }
  return "[unloggable]";
}
