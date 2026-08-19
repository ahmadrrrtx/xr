# Phase 10 — Web Research / Firecrawl: Architecture

**Status:** implemented (offline-verifiable; live-provider tests marked `integration`).
**Date:** 2026-08-19
**Repo state verified against:** `main` @ `70a48a7` (Phase 09 merged; 518+ `src` TS files, Bun 1.3.14, `zod` only runtime dep).

This document is the architecture record for Phase 10. It was written **after** inspecting the
actual repository (not from the phase brief), so every "present"/"missing" claim below is verified.

---

## 3.1 Current XR web architecture (verified)

| Piece | Location | What it actually does today |
| ----- | -------- | --------------------------- |
| `web_search` tool | `src/tools/web.ts` | SearXNG JSON search (`XR_SEARXNG` env, default `https://searx.be`), egress-gated via `guardedFetch`. |
| `fetch_url` tool | `src/tools/web.ts` | Fetch one allow-listed page, `htmlToText`, 4k char clip. |
| `check_package` tool | `src/tools/web.ts` | npm/pypi latest-version lookup, egress-gated. |
| Egress gate | `src/tools/egress.ts` (`hostAllowed`) + `src/security/egress-proxy.ts` (`guardedFetch`, `checkEgressTarget`) | **Centralized** connection-time enforcement: parse → allow → resolve → block private/link-local/metadata → pin → redirect revalidation → byte cap. |
| Private-IP blocking | `src/security/private-ip.ts` (`isPrivateIpv4/6`, `isBlockedAddress`, `blockedRangeLabel`) | RFC1918, loopback, link-local, `169.254.169.254`, CGNAT, IPv6 ULA/link-local/multicast/mapped, reserved. |
| Host canonicalization | `src/security/guard.ts` (`normalizeHost`) | Collapses dotted/hex/octal/int/IPv6 literal forms. |
| Research engine (Stage 7) | `src/research/*.ts` | `runResearch`: plan → SearXNG discover → rank → fetch → extract → synthesize; sources/evidence/claims/contradictions; budget guards; CLI (`xr research …`); markdown report + SHA-256 signature. |
| Research search/fetch | `src/research/search.ts` (`WebSearchCapability`) | SearXNG via `webSearchTool`; direct public fetch only with `--allow-public-web`, with its **own local** `assertPublicHostname`/`isPublicIp*` (duplicate of `private-ip.ts` — consolidated in this phase). |
| Research budget | `src/research/budget.ts` | `GovernedResearchBudget` (CostGovernor) + `LocalResearchBudget` (step cap). |
| Tool registry | `src/tools/registry-service.ts`, `registry-builder.ts`, `registry.ts` | ONE registration/discovery authority; namespaced ids; collision arbitration; Phase-08 lifecycle/trust/scope/permission metadata. |
| Capability system | `src/capabilities/*` | Descriptor model (`Capability`), policy, discovery, provenance; derived from the registry. |
| MCP | `src/mcp/*` | Signed Ed25519 default-deny allowlist; `McpManager`; tool-description injection scan. |
| Memory/context | `src/context/*` | Phase 09: provenance, conflict resolution, integrity, consent; research "remember" already links provenance. |
| Audit | `src/state/workspace-store.ts` (`audit`, hash-chained) | Tamper-evident append-only log with secret redaction. |
| Retry classification | `src/providers/errors.ts` | `ProviderError` + `isRetryableKind` (429/timeout/5xx/network → retryable; auth/invalid/blocked → not). |
| Daemon research surface | `src/daemon/routes/system.routes.ts` (`research.list`, `research.get`) | Read-only listing/inspection of persisted `ResearchSession` blobs. |
| Metrics | `src/observability/metrics.ts` | `registerMetric` + `xrMetrics` (counters/histograms, budgeted cardinality, redaction). |

## 3.2 Verified gaps (what Phase 10 must add)

Confirmed by inspection:

