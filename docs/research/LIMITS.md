# Research — Limits & budget

## Bounded limits (a missing limit never means infinite)

| Limit | Config key | Default |
| ----- | ---------- | ------- |
| max pages | `research.maxPages` | 20 |
| max depth | `research.maxDepth` | 2 |
| max concurrency | `research.maxConcurrency` | 3 |
| max requests | `research.maxRequests` | 50 |
| max bytes | `research.maxBytes` | 4 MiB |
| max duration | `research.maxDurationMs` | 120 s |
| Firecrawl per-crawl pages | `research.firecrawl.maxPages` | 20 |
| Firecrawl per-crawl depth | `research.firecrawl.maxDepth` | 2 |

`src/research/budget.ts` (`ResearchRunBudget`) tracks pages / requests / bytes /
tokens / wall-clock and stops truthfully. Cancellation (AbortController) is
also a truthful stop reason.

## Truthful outcomes

- Budget/limit exhaustion → state `budget_exhausted` (with partial results),
  never a generic `failed`.
- Some pages succeeded, some failed → state `partial`, with citations for the
  successful sources.
- Cancelled → state `cancelled`; the provider-side crawl is also cancelled.

## Never unbounded

- Crawls require `maxPages` and `maxDepth` (defaults applied when unspecified).
- No whole-internet crawl, no infinite recursion, no runaway Firecrawl bill.
- Duplicate pages are collapsed by canonical URL + content hash.

## CLI overrides

```bash
xr research crawl "https://example.com" --max-pages 5 --max-depth 1
```
