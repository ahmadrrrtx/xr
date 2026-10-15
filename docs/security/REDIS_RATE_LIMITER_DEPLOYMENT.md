# XR Cloud — Redis-Backed Rate Limiting Deployment Guide (review item #7)

**Status:** Production-ready guide. The Redis limiter code
([`cloud/src/lib/ratelimit.ts`](../../cloud/src/lib/ratelimit.ts)) is
complete and tested; this document closes the deployment-doc gap noted
in `cloud/.env.example`: *"Without it, rate limits are per-process —
correct for one instance, wrong behind a load balancer."*

**References:**
- [`cloud/src/lib/ratelimit.ts`](../../cloud/src/lib/ratelimit.ts) — implementation.
- [`cloud/.env.example`](../../cloud/.env.example) — `REDIS_URL` knob.
- KNOWN_LIMITATIONS #8 (multi-tenant/enterprise identity is Phase 10).
- [`cloud/src/routes/health.ts`](../../cloud/src/routes/health.ts) — `/readyz` surfaces the live backend.

---

## 1. When you need Redis (and when you don't)

| Deployment shape | Limiter backend | Why |
|---|---|---|
| **Single process** (dev, small team, PoC) | In-memory (`RateLimiterMemory`) | One process = one counter set = correct. |
| **Single process + restart on deploy** | In-memory | Counters reset on restart, which is fine — the limits are short-window (60s–1h). |
| **2+ replicas behind a load balancer** | **Redis (required)** | N replicas = N independent in-memory limiters = N× the configured limit. An attacker gets N×10 magic-link emails per minute instead of 10. |
| **Single process but you want persistent counters across restarts** | Redis (optional) | Survives depots without resetting the abuse-prone `magicLink` / `signup` buckets. |
| **Kubernetes with HPA (auto-scaling)** | **Redis (required)** | HPA scales replicas; without Redis the effective limit scales with them. |

**Rule of thumb:** if you have ever typed `kubectl scale deployment/xr-cloud --replicas=2` (or the equivalent), you need Redis.

## 2. Provisioning Redis

### Option A — Managed Redis (recommended for production)

| Provider | SKU | Notes |
|---|---|---|
| **Upstash** | Redis Premium (any tier) | Serverless, pay-per-request. Smallest team tier (~$1/mo) is enough for XR Cloud's traffic. Supports TLS. |
| **Redis Cloud** | Essential (25MB) | Fully managed by Redis Inc. Free tier covers a small team. |
| **AWS ElastiCache** | `cache.t3.micro` (Redis cluster mode off) | VPC-only; add a NAT gateway or VPC endpoint if XR Cloud runs outside the VPC. ~$11/mo. |
| **GCP Memorystore** | `Basic M1` (1GB) | VPC-only; same NAT consideration. ~$35/mo. |
| **Azure Cache for Redis** | `Basic C0` (250MB) | ~$16/mo. |

**TLS:** always enable in production. XR Cloud's `REDIS_URL` accepts
`rediss://` (note the double `s`) for TLS. Self-signed certs require
setting `REDIS_TLS_REJECT_UNAUTHORIZED=0` — do this only if you've
verified the self-signed cert out-of-band (e.g., internal CA).

### Option B — Self-hosted Redis (Docker Compose)

For a single-VM deployment that still wants Redis:

```yaml
# docker-compose.yml excerpt
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --save 60 1 --loglevel warning
    volumes:
      - redis-data:/data
    # Do NOT expose 6379 to the public internet. XR Cloud reaches it
    # via the Docker network.
    expose:
      - "6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  xr-cloud:
    # ... your existing xr-cloud service ...
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      redis:
        condition: service_healthy

volumes:
  redis-data:
```

### Option C — Self-hosted Redis (systemd on a VM)

```bash
# Debian/Ubuntu
sudo apt install redis-server
sudo sed -i 's/^bind .*/bind 127.0.0.1/' /etc/redis/redis.conf
sudo sed -i 's/^# requirepass .*/requirepass <openssl rand -base64 32>/' /etc/redis/redis.conf
sudo systemctl enable --now redis-server

# Verify
redis-cli -a <password> ping  # → PONG
```

