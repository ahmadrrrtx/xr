# Phase 04 — Current Provider Architecture Audit

Date: 2026-08-15 Asia/Karachi
Commit: 81996fbb70878bcd79da542c18cead8ebf2777b0
Branch: main
Auditor: Phase 04 Implementation

## Summary

Current provider system is PARTIALLY unified but lacks a canonical ProviderGateway.

- ProviderRegistry exists as singleton but is used via direct imports, not through a gateway abstraction.
- Provider factory registers builtins at module load time.
- Health checking has two layers: ProviderHealthChecker + bounded cached wrapper checkProviderHealthCached.
- Intelligence plane (catalog, routing-service, behavioral, health, slo, fallback) provides capability-aware routing but is still called directly via RoutingService in factory buildProvider.
- ProviderService (src/services/provider-service.ts) is the service-layer abstraction used by AgentService, but it still creates RoutingService per call and delegates to registry.createProvider directly.
- Daemon routes /api/providers uses getProviderEnvStatus + checkProviderHealthCached (bounded, cached) — good.
- Models list uses detectAllRuntimes (now parallel bounded, cached since Phase01).
- Chat routes now go through AgentService (Phase03), so they indirectly use provider abstraction, but NOT through a single ProviderGateway.
- No streaming abstraction: Provider.chat returns complete ModelTurn, not streaming.
- No error normalization: providers throw generic Error with HTTP status sliced text, not typed errors.
- No retry policy centralization: FallbackProvider retries only on primary failure, but not on retryable vs non-retryable classification.
- No fallback chain as first-class gateway concept: fallback handled inside RoutingService/FallbackProvider wrapper.

## Provider Entry Points

- `src/providers/registry.ts`: ProviderRegistry class, singleton `registry`. Methods: register, unregister, has, getPreset, getFactory, createProvider, list, listByKind, listByTier, syncCustom, version.
- `src/providers/factory.ts`: registerBuiltins() at import time, buildProvider(), buildProviderWithDecision(), knownProviders(), providersByTier(), suggestFreeProvider(), providerList().
- `src/providers/presets.ts`: PRESETS 25 builtins (10 local: ollama, lmstudio, llamacpp, jan, localai, vllm, gpt4all, koboldcpp, textgenwebui, sglang; 10 openai-compat hosted: groq, deepseek, openrouter, together, fireworks, sambanova, xai, perplexity, huggingface, cerebras; 6 native-ish: openai, anthropic, google, mistral, cohere, bedrock).
- `src/providers/openai-compat.ts`: OpenAICompatProvider implements Provider {id,label,chat,health}. Chat builds systemEnvelope with tools list as text (not native tool calling for local models but via JSON grammar), uses guardedRequest for timeout+cancellation.
- `src/providers/native/*.ts`: AnthropicProvider, GoogleProvider, MistralProvider, CohereProvider, BedrockProvider, CerebrasProvider — each implements Provider with chat() + health() using guardedRequest.
- `src/providers/custom.ts`: CustomProvider extends OpenAICompatProvider.
- `src/providers/capabilities.ts`: ProviderCapabilities boolean bag {chat, reasoning, vision, embeddings, toolUse, jsonMode, functionCalling, streaming, etc}.
- `src/intelligence/capability.ts`: tri-state CapabilitySupport (unknown/supported/unsupported) + ModelDescriptor + ProviderDescriptor — richer than boolean.
- `src/intelligence/catalog.ts`: buildCatalog() with cache keyed by config+registryVersion+keyPresence, TTL 60s SWR 15s. N+1 fixed in Phase01.
- `src/intelligence/routing-service.ts`: RoutingService wrapper over IntelligenceRouter, resolve() and resolveWithDecision(). Handles locality policy, fallback chain filtering, wraps primary+fallback in FallbackProvider if needed.
- `src/intelligence/router.ts`: IntelligenceRouter full scoring (taskFit, quality, latency, cost, locality, preference, historical, availability) + difficulty routing + breaker.
- `src/providers/health.ts`: ProviderHealthChecker + checkProviderHealthCached (bounded 2500ms, cached 60s pos/15s neg, dedup via TtlCache). HEALTH_BOUND_MS=2500.
- `src/providers/request-guard.ts`: guardedRequest with timeout + AbortSignal composition, ProviderAbortError kind cancelled/timeout, DEFAULT_REQUEST_TIMEOUT_MS=120_000, setConfiguredRequestTimeout from config.providerEngine.requestTimeoutMs.
- `src/providers/model-switch.ts`: ModelSwitchStateMachine preflight→warm→canary→swap→verify→done/rolled-back, with timeouts.
- `src/providers/stream-metrics.ts`: StreamingMetricsCollector, withTurnMetrics wrapper.
- `src/services/provider-service.ts`: ProviderService service-layer: syncCustom, getProvider (tries IntelligenceService then RoutingService, wraps withTurnMetrics), route(), getKnownProviders, getPreset, checkHealth, checkAllProviders, getActiveProviderId, setActiveProvider, addCustom, removeCustom, storeKey, getKeyStatus, getProviderList.
- `src/core/types.ts`: Provider interface minimal {id,label, chat(messages,tools,options?), health()}. ChatOptions {signal, timeoutMs}. ModelTurn {message, toolCalls, done, usage}. Tool, Message etc.
- `src/local/runtimes.ts`: detectAllRuntimes parallel bounded semaphore 5, cache TTL 60s dedup, detectRuntime, detectOllama special case /api/tags vs /models.

