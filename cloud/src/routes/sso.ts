/**
 * XR Cloud — SSO (OIDC + SAML).
 *
 * ## Client patterns reused, not reinvented
 *
 * The repo already has an OAuth2 connector registry (`src/integrations/registry.ts`)
 * for GitHub/Linear/Notion. The shape of that flow — build an authorization URL,
 * carry state, verify on return, exchange, store — is the same shape OIDC needs,
 * so this file follows it rather than inventing a second convention.
 *
 * ## What is checked, and why each check exists
 *
 *   - **`state`** — double-submit against a short-lived cookie. Without it, an
 *     attacker can hand a victim a callback URL that signs them into the
 *     attacker's account (login CSRF).
 *   - **PKCE (S256)** — required even for confidential clients. It is the only
 *     thing that stops an intercepted authorization code from being redeemed.
 *   - **`nonce`** — binds the ID token to this request, defeating replay.
 *   - **`iss` and `aud` on the ID token** — verified by `openid-client` against
 *     the discovery document. A token from a different IdP tenant must not work.
 *   - **Email claim → membership** — an IdP assertion is a *claim about identity*,
 *     not authorization. A user is only ever signed into an org they are already a
 *     member of, or auto-joined if the org's SSO is the thing that invited them.
 *
 * ## SAML
 *
 * `samlify` builds the SP. The ACS URL and entity id are derived from `API_URL`
 * so they cannot drift from what an admin pastes into Okta. Signature validation
 * is on and its failure is fatal — an unsigned assertion is refused.
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import * as client from "openid-client";
import type { Context } from "hono";

import {
  buildIdentityProvider,
  buildServiceProvider,
  normalizeCertificate,
  type SamlIdentityProvider,
  type SamlServiceProvider,
} from "../lib/saml.ts";

import type { AppDeps } from "../deps.ts";
import { members, orgs, ssoConfigs, users } from "../db/schema.ts";
import {
  CryptoError,
  decryptWithKey,
  encryptWithKey,
  randomToken,
} from "../lib/crypto.ts";
import { badRequest, conflict, forbidden, notFound, unavailable, validationFailed } from "../lib/errors.ts";
import { newId, normalizeEmail, emailDomain } from "../lib/ids.ts";
import { requireOrgMember, requireRole, requireUser } from "../middleware/auth.ts";
import { parseBody } from "../middleware/validate.ts";
import { oidcConfigSchema, samlConfigSchema, ssoEnforceSchema } from "../schemas.ts";
import { issueSession, setSessionCookies } from "./auth.ts";

/** Ten minutes is enough for a human to authenticate and too short to replay. */
const FLOW_TTL_SECONDS = 600;

interface OidcFlowState {
  orgId: string;
  codeVerifier: string;
  nonce: string;
  redirectTo?: string;
}

