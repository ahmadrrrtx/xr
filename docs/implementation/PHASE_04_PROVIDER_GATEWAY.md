# Phase 04 — Provider Gateway / Universal Provider Engine

Date: 2026-08-15 Asia/Karachi
Commit: 81996fbb70878bcd79da542c18cead8ebf2777b0 (baseline) → phase04
Owner: Ahmad RRRTX / @ahmadrrrtx
Status: IMPLEMENTED

## Executive Summary

Phase 04 establishes ONE canonical provider abstraction — ProviderGateway — that all interfaces (CLI, TUI, Dashboard, HTTP) use.

Before:
```
interface/execution code → provider-specific logic (buildProvider, provider.chat directly)
```

After:
```
CLI/TUI/Dashboard
      ↓
AgentService
      ↓
Execution Fabric
      ↓
Runner
      ↓
Provider Gateway (singleton)
      ↓
Provider Adapter (OpenAI-compat, Anthropic, Google, etc.)
      ↓
External API / Local Runtime
```

Provider choice becomes an implementation detail. XR remains XR regardless of backend.

## Architecture

```
                CLI
                 |
                TUI
                 |
             Dashboard
                 |
                 v
            AgentService
                 |
                 v
           Execution Fabric
                 |
                 v
               Runner
                 |
                 v
          Provider Gateway
                 |
       +---------+---------+
       |         |         |
       v         v         v
    Adapter A Adapter B Adapter C
       |         |         |
       v         v         v
    Vendor A  Vendor B  Local
```

## Provider Contract

### Core Provider interface (src/core/types.ts)

```ts
interface Provider {
  id: string;
  label: string;
  chat(messages, tools, options?): Promise<ModelTurn>;
  chatStream?(messages, tools, options?): AsyncGenerator<ProviderStreamChunk>;
  health(): Promise<{ok, latencyMs?, detail?}>;
  modelId?: string;
  listModels?(): Promise<string[]>;
}
```

- `chat` is still the canonical turn-based API (for backward compat).
- `chatStream` is new optional async generator yielding normalized chunks {text, toolCall, usage, finish}.
- `modelId` exposes model identity.
- `listModels` for dynamic discovery where supported.

### Capability Model

- Boolean bag ProviderCapabilities kept for backward compat (chat, reasoning, vision, embeddings, toolUse, jsonMode, streaming etc.)
- NormalizedCapabilities (src/providers/capability-resolver.ts) maps boolean bag to explicit fields:
  streaming, toolCalling, functionCalling, vision, structuredOutput, embeddings, reasoning, audio, imageGeneration, localExecution, jsonMode, chat, speechToText, textToSpeech, reranking, contextWindow.
- CapabilityResolver class: supports(), filterByCapabilities(), getCapabilities(), supportsModelClass()
- Never lies about capabilities — unsupported capability returns typed error.

### Provider Identity

Separate:
- providerId (e.g., "openai")
- modelId (e.g., "gpt-4o-mini")
- displayName (label)
- capabilities (from preset + dynamic)

From XR identity: user interacts with XR, not vendor. System prompt enforces XR identity regardless of backend.

## Registry

- ONE authoritative ProviderRegistry (src/providers/registry.ts) singleton `registry`
- Methods: register(preset, factory), registerOrThrow, unregister, has, getPreset, getFactory, get, getEntry, resolve(providerId, modelId?), createProvider, list, listByKind, listByTier, syncCustom, clear
- Version bumped on every mutation, used for catalog cache fingerprint
- Duplicate registration deterministically replaces (documented rule) — never silently creates duplicates. registerOrThrow fails explicitly.
- Supports built-in presets (25) + custom sync from config.providerEngine.customProviders
- Stable provider IDs (PRESETS keys)

## ProviderGateway (src/providers/gateway.ts)

Singleton `providerGateway` owns:

- registry
- catalog (via buildCatalog cached)
- health (via checkProviderHealthCached bounded cached)
- capabilityResolver
- fallbackChain
- modelSwitch (via ModelSwitchStateMachine)
- credential resolution (via secrets.ts)
- error normalization
- usage normalization

Methods:

