# Phase 30 — Business tier — implementation plan

Branch `phase/30-business`. Base: `4a255ac` (Phase 28 merge).
Scope: **additive cloud value only.** Zero local-feature paywalls. Read
`30-business-notes.md` first — it records the brief-vs-tree gaps.

---

## 1. Deliverable map

```
cloud/                      NEW deployable — Bun + Hono + Drizzle + Postgres + Redis
src/cloud/                  NEW daemon-side client (session, license, models proxy, memory sync)
src/daemon/routes/cloud.routes.ts
src/context/memory/team.ts
desktop/src/screens/Settings/tabs/BillingTab.tsx
desktop/src/screens/Workspaces/TeamSection.tsx
website/src/app/{pricing,security,legal,auth,dashboard,download}/
website/src/lib/brand.ts, website/src/components/dashboard/*
docs/business/{SSO,BILLING,SECURITY,TEAM-MEMORY,SELF-HOST}.md
```

## 2. Cloud service

### 2.1 Runtime
- Bun ≥ 1.3 (matches repo `.bun-version`), `Bun.serve` + Hono 4.
- Deployable as a standard Node/Bun app; `Dockerfile` + `docker-compose.yml`
  (postgres 17 + redis 7 + cloud) for local dev.
- 12-factor env, validated once at boot by `src/env.ts` (zod v4). **Fail closed:**
  a missing or malformed required var refuses to start rather than booting into a
  half-configured state (Art. IV.4).

### 2.2 Schema (Drizzle, `src/db/schema.ts`)

| Table | Purpose | Notes |
| --- | --- | --- |
| `users` | account identity | email unique (citext-ish, lowercased), `password_hash` nullable (magic-link primary) |
| `orgs` | the tenant | name, slug, `org_key_wrapped` + `org_key_kek_id` (envelope encryption) |
| `members` | user↔org | `role` enum `owner\|admin\|member`, per-user cap overrides, status |
| `invites` | pending membership | token hash only, email, role, expiry, inviter |
| `sso_configs` | OIDC **or** SAML per org | one row per org; `enforced` flag; secrets encrypted with org key |
| `policies` | admin-authored limits | caps, provider allowlist, egress allowlist, retention, require-approval threshold, `disable_byok` |
| `subscriptions` | Stripe mirror | stripe ids, `status`, seats, trial/period timestamps, plan |
| `invoices` | Stripe mirror (read/display) | hosted invoice + PDF urls |
| `memories` | **team** memory facts | workspace-scoped, `body_ciphertext` AES-256-GCM, version id, sensitivity tags |
| `memory_reviews` | suggested-fact queue | pending/approved/rejected, decider, reason |
| `audit_logs` | append-only, hash-chained | `seq`, `prev_hash`, `entry_hash`, actor/target/workspace/ip/action |
| `sessions` | refresh tokens + device sessions | token **hash** only, rotation, revocation |
| `license_keys` | issued license JWTs | jti, subject, org, expires, `revoked_at` |
| `api_keys` | Business API keys for CI | scoped, hashed, last-used |
| `usage_events` | managed-model metering | tokens in/out, model, provider, workspace, user, cost micro-USD — **no prompt content** |
| `usage_counters` | rolling per-user day/month totals | fast cap checks |
| `webhook_events` | Stripe idempotency | event id unique, processed-at |
| `relay_registrations` | device-scoped relay tokens | device id, org, user, revoked |

All money in **integer micro-USD** (`1e-6 USD`) so no float ever touches billing.
All timestamps `timestamptz`.

### 2.3 Encryption
- `KEK` = 32 bytes from `XR_KEY_ENCRYPTION_KEY` (base64), never in the DB.
- On org create: `org_key = randomBytes(32)`; stored as
  `AES-256-GCM(KEK, org_key)` + `kek_id` (5-byte tag) → enables KEK rotation.
- Per workspace: `ws_key = HKDF-SHA256(org_key, info="xr:team-memory:v1:"+workspaceId)`.
  Derivation is deterministic, so no per-workspace key rows to lose.
- Memory bodies: `iv(12) || ciphertext || tag(16)`, base64. The plaintext never
  reaches a log, an error message, or the audit row (Art. IX.5, Art. XXI).
- v1 is **server-managed encryption with exportable snapshots**; per-message E2E
  is explicitly v2 (brief §A). The `/security` page says exactly this and does
  not imply more.

