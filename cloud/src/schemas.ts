/**
 * XR Cloud — request schemas.
 *
 * Every schema in the service lives here, in one file, for one reason: it makes
 * the API's input surface readable in a single pass. A reviewer who wants to know
 * what a client can send does not have to open twelve route files.
 *
 * Zod objects strip unknown keys by default, which is the property that makes
 * mass assignment impossible (see `middleware/validate.ts`).
 *
 * Bounds exist on every string and array. An unbounded array in a policy document
 * is an unbounded amount of work per request, and this service is on the hot path
 * of every managed-model call a team makes (Constitution Art. XII · Rule 3).
 */

import { z } from "zod";

import { BUSINESS_FEATURES } from "./lib/license.ts";

/* ------------------------------------------------------------------ primitives */

export const emailField = z.email("Enter a valid email address.").max(320).transform((v) => v.trim().toLowerCase());

export const passwordField = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(200, "Use at most 200 characters.");

/** Opaque ids are prefixed lowercase + base64url. Shape-checked, never trusted. */
export const idField = z.string().min(6).max(96).regex(/^[a-z]+_[A-Za-z0-9_-]+$/, "Malformed id.");

export const slugField = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters and dashes only.");

export const microUsdField = z
  .number()
  .int()
  .min(0)
  // $1,000,000 in micro-USD. A cap above this is a typo, not a policy.
  .max(1_000_000_000_000);

/* ------------------------------------------------------------------ auth */

export const signupSchema = z.object({
  email: emailField,
  password: passwordField.optional(),
  name: z.string().min(1).max(120).optional(),
  orgName: z.string().min(1, "Give your team a name.").max(120),
});

export const magicLinkSchema = z.object({
  email: emailField,
  redirectTo: z.string().max(2048).optional(),
});

export const emailOnlySchema = z.object({ email: emailField });

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(200),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(16).max(512).optional(),
});

export const selectOrgSchema = z.object({ orgId: idField });

/* ------------------------------------------------------------------ teams */

export const createTeamSchema = z.object({
  name: z.string().min(1, "Give your team a name.").max(120),
  slug: slugField.optional(),
});

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(120).optional(),
});

export const inviteSchema = z.object({
  email: emailField,
  role: z.enum(["admin", "member"]),
  /** Owners can re-invite someone already invited; off by default. */
  resend: z.boolean().optional(),
});

