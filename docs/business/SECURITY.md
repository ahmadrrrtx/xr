# SECURITY

The security posture of the hosted XR control plane, written for someone filling
out a vendor questionnaire, and honest about the parts that do not exist yet.

Public trust page: `/security` · Compliance view: `/dashboard/compliance` ·
Vulnerability disclosure: `/.well-known/security.txt` on both the website and the API.

## 1. What we are protecting, and from whom

| Asset | Where it lives | Threat we take seriously |
| --- | --- | --- |
| Team memory facts | Postgres, encrypted per workspace | A database dump, a curious operator, an over-broad admin |
| Audit log | Postgres, hash-chained | Silent tampering by someone with database access |
| IdP client secrets, SAML certs | Postgres, AES-256-GCM under the KEK | A leaked backup |
| Sessions | Short-lived JWT + refresh cookie | Token theft, replay, CSRF |
| Provider API keys (BYOK) | **Never here** — they stay on the user's machine | We cannot leak what we do not hold |
| Prompts and completions | **Never stored.** Not in logs, not in the database | Prompt retention |

## 2. Transport and boundary

- **TLS 1.2 minimum**, with HSTS (`max-age=31536000; includeSubDomains`) set by
  `cloud/src/middleware/security.ts`. TLS is terminated by the platform in front of
  the service; the service refuses to run with `NODE_ENV=production` unless
  `APP_URL` and `API_URL` are `https://`.
- **CORS**: exactly one allowed origin, `APP_URL`. Not a wildcard, not a regex.
  Credentials are allowed only for that origin.
- **Cookies**: `xr_session` and `xr_refresh` are `HttpOnly`, `Secure` (in
  production), `SameSite=Lax`, with `__Host-`-style scoping where the deployment has
  no `COOKIE_DOMAIN`. The CSRF cookie is deliberately **not** `HttpOnly` — the
  browser has to be able to read it to echo it back.
- **Headers**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, and a `Content-Security-Policy` of `default-src 'none'`
  for API responses (the API serves no HTML).

## 3. Authentication and sessions

| Control | Value |
| --- | --- |
| Access token | JWT, **15 minutes**, HS256 with `JWT_SECRET` (≥32 characters), audience `xr-cloud` |
| Refresh token | Opaque, 30 days, **stored as a SHA-256 hash**, rotated on every use |
| Refresh reuse | Detection revokes the entire `familyId` — every session descended from that login — and writes an audit entry |
| Password (fallback path) | `@node-rs/argon2` (Argon2id), per-hash salt, no password ever logged |
| Magic link | 32 random bytes, SHA-256 at rest, single-use, **10 minutes** |
| Invitations | Same construction, **14 days**, single-use |
| SSO flows | State/nonce per flow, single-use, 10 minutes, deleted on read |

Two rules are enforced in code rather than by convention:

1. **Sign-in never reveals whether an address exists.** A sign-up for an existing
   address and a magic-link request for an unknown one both return the same
   response, in the same time.
2. **CSRF is checked on every cookie-authenticated mutation**, against the
   `x-csrf-token` header. A `Bearer`-authenticated request is exempt because it
   cannot be triggered cross-site by a browser.

## 4. Authorization

- **Roles are re-read per request.** `owner`, `admin`, `member`; the row is loaded
  from the database inside the request, never trusted from the token, so a demotion
  takes effect immediately rather than at the next token refresh.
- **Ownership is checked by query, not by parameter.** Every `/teams/:id/...` route
  resolves membership from the session and the path parameter, and a member of
  another organization gets the same 404 as a nonexistent team. Enumerating
  organization ids reveals nothing.
- **The resource is gated, not only the action.** An API key belonging to a
  cancelled organization is refused, even though "list keys" is a permitted action
  for an owner — the entitlement is checked on the resource.
- **Entitlement is orthogonal to role**: a member can read policy (so they can see
  the limits that apply to them) and cannot change it.

## 5. Cryptography

| Purpose | Primitive |
| --- | --- |
| Session tokens | HS256 JWT (`jose`) |
| Licence tokens | Ed25519 (EdDSA), verified offline against a public key compiled into the client |
| Envelope encryption | 32-byte KEK in `XR_KEY_ENCRYPTION_KEY` wraps a per-organization `org_key` (AES-256-GCM, `iv‖ct‖tag`) |
| Team memory | `HKDF-SHA256(org_key, "xr:team-memory:v1:<workspaceId>")` → per-fact AES-256-GCM |
| Passwords | Argon2id |
| Refresh / magic-link / invite tokens | SHA-256 at rest (they are high-entropy, so a slow hash would only cost latency) |
| Audit chain | SHA-256 of the previous hash plus the canonical entry |
| Stripe webhooks | HMAC over the raw request body, constant-time comparison |

**Team memory is encrypted at rest and in transit with keys we hold. It is not
end-to-end encrypted**, and nothing in the product claims otherwise. The console
says so, the trust page says so, and `docs/business/TEAM-MEMORY.md` §6 says so with
the reasoning. Per-message E2E is a v2 design question, not a shipped property.

## 6. Input handling

- **Every mutating endpoint validates with Zod** before its handler runs
  (`cloud/src/middleware/validate.ts`). An unparseable body is a 400 with the failing
  path, never a 500.
