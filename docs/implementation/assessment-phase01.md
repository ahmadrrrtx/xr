# Phase 01 Internal Implementation Assessment (pre-implementation)

## 1. Repository state verified
- HEAD `9680298` (main), Bun 1.3.14, XR 1.0.0. Typecheck clean; baseline suite **2950 pass / 19 skip / 0 fail**.
- CLI fast paths confirmed: `--version` 56ms, `--help` 53ms, `providers list` 153ms, `models list` 130ms.

## 2. Measured baseline (this host, with blackhole ports + slow GPU binaries)
Reproduction environment: TCP blackhole on all 9 local-runtime ports (accepts, never answers) +
slow `nvidia-smi`/`lspci` shims on PATH.

| Metric | Measured | Audit forensic |
|---|---|---|
| `providers.list` server-side | **16.0 s** (client killed at 10 s by Bun idle timeout) | 17–18 s |
| `onboarding.status` server-side | **30.6 s** (client killed at 10 s) | 10–12 s |
| `models.list` | killed at 10 s (sequential runtimes ≈ 29 s + hw 3.5 s) | 7–13 s |
| `detectAllRuntimes()` (11 runtimes, sequential) | **29.0 s** | ~25 s |
| `detectHardwareSpecs()` (spawnSync ×3) | **3.5 s** per call | 2.5–4 s blocking |
| `chat.stream.post` | **32 s → 503** ("The operation timed out.") | 16.5 s → 503 |
| `/api/health`, `/api/overview` | 16 ms / 33 ms (already light) | — |
| Bun timeout | confirmed in log: `request timed out after 10 seconds` | 10 s |
| catalog builds per `providers.list` | 26 (`buildProvider` per provider → `RoutingService` → `buildCatalog`) | N+1 confirmed |

Note: Bun's `spawnSync` does NOT stall the event loop (threaded impl; verified max gap 6 ms during
2 s spawnSync), but it still costs full wall-clock request latency per call and blocks under the
Node launcher path — async + cache remains the correct fix.

## 3. Existing infrastructure found (REUSE, do not duplicate)
- `src/util/process.ts` — async `runCommand` (Bun.spawn, kill-on-timeout) AND async `commandExists`
  with 60 s TTL memo + `clearCommandExistsCache()`. `src/local/runtimes.ts` duplicates a SYNC
  spawnSync `commandExists` — replace with the shared one.
- `src/util/concurrency.ts` — `Semaphore` (bounded concurrency) — reuse for parallel runtime probes.
- `src/config/cache.ts` — config/secrets cache with fs.watch invalidation; env-knob pattern
  (`XR_CONFIG_CACHE_TTL_MS`) → precedent for `XR_RUNTIME_CACHE`-style flags.
- `src/observability/metrics.ts` — `xrMetrics` Counter/Gauge/Histogram + cardinality guard → extend.
- `src/intelligence/router.ts` — `IntelligenceRouter.route()` builds `buildCatalog(config)` per call
  unless injected; catalog is read-only in routing (verified no mutation) → safe to cache.
- `getSecretSyncCached` — cheap (env+memo+file) → safe in catalog fingerprint.
- Env-override pattern (`applyEnvOverrides`, `XR_TRUST_HARDENED`) → rollback flag precedent.

## 4. Root causes mapped to fixes (Phase 01 scope only)
1. Sequential `detectAllRuntimes` → bounded-parallel (Semaphore 5) + cached + deduped + per-op
   bound (~2.5 s max: parallelize commandExists ∥ API probe inside `detectRuntime`).
2. Private sync `commandExists` → shared async cached `commandExists` from util/process.
3. Runtime result cache: config-fingerprint key, TTL 60 s, SWR 30 s, `XR_RUNTIME_CACHE=0` kill
   switch (fallback = bounded parallel, NEVER unbounded sequential).
4. Hardware `spawnSync` on request path → async `detectHardwareSpecsAsync()` via `runCommand`;
   cache TTL 5 min + background refresh at daemon startup; `statfsSync` stays sync (fast+safe);
   sync `detectHardwareSpecs()` kept for CLI with cache fast-path.
5. providers.list N+1: `buildProvider` per provider (26× catalog build) → build catalog ONCE per
   request; per-provider health via shared cached bounded checker. `buildCatalog` itself cached
   (config+env-key fingerprint, 60 s, SWR) so ALL N+1 sites collapse.
6. Provider health unbounded (2×8 s probes) → bounded 2500 ms race + positive 60 s / negative
   15 s cache + dedup; underlying fetch may continue up to 8 s after the race (documented
   limitation — `Provider.health()` has no signal plumbing; dedup prevents repeated probes).
7. onboarding.status: cached runtimes + cached internet probe (15 s) + shared health cache.
8. models.list triple work (hardware + all runtimes + single runtime again) → cached hardware +
   cached runtimes; selected-runtime status sourced from the same list.
9. chat.stream 32 s health → bounded 2.5 s via shared cache (fallback-chain path keeps
   `FallbackProvider.health()` semantics but bounded).
10. Dashboard: server-side caches make the 7 parallel endpoints fast; client: staged render
    (quick cells first), `loadProviderChip` reuses fetched data (no duplicate `/api/providers`
    + `/api/overview` fetches), `loadComposerMeta`/`loadVoiceStatus`/`syncSettingsFromConfig`
    share one `/api/config` fetch.
11. `/api/health` + `/api/overview` verified light; gitSummary gets a 5 s cache (repo-status
    polling guard).
12. New metrics: runtimeDetectionDuration, providerHealthDuration, hardwareDetectionDuration
    histograms + cache hit/miss counters + deduplicatedRequests counter.

## 5. New files / architecture
- `src/util/ttl-cache.ts` (NEW, L0): generic TTL cache + promise dedup + SWR + stats hooks —
  ONE cache primitive for all resources (spec H: one coherent mechanism).
- `src/daemon/state/cache.ts` (NEW): daemon-level shared state — internet probe + git summary
  caches, `daemonCacheStatus()` (no secrets). Domain caches live in their home modules
  (runtimes/hardware/catalog/health) because CLI shares them and L1/L2 may not import daemon.
- `src/daemon/routes/*`: consume the shared caches; no inline caches.

## 6. Correctness guards (per "do not over-cache")
- Runtime cache key = config fingerprint (baseUrls, cliCommands, localModels, defaults) →
  config change invalidates automatically; `saveConfig`/models.select flows change the key.
- Catalog key includes env key-presence bits → API key set/cleared invalidates.
- Health negative results cached 15 s only → "Ollama starts" recovers quickly.
- Failed promises never cached; pending promise removed on rejection (no poison).
- `models.select` / `models.test` stay FRESH (direct bounded probe, uncached).
- Auth/policy/audit paths untouched; caches keyed per-process, never per-user (single-user daemon
  with bearer token; no auth decisions cached anywhere).
- Windows/macOS/Linux behavior preserved: `where`/`command` selection, powershell path,
  nvidia-smi — all carried over to the async variants.

## 7. Explicitly OUT of scope (deferred to later phases — will document, not implement)
- skills.api / plugins.api 404 route mismatch → Phase 2 API coherence.
- Chat streaming/TTFT, fallback-chain improvements → Phase 4/5.
- Workspace-switch lifecycle unification → Phase 3.
- spawnSync in install/uninstall/update/onboard-URL-open → not request paths.
- `ProviderHealthChecker.checkAll` (CLI doctor path) — user-invoked, unchanged.