export const updateMemberSchema = z.object({
  role: z.enum(["owner", "admin", "member"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  dailyCapMicroUsd: microUsdField.nullable().optional(),
  monthlyCapMicroUsd: microUsdField.nullable().optional(),
  byokOnly: z.boolean().optional(),
});

export const inviteQuerySchema = z.object({ state: z.enum(["pending", "accepted", "expired", "all"]).default("all") });

/* ------------------------------------------------------------------ policies */

export const providerEntrySchema = z.object({
  provider: z.string().min(1).max(64),
  models: z.array(z.string().min(1).max(120)).max(200).optional(),
});

export const egressEntrySchema = z.object({
  destination: z.string().min(1).max(253),
  note: z.string().max(200).optional(),
});

export const policySchema = z.object({
  includedQuotaMicroUsd: microUsdField.optional(),
  defaultDailyBudgetMicroUsd: microUsdField.nullable().optional(),
  defaultMonthlyBudgetMicroUsd: microUsdField.nullable().optional(),
  teamMonthlyBudgetMicroUsd: microUsdField.nullable().optional(),
  // A threshold of $0 would force approval on everything; the minimum is one
  // cent so an admin cannot accidentally make the team unusable.
  requireApprovalAboveMicroUsd: microUsdField.min(10_000).nullable().optional(),
  allowedProviders: z.array(providerEntrySchema).max(50).optional(),
  egressRules: z.array(egressEntrySchema).max(200).optional(),
  dataRetentionDays: z.number().int().min(0).max(3650).optional(),
  auditRetentionDays: z.number().int().min(30).max(3650).optional(),
  blockSensitiveMemory: z.boolean().optional(),
  disableByok: z.boolean().optional(),
  relayEnabled: z.boolean().optional(),
});

/**
 * A guard that costs nothing and prevents a real footgun: an approval threshold
 * above a hard cap is a policy that can never fire, and an admin who set it
 * believes it works. Detected at write time and refused with the reason.
 */
export function crossCheckPolicy(input: z.infer<typeof policySchema>): string | null {
  const monthly = input.defaultMonthlyBudgetMicroUsd;
  const approval = input.requireApprovalAboveMicroUsd;
  if (typeof monthly === "number" && typeof approval === "number" && approval >= monthly) {
    return `The approval threshold (${approval / 1_000_000}) is at or above the monthly per-user cap (${monthly / 1_000_000}), so no request could ever need approval. Lower the threshold or raise the cap.`;
  }
  return null;
}

/* ------------------------------------------------------------------ billing */

export const checkoutSchema = z.object({
  interval: z.enum(["month", "year"]).default("month"),
  seats: z.number().int().min(1).max(500),
  /** Only honoured by owners, and only when the org is already entitled. */
  startTrial: z.boolean().optional(),
});

export const portalSchema = z.object({
  returnUrl: z.string().max(2048).optional(),
});

/* ------------------------------------------------------------------ SSO */

export const oidcConfigSchema = z
  .object({
    provider: z.enum(["google", "okta", "azure", "generic"]),
    clientId: z.string().min(1).max(512),
    clientSecret: z.string().min(1).max(512),
    issuer: z.url("Issuer must be a full URL.").max(512),
    authorizationUrl: z.url().max(512).optional(),
    tokenUrl: z.url().max(512).optional(),
    userinfoUrl: z.url().max(512).optional(),
    scopes: z.string().min(1).max(200).optional(),
    emailDomains: z.array(z.string().min(3).max(253)).max(50).optional(),
    enforced: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    // Google, Okta and Azure all publish a discovery document, so the explicit
    // endpoints are optional for them. "generic" has no discovery guarantee, so
    // the endpoints are required — guessing them is how a login breaks at 2am.
    if (value.provider === "generic" && (!value.authorizationUrl || !value.tokenUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["authorizationUrl"],
        message: "Generic OIDC requires an authorization URL and a token URL (there is no discovery document to read them from).",
      });
    }
  });

export const samlConfigSchema = z.object({
  provider: z.enum(["okta", "azure", "google", "generic"]),
  entryPoint: z.url("IdP SSO URL must be a full URL.").max(512),
  issuer: z.string().min(1).max(512),
  idpCert: z.string().min(32, "Paste the IdP's X.509 certificate.").max(10_000),
  nameIdFormat: z.string().max(200).optional(),
  signatureAlgorithm: z.enum(["sha256", "sha512"]).optional(),
  emailDomains: z.array(z.string().min(3).max(253)).max(50).optional(),
  enforced: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const ssoEnforceSchema = z.object({ enforced: z.boolean() });

/* ------------------------------------------------------------------ memory */

export const memoryUpsertSchema = z.object({
  workspaceId: idField,
  /** Absent = create. Present = update that fact, and `version` must be sent. */
  id: idField.optional(),
  version: z.number().int().min(1).max(1_000_000).optional(),
  body: z.string().min(1, "A fact cannot be empty.").max(8_000, "Facts are capped at 8,000 characters."),
  category: z.enum(["fact", "preference", "procedure", "episode", "summary"]).optional(),
  visibility: z.enum(["private", "team", "review"]).optional(),
  tags: z.array(z.string().min(1).max(48)).max(24).optional(),
  sensitivityTags: z.array(z.enum(["credit-card", "ssn", "api-key", "private-key"])).max(4).optional(),
  /** false = an agent-proposed candidate, which is queued for review. */
  direct: z.boolean().default(true),
  provenance: z.string().max(120).optional(),
});

export const memoryQuerySchema = z.object({
  workspace: idField,
  includePrivate: z
    .enum(["0", "1", "true", "false"])
    .default("false")
    .transform((v) => v === "1" || v === "true"),
  /** Incremental sync: only facts changed after this ISO timestamp. */
  since: z.string().max(40).optional(),
});

export const memoryReviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(500).optional(),
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, "Give the workspace a name.").max(120),
  slug: slugField.optional(),
  memoryVisibility: z.enum(["private", "team", "review"]).default("team"),
  ownerId: idField.optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  memoryVisibility: z.enum(["private", "team", "review"]).optional(),
  ownerId: idField.nullable().optional(),
});

/* ------------------------------------------------------------------ audit */

export const auditQuerySchema = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  actor: z.string().max(320).optional(),
  action: z.string().max(120).optional(),
  target: z.string().max(96).optional(),
  workspace: idField.optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});

export const auditExportSchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  actor: z.string().max(320).optional(),
  action: z.string().max(120).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});

/* ------------------------------------------------------------------ api keys */

export const createApiKeySchema = z.object({
  name: z.string().min(1, "Name the key so you can find it later.").max(120),
  scopes: z
    .array(z.enum(["audit:read", "memory:read", "memory:write", "usage:read", "members:read", "models:invoke", "*"]))
    .min(1, "Pick at least one scope.")
    .max(8),
  expiresInDays: z.number().int().min(1).max(730).optional(),
});

/* ------------------------------------------------------------------ models */

export const modelChatSchema = z.object({
  /** Provider is in the path; the body carries the request. */
  model: z.string().min(1).max(120),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z.string().max(500_000),
        name: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(500),
  maxOutputTokens: z.number().int().min(1).max(200_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().default(true),
  workspaceId: idField.optional(),
  /** Client-side id so a retry does not double-count usage. */
  requestId: z.string().min(1).max(120).optional(),
  /** true when the caller is supplying its own provider key (BYOK passthrough). */
  byok: z.boolean().default(false),
});

export const modelProviderSchema = z.enum(["openai", "anthropic", "google"]);

/* ------------------------------------------------------------------ relay */

export const relayRegisterSchema = z.object({
  deviceId: z.string().min(4).max(120),
  deviceLabel: z.string().max(120).optional(),
  /** SHA-256-ish opaque room key material, produced at pairing. */
  roomSecret: z.string().min(16).max(256),
});

/* ------------------------------------------------------------------ license */

export const licenseFeaturesSchema = z.array(z.enum(BUSINESS_FEATURES)).max(BUSINESS_FEATURES.length);

export type SignupInput = z.infer<typeof signupSchema>;
export type PolicyInput = z.infer<typeof policySchema>;
export type ModelChatInput = z.infer<typeof modelChatSchema>;
export type MemoryUpsertInput = z.infer<typeof memoryUpsertSchema>;
export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