### 2.4 Sessions
- Access JWT: HS256, 15 min, `sid` + `sub` + `org` + `role`. Returned in JSON
  **and** as an httpOnly cookie on web flows.
- Refresh token: 30 days, opaque 32 bytes, stored **hashed** (SHA-256), rotated on
  every use; reuse of a rotated token revokes the family (theft signal).
- Cookies: `httpOnly`, `secure` (prod), `sameSite=lax`, `path=/`.
- Device sessions (desktop/CLI/VS Code/mobile): separate `sessions.kind='device'`
  with a scoped token so a jailed laptop can be revoked without touching web.

### 2.5 License JWT (the honest bit)

```
header  { alg: "EdDSA", kid: "xr-lic-2026-01", typ: "JWT" }
payload {
  iss: "https://api.xr.rrrtx.ai",
  sub: "<userId>",
  org: "<orgId>",
  plan: "business",
  seats: 12,
  feat: ["team","sso-admin","managed-models","relay","memory-sync","audit-export"],
  iat, exp, jti
}
```

- Signed **Ed25519**. `GET /.well-known/xr-license-pubkey` publishes the SPKI.
- The **desktop bakes in the public key** (`src/cloud/license-pubkey.ts`) and
  verifies the signature locally with `node:crypto` — **no network call is
  required to enter Business mode, ever.**
- `feat` is an allowlist of *cloud* surfaces only. The desktop maps a `feat` entry
  to a UI affordance; **no local capability reads this list.** That is the
  mechanical guarantee behind "no local-feature paywall": the license has no
  vocabulary for a local feature.
- Grace: licence `exp` is not authoritative on its own. The client refuses to lock
  team UI until `now > exp + 30d`, and only after at least one failed *silent*
  re-check. Locking is a UI state, never a data or engine state.

### 2.6 Endpoints
As specified in the brief §C, with three honest adjustments:

1. `POST /relay/register` — registered as specified, but v1 ships the **WSS hub**
   at `GET /relay/ws` (upgrade) rather than an HTTP-only registration, because a
   relay registration with no socket is not a relay.
2. `GET /auth/callback` in the brief is ambiguous between magic-link and OAuth
   callbacks. Split: `GET /auth/magic/callback` (email link) and
   `GET /auth/sso/oidc/:provider/callback`. No route named `/auth/callback` is
   mounted, so nothing can silently pick the wrong verifier.
3. `POST /teams/:id/audit/export` returns **202 + a job id**; the signed URL is
   fetched from `GET /teams/:id/audit/export/:jobId` once `status='ready'`. The
   brief's "returns signed URL after processing" cannot be honoured by a single
   request without blocking, and a blocking request is a timeout waiting to happen.

### 2.7 Hardening checklist (all in `src/middleware/`)
- Rate limits: magic-link 10/min/email+IP, signup 5/min/IP, auth-general 60/min,
  API 600/min, export 5/hour/org.
- Zod validation on **every** body/query/param; unknown keys stripped, not merged.
- CSRF double-submit on cookie-authenticated mutations only.
- Security headers: HSTS (prod), `X-Content-Type-Options`, `Referrer-Policy`,
  `Cross-Origin-Opener-Policy`, CSP on HTML responses.
- CORS: exactly one origin (`APP_URL`), credentials on, no wildcard, no reflection.
- Drizzle parameterised everywhere; no string-built SQL anywhere.
- Stripe webhook: raw body, signature verified, idempotent by `event.id`.
- No secret, token, key, memory body, or prompt ever enters a log line — a
  `redact` list on the pino instance plus a per-request scrub.

### 2.8 Cloud relay (v1 minimal, per brief §E)
- `GET /relay/ws` — WSS upgrade. Business-gated, device-token authenticated.
- Frames are `{room, iv, ct}` opaque base64. The hub **routes only**; it does not
  need the key and cannot read payloads. No persistence, no history, no indexing.
- If no peer is connected, the frame is **dropped** and the sender is told
  `{type:"dropped", reason:"no-peer"}` — honest, never silently queued.
- E2E key exchanged at device pairing (mirrors the P28 LAN pairing pattern).

## 3. Daemon-side client (`src/cloud/`)

