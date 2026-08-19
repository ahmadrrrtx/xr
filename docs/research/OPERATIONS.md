# Research — Operations

## CLI

```bash
xr research search "query"          # provider search
xr research scrape <url>            # scrape one page
xr research crawl <url> [--max-pages N --max-depth N]   # bounded crawl
xr research map <url>               # site URL discovery
xr research extract <url> '<schema>'  # structured extraction
xr research providers               # providers + capabilities
xr research jobs                    # list research jobs
xr research job <id>                # inspect a job
xr research cancel <id>             # cancel a running job
```

The existing Stage-7 commands (`xr research "topic"`, `quick`, `deep`,
`compare`, `factcheck`, `briefing`, `plan`, `status`, `sources`, `evidence`,
`claims`, `contradictions`, `summarize`, `export`, `refresh`, `remember`,
`list`) are unchanged.

## HTTP API (`/api/v1`)

| Operation | Method + path |
| --------- | ------------- |
| search | `POST /api/research/search` |
| scrape | `POST /api/research/scrape` |
| map | `POST /api/research/map` |
| crawl (async) | `POST /api/research/crawl` → poll or stream |
| extract | `POST /api/research/extract` |
| list jobs | `GET /api/research/jobs` |
| get job | `GET /api/research/jobs/{id}` |
| cancel | `POST /api/research/jobs/{id}/cancel` |
| stream progress | `GET /api/research/stream/{id}` (SSE) |

All routes are in the API contract (OpenAPI + typed client regenerate
deterministically), schema-validated, and authenticated like every other route.

## Observability

Counters (shared metrics registry, `/api/v1/metrics`):
`xr_research_jobs_total`, `xr_research_pages_total`,
`xr_research_ssrf_blocked_total`, `xr_research_injection_detected_total`,
`xr_research_budget_exhausted_total`, `xr_research_provider_latency_ms_total`.

## Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| `no configured provider supports crawl` | Firecrawl disabled or no key. Enable `research.firecrawl.enabled` + set `FIRECRAWL_API_KEY`. |
| `SearXNG host … not in egress allowlist` | Add your SearXNG host to `security.egressAllowlist`. |
| `Firecrawl host … not in egress allowlist` | Add `api.firecrawl.dev` (or your self-host) to `security.egressAllowlist`. |
| `destination 127.0.0.1 … blocked range` | Correct — SSRF guard refused a private target. |
| `budget_exhausted` | Raise the relevant `research.*` limit or narrow the crawl. |
| job stuck `recovery_pending` after restart | Interrupted job; cancel it or start a new one. |