## Provider Registry

- ONE singleton `registry` exported from registry.ts.
- Version incremented on register/unregister, used for catalog cache fingerprint.
- syncCustom removes stale custom entries not in config then registers current custom with preset kind custom tier custom.
- Registration deterministic? Builtins registered at module load in deterministic order: localPresets list then openaiCompatHosted list then native list. No duplicate check — Map.set overwrites silently, version bumps anyway. Need explicit duplicate handling.
- Provider IDs stable (PRESETS keys).

## Provider Factories

- Factory function signature: (config: XRConfig, model: string, preset: ProviderPreset) => Provider.
- Each factory captures preset baseUrl label etc, resolves config overrides: localModels.runtimes[id].baseUrl → providers[id].baseUrl → preset.baseUrl.
- For local providers, checks config.localModels.runtimes[id].
- For hosted openai-compat, only providers[id].baseUrl override.
- For native, ignores baseUrl, uses fixed endpoint + apiKeyEnv.
- openai provider is openai-compat but registered last, uses override.

## Provider Adapters

- OpenAICompatProvider: chat() builds systemEnvelope with tool docs as text list, not using OpenAI tool calling format (legacy XR envelope). Uses body.messages mapping tool role → user with [tool:name] content. Supports grammar (local) vs json_mode (cloud) via model profile. health() probes /models then /chat/completions with 8s timeout each (internal).
- Native adapters: each translates XR Message/Tool to vendor format, uses guardedRequest, returns ModelTurn. No streaming.
- Error handling: throws generic Error with HTTP status + sliced text. No typed error.
- No streaming: no chatStream.
- No capability querying: capabilities static from PRESETS, not dynamic.

## Provider Health

- Health semantics: reports {id, ok, latencyMs, detail, authOk, modelAvailable?, timestamp}. Cached variant adds cached, stale, deduped, probeMs.
- Bounded 2500ms via bounded() helper (Promise.race with timeout fallback).
- Cache: TtlCache with hit/miss/dedup stats, positive TTL 60s, negative 15s, maxEntries 64.
- Cache key: id|model|effectiveBaseUrl (config-aware).
- Auth short-circuits before network.
- checkAll() in ProviderHealthChecker loops sequential for...await — still sequential! Need parallel bounded.
- Providers.routes uses Promise.all over status.map(checkProviderHealthCached) — parallel, good.
- No background refresh beyond SWR.

## Provider Discovery

- Presets static map.
- Custom providers from config.providerEngine.customProviders synced into registry.
- No dynamic model discovery from /models endpoint except for runtime detection (local) and health probes.
- Model listing: buildCatalog builds ProviderDescriptor + ModelDescriptor from presets + registry + credentialAvailable. Includes knownModels from preset.
- No live /v1/models fetching for hosted providers (OpenRouter etc). Static.

## Provider Model Discovery

- Models from preset.knownModels.
- For local runtimes, detectRuntime fetches models via /api/tags (ollama) or /v1/models (openai-compat) — this is runtime detection, not provider model discovery per se.
- catalog provides modelCount, builtAt.
- No capability dynamic detection.

## Provider Credentials

- BYOK: env vars per preset apiKeyEnv, or secret via getSecret/getSecretSyncCached (OS keychain / file).
- getProviderEnvStatus reads env presence.
- Provider adapters read apiKey from opts.apiKey or process.env[apiKeyEnv] directly — not via centralized credential resolver but via env.
- No secrets in health reports or telemetry.
- Config may have providers[id].baseUrl override but not secret (secrets via env or secret store).

