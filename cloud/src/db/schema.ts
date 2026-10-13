/**
 * XR Cloud — database schema (Drizzle / Postgres).
 *
 * Conventions this file holds to, deliberately and everywhere:
 *
 *  1. **Money is integer micro-USD.** `1_000_000` = $1.00. No float ever touches
 *     a billing number, in a column, in a type, or in an arithmetic expression.
 *  2. **Timestamps are `timestamptz`.** No naive local times cross a tenant
 *     boundary.
 *  3. **Secrets are never stored in the clear.** Passwords are argon2id hashes;
 *     refresh/invite/api/device tokens are SHA-256 hashes; third-party credentials
 *     (OIDC client secret, SAML cert, Stripe refs) are AES-256-GCM ciphertext
 *     under the org key.
 *  4. **Team memory bodies are ciphertext.** The column that stores a fact is
 *     `body_ciphertext`; there is no plaintext sibling column and no plaintext
 *     index (Constitution Art. IX.5).
 *  5. **Audit rows are append-only and hash-chained.** `prev_hash` + `entry_hash`
 *     mirror the local `src/security/audit-signer.ts` shape so the same verifier
 *     logic reads both.
 *
 * Nothing here is cloud-only machinery. Every table exists because a Business
 * feature named in the phase brief needs it, and every Business feature is
 * additive to a Personal install that never contacts this schema.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  bigint,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ enums */

export const memberRole = pgEnum("member_role", ["owner", "admin", "member"]);
export const memberStatus = pgEnum("member_status", ["active", "invited", "disabled"]);
export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
]);
export const billingInterval = pgEnum("billing_interval", ["month", "year"]);
export const ssoKind = pgEnum("sso_kind", ["oidc", "saml"]);
export const memoryVisibility = pgEnum("memory_visibility", ["private", "team", "review"]);
export const memoryReviewState = pgEnum("memory_review_state", ["pending", "approved", "rejected"]);
export const sessionKind = pgEnum("session_kind", ["web", "device", "cli", "vscode", "mobile"]);
export const exportJobStatus = pgEnum("export_job_status", ["queued", "running", "ready", "failed"]);
export const auditActorKind = pgEnum("audit_actor_kind", ["user", "system", "api_key", "stripe"]);

/* ------------------------------------------------------------------ identity */

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    /** argon2id. Nullable: email magic-link is the primary credential (brief §A). */
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /** Set when the user is disabled org-wide; never a silent lock-out. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

/**
 * An org is the tenant. The org key is the root of all team-data encryption:
 * generated at signup, stored wrapped under the deployment KEK so the KEK can be
 * rotated without re-encrypting team data (`kek_id` records which KEK wrapped it).
 */
export const orgs = pgTable(
  "orgs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** AES-256-GCM(KEK, org_key) — base64(iv||ct||tag). */
    orgKeyWrapped: text("org_key_wrapped").notNull(),
    kekId: text("kek_id").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Soft-delete window from the brief §J: 30 days, then purge. */
    deletionScheduledAt: timestamp("deletion_scheduled_at", { withTimezone: true }),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("orgs_slug_uq").on(t.slug)],
);

export const members = pgTable(
  "members",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("member"),
    status: memberStatus("status").notNull().default("active"),
    /** Per-user override of the org default cap. NULL = inherit policy. */
    dailyCapMicroUsd: bigint("daily_cap_micro_usd", { mode: "number" }),
    monthlyCapMicroUsd: bigint("monthly_cap_micro_usd", { mode: "number" }),
    /** When true the member may not use XR-managed keys, only BYOK. */
    byokOnly: boolean("byok_only").notNull().default(false),
    /** IdP subject for SSO-bound members (OIDC `sub` / SAML NameID). */
    ssoSubject: text("sso_subject"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("members_org_user_uq").on(t.orgId, t.userId),
    index("members_user_idx").on(t.userId),
    index("members_org_idx").on(t.orgId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: memberRole("role").notNull().default("member"),
    /** SHA-256 of the invite token. The plaintext exists only in the email. */
    tokenHash: text("token_hash").notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: text("accepted_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invites_org_idx").on(t.orgId),
    uniqueIndex("invites_token_uq").on(t.tokenHash),
  ],
);

/* ------------------------------------------------------------------ sessions */

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: text("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    kind: sessionKind("kind").notNull().default("web"),
    /** SHA-256 of the refresh token. Rotation replaces this value. */
    refreshHash: text("refresh_hash").notNull(),
    /**
     * Rotation family. Reuse of an already-rotated token revokes the whole
     * family — the standard refresh-token-theft signal.
     */
    familyId: text("family_id").notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_family_idx").on(t.familyId),
  ],
);

