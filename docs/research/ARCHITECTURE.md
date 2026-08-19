# Research — Architecture

See `docs/research/PHASE-10-WEB-RESEARCH-ARCHITECTURE.md` for the full verified
architecture record. This file is the compact map.

## Pipeline

```
user / model
  ↓ capability request (research.search / scrape / crawl / map / extract)
ToolRegistryService (capability registry) → Policy → Approval → Budget
  ↓ egress (guardedFetch) + SSRF (url-guard → private-ip tables)
Research provider pool (SearXNG | DirectFetch | Firecrawl)
  ↓ normalized ResearchSource / ResearchPage
dedupe + domain policy + verification
  ↓ citations + provenance
ResearchJob (durable, cancellable, streamable)
```

## Modules

| Module | Responsibility |
| ------ | ------------- |
| `src/research/provider-types.ts` | Normalized domain model (sources, citations, limits, jobs, states, errors, stream events). |
| `src/research/providers/types.ts` | `ResearchProvider` interface + `ResearchProviderContext` (capability discovery, budget, assertUrl). |
| `src/research/providers/pool.ts` | Provider pool: capability-aware selection + deterministic fallback. |
| `src/research/providers/searxng.ts` | SearXNG search adapter (guardedFetch + JSON API). |
| `src/research/providers/direct-fetch.ts` | Direct public-web scrape + `fetchPublicUrl` (redirect-revalidating SSRF-safe fetch). |
| `src/research/providers/firecrawl.ts` | Firecrawl adapter (search/scrape/crawl/map/extract, async jobs, schema validation). |
| `src/research/url-guard.ts` | Research target URL validation (composes `normalizeHost` + `isBlockedAddress` + DNS), domain policy, canonicalization/dedupe. |
| `src/research/citations.ts` | Formal citations + content hash + verification states (never fabricates). |
| `src/research/jobs.ts` | Durable, cancellable job registry (in-memory + `research_jobs` table). |
| `src/research/runner.ts` | Operation runner: fallback, retry classification, budget, cancellation, streaming. |
| `src/research/budget.ts` | `ResearchRunBudget` (pages/requests/bytes/duration) + existing cost governors. |
| `src/research/content-guard.ts` | Prompt-injection scan + untrusted-data framing (reuses `frameToolOutput`). |
| `src/research/observability.ts` | Research counters via the shared metrics registry. |
| `src/research/tools.ts` | Core tools `research_*` (model-facing capabilities). |
| `src/daemon/routes/research.routes.ts` | `/api/v1/research/*` operations, jobs, cancellation, SSE stream. |

## Invariants

1. **One execution path** — CLI, tools, and API all go through `runResearchOperation`.
2. **Firecrawl is a provider, never an authority** — every target URL is validated by XR before being handed to it, and every XR-originated HTTP call goes through `guardedFetch`.
3. **No duplicate architecture** — SSRF range tables, egress proxy, audit, metrics, and memory/provenance are all the existing centralized systems.
4. **Truthful states** — `completed | partial | cancelled | failed | budget_exhausted | recovery_pending`; partial results are never discarded.
