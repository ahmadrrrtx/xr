# Research — Providers

## Capability matrix

| Capability | SearXNG | Direct fetch | Firecrawl |
| ---------- | ------- | ------------ | --------- |
| search     | ✓ | — | ✓ |
| scrape     | — | ✓ | ✓ |
| crawl      | — | — | ✓ |
| map        | — | — | ✓ |
| extract    | — | — | ✓ |

Capability discovery is runtime truth: `provider.capabilities()` decides what a
provider is asked to do. Selection never assumes.

## Selection + fallback

`src/research/providers/pool.ts` orders providers per capability:

1. explicit preference (none today),
2. fewer recorded failures first.

The runner (`src/research/runner.ts`) tries providers in order and falls back
on **retryable** failures (`rate_limit`, `timeout`, `unavailable`,
`network_failure`). Non-retryable failures (`authentication_failure`,
`invalid_request`, `ssrf_blocked`, `policy_denied`, `budget_exhausted`,
`invalid_schema`, `unsupported_capability`) stop immediately — security
failures are never retried.

## When Firecrawl is not configured

SearXNG + direct fetch remain available. If no provider supports a requested
capability, the job fails truthfully with
`no configured provider supports <capability>` — success is never faked.

## Adding a provider

Implement `ResearchProvider` (`src/research/providers/types.ts`), translate
your wire format into `ResearchSource`/`ResearchPage` (`provider-types.ts`),
validate every target URL via `ctx.assertUrl`, make every outbound call via
`guardedFetch`, and register it in `buildResearchPool`
(`src/research/factory.ts`). Do not import your provider's types anywhere else.