## Provider Execution

- AgentService.getProvider() -> RoutingService -> registry.createProvider -> withTurnMetrics -> Provider.
- Provider.chat(messages, tools, options) -> guardedRequest -> fetch -> parse -> repairToTurn.
- FallbackProvider wrapper: tries primary.chat, on failure (except ProviderAbortError) falls back to fallback.chat. Health tries primary then fallback.
- No retry classification beyond abort vs failure.
- No usage normalization beyond inTokens/outTokens from provider response.

## Provider Streaming

- NOT implemented. OpenAICompatProvider has streaming capability flag but chat() sets stream:false.
- No chatStream method on Provider interface.
- Daemon chat currently streams via say() callback from agent loop (turn-level), not token-level. Token-level deferred to Phase04.

## Provider Error Handling

- Errors are generic Error with message `${provider} HTTP ${status}: ${txt}`.
- Timeout → ProviderAbortError kind timeout.
- Cancellation → ProviderAbortError kind cancelled.
- No structured error types for auth, rate limit, model unavailable, etc.
- No retryable vs non-retryable classification except abort errors excluded from fallback.

## Provider Retries

- No retry policy in ProviderGateway. FallbackProvider retries once on any failure (except abort).
- RoutingService retry tuning exists in intelligencePlane.retry config (maxInPlaceRetries, baseDelayMs, maxDelayMs, totalBudgetMs) but not used in provider execution — only documented for future.
- No jitter, no rate limit handling.

## Provider Timeouts

- requestTimeoutMs config 120_000 default (2min) — used for chat calls via setConfiguredRequestTimeout -> resolveTimeoutMs.
- Health timeout separate: HEALTH_BOUND_MS 2500ms for catalog health, plus internal 8s per probe in provider.health().
- No separation in config: providerEngine only has requestTimeoutMs, not healthTimeoutMs. Spec says need separate healthTimeout 2500 vs requestTimeout 120000.
- guardedRequest resolves timeout via explicit > env XR_PROVIDER_TIMEOUT_MS > configured > default.

## Provider Fallbacks

- Fallback chain concept exists in intelligence router decision.fallbackChain.
- RoutingService selects fallback from decision.fallbackChain or legacy fallbackProvider logic.
- Legacy fallback: localFirst strategy, localModels.enabled, best local target.
- Fallback chain filtering ensures locality policy respected and target diversity (different provider or model).
- FallbackProvider wrapper logs warning on fallback.
- No explicit auditable fallback decision beyond routing decision record.

## Provider Routing

- Resolution inputs: provider pin, model pin, strategy, requirements (modelClass, localityPolicy, require toolUse etc), mode.
- Precedence: explicit task provider > workspace/provider preference? Actually RoutingService: IntelligenceRouter uses preference scoring plus manual pins override. Config defaults provider/model used when no pin. Fallback provider from config or best local.
- Locality policy enforced: policyFromConfig, localityOf, localityAllowed. Fail closed if violation.
- Difficulty routing: estimates task difficulty and requires measured fidelity.

## Duplicated Logic

- ProviderRegistry vs getProviderEnvStatus: getProviderEnvStatus iterates PRESETS directly, not registry.list(). If custom providers synced, PRESETS doesn't include custom, but registry does. So providers.list via getProviderEnvStatus misses custom? Actually providers.routes uses getProviderEnvStatus which reads PRESETS only, not custom. Custom providers not shown? Need fix.
- buildProvider vs ProviderService.getProvider: both create RoutingService and call resolve. buildProvider is legacy facade, ProviderService.getProvider is service-layer. Both exist — duplication but buildProvider wrapper over RoutingService, ProviderService also uses RoutingService (or IntelligenceService). Two paths to same logic.
- checkAll vs checkProviderHealthCached: checkAll is sequential, not using cached bounded path.
- Catalog building: buildCatalog cached but some call sites still call buildCatalog directly without cache? Actually buildCatalog now cached. Good.
- Runtime detection: Ollama special-cased /api/tags vs generic /models — intentional leak documented as justified (different API).
- Provider health vs runtime health: overlap but separate.
- Secret retrieval: process.env[apiKeyEnv] || getSecret — duplicated in many places (factory, health, provider adapters).

