# PHASE 10 IMPLEMENTATION REPORT — Web Research / Firecrawl

**Date:** 2026-08-19 · **Repo:** `main` @ `70a48a7` (Phase 09 merged) · **Bun:** 1.3.14

The goal was NOT "XR now has Firecrawl" — it was to make research a **first-class,
provider-agnostic, secure, observable, budgeted, citation-aware** subsystem that
stays inside XR's unified capability / policy / budget / egress / audit / context
architecture. That is what shipped.

---

## 1. Repository state

Verified by inspection before implementation: Phase 08 (unified capability
system) and Phase 09 (memory/context) were merged; the Stage-7 research engine
(`src/research/*`), SearXNG-based `web_search` tool, centralized egress proxy
(`guardedFetch`/`checkEgressTarget`), private-IP tables, `ToolRegistryService`,
MCP signed allowlist, audit chain, and retry classification were all present.

## 2. What was already present

- Stage-7 research engine (plan → SearXNG discover → rank → fetch → extract → synthesize) + full CLI + signed markdown export.
- `web_search` / `fetch_url` / `check_package` tools (egress-gated).
- Centralized SSRF: `guardedFetch`, `checkEgressTarget`, `isBlockedAddress`, `normalizeHost`.
- `ToolRegistryService` + Phase-08 capability metadata; `ProviderError` retry classification; audit; metrics registry.

## 3. What changed

A provider-agnostic research stack **added on top of** (not beside) the above:

| # | Subsystem | Status | Evidence |
| - | --------- | ------ | -------- |
| 1 | Domain model | PASS | `src/research/provider-types.ts` (sources, citations, limits, jobs, states, errors, stream events) |
| 2 | Provider abstraction + selection | PASS | `src/research/providers/{types,pool}.ts` |
| 3 | SearXNG provider | PASS | `providers/searxng.ts` (search; guardedFetch) |
| 4 | DirectFetch provider | PASS | `providers/direct-fetch.ts` (scrape; single SSRF-safe public fetch) |
| 5 | Firecrawl adapter | PASS | `providers/firecrawl.ts` (search/scrape/crawl/map/extract + async jobs + schema validation) |
| 6 | Source normalization + dedupe + domain policy | PASS | `src/research/url-guard.ts` |
| 7 | Citations + provenance | PASS | `src/research/citations.ts` |
| 8 | Research jobs (durable, cancellable) | PASS | `src/research/jobs.ts` + `research_jobs` table |
| 9 | Runner (fallback, retry, budget, cancel, streaming) | PASS | `src/research/runner.ts` |
| 10 | Budget/limits | PASS | `src/research/budget.ts` (`ResearchRunBudget`) |
| 11 | Security integration | PASS | reuses `guardedFetch` + `isBlockedAddress`; removed duplicate SSRF in `search.ts` |
| 12 | Prompt-injection defense | PASS | `src/research/content-guard.ts` (reuses `frameToolOutput`/`scanUntrusted`) |
| 13 | Capability integration | PASS | `research_*` core tools + permissions + READ_ONLY scoping |
| 14 | Config | PASS | `research.*` block + migration 19→20 (Firecrawl off by default) |
| 15 | API routes | PASS | `src/daemon/routes/research.routes.ts` (9 ops) + contract + schemas |
| 16 | SSE streaming | PASS | `GET /api/v1/research/stream/{id}` |
| 17 | CLI | PASS | `search/scrape/crawl/map/extract/providers/jobs/job/cancel` |
| 18 | Observability | PASS | `src/research/observability.ts` (6 counters, shared registry) |
| 19 | Tests | PASS | 49 research tests (offline) + route smoke tests |
| 20 | Benchmarks | PASS (offline) | `benchmarks/research/offline-bench.ts` |
| 21 | Documentation | PASS | `docs/research/*` (8 files) |
| 22 | Memory/context integration | PASS (reused) | existing `xr research remember` already stores with provenance; research jobs persist via the one store |

## 4–24. Subsystem detail

- **Provider abstraction** — `ResearchProvider` interface with runtime capability
  discovery; `ProviderPool.forCapability(capability, preferred)` orders by
  preference then failure count. Never an LLM decision.
- **Firecrawl** — a provider, not an authority. API calls via `guardedFetch`
  (egress allowlist + SSRF + byte cap); every target URL validated by
  `ctx.assertUrl` before sending; responses normalized into XR types; key never
  logged/serialized; extraction output validated against the requested schema.
- **Search/scrape/crawl/map/extract** — all flow through `runResearchOperation`.
  Crawl is async (poll or SSE), bounded by `maxPages`/`maxDepth`, domain policy
  enforced on returned pages, canonical dedupe applied.
- **Jobs** — `queued → … → completed | partial | cancelled | failed |
  budget_exhausted | recovery_pending`; persisted via `research_jobs` table;
  unfinished jobs found at startup load as `recovery_pending` (honest recovery).
- **Budget** — pages/requests/bytes/duration tracked; exhaustion yields
  `budget_exhausted` with partial results preserved, never a generic `failed`.