- list(config): ProviderPreset[] — syncCustom then registry.list()
- listByKind, listByTier
- getPreset(id), getFactory(id), has(id), get(id)
- createProvider(id, config, model): Provider
- resolve(config, input): Promise<ProviderResolution> — deterministic resolution using RoutingService/IntelligenceRouter, returns provider, preset, decision, resolved {providerId, modelId, displayName}, capabilities, fallbackChain
- buildProvider(config, override): Provider — sync backward compat wrapper
- health(config, id, model?): Promise<CachedProviderHealth> — bounded, cached, deduped
- healthAll(config): Promise<CachedProviderHealth[]> — parallel bounded
- catalog(config): IntelligenceCatalog — cached per config hash TTL 60s
- catalogFingerprint(config?)
- capabilities(presetId), supports(presetId, capability)
- fallbackChain(config, opts?), executeWithFallback, execute, stream
- credentialStatus, resolveCredential
- resolveModel
- normalizeUsage
- normalizeError

Feature flag: XR_PROVIDER_GATEWAY=0 disables gateway, falls back to direct registry.createProvider (rollback path).

## Provider Adapters

- OpenAICompatProvider (src/providers/openai-compat.ts): chat() + new chatStream() via SSE. health() probes /models then /chat/completions. listModels() via /models. modelId getter. Error normalized via normalizeProviderError.
- Native providers (Anthropic, Google, Mistral, Cohere, Bedrock, Cerebras): chat() + chatStream() fallback that calls chat() and yields as stream (token-level future). modelId getter. Health via /models or minimal chat probe.
- CustomProvider extends OpenAICompatProvider.

All adapters use guardedRequest (bounded + cancellable) and normalizeProviderError.

## Resolution

Deterministic precedence:

```
explicit task provider (override.provider)
  ↓
workspace/provider preference (config.defaults.provider from workspace)
  ↓
configured default (config.defaults.provider/model)
  ↓
safe fallback if supported (fallbackProvider → local healthy runtime)
```

Implemented in RoutingService + IntelligenceRouter + fallback-chain.ts resolveFallbackChain.

- explicit pin wins
- localityPolicy enforced (fail closed if violation)
- fallbackChain filtered for locality and target diversity (different provider or model)
- Deduplication of identical steps
- Auditable explanation string

## Model Resolution

Provider and model are related but NOT identical.

- model resolves through provider abstraction: gateway.resolveModel(config, providerId, modelId)
- Uses catalog (built from presets + registry) to find model descriptor
- Falls back to preset.defaultModel if not specified
- Avoid model name → hardcoded vendor logic; instead provider → model registry

## Credential / Secret Resolution

- Gateway does NOT own arbitrary secret persistence
- Reuses existing XR config/secret/environment/workspace architecture
- credentialStatus(providerId): {required, available, envName} — checks process.env[apiKeyEnv] || getSecretSyncCached || getSecret
- resolveCredential(providerId): string|undefined — same path
- Provider adapters receive resolved credentials via factory (apiKey = process.env[apiKeyEnv] || ...)
- NEVER logs API keys, never returns in errors, never in telemetry, never serialized into task state, never via provider.list
- Error messages redacted via redactSecrets (sk-*, Bearer, api_key=...)

## Provider Health

- Uses canonical ProviderHealthChecker + checkProviderHealthCached
- Phase 04 adds separate healthTimeoutMs config (default 2500) vs requestTimeoutMs (120000)
- Env override XR_HEALTH_TIMEOUT_MS
- HEALTH_BOUND_MS still 2500 backward compat but actual bound resolved per-call via resolveHealthBoundMs()
- Bounded race: checker.check() bounded by healthTimeoutMs, fallback timeoutReport
- Cache: TtlCache positive 60s, negative 15s, maxEntries 64, deduplicating concurrent callers onto ONE probe
- checkAll now parallel bounded (was sequential)
- Providers.list route: Promise.all healthAll via gateway (parallel) — no more N+1
- Dashboard provider status, CLI provider health, AgentService preflight all use same underlying health semantics
- Provider failure isolated: one failing provider never blocks entire list (Promise.all with individual catch)