Set `REDIS_URL=redis://:<password>@127.0.0.1:6379` in XR Cloud's env.

**Do NOT expose Redis to the public internet.** Bind to 127.0.0.1 (or a
private interface) and run XR Cloud on the same host (or reach it via
private network / WireGuard).

## 3. Configuring XR Cloud

Set one environment variable:

```bash
# .env (production)
REDIS_URL=rediss://<user>:<password>@<host>:<port>
```

That's it. XR Cloud's `createRateLimiter()` (in
`cloud/src/lib/ratelimit.ts`) detects `REDIS_URL` at boot, creates an
`ioredis` client with bounded retry strategy, and switches every
limiter in `LIMITS` to `RateLimiterRedis`. If the connection fails at
boot, it falls back to in-memory and logs the fallback — see §5.

### Tunable limits

The limit values are in `LIMITS` (in `ratelimit.ts`). They are
deliberately not env-var-driven — changing a rate limit is a security
decision, not an ops knob. To change one, open a PR editing `LIMITS`
and document the reason in the commit message.

| Limit | Default | Window | Fail-open / closed |
|---|---|---|---|
| `magicLink` | 10 | 60s | **closed** (per email AND per IP) |
| `signup` | 5 | 60s | **closed** |
| `login` | 20 | 60s | **closed** |
| `authGeneral` | 60 | 60s | **closed** |
| `api` | 600 | 60s | open |
| `export` | 5 | 3600s | **closed** |
| `models` | 300 | 60s | open |
| `invite` | 30 | 3600s | **closed** |
| `relayConnect` | 30 | 60s | **closed** |

**Why fail-closed for auth:** an attacker who can spam magic-link
emails costs you money AND can lock out a victim's email. Better to
lock the bucket (and surface the outage) than to under-limit.

**Why fail-open for API/models:** a Redis blip should NOT lock every
user out of the product. The in-memory fallback under-limits briefly;
the `degraded` flag surfaces in `/readyz` so ops can react.

## 4. Verifying it works

### Boot check

`/readyz` reports the live limiter backend:

```bash
curl -s https://api.your-xr.cloud/readyz | jq .rateLimiter
```

```json
{
  "backend": "redis",
  "degraded": false
}
```

If `backend` is `"memory"` in a multi-replica deployment, **stop and
fix Redis before relying on the rate limits**. The `/readyz` endpoint
also returns 503 when `degraded: true`, so your load balancer should
pull the instance out of rotation when it sees 503.

### Live check

Send a burst of magic-link requests and confirm the 11th gets a 429:

```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://api.your-xr.cloud/auth/magic-link \
    -H "content-type: application/json" \
    -d '{"email":"test+burst@example.com"}'
done
# Expected: 200, 200, ... (10×), then 429, 429
```

The 429 response includes a `retry-after` header (seconds until the
bucket refills) and a JSON body with a `repair` string explaining the
limit.

### Redis-side check

Confirm the keys exist:

```bash
redis-cli -a <password> KEYS "xr:rl:*" | head
# Expected: xr:rl:magicLink:<email-hash>, xr:rl:api:<ip>, etc.
```

The key format is `xr:rl:<limitName>:<key>` (e.g.,
`xr:rl:magicLink:test+burst@example.com`). Keys TTL on their own per
the `duration` in `LIMITS`.

## 5. What happens when Redis goes down

The rate limiter is designed to degrade gracefully:

1. **Connection drops mid-request:** `ioredis` retries up to
   `maxRetriesPerRequest: 2` (2 × 200ms backoff). If still unreachable,
   the request throws.
2. **The throw is caught** in `consume()`. The limiter checks the
   `onBackendError` policy for that bucket:
   - **fail-closed** (auth, signup, export, invite, relay): returns
     `{ allowed: false, degraded: true, retryAfterSeconds: 30 }`. The
     user gets a 429 with a "rate limit degraded, retry in 30s" repair
     string.
   - **fail-open** (api, models): returns
     `{ allowed: true, degraded: true }`. The request proceeds; the
     in-memory fallback is NOT used (the limiter just lets it through).
