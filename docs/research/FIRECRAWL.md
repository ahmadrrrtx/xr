# Research — Firecrawl

Firecrawl is an **optional provider** for XR research. It is OFF by default and
never required: SearXNG + direct fetch keep research functional without it.

## Configuration

```jsonc
// ~/.xr/config.json
{
  "research": {
    "firecrawl": {
      "enabled": true,                         // default false
      "baseUrl": "https://api.firecrawl.dev",  // v1 base (self-host supported)
      "apiKeyEnv": "FIRECRAWL_API_KEY",        // key comes from env/keychain, never config
      "timeoutMs": 30000,
      "maxPages": 20,                          // per-crawl page ceiling
      "maxDepth": 2,
      "maxConcurrency": 2
    }
  }
}
```

The API key is resolved from the environment variable named by `apiKeyEnv`
(loaded by the existing secret system — OS keychain or `~/.xr/.env`). It never
appears in config JSON, logs, audit records, citations, SSE events, or model
context.

Set the key:

```bash
# one of:
export FIRECRAWL_API_KEY=fc-...
xr secrets set FIRECRAWL_API_KEY   # (if available in your build)
```

## Endpoints used (v1, verified against the 2026 public reference)

| Operation | Endpoint |
| --------- | -------- |
| search    | `POST /v1/search` |
| scrape    | `POST /v1/scrape` |
| crawl     | `POST /v1/crawl` (async → job id) |
| status    | `GET /v1/crawl/{id}` |
| cancel    | `DELETE /v1/crawl/{id}` |
| map       | `POST /v1/map` |
| extract   | `POST /v1/extract` (urls + schema) |

## Egress

The Firecrawl host must be in the egress allowlist:

```jsonc
{ "security": { "egressAllowlist": ["searx.be", "api.firecrawl.dev", "…"] } }
```

No wildcard. The Firecrawl API call itself flows through `guardedFetch`
(connection-time SSRF + pinning + redirect revalidation + byte cap) like every
other XR egress target. Target URLs handed to Firecrawl are additionally
validated by `assertResearchSafeUrl` before being sent.

## Costs

Firecrawl crawls/extracts bill per page/credit. XR bounds every operation with
`maxPages`, `maxDepth`, `maxRequests`, `maxBytes`, and `maxDurationMs`, and the
runner stops truthfully (`budget_exhausted`, partial results preserved) — it
never lets a crawl run away and consume unbounded credits.

## Live integration tests

Live Firecrawl tests require a real API key and are NOT part of the default
suite (offline tests mock `guardedFetch`). They are intentionally out of scope
until a key is provisioned for CI; the adapter's translation layer is covered
by `test/research/firecrawl.test.ts`.