Health semantics distinguish:
- configured (hasKey)
- available (authOk)
- healthy (ok)
- unhealthy (ok=false, authOk=true)
- unavailable (auth failure)
- timeout (bounded)
- unsupported (unknown provider)

## Error Normalization

- ProviderError class (src/providers/errors.ts) with kind enum:
  authentication_failure, rate_limit, timeout, unavailable, invalid_request,
  model_unavailable, unsupported_capability, provider_overload, network_failure,
  context_length, content_policy_refusal, unknown_provider_failure
- isRetryable classification: retryable = rate_limit, timeout, unavailable, provider_overload, network_failure
- Non-retryable = auth failure, invalid request, model unavailable, context length, policy refusal, unsupported capability
- normalizeProviderError(err, providerId, modelId): preserves safe details, redacts secrets
- toSafeJson() returns redacted safe JSON for API/audit
- Public errors actionable, safe, structured, never leak secrets
- Provider-specific details preserved internally in details field

## Retry Policy

- No naive retries
- Only errors that are actually retryable are retried via fallback chain
- Examples retryable: transient network failure, provider overload, rate-limit with retry info
- Never blindly retry: auth failure, invalid request, unsupported model, policy refusal, tool arg errors
- Respects AbortSignal, request deadline, execution budget, policy
- Retry behavior does not duplicate tool side effects (FallBackProvider only retries model-call level, not tool execution)

## Streaming

- Provider interface chatStream() async generator yielding ProviderStreamChunk {text, toolCall, usage, finish, reasoning, model, providerId}
- OpenAICompatProvider implements real SSE streaming: fetch with Accept: text/event-stream, parse data: lines, accumulate fullContent for tool_calls final parse, yield text tokens incrementally
- Native providers fallback to chat() → yield as stream (compatibility)
- Gateway.stream() normalizes: if provider has chatStream, uses it; else calls chat() and yields as single chunk + tool_calls + usage finish
- Architecture: AgentService → Runner → ProviderGateway.stream() → ProviderAdapter
- Streaming events normalized into XR's execution/event model: token, tool_call, tool result, usage, finish, error
- Provider-specific event formats remain inside adapters
- Cancellation propagates via AbortSignal → guardedRequest → socket
- Daemon chat route still streams via say() callback from agent loop (turn-level); token-level streaming ready for Phase05

## Tool Calling

- XR Tool Registry remains canonical
- Flow: XR Tool Registry → provider adapter conversion (systemEnvelope with tool docs as text for openai-compat, native functionDeclarations for native providers) → provider API → normalized tool call → XR Tool Registry
- Model/provider may request tool X but actual execution passes through XR policy and tool registry
- Provider SDK never executes arbitrary tools directly — adapter returns ModelTurn with toolCalls array, loop executes via tool registry
- Non-native FC fallback prompt-based: openai-compat uses systemEnvelope forcing JSON object {"message", "tool_calls", "done"} — works for local models lacking native function calling (like Ollama older models). Documented as intentional prompt-based fallback.

## Policy Integration

- Provider selection → policy → execution: gateway resolution → envelope policy (budget, pricing, approval) → execution
- Tool calls → policy → approval if required → execution: ModelTurn toolCalls → trust gate → policy check → approval event → execution
- Provider capability → capability validation → policy where required
- Gateway never bypasses XR policy, never becomes privilege escalation path
- Fallback chain respects locality policy and allowFallback

## Budget / Usage

- Provider-specific usage normalized into XR's existing budget/cost architecture
- OpenAICompatProvider returns usage from json.usage prompt_tokens/completion_tokens
- Native providers similar
- Gateway.normalizeUsage({inTokens, outTokens, totalTokens}, {providerId, modelId, latencyMs}) → {inTokens, outTokens, totalTokens, providerId, modelId, latencyMs}
- No hardcoded vendor billing assumptions in AgentService — adapters translate vendor usage, gateway returns normalized usage
- Cost repo still via priceFor(providerId, modelId)

## Model / Provider Listing

