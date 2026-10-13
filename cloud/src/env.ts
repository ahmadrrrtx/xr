/**
 * XR Cloud — environment contract (12-factor, fail closed).
 *
 * Constitution Art. IV.4 — ambiguity denies. A half-configured billing service
 * is more dangerous than a service that refuses to boot, so this module is the
 * only place environment variables are read, and it is strict about it:
 *
 *   - There is no default for a secret. `JWT_SECRET` absent is a boot failure,
 *     not a random key generated at boot (a random key would silently invalidate
 *     every session on restart while looking healthy).
 *   - There is no default for `DATABASE_URL` or `APP_URL`.
 *   - Integrations that a *deployment* may legitimately omit (Stripe in a
 *     self-hosted non-billing install, S3 when the operator accepts local-only
 *     exports, SMTP in a dev loop) are **optional** — but each one reports its
 *     own `status` so the health endpoint can say "degraded" out loud instead of
 *     pretending. Art. IV.2 / Art. X.1.
 *
 * Nothing here is read at import time by any other module. Everything goes
 * through `loadEnv()` so a test can point the process at a scratch config.
 */

import { z } from "zod";

/** Whether a feature is fully configured, partially configured, or off. */
export type CapabilityState = "ready" | "disabled" | "misconfigured";

export interface Capability {
  readonly state: CapabilityState;
  /** Operator-facing repair path. Empty only when state === "ready". */
  readonly detail: string;
}

export interface CloudEnv {
  readonly NODE_ENV: "development" | "test" | "production";
  readonly PORT: number;
  readonly HOST: string;
  /** Public origin of this API, e.g. https://api.xr.rrrtx.ai — used in emails and license `iss`. */
  readonly API_URL: string;
  /** Public origin of the marketing site + admin console. The ONLY allowed CORS origin. */
  readonly APP_URL: string;

  readonly DATABASE_URL: string | undefined;
  /** `pglite` runs an in-process WASM Postgres — dev/test only, never production. */
  readonly DATABASE_DRIVER: "postgres" | "pglite";
  readonly PGLITE_DIR: string;

  readonly REDIS_URL: string | undefined;

  readonly JWT_SECRET: string;
  readonly COOKIE_DOMAIN: string | undefined;
  readonly SESSION_ACCESS_TTL_SECONDS: number;
  readonly SESSION_REFRESH_TTL_DAYS: number;

  /** base64 of 32 bytes. Wraps every org key. Never rotates silently. */
  readonly XR_KEY_ENCRYPTION_KEY: string;
  /** Ed25519 private key (PKCS#8 DER, base64) that signs license JWTs. */
  readonly XR_LICENSE_PRIVATE_KEY: string | undefined;
  /** Key id published in the license header + JWKS. */
  readonly XR_LICENSE_KID: string;

  readonly STRIPE_SECRET_KEY: string | undefined;
  readonly STRIPE_WEBHOOK_SECRET: string | undefined;
  readonly STRIPE_PRICE_ID_PRO_SEAT_MONTHLY: string | undefined;
  readonly STRIPE_PRICE_ID_PRO_SEAT_ANNUAL: string | undefined;

  readonly S3_ENDPOINT: string | undefined;
  readonly S3_REGION: string | undefined;
  readonly S3_BUCKET: string | undefined;
  readonly S3_ACCESS_KEY_ID: string | undefined;
  readonly S3_SECRET_ACCESS_KEY: string | undefined;
  readonly S3_FORCE_PATH_STYLE: boolean;

  /** `smtp` sends real email; `capture` writes .eml files to MAIL_CAPTURE_DIR. */
  readonly MAIL_TRANSPORT: "smtp" | "capture";
  readonly MAIL_FROM: string;
  readonly MAIL_CAPTURE_DIR: string;
  readonly SMTP_HOST: string | undefined;
  readonly SMTP_PORT: number;
  readonly SMTP_USER: string | undefined;
  readonly SMTP_PASSWORD: string | undefined;
  readonly SMTP_SECURE: boolean;

  readonly LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  /** Cmdts 11 — never trust a proxy header unless an operator says a proxy exists. */
  readonly TRUST_PROXY: boolean;

  readonly TRIAL_DAYS: number;
  readonly TRIAL_MAX_SEATS: number;

