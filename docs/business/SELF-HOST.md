# SELF-HOST

Running the XR control plane yourself. The cloud service is a normal web
application: Postgres, Redis, an HTTP port, and a `.env`. Nothing about it is
proprietary, and a self-hosted deployment is a first-class configuration rather
than a debug mode.

- Code: `cloud/` (Bun + Hono + Drizzle)
- Compose file: `cloud/docker-compose.yml`
- Image: `cloud/Dockerfile`
- Smoke test: `cloud/scripts/smoke.ts`

> **What is verified where.** The compose stack, the Stripe CLI flow, a real IdP
> and a real S3/R2 bucket were **not** run in the environment this release was
> built in — that sandbox has no Docker, no `stripe` binary and no outbound network.
> What *was* run there: the migration runner (idempotent, twice), the boot and
> `/readyz` path against PGlite, the smoke test (7/7), the full route surface, and
> 28 auth tests plus the licence tests. The rows marked **operator-verified** below
> are steps a human runs on a machine that has Docker; nothing in this document
> claims they were executed automatically.

## 1. Five-minute path (Docker)

```bash
git clone https://github.com/ahmadrrrtx/xr && cd xr/cloud
cp .env.example .env          # then edit the four required values
docker compose up -d
docker compose logs -f api
curl -fsS http://localhost:8787/readyz | jq
```

The compose file brings up three services:

| Service | What it is | Notes |
| --- | --- | --- |
| `postgres` | PostgreSQL 16 | Healthchecked with `pg_isready`; data in a named volume |
| `redis` | Redis 7 | `--appendonly`, for rate-limit buckets |
| `migrate` | One-shot | Runs `bun run src/db/migrate.ts`, then exits 0 |
| `api` | The service | Gated on `postgres` being healthy **and** `migrate` completing (`service_completed_successfully`) |

The `api` service does **not** start before migrations finish. That single line is
the difference between a first deploy that works and one that 500s until someone
runs a command they have to be told about.

No Docker? §7 runs it directly on Bun, and §8 runs it on Postgres without Redis.

## 2. Required configuration

Four values have no safe default. `assertBootable()` refuses to start without them
rather than inventing one.

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | `postgres://user:pass@host:5432/xr_cloud`. Required when `DATABASE_DRIVER=postgres` |
| `JWT_SECRET` | ≥ 32 characters. Generate with `openssl rand -base64 48` |
| `XR_KEY_ENCRYPTION_KEY` | **Exactly 32 bytes, base64.** Generate with `openssl rand -base64 32`. This is the KEK: lose it and team memory is unreadable |
| `APP_URL` | The console origin. **This is the only allowed CORS origin** and the base of every link in an email |