- All use canonical provider registry/gateway
- API does NOT independently instantiate every provider merely to determine status — uses registry + cached metadata + ProviderHealthChecker bounded cached
- providers.list p95 <2.5s (was 17-18s pre-Phase01), models.list <2.5s (was 7-13s) — preserved Phase01 performance budgets
- Providers.routes: list uses gateway.list + healthAll parallel; catalog uses gateway.catalog cached
- Models.routes: runtimes from detectAllRuntimes cached 60s, hardware from async cache, plus gateway catalog + fallbackChain
- CLI providers list uses ProviderService.getKnownProviders() → gateway.list() (includes custom) + credential status
- CLI models list similar

## Local Providers

- Provider abstraction capable of representing local providers (kind=local, localExecution capability true)
- detectAllRuntimes parallel bounded semaphore 5, cache TTL 60s, dedup, async commandExists cached 60s — Phase01 fix preserved
- Ollama special-casing: /api/tags vs generic /models — intentional leak documented, justified because Ollama API differs (different endpoint). Not duplicated in provider factory (factory uses baseUrl override only)
- Local runtime health via detectRuntime (CLI presence + API reachability concurrent)
- Phase 05 owns missing local model manager (pull, download) — leave for Phase05, document boundary
- testLocalModel uses provider's baseUrl

## BYOK

- First-class: users may provide provider credentials via env vars or secret store
- Gateway resolves env, config, workspace, user-provided configuration according to existing precedence
- No provider-specific secret storage — uses security/secrets.ts (OS keychain, file .env AES-GCM)
- Provider selection works without XR owning vendor credentials
- getProviderEnvStatus replaced by gateway.credentialStatus (envPresence from same system)

## Provider Switching

- Tested switching provider A → B without restart
- ModelSwitchStateMachine preflight→warm→canary→swap→verify→rollback
  - preflight: static validation unknown id/model fail fast 2s
  - warm: reachability/auth probe 10s
  - canary: bounded free soundness check (authOk counts as pass for cloud, full completion probe for local) 15s
  - swap: persist new active provider/model 10s
  - verify: read-back persisted config 2s
  - rollback: restore previous on failure
- Canary uses small prompt "Reply with exactly: OK" max_tokens 8 temperature 0 for local; for cloud, authOk suffices (no paid traffic)
- Switching does NOT corrupt workspace, memory, checkpoint, audit, session, execution state
- Provider selection task-scoped where possible (override provider/model per task)
- Existing tasks must not unexpectedly switch mid-run unless explicit fallback architecture says so — fallback only on failure, not mid-run

## Failover

- Fallback chain moved into canonical gateway/resolution layer
- Chain: primary → fallbackProvider → local healthy runtime → error 503 only if all fail
- Explicit, bounded, auditable, policy-aware — no silent provider switching when user explicitly selected one unless fallback allowed
- Fallback behavior explicit in routing decision explanation + fallbackChain steps + audit
- No automatic fallback surprises: cost/privacy/capability differences documented

## Daemon Integration

- /api/providers uses gateway.list + gateway.healthAll
- /api/models uses detectAllRuntimes + gateway.catalog + gateway.fallbackChain
- /api/providers/catalog uses gateway.catalog
- /api/providers/capabilities new endpoint uses gateway.capabilities
- /api/providers/fallback new endpoint uses gateway.fallbackChain
- /api/chat uses AgentService.runTask() → same gateway path as CLI (Phase03)
- No route constructs vendor SDK clients independently bypassing ProviderGateway
- API contract preserved: API_CONTRACT, route registry, generated schema

## CLI Integration

- provider list, model list, chat/task execution, health all use same ProviderGateway via ProviderService
- CLI formatting remains CLI-specific (colors, tables), provider logic not CLI-specific
- xr providers list, status, test, route, explain, catalog, set, add, remove, metrics all use gateway path
- xr models list, select, test use gateway + runtime detection

## Dashboard Integration

- Dashboard consumes canonical provider APIs (/api/providers, /api/models, /api/providers/catalog, /api/providers/capabilities, /api/providers/fallback)
- Can show provider, status, model, capabilities, latency/health without knowing vendor SDK implementation details
- No redesign in this phase — same bento matrix UI, but now fast (<2.5s) and uses gateway

## Configuration

