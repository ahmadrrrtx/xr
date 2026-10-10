/**
 * Phase 22 — zod schemas for the Integrations endpoints. Re-exported from
 * schemas.ts; the contract lives in contract-integrations.ts.
 *
 * Request shapes mirror the hand-checked bodies in integrations.routes.ts. The
 * routes validate by hand, so these schemas document and type the wire format for
 * the OpenAPI spec and the typed client. They never accept or return a secret in
 * a response: responses carry only the connection view (status, account, times).
 */
import { z } from "zod/v4";

/** PUT /api/integrations/{id}/app — BYOK OAuth app credentials (vault-stored). */
export const IntegrationAppCredentialsRequest = z.looseObject({
  clientId: z.string().min(1).max(200),
  clientSecret: z.string().min(1).max(500),
});

/**
 * POST /api/integrations/oauth/complete — either the provider's code, or its error
 * (for example access_denied). The state is required in both cases so the daemon
 * can consume it.
 */
export const IntegrationOAuthCompleteRequest = z.looseObject({
  state: z.string().min(1).max(256),
  code: z.string().min(1).max(2048).optional(),
  error: z.string().max(200).optional(),
});

/**
 * POST /api/integrations/{id}/connect — API-key connectors. The key sits in `config`
 * (or at the top level). Non-secret fields are stored in SQLite; secret fields
 * go to the vault.
 */
export const IntegrationConnectRequest = z.looseObject({
  config: z.record(z.string(), z.unknown()).optional(),
});

/** The { ok, … } envelope every integrations route returns. No secret field exists. */
export const IntegrationEnvelope = z.looseObject({
  ok: z.boolean(),
  code: z.string().optional(),
  error: z.string().optional(),
});

/** POST /api/integrations/{id}/oauth/start. */
export const IntegrationOAuthStartResponse = z.looseObject({
  ok: z.boolean(),
  authorizeUrl: z.string().optional(),
  expiresInSeconds: z.number().int().positive().optional(),
});