- **Retry classification** — retryable (`rate_limit`/`timeout`/`unavailable`/
  `network_failure`) falls back to the next provider; non-retryable (auth,
  invalid request/schema, blocked domain, SSRF, budget, permission) stops.
- **Citations** — `ResearchCitation` maps to a retrieved source only; unknown
  metadata stays unknown; content hashes allow tamper/staleness checks.
- **Security** — SSRF remains centralized (one implementation). Private IPs,
  metadata endpoint, redirect-to-private, punycode/domain confusion, and
  budget abuse are all covered by tests.
- **API** — canonical `/api/v1`, registered in the contract, schema-validated,
  present in OpenAPI + typed client (regenerated, 117 operations).

## 25. Tests

```
bun run typecheck          ✓
bun test                   ✓ 3388 pass / 0 fail (3407 tests, 281 files)
bun test test/research     ✓ 49 tests (url-guard, citations, jobs, runner,
                              firecrawl adapter, security, api-routes)
bun run boundaries         ✓ 0 violations (579 modules)
bun run api:schema:check   ✓ (117 operations)
bun run client:check       ✓
bun run api:compat         ✓ (no breaking changes)
bun run size-gate          ✓
bun run ownership:check    ✓
```

Golden-style scenarios (offline): search, scrape, map, crawl, extract,
citations, conflicting sources, domain restriction, page limit, cancel,
recovery, SSRF block, injection detect, fallback provider — covered as
deterministic tests above.

## 26. Benchmarks

Offline micro-benchmarks (p50/p95 measured, this host): url-guard ~0.008ms,
canonicalize+dedupe(20) ~0.14ms, citations(10) ~0.012ms, normalization(50)
~0.45ms, end-to-end runner(mock) ~0.03ms. Live provider benches are not
measured (no keys) — see §27.

## 27. Remaining limitations / BLOCKED

| Item | Status | Why |
| ---- | ------ | --- |
| Live Firecrawl integration tests | **BLOCKED** | Requires a real `FIRECRAWL_API_KEY` + network. Adapter translation is covered by mocked tests; a live test can be added once a key is provisioned. |
| Live SearXNG / Firecrawl benchmark runs | **BLOCKED** | No provisioned SearXNG instance / Firecrawl key for CI. |
| Dashboard research panel | **DEFERRED** | Spec: "Do not create an enormous UI rewrite." Overview already surfaces research count/recent; a dedicated panel is a Phase 12 (UX) task. |
| TUI research surface | **DEFERRED** | CLI covers the surface; TUI wiring is a Phase 12 task ("only if consistent with the existing command model"). |
| Firecrawl via MCP | **NOT CHOSEN** | Integrated as a direct HTTP provider adapter (spec §34 makes MCP integration conditional). The signed/default-deny MCP model is untouched. |
| Parallel multi-agent research fan-out | **PARTIAL** | Provider fallback + bounded concurrency exist; a full `delegate_task` sub-agent fan-out is a Phase 12/13 concern (existing `src/agents/*` provides the runtime). |

## 28. Known risks

- Firecrawl wire shapes evolve; the adapter is defensive and reports malformed
  responses truthfully, but field-level differences may need follow-up.
- Prompt-injection scanning is framing, not proof of safety (documented).
- `research_jobs` persistence writes on every progress update; fine at default
  poll intervals, revisit if crawl polling gets very fast.

## 29. Files changed (summary)

New: `src/research/{provider-types,citations,url-guard,jobs,runner,factory,content-guard,observability,tools}.ts`,
`src/research/providers/{types,pool,searxng,direct-fetch,firecrawl}.ts`,
`src/daemon/routes/research.routes.ts`, `test/research/*` (7 files),
`docs/research/*` (8 files), `benchmarks/research/*`.
Modified: `src/config/config.ts` (research block + migration 19→20),
`src/state/workspace-store.ts` (research_jobs table), `src/research/{budget,cli,search}.ts`,
`src/tools/{registry,registry-service,registry-builder}.ts`,
`src/capabilities/compatibility.ts`, `src/daemon/routes/{contract,registry,router,schemas}.ts`,
`scripts/generate-client.ts` (SSE GET fix), `test/{context,environment}/migration.test.ts` (v20),
regenerated `docs/api/openapi.json`, `src/clients/daemon-client.generated.ts`,
`docs/OWNERSHIP.md`, `docs/perf/SIZE-WAIVERS.json`.

## 30. Git diff summary

`+2192 / −142` lines across tracked files, plus the new files above. No secrets,
no debug logs, no generated junk, no unrelated modifications (the one unrelated
side-effect file was reverted).

## 31. Final verification

```
STATUS: PASS (core) / PARTIAL (parallel fan-out) / BLOCKED (live-provider tests + benchmarks)
EVIDENCE: 3388 tests green · boundaries 0 · API contract in sync · CLI + HTTP routes exercised
TEST: bun test · bun run boundaries · bun run api:schema:check · client:check · api:compat
BENCHMARK: benchmarks/research/offline-bench.ts (p50/p95 reported above)
```