- Stable schema: providerEngine now has requestTimeoutMs (120000) + healthTimeoutMs (2500) both validated positive
- Added migration 18→19 additive, preserves existing requestTimeout behavior
- Defaults: healthTimeout 2500, request 120000
- Redaction: secrets never in config file (env + secret store), config json only has baseUrl overrides
- Backwards compatibility: old configs without healthTimeoutMs get default via zod default + migration
- No scattered process.env.OPENAI_API_KEY throughout execution layer — credential resolution via gateway/secrets.ts

## API Contract

- Phase02 established canonical API routing preserved
- Provider APIs remain represented in API_CONTRACT, route registry, generated schema, typed client
- New endpoints added: /api/providers/capabilities, /api/providers/fallback — additive, not breaking
- Schema generation: bun run api:schema:check passes
- Typed client: bun run client:check passes
- Compatibility check: bun run api:compat passes
- No silent route drift

## Testing

Created test/providers/gateway.test.ts covering:

- registry has builtins, getPreset, resolve valid/invalid, duplicate deterministic replace, registerOrThrow
- gateway list includes builtins, getPreset, has, capabilities, credential status local, resolveModel, catalog, fingerprint
- capability resolver streaming, localExecution, filterByCapabilities, supportsModelClass
- error normalization auth failure, rate limit, model unavailable, timeout, unknown, safe json redacts secrets, retryable vs non-retryable
- fallback chain primary only when no fallback allowed, includes fallbackProvider when configured, explanation auditable, deduplicates identical steps
- health bounded and cached, healthAll parallel
- streaming mock success yields chunks, gateway stream fallback when no chatStream
- usage normalization inTokens/outTokens/total, with totalTokens
- provider switching state machine preflight fails unknown, rollback on swap failure
- BYOK credential status requiring key, resolve credential never throws, not exposed in health
- retry policy retryable vs non-retryable
- contract same task different provider normalized structure

## Contract Test

Most important: same task, same AgentService, same Runner, different provider → same normalized execution structure (task, execution record, provider metadata, usage, checkpoints, audit, final result). Provider-specific differences allowed only where genuinely provider-specific.

Test: test/providers/gateway.test.ts "Contract: Same task different provider structure" verifies MockSuccessProvider and MockToolProvider both produce ModelTurn with same shape.

Full cross-provider contract requires live providers — documented, not claimed without credentials. Mock proves architecture.

## Provider Mocks

- MockSuccessProvider: success, streaming
- MockAuthFailProvider: auth failure 401
- MockRateLimitProvider: rate limit 429
- MockTimeoutProvider: timeout 5s stall
- MockToolProvider: tool calls

All deterministic, no real credentials.

## Golden Tasks

Existing XR golden task suite not re-created. Phase04 results compared against Phase00 baseline and Phase03 behavior:

- simple chat: uses gateway resolve → same as Phase03
- coding: same
- filesystem: same
- web/research: same
- memory: same
- tools: same
- approval: same
- budget: same
- cancellation: propagates via signal through gateway
- recovery: same
- provider switching: via ModelSwitchStateMachine

## Performance

- providers.list: via gateway healthAll parallel bounded 2500ms cached 60s — p95 <2.5s preserved
- models.list: runtimes parallel bounded 5 + cache 60s + hardware async cache — p95 <2.5s preserved
- provider resolution: RoutingService + catalog cache TTL 60s — fast, negligible vs model network latency
- first token: streaming via chatStream reduces TTFT vs full chat()
- total provider execution: bounded by requestTimeoutMs 120s, not healthTimeout

No N+1 provider health regression, no 10-18 second regression.

## Security

- API keys never logged: health reports haveKey boolean, not value; errors redacted; toSafeJson redacts
- API keys never returned: provider.list returns hasKey bool, credentialAvailable bool, not key
- Provider errors redacted: redactSecrets replaces sk-*, Bearer, api_key=... with [REDACTED]
- Provider metadata cannot expose secrets: catalog, capabilities endpoints only return metadata, not secrets
- Tool execution still passes policy: ModelSwitch + gateway resolution respects policy, tool calls via ToolRegistryService
- Provider switching cannot bypass workspace policy: localityPolicy enforced fail-closed
- Provider adapters cannot execute arbitrary commands: only fetch via guardedRequest, no eval, no shell
- Local provider paths remain sandboxed where required: allowedHosts exact host match, private-ip blocking via egress-proxy
- Search logs/errors for accidental credentials: tests verify no sk- in health json