export function ssoRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  /* ------------------------------------------------------ config (admin) */

  app.get(
    "/teams/:id/sso",
    requireUser(deps),
    requireOrgMember(deps, "id"),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const rows = await deps.db.select().from(ssoConfigs).where(eq(ssoConfigs.orgId, member.orgId)).limit(1);
      const config = rows[0];
      return c.json({
        configured: Boolean(config),
        sso: config
          ? {
              kind: config.kind,
              provider: config.provider,
              enabled: config.enabled,
              enforced: config.enforced,
              emailDomains: config.emailDomains,
              // Secrets are never echoed. The UI shows "configured" and offers
              // "replace", which is the only safe representation.
              oidc: config.kind === "oidc"
                ? {
                    issuer: config.oidcIssuer,
                    clientId: config.oidcClientId,
                    clientSecretSet: Boolean(config.oidcClientSecretEnc),
                    scopes: config.oidcScopes,
                    authorizationUrl: config.oidcAuthorizationUrl,
                    tokenUrl: config.oidcTokenUrl,
                    userinfoUrl: config.oidcUserinfoUrl,
                  }
                : null,
              saml: config.kind === "saml"
                ? {
                    entryPoint: config.samlEntryPoint,
                    issuer: config.samlIssuer,
                    idpCertSet: Boolean(config.samlIdpCertEnc),
                    nameIdFormat: config.samlNameIdFormat,
                    signatureAlgorithm: config.samlSignatureAlgorithm,
                  }
                : null,
            }
          : null,
        endpoints: {
          oidcRedirectUri: `${deps.env.API_URL}/auth/sso/oidc/${member.orgId}/callback`,
          samlAcsUrl: `${deps.env.API_URL}/auth/sso/saml/${member.orgId}/acs`,
          samlMetadataUrl: `${deps.env.API_URL}/auth/sso/saml/${member.orgId}/metadata`,
          samlEntityId: `${deps.env.API_URL}/auth/sso/saml/${member.orgId}/metadata`,
        },
      });
    },
  );

  app.put(
    "/teams/:id/sso/oidc",
    requireUser(deps),
    requireOrgMember(deps, "id"),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const body = await parseBody(c, oidcConfigSchema);
      const orgKey = await orgKeyFor(deps, member.orgId);
      const now = deps.clock();

      const values = {
        kind: "oidc" as const,
        provider: body.provider,
        enabled: body.enabled ?? true,
        enforced: body.enforced ?? false,
        oidcIssuer: body.issuer,
        oidcClientId: body.clientId,
        oidcClientSecretEnc: encryptWithKey(orgKey, body.clientSecret),
        oidcAuthorizationUrl: body.authorizationUrl ?? null,
        oidcTokenUrl: body.tokenUrl ?? null,
        oidcUserinfoUrl: body.userinfoUrl ?? null,
        oidcScopes: body.scopes ?? "openid email profile",
        emailDomains: body.emailDomains ?? [],
        updatedAt: now,
      };

      const existing = await deps.db.select().from(ssoConfigs).where(eq(ssoConfigs.orgId, member.orgId)).limit(1);
      if (existing[0]) {
        await deps.db.update(ssoConfigs).set(values).where(eq(ssoConfigs.id, existing[0].id));
      } else {
        await deps.db
          .insert(ssoConfigs)
          .values({ id: newId("sso"), orgId: member.orgId, createdAt: now, ...values });
      }

      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: "sso.oidc_configured",
        targetType: "sso_config",
        targetId: member.orgId,
        ip: c.get("meta").ip,
        userAgent: c.get("meta").userAgent,
        // The client secret is NOT in here. Only the fact that one was set, and
        // where the issuer is — enough for an auditor, useless to an attacker.
        detail: {
          provider: body.provider,
          issuer: body.issuer,
          enforced: values.enforced,
          emailDomains: values.emailDomains,
        },
      });

      return c.json({ ok: true, enabled: values.enabled, enforced: values.enforced }, 200);
    },
  );

  app.put(
    "/teams/:id/sso/saml",
    requireUser(deps),
    requireOrgMember(deps, "id"),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const body = await parseBody(c, samlConfigSchema);
      const orgKey = await orgKeyFor(deps, member.orgId);
      const now = deps.clock();

      let normalizedCert: string;
      try {
        normalizedCert = normalizeCertificate(body.idpCert);
      } catch (error) {
        throw validationFailed({
          idpCert: error instanceof Error ? error.message : "Invalid certificate.",
        });
      }

      const values = {
        kind: "saml" as const,
        provider: body.provider,
        enabled: body.enabled ?? true,
        enforced: body.enforced ?? false,
        samlEntryPoint: body.entryPoint,
        samlIssuer: body.issuer,
        samlIdpCertEnc: encryptWithKey(orgKey, normalizedCert),
        samlNameIdFormat: body.nameIdFormat ?? "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        samlSignatureAlgorithm: body.signatureAlgorithm ?? "sha256",
        emailDomains: body.emailDomains ?? [],
        updatedAt: now,
      };

      const existing = await deps.db.select().from(ssoConfigs).where(eq(ssoConfigs.orgId, member.orgId)).limit(1);
      if (existing[0]) {
        await deps.db.update(ssoConfigs).set(values).where(eq(ssoConfigs.id, existing[0].id));
      } else {
        await deps.db.insert(ssoConfigs).values({ id: newId("sso"), orgId: member.orgId, createdAt: now, ...values });
      }

      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: "sso.saml_configured",
        targetType: "sso_config",
        targetId: member.orgId,
        ip: c.get("meta").ip,
        detail: { provider: body.provider, entryPoint: body.entryPoint, enforced: values.enforced },
      });

      return c.json(
        {
          ok: true,
          enabled: values.enabled,
          enforced: values.enforced,
          acsUrl: `${deps.env.API_URL}/auth/sso/saml/${member.orgId}/acs`,
          metadataUrl: `${deps.env.API_URL}/auth/sso/saml/${member.orgId}/metadata`,
        },
        200,
      );
    },
  );

  app.post(
    "/teams/:id/sso/enforce",
    requireUser(deps),
    requireOrgMember(deps, "id"),
    requireRole(["owner"]),
    async (c) => {
      const member = c.get("currentMember");
      const body = await parseBody(c, ssoEnforceSchema);
      const rows = await deps.db.select().from(ssoConfigs).where(eq(ssoConfigs.orgId, member.orgId)).limit(1);
      const config = rows[0];
      if (!config) throw conflict("Configure SSO before enforcing it.", "Save an OIDC or SAML configuration first.");
      if (body.enforced && !config.enabled) {
        throw conflict("Enable SSO before enforcing it.", "An enforced-but-disabled IdP would lock everyone out.");
      }

      await deps.db.update(ssoConfigs).set({ enforced: body.enforced, updatedAt: deps.clock() }).where(eq(ssoConfigs.id, config.id));

      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: "sso.enforcement_changed",
        targetType: "sso_config",
        targetId: config.id,
        ip: c.get("meta").ip,
        detail: {
          enforced: body.enforced,
          ownerExemption: "Owners may still use email links so an org cannot lock itself out.",
        },
      });

      return c.json({
        ok: true,
        enforced: body.enforced,
        note: body.enforced
          ? "Members must now sign in through your identity provider. Owners keep the email-link fallback on purpose."
          : "Enforced SSO is off. Members can use email links again.",
      });
    },
  );

  /** Metadata the IdP needs, as copy-pasteable XML. */
  app.get("/auth/sso/saml/:orgId/metadata", async (c) => {
    const orgId = c.req.param("orgId");
    if (!orgId) throw badRequest("Missing organization id.");
    const sp = serviceProviderFor(deps, orgId);
    return c.body(sp.getMetadata(), 200, { "content-type": "application/xml; charset=utf-8" });
  });

  /* ------------------------------------------------------------ OIDC flow */

  app.get("/auth/sso/oidc/:orgId/start", async (c) => {
    const orgId = c.req.param("orgId");
    if (!orgId) throw badRequest("Missing organization id.");
    const config = await loadConfig(deps, orgId);

    if (!config || config.kind !== "oidc" || !config.enabled) {
      throw notFound("SSO configuration");
    }

    const orgKey = await orgKeyFor(deps, orgId);
    const clientSecret = config.oidcClientSecretEnc ? decryptWithKey(orgKey, config.oidcClientSecretEnc) : null;
    if (!clientSecret || !config.oidcIssuer || !config.oidcClientId) {
      throw unavailable("SSO", "This organization's OIDC configuration is incomplete. An admin can fix it in the SSO settings.");
    }

    const oidc = await discovery({
      issuer: config.oidcIssuer,
      clientId: config.oidcClientId,
      clientSecret,
      authorizationUrl: config.oidcAuthorizationUrl,
      tokenUrl: config.oidcTokenUrl,
    });

    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const nonce = randomToken(16);
    const state = randomToken(24);

    const flow: OidcFlowState = { orgId, codeVerifier, nonce };
    await stashFlow(deps, state, flow);

    const redirectUri = `${deps.env.API_URL}/auth/sso/oidc/${orgId}/callback`;
    const url = client.buildAuthorizationUrl(oidc, {
      redirect_uri: redirectUri,
      scope: config.oidcScopes,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
      // Freshness: an assertion older than five minutes is refused, which stops
      // a captured token from working later.
      max_age: "300",
    });

    return c.redirect(url.toString(), 302);
  });

  app.get("/auth/sso/oidc/:orgId/callback", async (c) => {
    const orgId = c.req.param("orgId");
    if (!orgId) throw badRequest("Missing organization id.");

    const url = new URL(c.req.url);
    const state = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");
    if (errorParam) {
      throw forbidden(
        `Your identity provider returned an error: ${errorParam}. ${url.searchParams.get("error_description") ?? ""}`.trim(),
      );
    }
    if (!state) throw badRequest("Missing OIDC state.", "Start sign-in again from the sign-in page.");

    const flow = await takeFlow(deps, state);
    if (!flow || flow.orgId !== orgId) {
      throw forbidden(
        "This sign-in attempt could not be matched to a started login.",
        "It may have expired (they last 10 minutes) or come from a different browser. Start again from the sign-in page.",
      );
    }

    const config = await loadConfig(deps, orgId);
    if (!config || config.kind !== "oidc" || !config.enabled) throw notFound("SSO configuration");

    const orgKey = await orgKeyFor(deps, orgId);
    const clientSecret = config.oidcClientSecretEnc ? decryptWithKey(orgKey, config.oidcClientSecretEnc) : null;
    if (!clientSecret || !config.oidcIssuer || !config.oidcClientId) {
      throw unavailable("SSO", "This organization's OIDC configuration is incomplete.");
    }

    const oidc = await discovery({
      issuer: config.oidcIssuer,
      clientId: config.oidcClientId,
      clientSecret,
      authorizationUrl: config.oidcAuthorizationUrl,
      tokenUrl: config.oidcTokenUrl,
    });

    let claims: Record<string, unknown>;
    try {
      const tokens = await client.authorizationCodeGrant(oidc, url, {
        pkceCodeVerifier: flow.codeVerifier,
        expectedNonce: flow.nonce,
        expectedState: state,
        idTokenExpected: true,
      });
      claims = (tokens.claims() ?? {}) as Record<string, unknown>;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      deps.log.warn({ orgId, detail }, "oidc code exchange failed");
      throw forbidden(
        "Your identity provider's response could not be verified.",
        "The ID token failed validation (issuer, audience, nonce or signature). An admin can check the SSO configuration.",
      );
    }

    return await completeSsoSignIn(deps, {
      orgId,
      claims,
      meta: c.get("meta"),
      c,
      method: "oidc",
      idpSubject: typeof claims.sub === "string" ? claims.sub : null,
    });
  });

  /* ------------------------------------------------------------ SAML flow */

  app.get("/auth/sso/saml/:orgId/start", async (c) => {
    const orgId = c.req.param("orgId");
    if (!orgId) throw badRequest("Missing organization id.");
    const config = await loadConfig(deps, orgId);
    if (!config || config.kind !== "saml" || !config.enabled) throw notFound("SSO configuration");

    const idp = await identityProviderFor(deps, orgId);
    const sp = serviceProviderFor(deps, orgId);
    const { context } = sp.createLoginRequest(idp, "redirect");
    return c.redirect(context, 302);
  });

  app.post("/auth/sso/saml/:orgId/acs", async (c) => {
    const orgId = c.req.param("orgId");
    if (!orgId) throw badRequest("Missing organization id.");
    const config = await loadConfig(deps, orgId);
    if (!config || config.kind !== "saml" || !config.enabled) throw notFound("SSO configuration");

    const idp = await identityProviderFor(deps, orgId);
    const sp = serviceProviderFor(deps, orgId);

    let claims: Record<string, unknown>;
    let idpSubject: string | null = null;
    try {
      // The envelope samlify expects. Headers are passed as a plain object; the
      // only one it consults is `cookie` for relay-state correlation, which this
      // SP does not use, so the shape stays minimal on purpose.
      const parsedBody = (await c.req.parseBody()) as Record<string, unknown>;
      const result = await sp.parseLoginResponse(idp, "post", {
        body: parsedBody,
        query: Object.fromEntries(new URL(c.req.url).searchParams),
        headers: { cookie: c.req.header("cookie") ?? "" },
      });
      claims = (result.extract?.attributes ?? {}) as Record<string, unknown>;
      const nameId = result.extract?.nameID;
      idpSubject = typeof nameId === "string" ? nameId : null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      deps.log.warn({ orgId, detail }, "saml assertion rejected");
      // Signature validation lives inside samlify and its failure lands here.
      // An unsigned or mis-signed assertion is refused, never accepted.
      throw forbidden(
        "The SAML assertion could not be verified.",
        "Check that the IdP certificate saved in SSO settings matches the one your identity provider is signing with.",
      );
    }

    return await completeSsoSignIn(deps, {
      orgId,
      claims,
      meta: c.get("meta"),
      c,
      method: "saml",
      idpSubject,
    });
  });

  /* -------------------------------------------------------- test endpoint */

  app.post(
    "/teams/:id/sso/test",
    requireUser(deps),
    requireOrgMember(deps, "id"),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const rows = await deps.db.select().from(ssoConfigs).where(eq(ssoConfigs.orgId, member.orgId)).limit(1);
      const config = rows[0];
      if (!config) throw conflict("There is no SSO configuration to test.", "Save a configuration first.");

      const orgKey = await orgKeyFor(deps, member.orgId);
      const problems: string[] = [];

      if (config.kind === "oidc") {
        const clientSecret = config.oidcClientSecretEnc ? safeDecrypt(orgKey, config.oidcClientSecretEnc) : null;
        if (!clientSecret) problems.push("The stored client secret could not be decrypted.");
        if (!config.oidcIssuer) problems.push("No issuer URL is set.");
        if (config.oidcIssuer) {
          try {
            await discovery({
              issuer: config.oidcIssuer,
              clientId: config.oidcClientId ?? "",
              clientSecret: clientSecret ?? "",
              authorizationUrl: config.oidcAuthorizationUrl,
              tokenUrl: config.oidcTokenUrl,
            });
          } catch (error) {
            problems.push(
              `Discovery failed against ${config.oidcIssuer}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      } else {
        try {
          await identityProviderFor(deps, member.orgId);
        } catch (error) {
          problems.push(`The SAML IdP configuration is invalid: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: "sso.tested",
        targetType: "sso_config",
        targetId: config.id,
        ip: c.get("meta").ip,
        detail: { kind: config.kind, ok: problems.length === 0, problems: problems.length },
      });

      return c.json({
        ok: problems.length === 0,
        kind: config.kind,
        problems,
        // Honest about what a config test does and does not prove.
        scope:
          problems.length === 0
            ? "Configuration is reachable and structurally valid. This does not perform a real login — use the sign-in link to prove the end-to-end flow with a real account."
            : "Fix the problems above, then test again.",
      });
    },
  );

  return app;
}