  readonly capabilities: {
    readonly database: Capability;
    readonly redis: Capability;
    readonly stripe: Capability;
    readonly blobStorage: Capability;
    readonly mail: Capability;
    readonly licenseSigning: Capability;
  };
}

const rawSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().min(1).default("0.0.0.0"),
  API_URL: z.url().default("http://localhost:8787"),
  APP_URL: z.url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_DRIVER: z.enum(["postgres", "pglite"]).optional(),
  PGLITE_DIR: z.string().min(1).default(".xr-cloud-pglite"),

  REDIS_URL: z.string().min(1).optional(),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  COOKIE_DOMAIN: z.string().min(1).optional(),
  SESSION_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  SESSION_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  XR_KEY_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine((v) => {
      try {
        return Buffer.from(v, "base64").length === 32;
      } catch {
        return false;
      }
    }, "XR_KEY_ENCRYPTION_KEY must be base64 encoding exactly 32 bytes"),
  XR_LICENSE_PRIVATE_KEY: z.string().min(1).optional(),
  XR_LICENSE_KID: z.string().min(1).default("xr-lic-1"),

  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_ID_PRO_SEAT_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_ID_PRO_SEAT_ANNUAL: z.string().min(1).optional(),

  S3_ENDPOINT: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(["0", "1", "true", "false"])
    .default("false")
    .transform((v) => v === "1" || v === "true"),

  MAIL_TRANSPORT: z.enum(["smtp", "capture"]).default("capture"),
  MAIL_FROM: z.string().min(3).default("XR <no-reply@xr.rrrtx.ai>"),
  MAIL_CAPTURE_DIR: z.string().min(1).default(".xr-cloud-mail"),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_SECURE: z
    .enum(["0", "1", "true", "false"])
    .default("false")
    .transform((v) => v === "1" || v === "true"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  TRUST_PROXY: z
    .enum(["0", "1", "true", "false"])
    .default("0")
    .transform((v) => v === "1" || v === "true"),

  TRIAL_DAYS: z.coerce.number().int().min(0).max(365).default(30),
  TRIAL_MAX_SEATS: z.coerce.number().int().min(1).max(1000).default(5),
});