/** Single-use magic-link tokens (SHA-256, 10-minute TTL, consumed on first use). */
export const magicLinks = pgTable(
  "magic_links",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    /** Where to send the user after the link resolves (validated against APP_URL). */
    redirectTo: text("redirect_to"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("magic_links_token_uq").on(t.tokenHash)],
);

/* ------------------------------------------------------------------ SSO */

export const ssoConfigs = pgTable(
  "sso_configs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    kind: ssoKind("kind").notNull(),
    /** "google" | "okta" | "azure" | "generic" — display only, never trusted. */
    provider: text("provider").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /**
     * When enforced, members of this org may not authenticate with a magic link
     * or password; the IdP is the only door. Owners are always exempt so an org
     * cannot lock itself out.
     */
    enforced: boolean("enforced").notNull().default(false),
    /** OIDC. clientSecret is AES-256-GCM(org_key) ciphertext. */
    oidcIssuer: text("oidc_issuer"),
    oidcClientId: text("oidc_client_id"),
    oidcClientSecretEnc: text("oidc_client_secret_enc"),
    oidcAuthorizationUrl: text("oidc_authorization_url"),
    oidcTokenUrl: text("oidc_token_url"),
    oidcUserinfoUrl: text("oidc_userinfo_url"),
    oidcScopes: text("oidc_scopes").notNull().default("openid email profile"),
    /** SAML. cert is AES-256-GCM(org_key) ciphertext; the IdP cert is public but
     *  is still encrypted at rest so a DB leak is not an org-fingerprint leak. */
    samlEntryPoint: text("saml_entry_point"),
    samlIssuer: text("saml_issuer"),
    samlIdpCertEnc: text("saml_idp_cert_enc"),
    samlNameIdFormat: text("saml_name_id_format"),
    samlSignatureAlgorithm: text("saml_signature_algorithm"),
    /** Domain hints used by the login page to route an email to its IdP. */
    emailDomains: jsonb("email_domains").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sso_configs_org_uq").on(t.orgId)],
);

/* ------------------------------------------------------------------ policies */

export type EgressRule = { destination: string; note?: string };
export type ProviderAllowlist = { provider: string; models?: string[] };