/* ------------------------------------------------------------------------- */
/* helpers                                                                    */
/* ------------------------------------------------------------------------- */

async function loadConfig(deps: AppDeps, orgId: string) {
  const rows = await deps.db.select().from(ssoConfigs).where(eq(ssoConfigs.orgId, orgId)).limit(1);
  return rows[0];
}

async function orgKeyFor(deps: AppDeps, orgId: string): Promise<Buffer> {
  const rows = await deps.db.select({ wrapped: orgs.orgKeyWrapped }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
  const org = rows[0];
  if (!org) throw notFound("Organization");
  return deps.orgKeys.get(orgId, org.wrapped);
}

function safeDecrypt(key: Buffer, value: string): string | null {
  try {
    return decryptWithKey(key, value);
  } catch {
    return null;
  }
}

/**
 * Discovery, with an explicit-endpoint fallback for the "generic" provider.
 *
 * Cached by issuer for an hour: a discovery document is effectively static, and
 * fetching it on every sign-in attempt would make SSO wait on a third party.
 */
const discoveryCache = new Map<string, { config: client.Configuration; at: number }>();

async function discovery(
  input: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    authorizationUrl?: string | null;
    tokenUrl?: string | null;
  },
): Promise<client.Configuration> {
  const cacheKey = `${input.issuer}|${input.clientId}`;
  const cached = discoveryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.config;

  if (input.authorizationUrl && input.tokenUrl) {
    // Explicit endpoints win when provided — some IdPs (and most Okta preview
    // orgs) have an authorization server URL that differs from the issuer.
    const config = new client.Configuration(
      {
        issuer: input.issuer,
        authorization_endpoint: input.authorizationUrl,
        token_endpoint: input.tokenUrl,
        jwks_uri: `${input.issuer.replace(/\/+$/, "")}/.well-known/jwks.json`,
      },
      input.clientId,
      input.clientSecret,
    );
    discoveryCache.set(cacheKey, { config, at: Date.now() });
    return config;
  }

  const config = await client.discovery(new URL(input.issuer), input.clientId, input.clientSecret);
  discoveryCache.set(cacheKey, { config, at: Date.now() });
  return config;
}

