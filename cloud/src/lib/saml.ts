/**
 * XR Cloud — SAML adapter.
 *
 * ## Why this file exists
 *
 * `samlify` is the right library — it is the maintained one, it validates
 * signatures properly, and it is what the brief names. Its TypeScript packaging,
 * however, mixes a **default-exported factory function** with a **named class** of
 * the same name, and the re-export in `types/index.d.ts` resolves the name to the
 * value. The practical consequences are that `new ServiceProvider(...)` has no
 * construct signature under `strict`, and the settings interfaces have no
 * `signAssertion` or `ssoLoginService` member.
 *
 * Rather than sprinkle `as any` through the route file — which would defeat the
 * type checking on the parts that matter — the interop lives here, once, behind a
 * narrow interface that states exactly what this service uses. The route code then
 * gets real types, and the cast is in one reviewable place with its reason written
 * down.
 *
 * ## What this adapter deliberately does NOT do
 *
 * It does not re-implement signature validation, assertion parsing, or metadata
 * generation. All of that stays inside samlify, which is the point of using it. The
 * adapter only narrows the surface.
 *
 * ## Security posture encoded here
 *
 *   - `wantAssertionsSigned: true` — an unsigned assertion is refused by samlify.
 *   - `wantAuthnRequestsSigned: false` — XR does not sign AuthnRequests, and
 *     claiming otherwise in metadata would make the IdP reject the login.
 *   - Certificate armour is stripped before being handed over, because an IdP
 *     admin pasting a certificate from a portal will paste it with the PEM
 *     headers, and samlify wants the bare base64.
 */

import { IdentityProvider, ServiceProvider } from "samlify";

/** The subset of samlify's SP surface this service calls. */
export interface SamlServiceProvider {
  /** Serialized SP metadata XML, for pasting into the IdP. */
  getMetadata(): string;
  /** Returns `{ context }`, where `context` is the redirect URL for `redirect` binding. */
  createLoginRequest(
    idp: SamlIdentityProvider,
    binding: "redirect",
    options?: { relayState?: string },
  ): { context: string };
  /** Validates the signature and returns the extracted claims. Throws on failure. */
  parseLoginResponse(
    idp: SamlIdentityProvider,
    binding: "post",
    request: SamlHttpRequest,
  ): Promise<SamlFlowResult>;
}

export interface SamlIdentityProvider {
  readonly __brand: "saml-identity-provider";
}

export interface SamlHttpRequest {
  body: Record<string, unknown>;
  query: Record<string, string>;
  headers: Record<string, string>;
}

export interface SamlFlowResult {
  extract?: {
    nameID?: string;
    attributes?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

/** Strips PEM armour and whitespace. Returns bare base64, as samlify expects. */
export function normalizeCertificate(raw: string): string {
  const body = raw
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  if (body.length < 32) {
    throw new Error("That does not look like an X.509 certificate.");
  }
  return body;
}

export function buildServiceProvider(input: {
  /** SP entity id — the metadata URL. */
  entityId: string;
  /** Assertion Consumer Service URL. */
  acsUrl: string;
}): SamlServiceProvider {
  const factory = ServiceProvider as unknown as (settings: {
    entityID: string;
    assertionConsumerService: Array<{ Binding: string; Location: string }>;
    wantAssertionsSigned: boolean;
    wantMessageSigned: boolean;
  }) => SamlServiceProvider;

  return factory({
    entityID: input.entityId,
    assertionConsumerService: [
      { Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST", Location: input.acsUrl },
    ],
    // An assertion that is not signed cannot be attributed to anyone. Refusing is
    // the only defensible default.
    wantAssertionsSigned: true,
    wantMessageSigned: false,
  });
}

export function buildIdentityProvider(input: {
  entityId: string;
  ssoUrl: string;
  /** Bare base64 X.509 certificate. */
  certificate: string;
  nameIdFormat?: string;
}): SamlIdentityProvider {
  const factory = IdentityProvider as unknown as (settings: {
    entityID: string;
    singleSignOnService: Array<{ Binding: string; Location: string }>;
    signingCert: string;
    wantAuthnRequestsSigned: boolean;
    nameIDFormat?: string[];
  }) => SamlIdentityProvider;

  return factory({
    entityID: input.entityId,
    singleSignOnService: [
      { Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect", Location: input.ssoUrl },
    ],
    signingCert: input.certificate,
    // XR does not sign AuthnRequests. Declaring that we do would make a compliant
    // IdP reject every login with an honest signature error.
    wantAuthnRequestsSigned: false,
    ...(input.nameIdFormat ? { nameIDFormat: [input.nameIdFormat] } : {}),
  });
}