export const policies = pgTable(
  "policies",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /** Soft included quota per user per month, micro-USD. NULL = unlimited. */
    includedQuotaMicroUsd: bigint("included_quota_micro_usd", { mode: "number" })
      .notNull()
      .default(20_000_000),
    /** Hard per-user daily cap. NULL = no team-imposed daily cap. */
    defaultDailyBudgetMicroUsd: bigint("default_daily_budget_micro_usd", { mode: "number" }),
    /** Hard per-user monthly cap (overage ceiling). */
    defaultMonthlyBudgetMicroUsd: bigint("default_monthly_budget_micro_usd", { mode: "number" }),
    teamMonthlyBudgetMicroUsd: bigint("team_monthly_budget_micro_usd", { mode: "number" }),
    /** Above this per-action spend, an admin must approve before the call runs. */
    requireApprovalAboveMicroUsd: bigint("require_approval_above_micro_usd", { mode: "number" }),
    /** Empty array = every provider allowed (explicit, not implied by NULL). */
    allowedProviders: jsonb("allowed_providers")
      .$type<ProviderAllowlist[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Empty array = every egress destination allowed. */
    egressRules: jsonb("egress_rules").$type<EgressRule[]>().notNull().default(sql`'[]'::jsonb`),
    /** Days after membership ends before that member's team-authored data goes. */
    dataRetentionDays: integer("data_retention_days").notNull().default(30),
    /** Days to keep audit rows. 0 = until org deletion. */
    auditRetentionDays: integer("audit_retention_days").notNull().default(365),
    /** Block facts the P21 scanner flags from ever reaching team memory. */
    blockSensitiveMemory: boolean("block_sensitive_memory").notNull().default(false),
    /** Force usage through XR-managed keys for cost control. */
    disableByok: boolean("disable_byok").notNull().default(false),
    relayEnabled: boolean("relay_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("policies_org_uq").on(t.orgId)],
);

/* ------------------------------------------------------------------ billing */

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeSubscriptionItemId: text("stripe_subscription_item_id"),
    stripePriceId: text("stripe_price_id"),
    plan: text("plan").notNull().default("business"),
    status: subscriptionStatus("status").notNull().default("trialing"),
    interval: billingInterval("interval").notNull().default("month"),
    seats: integer("seats").notNull().default(1),
    /** Trials are capped at 5 seats and require no card (brief §I/§B). */
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    billingEmail: text("billing_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("subscriptions_org_uq").on(t.orgId),
    index("subscriptions_stripe_sub_idx").on(t.stripeSubscriptionId),
    index("subscriptions_stripe_cus_idx").on(t.stripeCustomerId),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    stripeInvoiceId: text("stripe_invoice_id").notNull(),
    number: text("number"),
    status: text("status").notNull(),
    amountDueMicroUsd: bigint("amount_due_micro_usd", { mode: "number" }).notNull().default(0),
    amountPaidMicroUsd: bigint("amount_paid_micro_usd", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("usd"),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    invoicePdfUrl: text("invoice_pdf_url"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invoices_stripe_uq").on(t.stripeInvoiceId),
    index("invoices_org_idx").on(t.orgId),
  ],
);

/** Stripe webhook idempotency. One row per processed event id. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull().default("stripe"),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webhook_events_source_id_uq").on(t.source, t.eventId)],
);

/* ------------------------------------------------------------------ team memory */

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    /** AES-256-GCM under HKDF(org_key, "xr:team-memory:v1:"+workspaceId). */
    bodyCiphertext: text("body_ciphertext").notNull(),
    /** Non-reversible short digest of the plaintext body — dedupe + LWW compare. */
    bodyDigest: text("body_digest").notNull(),
    category: text("category").notNull().default("fact"),
    scope: text("scope").notNull().default("team"),
    /** Monotonic per fact id. Higher version wins on conflict (last-writer-wins). */
    version: integer("version").notNull().default(1),
    visibility: memoryVisibility("visibility").notNull().default("team"),
    /** From the P21 sensitivity scanner, computed before upload. Never raw PII. */
    sensitivityTags: jsonb("sensitivity_tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("memories_org_ws_idx").on(t.orgId, t.workspaceId),
    index("memories_updated_idx").on(t.updatedAt),
  ],
);

export const memoryReviews = pgTable(
  "memory_reviews",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    bodyCiphertext: text("body_ciphertext").notNull(),
    bodyDigest: text("body_digest").notNull(),
    /** Where the candidate came from: agent:<role>, tool:<name>, user, schedule. */
    provenance: text("provenance").notNull(),
    sensitivityTags: jsonb("sensitivity_tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    state: memoryReviewState("state").notNull().default("pending"),
    proposedBy: text("proposed_by").references(() => users.id, { onDelete: "set null" }),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("memory_reviews_org_state_idx").on(t.orgId, t.state)],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Default memory visibility for facts authored in this workspace. */
    memoryVisibility: memoryVisibility("memory_visibility").notNull().default("team"),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workspaces_org_slug_uq").on(t.orgId, t.slug),
    index("workspaces_org_idx").on(t.orgId),
  ],
);

/* ------------------------------------------------------------------ audit */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /** Per-org monotonic sequence; the chain order. */
    seq: bigint("seq", { mode: "number" }).notNull(),
    actorKind: auditActorKind("actor_kind").notNull().default("user"),
    actorId: text("actor_id"),
    actorEmail: text("actor_email"),
    /** Dotted action verb, e.g. "member.invite", "policy.update", "memory.read". */
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    workspaceId: text("workspace_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /**
     * Structured detail. MUST NOT contain memory bodies, prompts, secrets or
     * tokens (Constitution Art. XXI — structure only, never payloads).
     */
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    prevHash: text("prev_hash").notNull(),
    entryHash: text("entry_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("audit_logs_org_seq_uq").on(t.orgId, t.seq),
    index("audit_logs_org_created_idx").on(t.orgId, t.createdAt),
    index("audit_logs_org_action_idx").on(t.orgId, t.action),
  ],
);

export const exportJobs = pgTable(
  "export_jobs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("audit"),
    format: text("format").notNull().default("csv"),
    status: exportJobStatus("status").notNull().default("queued"),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    rowCount: integer("row_count"),
    /** S3 object key. Never a public URL — a short-lived signed URL is minted. */
    objectKey: text("object_key"),
    /** SHA-256 of the exported bytes, so a download can be verified. */
    objectDigest: text("object_digest"),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("export_jobs_org_idx").on(t.orgId, t.createdAt)],
);