- **All SQL is parameterised** (Drizzle). There is no string-built query anywhere in
  `cloud/src`. `sql.unsafe` is used in exactly one place — the migration runner —
  and only on files in `cloud/drizzle/` that ship in the repository.
- **Output is encoded, not escaped by hand**: API responses are JSON with an explicit
  charset, and the console renders user-supplied strings as text.
- **Size caps** on bodies, on audit exports, and on model prompts.
- **Rate limits** (`rate-limiter-flexible`, Redis-backed; in-process in tests):

| Bucket | Limit |
| --- | --- |
| Sign-in / magic-link / password | 10 per minute per IP (+ per-account bucket) |
| Sign-up | 5 per minute per IP |
| Invitation acceptance | 10 per minute per IP |
| Model invocation | per-user and per-organization, from policy |
| Audit export | 5 per hour per organization |

Client IP is the **peer address**. Forwarded headers (`x-forwarded-for`,
`x-real-ip`) are honoured only when `TRUST_PROXY=1`, because otherwise any caller
can rotate a header value and walk through every IP limit — which is exactly what
happened while this service was being built.

## 7. Logging and audit

- Structured JSON (`pino`) with a per-request id. **Logs never contain** prompts,
  completions, memory bodies, tokens, passwords or secrets. The audit `detail` for a
  model call is the model id and the prompt length.
- The **audit log is hash-chained**: each entry commits to its predecessor
  (`seq`, `prev_hash`, `entry_hash`). Deleting or editing a row breaks the chain at
  that index, and `GET /teams/:id/audit/verify` recomputes it so a customer can
  check rather than trust.
- Exports are CSV with a UTF-8 BOM and CRLF endings (so Excel opens them without an
  import wizard), signed, and served from a short-lived link.
- Administrative actions and data-access events are both recorded (see
  `docs/business/TEAM-MEMORY.md` §5 for what is and is not in the log).

## 8. Retention and deletion

| Data | Retention |
| --- | --- |
| Team memory, audit log | 30 days after cancellation (configurable upward), then purged |
| Subscription, invoices, webhook events | Life of the account + 30 days |
| Sessions, magic links, SSO flows | Deleted on use or at expiry; sweeps run on the request path |
| Model prompts and outputs | Not stored at all |
| Usage counters | Aggregates only (day and month keys), never content |

Deleting an organization does not and cannot reach into a member's machine. That is
a design property, not an operational promise: the client has no endpoint to call
that would do it, and no code path to receive one.

## 9. Sub-processors

| Sub-processor | Purpose | Data it can see | Where |
| --- | --- | --- | --- |
| Stripe | Payments, subscription state, invoices | Organization name, billing email, tax ids, amounts. **No product data, no memory, no prompts** | US/EU |
| Cloudflare (R2) | Audit export storage | Signed export files, for the life of the link plus retention | Global edge |
| Postmark (or SMTP) | Transactional mail: magic links, invitations, dunning | Recipient address, subject, link. Nothing else | US |
| Model providers (OpenAI, Anthropic, Google) | Managed-model inference, **only when a request is made** | The prompt and completion of that request, under their terms | US |

An up-to-date list is on `/security`. Sub-processor changes ship in the changelog;
a 30-day advance email notice is a gap we have not built yet.

## 10. Development and supply chain

- **Source available**, MIT-licensed. The cloud service is `cloud/`; the client half
  is `src/cloud/`. Anyone can read the code that holds their data, and several tests
  exist to make the honest claims in the docs falsifiable.
- **Migrations are additive and reversible**, reviewed like any other change, and
  timestamped in a journal table so a partial run is visible.
- **Secrets are environment-only.** The service refuses to boot with a missing or
  weak `JWT_SECRET` or a `XR_KEY_ENCRYPTION_KEY` that is not exactly 32 bytes
  (`assertBootable`). It never writes a secret to disk.
- **No analytics, no telemetry, no third-party script** in the product or on the
  website. Server logs are the only telemetry pipeline and they are not person-linked.

## 11. Compliance status — stated plainly

- **SOC 2 Type I: in progress.** The controls in `/dashboard/compliance` are
  implemented and evidenced. What remains is an independent auditor's opinion on
  their design. No audit has been completed.
- **SOC 2 Type II: not attempted.** It observes controls over months and cannot be
  done retroactively for a product this young.
- **No ISO 27001, HIPAA, PCI-DSS or FedRAMP program exists.** Card data never
  touches our servers, which is why PCI scope is avoided rather than put through an attestation.
- **No external penetration test has been completed.** Dependency scanning is
  automated; a third-party engagement is planned and not booked.
- **No availability SLA is offered.** Availability targets for operators who run
  their own control plane are in `docs/business/SELF-HOST.md` and are not a
  contractual commitment.

## 12. Reporting a vulnerability

`security@xr.rrrtx.ai`, or a private advisory via
`https://github.com/ahmadrrrtx/xr/security/advisories/new`. Both are published in
`/.well-known/security.txt` on the website **and** on the API, so a researcher who
finds something in either place does not have to guess that there is a second copy.

- We acknowledge within **two business days** and tell you what we concluded,
  including when the conclusion is that we disagree.
- There is **no bug bounty** in v1.0.0. Credit in the release notes is offered and
  is not a payment.
- Good-faith research against **your own** account is authorised. Do not test
  against other people's organizations, and do not run denial-of-service tests.