| Gap | Verified? | Evidence |
| --- | --------- | -------- |
| No crawl capability | **missing** | no `crawl` anywhere in `src/research` or tools |
| No map capability | **missing** | no `map` symbol in `src/research` |
| No Firecrawl provider/adapter | **missing** | no `firecrawl` string in `src/` (only in docs) |
| No provider abstraction for research | **missing** | `WebSearchCapability` is the only "provider"; `runResearch` hard-codes it |
| No formal citation model | **missing** | citations are `[s1]` inline ids in prose; no `ResearchCitation` type, no locator/excerpt/hash |
| No source identity beyond `Source` | **partial** | `Source.metadata` has url/domain/contentType, but no canonicalUrl enrichment, author, publishedAt, contentHash, wordCount, language |
| No research jobs / async crawl | **missing** | `runResearch` is a single awaited call; no job registry, no cancellation |
| No parallel research | **missing** | engine is strictly sequential |
| No crawl limits / domain restrictions | **missing** | only depth budgets (`maxQueries/maxSources/maxFetched`) |
| No per-run budget counters (pages/bytes/duration) | **partial** | only $ + step caps |
| No SSE progress for research | **missing** | CLI prints only |
| No research API beyond list/get | **verified** | only `research.list`/`research.get` in contract |
| No research capability registration | **missing** | `coreToolContributions()` has `web_search`/`fetch_url` but no `research.*` |
| Duplicate SSRF check | **present** | `src/research/search.ts` `assertPublicHostname`/`isPublicIp*` duplicates `src/security/private-ip.ts` |
| Prompt-injection scan of web content | **partial** | `scanUntrusted`/`frameToolOutput` exist and are applied to tool results; research engine does not frame fetched page text |

## 3.3 Provider comparison (capability × provider)

| Capability      | SearXNG | Direct fetch | Firecrawl (self-host or cloud) |
| --------------- | ------- | ------------ | ------------------------------ |
| Search          | ✓ (JSON API) | — | ✓ `/search` |
| Scrape          | — | ✓ (guardedFetch + HTML→text) | ✓ `/scrape` (markdown, metadata, links) |
| Crawl           | — | — | ✓ `/crawl` (async job) |
| Map             | — | — | ✓ `/map` |
| Extraction      | — | — | ✓ `/extract` (schema) |
| JS pages        | — | — | ✓ (rendering backend) |
| Structured data | — | — | ✓ (schema-validated extract) |
| Citations       | title+url+snippet | title+url+retrievedAt | title+url+publishedAt+retrievedAt |
| Async jobs      | — | — | ✓ (job id + status polling) |
| Cost            | free (self-host) | free | metered API credits |
| Reliability     | instance-dependent | network-dependent | managed, rate-limited |

Firecrawl is a **provider**, not a security boundary: every URL it is asked to touch still passes XR's
URL/SSRF validation, every response is normalized into XR's internal model, and its API key never enters
model context, audit, logs, or citations.

## 3.4 Security model

```
Model
  ↓  capability request  (ToolRegistryService: research.search / research.scrape / …)
  ↓  Policy              (capability permission network.search|network.fetch, mode scoping, egress allowlist)
  ↓  Approval            (tools are read-only; approval for writes/shell unchanged)
  ↓  Budget              (pages / requests / bytes / duration / cost — job stops truthfully at exhaustion)
  ↓  Egress              (guardedFetch + checkEgressTarget for every XR-originated HTTP call)
  ↓  Provider            (SearXNG | DirectFetch | Firecrawl)
  ↓  External website    (untrusted DATA: injected-scan + framing before model context)
```

**Where SSRF protection applies (exactly):**

1. **Any XR-originated request** (SearXNG query, Firecrawl API call, direct scrape) goes through
   `guardedFetch`, whose `checkEgressTarget` blocks private/link-local/metadata ranges **at connection
   time** and revalidates every redirect. No research code calls raw `fetch`.
2. **Any target URL handed to a provider** (Firecrawl scrape/crawl/map/extract, direct scrape) is first
   validated by `src/research/url-guard.ts` (`assertResearchSafeUrl`), which reuses the centralized
   `normalizeHost` + `isBlockedAddress` + DNS resolution: private IPs, loopback, link-local,
   `169.254.169.254`, IPv6 ULA/link-local, and redirect-to-private targets are all refused **before**
   the provider is asked to touch them. This is URL validation, not a second SSRF proxy — the actual
   connection-time boundary remains `guardedFetch`/`checkEgressTarget`.
3. **Content returned by providers** is untrusted data: it is scanned (`scanUntrusted`) and framed
   (`frameToolOutput`) before it can reach model context, and it is never treated as instruction.

### Consolidation (no duplicate architecture)

- `src/research/search.ts` local `assertPublicHostname`/`isPublicIp*` (a duplicate SSRF check) is removed;
  direct fetch now uses `url-guard.ts` → `security/private-ip.ts`.
- No new egress proxy, no new private-IP table, no new citation store, no new audit chain, no new
  metrics registry. Research reuses `guardedFetch`, `checkEgressTarget`, `isBlockedAddress`,
  `frameToolOutput`, `store.audit`, `registerMetric`, and `ProviderError` retry classification.