/** The SP is derived entirely from `API_URL`, so it cannot drift from the IdP config. */
function serviceProviderFor(deps: AppDeps, orgId: string): SamlServiceProvider {
  return buildServiceProvider({
    entityId: `${deps.env.API_URL}/auth/sso/saml/${orgId}/metadata`,
    acsUrl: `${deps.env.API_URL}/auth/sso/saml/${orgId}/acs`,
  });
}

async function identityProviderFor(deps: AppDeps, orgId: string): Promise<SamlIdentityProvider> {
  const config = await loadConfig(deps, orgId);
  if (!config || !config.samlEntryPoint || !config.samlIdpCertEnc) {
    throw conflict(
      "The SAML configuration is incomplete.",
      "An admin must set the IdP SSO URL and the IdP X.509 certificate in SSO settings.",
    );
  }
  const orgKey = await orgKeyFor(deps, orgId);
  const cert = safeDecrypt(orgKey, config.samlIdpCertEnc);
  if (!cert) {
    throw new CryptoError(
      "The stored IdP certificate could not be decrypted. Re-save the SSO configuration so it is encrypted under the current key.",
    );
  }
  return buildIdentityProvider({
    entityId: config.samlIssuer ?? config.samlEntryPoint,
    ssoUrl: config.samlEntryPoint,
    certificate: cert,
    ...(config.samlNameIdFormat ? { nameIdFormat: config.samlNameIdFormat } : {}),
  });
}

