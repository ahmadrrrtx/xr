# SSO (OIDC and SAML 2.0)

Single sign-on is a **Business tier** feature of the hosted control plane. It has
no effect on a local XR install: nothing about the desktop application changes
when an organization enables it, and an enforced SSO policy cannot reach a machine
that is not signed in.

- Audience: organization owners and admins, and the IdP administrator on the other side.
- Implementation: `cloud/src/routes/sso.ts`, `cloud/src/lib/saml.ts`, `cloud/src/services/policy.ts`.
- Console page: `/dashboard/sso`.

## 1. What XR is as a service provider

| Value | Where it comes from | Example |
| --- | --- | --- |
| Entity ID | `{API_URL}/auth/sso/saml/{orgId}/metadata` | `https://api.xr.rrrtx.ai/auth/sso/saml/org_abc/metadata` |
| ACS URL | `{API_URL}/auth/sso/saml/{orgId}/acs` | `https://api.xr.rrrtx.ai/auth/sso/saml/org_abc/acs` |
| Metadata URL | `{API_URL}/auth/sso/saml/{orgId}/metadata` | same as Entity ID |
| OIDC redirect URI | `{API_URL}/auth/sso/oidc/{orgId}/callback` | `https://api.xr.rrrtx.ai/auth/sso/oidc/org_abc/callback` |

Both the entity ID and the ACS URL are derived from the deployment's `API_URL` at
request time (`cloud/src/lib/saml.ts`). They are never stored, and the console
never assembles them from a client-side constant, so the value in the metadata and
the value the server validates against cannot drift. That class of bug presents as
"the signature is invalid" and costs an afternoon to diagnose.

**XR does not sign AuthnRequests, and the metadata says so**
(`WantAuthnRequestsSigned="false"`). Claiming otherwise makes a correctly
configured IdP reject every login with a signature error that looks like a
certificate problem.

## 2. Protocols

### OIDC (`kind: "oidc"`)

Supported providers: Google, Okta, Azure AD / Entra ID, and any generic
issuer (`provider: "generic"` with an explicit `issuer`). Discovery is fetched
from `{issuer}/.well-known/openid-configuration`; a deployment that cannot reach
the issuer at configuration time stores the discovery document it was given and
validates the issuer claim on every response.

Required on our side:

| Control | Implementation |
| --- | --- |
| PKCE, S256 | `code_challenge` generated per flow; `plain` is not accepted |
| State | 32 random bytes, single-use, 10-minute TTL, bound to a browser cookie |
| Nonce | Sent and verified against the ID token claim |
| ID token | Signature verified against the issuer's JWKS; `aud`, `iss` and `exp` all checked |
| Email | Read from `email` only; an unverified email claim is refused when the provider supplies `email_verified: false` |

### SAML 2.0 (`kind: "saml"`)

- Assertions must be **signed**. An unsigned assertion is refused, including from
  an IdP that only signs the response. (A response signature is accepted when the
  assertion carries none, and the XML is validated against the same
  canonicalisation path either way.)
- `Issuer` and `Audience` are validated on every response against the stored
  configuration; `InResponseTo` is matched to the outstanding flow and the flow is
  deleted on read, single-use.
- `NotBefore` / `NotOnOrAfter` are enforced with a 90-second clock skew allowance.
- The IdP certificate is stored as PEM, encrypted at rest (see §5). Uploading a
  certificate that is not a certificate fails at save time, not at login time.
- Replay defence: an assertion ID is recorded per organization for the assertion's
  validity window; a repeat is refused.

## 3. What a successful SSO sign-in does — and does not do

It proves **identity**. It does not confer membership.

| Outcome | Behaviour |
| --- | --- |
| Email matches an active member | A session is issued; `last_login_at` and an audit entry are written |
| Email matches no member | Sign-in ends on `/auth/error?code=not_a_member`, which names the organization and tells the person an admin has to invite them |
| Email matches an invited member | The invitation is accepted and the session is issued |
| Domain matches an enforced policy but the person is not a member | Same as "no member": enforcement changes *which* sign-in methods are allowed, never who belongs |

## 4. Enforcement

`POST /teams/:id/sso/enforce` toggles enforcement for the domains listed in
`emailDomains`. When enabled, password and magic-link sign-in are refused for
addresses on a verified domain; the person is redirected to the provider with a
message that says so rather than being given a generic failure.

Two properties matter:

1. **Verified domains must be verified.** A domain is only eligible for
   enforcement after a DNS TXT or a mail-based check succeeds. Otherwise an admin
   could lock out `gmail.com`.
2. **Enforcement cannot become a lockout tool.** The organization owner's account
   is exempt while the IdP configuration is in a `test` state, and turning
   enforcement on with a broken configuration is refused at save time: we attempt
   a discovery/metadata fetch first and report what the provider said.

## 5. Secret handling

The OIDC client secret and the SAML certificate are encrypted with **AES-256-GCM**
under a key derived from `XR_KEY_ENCRYPTION_KEY` before they are stored
(`sso_configs.client_secret_ciphertext`). Once saved, a secret is **write-only**:
the console renders a placeholder, and no endpoint returns the stored value. The
row keeps a key identifier so a KEK rotation can find what still needs re-wrapping.

Audit entries record that a configuration changed and who changed it — never the
secret, never the client ID.

## 6. Configuration API

| Method | Path | Role |
| --- | --- | --- |
| `GET` | `/teams/:id/sso` | owner, admin, member (read-only, for the "how do I sign in" view) |
| `PUT` | `/teams/:id/sso/oidc` | owner, admin |
| `PUT` | `/teams/:id/sso/saml` | owner, admin |
| `POST` | `/teams/:id/sso/test` | owner, admin |
| `POST` | `/teams/:id/sso/enforce` | owner only |

Every mutation is written to the audit log with the previous and next values of
the non-secret fields.

## 7. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "Signature validation failed" on every login | The IdP is signing with a certificate that does not match the one uploaded, or the IdP is signing the response while the assertion is unsigned and the config expects the opposite |
| Login loops back to the provider | The redirect URI at the IdP does not exactly match `{API_URL}/auth/sso/oidc/{orgId}/callback`, including trailing slash |
| "That sign-in did not finish" after a long pause | The flow expired (10 minutes). The state cookie is deleted on read; start again |
| `not_a_member` | Working as intended. Invite the person, or invite by domain from the Members page |
| Works in test, fails after switching the IdP to production URLs | The `issuer` still points at the test tenant. Re-save the configuration; the test button re-fetches discovery |

## 8. Not implemented, and stated plainly

- **SCIM provisioning.** Deactivating someone in the IdP does not disable them here.
  An admin has to remove them. Their session expires within fifteen minutes
  regardless, but the removal is manual and that is a real gap.
- **Multiple IdPs per organization.** One configuration per organization
  (`sso_configs` has a unique organization column). Multi-tenant IdP routing is
  not attempted.
- **SAML single logout.** We do not send or consume `LogoutRequest`. Signing out of
  XR does not sign the person out of their IdP, and vice versa; the session ends
  on its own within fifteen minutes.
- **Group-to-role mapping.** Roles are assigned in XR by an admin. IdP groups are
  not read.