/* ------------------------------------------------------------------ SSO flows */

/**
 * Short-lived SSO flow state (OIDC `state` → PKCE verifier + nonce).
 *
 * In Postgres rather than in process memory on purpose: a multi-replica
 * deployment must complete a sign-in regardless of which replica served the
 * callback, and a restart mid-flow must not strand a user. Rows are deleted on
 * read, so a `state` value is single-use by construction, and `expires_at` bounds
 * how long a half-finished flow can linger.
 */
export const ssoFlows = pgTable(
  "xr_sso_flows",
  {
    state: text("state").primaryKey(),
    orgId: text("org_id").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    nonce: text("nonce").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sso_flows_expires_idx").on(t.expiresAt)],
);

/* ------------------------------------------------------------------ license / API keys */

export const licenseKeys = pgTable(
  "license_keys",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** JWT id. Verification is offline; this row exists for revocation *reporting*. */
    jti: text("jti").notNull(),
    plan: text("plan").notNull().default("business"),
    seats: integer("seats").notNull().default(1),
    features: jsonb("features").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("license_keys_jti_uq").on(t.jti), index("license_keys_org_idx").on(t.orgId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "xr_live_" + 32 random bytes b64url; only the SHA-256 is stored. */
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_org_idx").on(t.orgId)],
);

/* ------------------------------------------------------------------ metering */

export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** true = XR paid the provider; false = the user's own key (visibility only). */
    managed: boolean("managed").notNull().default(true),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    latencyMs: integer("latency_ms"),
    requestId: text("request_id"),
    /** Day bucket (UTC date) for cheap daily rollups. */
    day: text("day").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("usage_events_org_user_day_idx").on(t.orgId, t.userId, t.day),
    index("usage_events_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

/**
 * Rolled-up counters. Kept as a separate table so a cap check is one indexed
 * row read on the hot path, never a SUM over the event log.
 */
export const usageCounters = pgTable(
  "usage_counters",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "day:2026-10-14" | "month:2026-10" */
    periodKey: text("period_key").notNull(),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    requests: integer("requests").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("usage_counters_uq").on(t.orgId, t.userId, t.periodKey)],
);

/* ------------------------------------------------------------------ relay */

export const relayRegistrations = pgTable(
  "relay_registrations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    deviceLabel: text("device_label"),
    /** SHA-256 of the device-scoped relay token. */
    tokenHash: text("token_hash").notNull(),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("relay_org_device_uq").on(t.orgId, t.deviceId),
    index("relay_token_idx").on(t.tokenHash),
  ],
);

/* ------------------------------------------------------------------ relations */

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(members),
  sessions: many(sessions),
}));

export const orgsRelations = relations(orgs, ({ many, one }) => ({
  members: many(members),
  policy: one(policies, { fields: [orgs.id], references: [policies.orgId] }),
  subscription: one(subscriptions, { fields: [orgs.id], references: [subscriptions.orgId] }),
}));

export const membersRelations = relations(members, ({ one }) => ({
  org: one(orgs, { fields: [members.orgId], references: [orgs.id] }),
  user: one(users, { fields: [members.userId], references: [users.id] }),
}));

/** Row types, re-exported so route code never re-derives them by hand. */
export type UserRow = typeof users.$inferSelect;
export type OrgRow = typeof orgs.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SsoConfigRow = typeof ssoConfigs.$inferSelect;
export type PolicyRow = typeof policies.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type MemoryRow = typeof memories.$inferSelect;
export type MemoryReviewRow = typeof memoryReviews.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type ExportJobRow = typeof exportJobs.$inferSelect;
export type UsageEventRow = typeof usageEvents.$inferSelect;
export type UsageCounterRow = typeof usageCounters.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type RelayRegistrationRow = typeof relayRegistrations.$inferSelect;
export type MemberRole = (typeof memberRole.enumValues)[number];
export type SubscriptionStatusValue = (typeof subscriptionStatus.enumValues)[number];