## Current Provider Interfaces

- Provider interface (src/core/types.ts): minimal, no streaming, no capabilities, no model identity beyond id/label (model stored inside adapter but not exposed as capability query).
- ProviderPreset: id, label, kind, tier, baseUrl, apiKeyEnv, authType, defaultModel, knownModels, capabilities (boolean bag).
- ProviderCapabilities: boolean bag.
- ModelDescriptor/ ProviderDescriptor (intelligence): richer tri-state, contextWindow, classes, etc.
- RoutingDecision: decisionId, version, timestamp, mode, providerId, modelId, manual, unavailable, explanation, factors, fallbackChain, localityPolicy, confidence, rejectedCount, etc.
- ProviderHealthReport.

## Existing Good Abstractions

- ProviderRegistry singleton with versioning.
- TtlCache with stats and dedup (used for health, catalog, runtimes).
- bounded helper (Promise.race with fallback) for health.
- guardedRequest for timeout+cancellation with honest error kinds.
- RoutingService + IntelligenceRouter for capability-aware routing with locality enforcement.
- ModelSwitchStateMachine for safe provider switching.
- StreamingMetricsCollector single choke point for metrics.
- ProviderService as service layer abstracting registry+routing.
- FallbackProvider composition primitive.
- Config fingerprinting for cache invalidation.

## Technical Debt

- No ProviderGateway singleton — ProviderService + factory + registry are separate entry points.
- Provider interface too minimal: no streaming, no structured errors, no capabilities query.
- Health checkAll sequential.
- getProviderEnvStatus reads PRESETS not registry, misses custom.
- buildProvider legacy but still used in some places (check codebase).
- requestTimeout vs healthTimeout not separated in config.
- No central credential resolver — secrets read ad-hoc via env/getSecret in many places.
- No error normalization.
- No retry policy.
- No fallback chain as first-class gateway method.
- No model discovery dynamic.
- Ollama special-casing in runtime detection, but also in provider factory baseUrl resolution — two places.
- Streaming not implemented.
- Tool calling: XR uses custom JSON envelope, not native OpenAI tool calling for openai-compat providers — but native providers use their own tool conversion. Inconsistent.
- Providers.routes still uses getProviderEnvStatus + checkProviderHealthCached, not gateway.
- Models.list uses detectAllRuntimes directly, not via gateway.
- CLI providers command uses ProviderService.checkHealth directly, not gateway cache? Actually uses same.

## Metrics

- HEALTH_BOUND_MS 2500ms, but internal health probes use 8000ms timeout — bounded race ensures 2500ms outer.
- CATALOG_CACHE_TTL 60s, RUNTIME_CACHE_TTL 60s, HEALTH_CACHE 60s pos/15s neg.
- DEFAULT_REQUEST_TIMEOUT 120s.
- RUNTIME_DETECTION_CONCURRENCY 5.

## Security

- API keys never logged: health reports use hasKey boolean, not key value. But need verify provider adapters don't leak key in error messages — they slice response text but include header? Auth header contains Bearer token but not logged.
- Secrets redacted in audit? Need verify.
- Egress allowlist enforced via security.education? Actually egress proxy.

## Recommendations for Phase04

- Create ProviderGateway as singleton owning registry, catalog, health, capability, fallback, switching, credential resolution, error normalization, streaming, usage normalization.
- Extend Provider interface to support chatStream, getModel, getCapabilities, etc OR keep Provider minimal and have Gateway handle streaming normalization via adapter method.
- Implement structured ProviderError type with kind enum.
- Add healthTimeoutMs separate config with default 2500.
- Make provider listing use gateway.list() + gateway.health() cached.
- Make model listing use gateway catalog.
- Implement fallbackChain resolution in gateway.
- Implement streaming: add chatStream to Provider (optional) and gateway normalizes to async generator of chunks.
- Implement capability resolver.
- Implement usage normalization.
- Implement BYOK resolution central.
- Ensure all entry points (CLI, daemon, dashboard) use gateway.
- Add tests for gateway.
- Preserve backward compat: buildProvider wrapper over gateway.
- Feature flag XR_PROVIDER_GATEWAY=0 to disable gateway and fallback to direct registry.createProvider.

## Boundaries

- Do NOT implement Phase05 local AI manager (pull, remove already exist).
- Do NOT redesign dashboard UI.
- Do NOT redesign TUI.
- Do NOT rebuild memory, policy, checkpoints.