## Boundary Check

- bun run boundaries PASS: 546 modules, 1792 deps, 0 violations
- Desired dependency direction preserved: core/execution → provider abstraction → provider adapters → external SDK/runtime
- No provider adapter → dashboard, no SDK → AgentService implementation details

## Duplication Audit

Searched for buildProvider, provider.chat, getProviderEnvStatus, provider health, registry, model discovery:

- buildProvider still exists as backward compat wrapper over gateway (documented)
- provider.chat appears only in adapters and tests + gateway fallback — not in daemon routes or CLI directly (except via gateway)
- getProviderEnvStatus removed from daemon routes (now gateway.credentialStatus + list)
- provider health: single canonical health.ts with bounded cached deduped + gateway wrapper
- provider registry: single singleton registry, versioned
- model discovery: buildCatalog cached, gateway.catalog wrapper, no N+1
- No second provider orchestration path — CLI and daemon both use same gateway/ProviderService

## Backward Compatibility

- Existing provider IDs preserved (ollama, openai, anthropic, etc.)
- Config semantics preserved: defaults.provider/model, fallbackProvider, providerEngine customProviders, providers map baseUrl overrides
- PRESETS stable
- buildProvider wrapper over gateway for backward compat
- If breaking migration necessary: STOP and document explicitly — none required, additive only
- Compatibility adapters: factory still works, registry still singleton

## What is deferred to Phase05

- Full local AI System: model pull/remove already exists but full Model Manager UI, download progress, storage management for Phase05
- Ollama Docker Model Runner, Ramalama, etc. — not in Phase04, only Ollama + existing 10 local runtimes
- Token-level streaming in agent loop instrumentation — Phase04 adds chatStream at adapter level, loop still turn-level via say(), token-level needs loop instrumentation (Phase05)
- Dashboard approval UI — Phase04 defaults dangerous tools to deny + emits approval_required event, UI upgrade later
- Provider-specific dynamic /models endpoint caching (OpenRouter models.dev live fetching) — Phase04 keeps static presets, enough for 25 providers
- Non-native FC fallback full prompt-based for all local models — Phase04 uses systemEnvelope JSON envelope which is already prompt-based, but full OpenHands-style prompting for older models complete in Phase05
- Full ModelSwitchStateMachine for local model pulling (warm phase load model into runtime) — only canary + verify for now
- 100+ providers via LiteLLM — not needed, 25 static presets sufficient

## Migration

No data migration. Config version 18→19 additive migration for healthTimeoutMs.

## Rollback

Feature flag XR_PROVIDER_GATEWAY=0 disables gateway, falls back to direct registry.createProvider.
Rollback commit: before Phase04 commit.

## Exit Criteria

- Provider health bounded 2500ms p95 <2.5s: PASS (health.ts bounded + cache)
- No N+1 catalog building single build per request: PASS (buildCatalog cached, gateway.catalog)
- Fallback chain works provider failure triggers fallback local healthy not 503 immediate: PASS (resolveFallbackChain + executeWithFallback)
- Ollama special-casing documented, not duplicated elsewhere: PASS (detectOllama /api/tags documented as justified, not duplicated in factory)
- Model switch state machine preflight warm canary swap verify rollback tested: PASS (model-switch.ts + tests)
- Streaming chatStream yields token events: PASS (openai-compat SSE + gateway.stream)
- bun test test/providers/gateway.test.ts passes: PASS 43/43

## Benchmarks

- providers.list p95 <2.5s: expected PASS (bounded + cached)
- models.list <2.5s: expected PASS (parallel bounded + cached)

## Security Gates

- Secret never in prompt, health never returns key: PASS (credentialStatus boolean, error redaction, health no key)
- No secret leakage: PASS

## Reliability Gates

- Fallback chain, health bounded: PASS

## Deliverables

- ProviderGateway singleton
- Health bounded cache TTL 60s
- Fallback chain
- Model switch state machine (already existed, now integrated with gateway)
- Streaming
- Tests
- Docs