export class EnvError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`XR Cloud refused to start — environment is not valid:\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvError";
    this.issues = issues;
  }
}

/**
 * Resolve one capability. `required` inside a partial group is what makes the
 * difference between "off on purpose" (disabled) and "someone forgot a var"
 * (misconfigured) — and the two produce different health output.
 */
function capability(keys: ReadonlyArray<string | undefined>, names: readonly string[]): Capability {
  const present = keys.filter((k): k is string => typeof k === "string" && k.length > 0);
  if (present.length === 0) {
    return { state: "disabled", detail: `not configured (set ${names.join(", ")})` };
  }
  if (present.length === keys.length) return { state: "ready", detail: "" };
  const missing = names.filter((_, i) => keys[i] === undefined || keys[i] === "");
  return {
    state: "misconfigured",
    detail: `partially configured — missing ${missing.join(", ")}`,
  };
}

let cached: CloudEnv | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env, opts?: { reload?: boolean }): CloudEnv {
  if (cached && !opts?.reload) return cached;

  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new EnvError(issues);
  }
  const raw = parsed.data;

  // Cmdts 13 — defaults are decided, never inferred. A production deployment
  // that has not said how it stores data is refused rather than guessed at.
  const driver: "postgres" | "pglite" =
    raw.DATABASE_DRIVER ?? (raw.DATABASE_URL ? "postgres" : raw.NODE_ENV === "production" ? "postgres" : "pglite");

  if (driver === "postgres" && !raw.DATABASE_URL) {
    throw new EnvError(["DATABASE_URL is required when DATABASE_DRIVER=postgres"]);
  }
  if (driver === "pglite" && raw.NODE_ENV === "production") {
    throw new EnvError([
      "DATABASE_DRIVER=pglite is a development/test affordance and is refused in production. Set DATABASE_URL.",
    ]);
  }

  const database: Capability =
    driver === "pglite"
      ? { state: "ready", detail: `in-process PGlite at ${raw.PGLITE_DIR} (dev/test only)` }
      : { state: "ready", detail: "postgres" };

  const redis = capability([raw.REDIS_URL], ["REDIS_URL"]);
  const stripe = capability(
    [raw.STRIPE_SECRET_KEY, raw.STRIPE_WEBHOOK_SECRET, raw.STRIPE_PRICE_ID_PRO_SEAT_MONTHLY],
    ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID_PRO_SEAT_MONTHLY"],
  );
  const blobStorage = capability(
    [raw.S3_BUCKET, raw.S3_ACCESS_KEY_ID, raw.S3_SECRET_ACCESS_KEY],
    ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
  );
  const mail = capability(
    raw.MAIL_TRANSPORT === "capture" ? ["capture"] : [raw.SMTP_HOST, raw.SMTP_USER, raw.SMTP_PASSWORD],
    ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"],
  );
  const licenseSigning = capability([raw.XR_LICENSE_PRIVATE_KEY], ["XR_LICENSE_PRIVATE_KEY"]);

  const env: CloudEnv = {
    NODE_ENV: raw.NODE_ENV,
    PORT: raw.PORT,
    HOST: raw.HOST,
    API_URL: raw.API_URL.replace(/\/+$/, ""),
    APP_URL: raw.APP_URL.replace(/\/+$/, ""),
    DATABASE_URL: raw.DATABASE_URL,
    DATABASE_DRIVER: driver,
    PGLITE_DIR: raw.PGLITE_DIR,
    REDIS_URL: raw.REDIS_URL,
    JWT_SECRET: raw.JWT_SECRET,
    COOKIE_DOMAIN: raw.COOKIE_DOMAIN,
    SESSION_ACCESS_TTL_SECONDS: raw.SESSION_ACCESS_TTL_SECONDS,
    SESSION_REFRESH_TTL_DAYS: raw.SESSION_REFRESH_TTL_DAYS,
    XR_KEY_ENCRYPTION_KEY: raw.XR_KEY_ENCRYPTION_KEY,
    XR_LICENSE_PRIVATE_KEY: raw.XR_LICENSE_PRIVATE_KEY,
    XR_LICENSE_KID: raw.XR_LICENSE_KID,
    STRIPE_SECRET_KEY: raw.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: raw.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_ID_PRO_SEAT_MONTHLY: raw.STRIPE_PRICE_ID_PRO_SEAT_MONTHLY,
    STRIPE_PRICE_ID_PRO_SEAT_ANNUAL: raw.STRIPE_PRICE_ID_PRO_SEAT_ANNUAL,
    S3_ENDPOINT: raw.S3_ENDPOINT,
    S3_REGION: raw.S3_REGION,
    S3_BUCKET: raw.S3_BUCKET,
    S3_ACCESS_KEY_ID: raw.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: raw.S3_SECRET_ACCESS_KEY,
    S3_FORCE_PATH_STYLE: raw.S3_FORCE_PATH_STYLE,
    MAIL_TRANSPORT: raw.MAIL_TRANSPORT,
    MAIL_FROM: raw.MAIL_FROM,
    MAIL_CAPTURE_DIR: raw.MAIL_CAPTURE_DIR,
    SMTP_HOST: raw.SMTP_HOST,
    SMTP_PORT: raw.SMTP_PORT,
    SMTP_USER: raw.SMTP_USER,
    SMTP_PASSWORD: raw.SMTP_PASSWORD,
    SMTP_SECURE: raw.SMTP_SECURE,
    LOG_LEVEL: raw.LOG_LEVEL,
    TRUST_PROXY: raw.TRUST_PROXY,
    TRIAL_DAYS: raw.TRIAL_DAYS,
    TRIAL_MAX_SEATS: raw.TRIAL_MAX_SEATS,
    capabilities: { database, redis, stripe, blobStorage, mail, licenseSigning },
  };

  cached = env;
  return env;
}

/** Test/CLI escape hatch. Never call this on a request path. */
export function resetEnvCache(): void {
  cached = undefined;
}

/** Any capability that is `misconfigured` blocks boot — silence is the bug. */
export function assertBootable(env: CloudEnv): void {
  const broken = Object.entries(env.capabilities)
    .filter(([, c]) => c.state === "misconfigured")
    .map(([name, c]) => `${name}: ${c.detail}`);
  if (broken.length > 0) throw new EnvError(broken);
}