| File | Responsibility |
| --- | --- |
| `session.ts` | signed-in state; token in `secretBroker` under `XR_CLOUD_SESSION`; never in config files (Art. IX.5) |
| `client.ts` | typed cloud HTTP client; **every** request via `guardedFetch` so the org egress allowlist applies |
| `license.ts` | offline Ed25519 verify against baked-in pubkey; grace arithmetic; `businessFeatures()` |
| `license-pubkey.ts` | the baked SPKI (generated once, committed, stable forever) |
| `models-proxy.ts` | SSE passthrough to `POST /v1/models/:provider/chat`; metering; **BYOK bypasses it** |
| `memory-sync.ts` | push/pull team facts; sensitivity scanner gate; LWW merge on version id |
| `policy.ts` | team policy fetch/cache; composes with (never replaces) the local budget cap |

Constitutional test to be added: `test/cloud/no-local-gate.test.ts` — asserts that
no module under `src/` outside `src/cloud/` and `src/daemon/routes/cloud.routes.ts`
imports the license, and that `businessFeatures()` is read by UI/route code only.

## 4. Desktop

- `Settings → Billing & Account` (`account` group, after `general`).
  - Unsigned: Personal card, compact 2-column comparison, one primary CTA, one
    "Sign in", plus the literal sentence *"Personal stays fully-featured.
    Upgrading only adds team features."*
  - Signed: team + role chip, plan, seats, next billing date, month spend vs cap,
    Manage team / Manage billing / Invite members / Sign out; `past_due` banner;
    trialing banner.
  - Post-checkout: a 1–2 sentence welcome card. No confetti, no cinematic motion.
- `Workspaces` gains a `Team` section above `Local`, rendered **only** when
  `businessFeatures()` is non-empty. Local list is byte-identical when unsigned.
- Expired licence: Business affordances grey out with *"Your Business subscription
  ended — team features disabled. Your local data and workspaces are unaffected."*

## 5. Website

- `/pricing` — 3 tiers. Personal is the **default and first** card, honestly
  labelled *"Free forever, fully functional."* No countdown, no "🔥", no fake
  urgency, no dark pattern. Feature grid marks each row Personal ✓ / Business ✓.
- `/security` — SOC 2 **roadmap** badge (never "certified"), controls list with
  enforced/planned badges (Art. IV.2), sub-processors, DPA, security.txt, VDP.
- `/legal/privacy`, `/legal/terms` — plain English.
- `/download`, `/auth/*`, `/dashboard/*`.
- Analytics: **none**. Server logs only.

## 6. Test matrix (what will actually be run vs. what needs infra)

| Check | Runnable in this sandbox | How |
| --- | --- | --- |
| cloud typecheck strict | ✅ | `bun run typecheck` |
| cloud boots, health endpoints | ✅ | `bun run dev` + curl |
| migration applies, schema matches | ✅ | drizzle-kit generate/push against local pg |
| magic-link signup → session → `/auth/me` | ✅ | `bun test` against the running app, mail transport stubbed |
| team create / invite / accept / role change | ✅ | as above |
| policy CRUD + cap enforcement | ✅ | as above |
| team memory CRUD + encryption round-trip + sensitivity block | ✅ | as above |
| audit chain verify + filtered list + export job | ✅ | as above |
| license JWT mint → offline verify → grace math | ✅ | as above, pure functions |
| relay routes / drops with no peer | ✅ | ws client in test |
| Stripe checkout/webhook | ⚠️ needs Stripe CLI + test keys | handler unit-tested against signed fixture payloads instead; documented as the one flow requiring an operator-supplied key |
| SSO against a real IdP | ⚠️ needs samltest.id / Okta preview | protocol-level tests with a mock IdP; documented |
| Postgres + Redis integration | ⚠️ needs docker | run against a local pg if available, else documented |

`docs/business/SELF-HOST.md` carries the operator runbook for the two ⚠️ rows.

## 7. Definition of done for this phase

1. Every ✅ row above actually executed, output recorded in `30-business-notes.md`.
2. `bun run typecheck` green for `cloud/`; root `bun run typecheck` unchanged
   (Phase 30 adds no type errors to the kernel).
3. No file under `src/` outside the two new integration points is modified in a
   way that changes existing behaviour; `src/daemon/routes/business.routes.ts` is
   byte-identical.
4. Docs: 5 business docs + README pricing statement + CHANGELOG v1.0.0 entry.
5. Screenshots into `previews/implementation/phase-30/`.
6. **No self-merge.** PR opened against `main`, @ahmadrrrtx tagged.