Everything else has a documented default. The ones an operator actually touches:

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_URL` | `http://localhost:8787` | Public base URL. SSO entity IDs and ACS URLs are derived from it |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Bind address |
| `DATABASE_DRIVER` | `postgres` | `pglite` for a single-process dev instance |
| `PGLITE_DIR` | `.xr-cloud-pglite` | Data directory when `DATABASE_DRIVER=pglite` |
| `REDIS_URL` | — | Rate limiting. Unset = in-process buckets (fine for one node) |
| `SESSION_ACCESS_TTL_SECONDS` | `900` | Access-token lifetime. Do not raise this above 3600 |
| `SESSION_REFRESH_TTL_DAYS` | `30` | Refresh lifetime; sliding, rotated on use |
| `COOKIE_DOMAIN` | — | Set only when the console and API share a parent domain |
| `TRUST_PROXY` | `false` | **Read §6 before turning this on** |
| `LOG_LEVEL` | `info` | `pino` level |
| `TRIAL_DAYS` / `TRIAL_MAX_SEATS` | `30` / `5` | Trial length and seat cap |
| `MAIL_TRANSPORT` | `capture` | `capture` writes `.eml` files to `MAIL_CAPTURE_DIR`; use `smtp` or `postmark` in production |
| `MAIL_FROM` | — | Envelope sender; required for any transport other than `capture` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_SECURE` | — | SMTP transport |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO_SEAT_MONTHLY`, `STRIPE_PRICE_ID_PRO_SEAT_ANNUAL` | — | Billing. **Unset = billing disabled, everything else works** (§5) |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_FORCE_PATH_STYLE` | — | Audit export storage. Works with Cloudflare R2 (`S3_FORCE_PATH_STYLE=true`) or any S3 API. Unset = export assembles the file and streams it instead of storing it |
| `XR_LICENSE_PRIVATE_KEY` | — | Ed25519 private key (PKCS#8, base64) used to mint licences. **Unset = the service runs and refuses to issue licences**, with a `misconfigured` check on `/readyz` |
| `XR_LICENSE_KID` | `xr-lic-1` | Key id, matched by the client before it verifies |

`cloud/.env.example` documents each one in place.

## 3. Licence keypair

The client verifies licences **offline** against a public key compiled into the
binary. To run your own control plane you generate your own pair and rebuild the
client with your public half (or set `XR_LICENSE_PUBLIC_KEY_SPKI` in the client's
environment).

```bash
cd cloud
bun run license:keypair        # writes nothing; prints the two values
```

The script prints:

- `XR_LICENSE_PRIVATE_KEY` — PKCS#8, base64. **Server only. Never in the client.**
- the SPKI public key, base64 — this is what goes into `src/cloud/license.ts` or the
  client's `XR_LICENSE_PUBLIC_KEY_SPKI`.
- a `kid` derived from the public key.

Licences are Ed25519 JWTs, audience `xr-desktop`, with a 24-hour `exp`. The client
refreshes them opportunistically and keeps working for **30 days** past expiry, so a
control plane that is down does not turn into a dead product.

## 4. Migrations

```bash
bun run db:generate      # diff the schema, write drizzle/000N_*.sql (dev)
bun run db:migrate       # apply (what the compose `migrate` service runs)
bun run db:studio        # inspect (dev)
bun run src/db/migrate.ts --status   # what is applied, what is pending
```

- Migrations run inside a transaction **per file**, and a failure names the file and
  rolls back that file only.
- Applied files are recorded in `xr_cloud_migrations`, and that journal is the
  **only** source of idempotency — the runner never swallows "already exists".
- Verified idempotent: applied to a fresh database, then applied again and reported
  `nothing to do — schema is up to date`.
- Take a snapshot before a deploy. The runner is careful, not magic.

## 5. Billing: three states

| `STRIPE_*` | Behaviour |
| --- | --- |
| All four set | Full self-serve billing. Point a Stripe webhook at `POST /billing/webhooks/stripe` for the seven events in `docs/business/BILLING.md` §11 |
| Unset | `/billing/*` returns `available: false` with a repair message naming `STRIPE_SECRET_KEY`. `/license/me` still answers for free organizations. Trials cannot be started, but nothing 500s |
| Partially set | **Refuses to start.** A half-configured payment integration is a liability; `assertBootable` treats it as `misconfigured` |

For local development with the real Stripe API:

```bash
stripe listen --forward-to localhost:8787/billing/webhooks/stripe   # operator-verified
```

Test mode with card `4242 4242 4242 4242` and any future expiry. **No card data
reaches this service** in any configuration: checkout and the customer portal are
Stripe-hosted, and the only billing values stored are a customer id, a subscription
id, and price ids.

## 6. `TRUST_PROXY`, and why the default is off

When `TRUST_PROXY=1`, `x-forwarded-for` and `x-real-ip` are trusted for the client
address used by rate limiting and audit entries. When it is `0` (the default),
**only the peer address is used**.

This is not fussiness. Honouring a forwarded header without a proxy in front means
any caller can send a different value on every request and bypass every IP-based
limit — sign-in, sign-up, invitations, everything. Turn it on **only** when the
service is definitely behind a proxy you control, and prefer that the proxy
overwrites the header rather than appending to it.

Compose sets `TRUST_PROXY=1` because the compose network is the boundary. A bare
`bun run start` on a public interface should leave it off.

## 7. Running without Docker

```bash
cd cloud
bun install
cp .env.example .env
bun run typecheck && bun test
DATABASE_DRIVER=pglite bun run src/index.ts        # no Postgres needed
curl -fsS localhost:8787/readyz
```

PGlite is the embedded Postgres build. It is genuinely useful — the entire test
suite runs on it — and it is **not** a production database: one process, one
writer, no connection pool. Use it to evaluate, and Postgres to operate.

## 8. Operating it

### Health

| Endpoint | Answers |
| --- | --- |
| `GET /healthz` | Process liveness. 200 while the process is running; no dependencies checked |
| `GET /readyz` | Real readiness: `{ok, checks, at, note}`. Each check reports `ready`, `disabled` (deliberately unconfigured) or `misconfigured`. **Only `database` drives the status code**, because a missing Stripe key should not take an instance out of rotation |

A `disabled` check is not a failure. A mail transport in `capture` mode, Stripe
without keys, and blob storage without a bucket are all valid configurations, and
`/readyz` says so instead of failing a load balancer.

### Availability targets (for operators, not a customer SLA)

| | |
| --- | --- |
| Recovery time objective | 1 hour |
| Recovery point objective | 24 hours (daily snapshot) |
| Backups | `pg_dump` nightly, plus the platform's snapshot; **restore tested before go-live** |
| Rollback | Redeploy the previous image; migrations are additive, so the previous image runs against the new schema |

Restore drill, once per environment:

```bash
pg_dump "$DATABASE_URL" > backup.sql
createdb xr_restore && psql xr_restore < backup.sql
DATABASE_URL=postgres://…/xr_restore bun run src/db/migrate.ts --status   # expect: nothing to do
```

### What has to be backed up

1. **Postgres** — everything except the KEK.
2. **`XR_KEY_ENCRYPTION_KEY`** — in a secret manager, not in the database and not in
   the backup. Without it, team memory is unrecoverable; with it in the same place
   as the dump, the encryption stops meaning anything.
3. **`JWT_SECRET`** — losing it invalidates every session (annoying, not fatal).
4. **`XR_LICENSE_PRIVATE_KEY`** — losing it means every licence you ever issued
   expires permanently; nothing can re-mint them.

### Upgrades

```bash
git pull && docker compose build && docker compose up -d
```

The `migrate` service runs first, `api` follows. Migrations are additive: the
previous image keeps working against the new schema, so a rollback is a redeploy
rather than a restore.

## 9. Multi-node

The service is stateless apart from Postgres and Redis, so it scales horizontally
with three caveats:

1. **Set `REDIS_URL`.** In-process rate-limit buckets are per node, so with three
   nodes a "10 per minute" limit is really 30.
2. **Sessions are JWTs**, so any node can serve any request; the refresh token is
   in Postgres, not in memory.
3. **The relay hub is in-process.** WebSocket rooms do not span nodes without a
   shared pub/sub; run one relay node, or sticky-route `/relay/ws`, until that is
   built.

## 10. Post-deploy checklist

```bash
curl -fsS  "$API/healthz"
curl -fsS  "$API/readyz" | jq '.checks | map({name, state})'
curl -fsS  "$API/.well-known/security.txt"
curl -fsS  "$API/.well-known/xr-license-pubkey"      # expect keys: 1 once the private key is set
```

Then, by hand:

- [ ] Sign up, and receive a magic link (check the `capture` directory, or the inbox)
- [ ] Create an organization, invite a second address, accept the invitation
- [ ] Confirm `/dashboard` renders and `/dashboard/billing` shows the trial, if Stripe is configured
- [ ] Confirm `/dashboard/sso` renders the SAML metadata with the **right** entity ID and ACS URL
- [ ] Run `bun run scripts/smoke.ts` against the deployment
- [ ] Confirm `pg_dump` runs and a restore into a scratch database works

## 11. What is deliberately not here

- **No Kubernetes, Helm or Terraform.** Compose and a Dockerfile. Anyone who wants
  more can write it against the image.
- **No multi-region or read replicas.**
- **No SCIM, no HRIS integration.**
- **No on-premise delivery programme beyond this document** — building it is not
  supported, running the compose file is.
- **No fine-tuning, no model hosting.** Managed models are a passthrough to the
  provider; the providers in v1.0.0 are OpenAI (GPT-4.1, GPT-4o, o1, o3-mini),
  Anthropic (Claude Sonnet 4.5, Opus, Haiku) and Google (Gemini 2.5 Pro, Flash).