3. **The `degraded` flag flips to true** on the first error and stays
   true until `ioredis` emits `ready`. `/readyz` reflects this; your
   LB should pull the instance.
4. **Logs:** a single `warn` line per degradation episode (not per
   request) — `redis unavailable — rate limiting degraded` with the
   error detail. Recovery logs at `info` level.

**What you should do:** alert on `/readyz` returning 503 or
`degraded: true` for >60s. Page the on-call if it's >5min — that
means Redis is properly down, not just blipping.

## 6. Monitoring

### Prometheus metrics (if you scrape XR Cloud)

The `/metrics` endpoint exposes (among others):

```
xr_cloud_rate_limiter_backend{backend="redis|memory"} 1
xr_cloud_rate_limiter_degraded 0|1
xr_cloud_rate_limit_blocked_total{limit="magicLink"} <counter>
xr_cloud_rate_limit_allowed_total{limit="magicLink"} <counter>
```

Alert rules (suggested):

```yaml
# Redis down for >60s
- alert: XRCloudRedisDown
  expr: xr_cloud_rate_limiter_degraded == 1
  for: 1m
  labels: { severity: page }
  annotations:
    summary: "XR Cloud rate limiter degraded (Redis unreachable)"

# Backend is memory in a multi-replica deployment
- alert: XRCloudRedisNotConfigured
  expr: xr_cloud_rate_limiter_backend{backend="memory"} == 1 and on() xr_cloud_replicas > 1
  for: 5m
  labels: { severity: ticket }
  annotations:
    summary: "XR Cloud running without Redis behind a load balancer — rate limits are per-process"

# Spike in blocked magic-link attempts (possible abuse)
- alert: XRCloudMagicLinkAbuse
  expr: rate(xr_cloud_rate_limit_blocked_total{limit="magicLink"}[5m]) > 5
  for: 2m
  labels: { severity: ticket }
  annotations:
    summary: "Sustained magic-link rate-limit hits — possible sign-in abuse"
```

### Logs

Every rate-limit decision is logged at `debug` level (not `info` — too
noisy for production). The degradation episode is logged at `warn`.
Set `LOG_LEVEL=debug` only when diagnosing; revert to `info` for
normal operations.

## 7. Multi-region considerations

KNOWN_LIMITATIONS #8 honestly records that multi-tenant / HA profiles
are Phase 10. **Today, XR Cloud is single-region.** If you deploy
multi-region:

- Each region needs its own Redis (Redis is not multi-region without
  clustering or replication, which is out of scope here).
- A user in region A hitting region B's API will see region B's limits.
  This is fine for abuse-prone limits (magic-link, signup) but
  surprising for generous limits (api, models).
- **Recommended:** pin users to a region via DNS / latency-based
  routing, and treat each region as independent for rate-limiting
  purposes.

## 8. When you can drop Redis

If you scale back to a single instance (e.g., a small team that
doesn't need HA), you can unset `REDIS_URL`. The limiter falls back
to in-memory on the next boot. No data migration is needed — Redis
keys TTL on their own and are not consulted after the fallback.

## 9. Closure

This document closes review item #7 (cloud is single-instance-oriented;
add Redis-backed rate limiting to the deployment guide). The code was
already complete; the gap was operational guidance. With this doc:

- Operators have a decision tree (§1) for when to enable Redis.
- Operators have provisioning recipes (§2) for managed + self-hosted.
- Operators have verification steps (§4) to confirm Redis is actually
  being used.
- Operators have a degradation runbook (§5) for when Redis blips.
- Operators have monitoring rules (§6) to alert on degradation.

KNOWN_LIMITATIONS #8 (multi-tenant/enterprise identity is Phase 10)
remains open — Redis solves the rate-limit-consistency problem, not
the SAML/OIDC SSO / SCIM / HA problem. Those are still Phase 10.