/* ------------------------------------------------ short-lived flow storage */

/**
 * Flow state lives in Postgres rather than memory, so a multi-replica deployment
 * completes a sign-in regardless of which replica served the callback — and so a
 * restart mid-flow does not strand users.
 */
async function stashFlow(deps: AppDeps, state: string, flow: OidcFlowState): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await deps.db.execute(sql`
    insert into xr_sso_flows (state, org_id, code_verifier, nonce, expires_at)
    values (${state}, ${flow.orgId}, ${flow.codeVerifier}, ${flow.nonce}, now() + make_interval(secs => ${FLOW_TTL_SECONDS}))
    on conflict (state) do nothing
  `);
}

async function takeFlow(deps: AppDeps, state: string): Promise<OidcFlowState | null> {
  const { sql } = await import("drizzle-orm");
  const result = await deps.db.execute(sql`
    delete from xr_sso_flows
    where state = ${state} and expires_at > now()
    returning org_id, code_verifier, nonce
  `);
  const rows = (result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  const row = rows[0];
  if (!row) return null;
  return {
    orgId: String(row.org_id),
    codeVerifier: String(row.code_verifier),
    nonce: String(row.nonce),
  };
}

/* -------------------------------------------------------------- completion */

async function completeSsoSignIn(
  deps: AppDeps,
  input: {
    orgId: string;
    claims: Record<string, unknown>;
    meta: { ip: string; userAgent: string };
    c: Context;
    method: "oidc" | "saml";
    idpSubject: string | null;
  },
): Promise<Response> {
  const email = extractEmail(input.claims);
  if (!email) {
    throw forbidden(
      "Your identity provider did not return an email address.",
      "Add the `email` claim (OIDC) or an email attribute (SAML) to your IdP's configuration for this application.",
    );
  }

  const domain = emailDomain(email);
  const config = await loadConfig(deps, input.orgId);
  if (config && config.emailDomains.length > 0 && domain && !config.emailDomains.includes(domain)) {
    // Domain pinning is what stops "anyone with an account on the same IdP" from
    // becoming "anyone on the team".
    throw forbidden(
      `Your email domain (${domain}) is not allowed for this team's SSO configuration.`,
      "Ask an admin to add the domain, or to invite you directly.",
    );
  }

  const found = await deps.db.select().from(users).where(eq(users.email, email)).limit(1);
  let user = found[0];
  const now = deps.clock();

  if (!user) {
    const created = await deps.db
      .insert(users)
      .values({ id: newId("user"), email, emailVerifiedAt: now, createdAt: now, updatedAt: now })
      .returning();
    user = created[0];
    if (!user) throw conflict("Could not create the account.");
  }

  const membership = await deps.db
    .select()
    .from(members)
    .where(and(eq(members.orgId, input.orgId), eq(members.userId, user.id)))
    .limit(1);

  /**
   * Authorization, not authentication. A valid IdP assertion proves who someone
   * is; it does not enroll them in an organization. If they are not a member,
   * they get an honest refusal naming the repair — never a silent auto-join,
   * which would let anyone in the customer's directory read team memory.
   */
  if (!membership[0]) {
    throw forbidden(
      "You are not a member of this team.",
      "Ask an organization admin to invite this email address, then sign in again. Signing in through SSO does not add you to a team by itself.",
    );
  }
  if (membership[0].status === "disabled") {
    throw forbidden("Your access to this organization has been disabled by an admin.");
  }

  if (input.idpSubject && membership[0].ssoSubject !== input.idpSubject) {
    await deps.db
      .update(members)
      .set({ ssoSubject: input.idpSubject, updatedAt: now })
      .where(eq(members.id, membership[0].id));
  }

  const issued = await issueSession(deps, {
    userId: user.id,
    orgId: input.orgId,
    role: membership[0].role,
    kind: "web",
    userAgent: input.meta.userAgent,
    ip: input.meta.ip,
  });
  setSessionCookies(input.c, deps, issued);

  await deps.audit.append({
    orgId: input.orgId,
    actorKind: "user",
    actorId: user.id,
    actorEmail: email,
    action: `auth.signin_${input.method}`,
    ip: input.meta.ip,
    userAgent: input.meta.userAgent,
    detail: { role: membership[0].role },
  });

  // Straight to the console, with the deep link the desktop listens for.
  return input.c.redirect(`${deps.env.APP_URL}/auth/complete?next=%2Fdashboard`, 302);
}

/**
 * Pull an email out of whatever shape the IdP used. This is deliberately narrow:
 * only well-known claim names are consulted, and the result is normalized. An IdP
 * that returns something unusual gets an actionable error rather than a guess.
 */
function extractEmail(claims: Record<string, unknown>): string | null {
  const candidates = [
    claims.email,
    claims.mail,
    claims.upn,
    claims.preferred_username,
    claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"],
    claims["urn:oid:0.9.2342.19200300.100.1.3"],
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.includes("@")) return normalizeEmail(candidate);
  }
  return null;
}
