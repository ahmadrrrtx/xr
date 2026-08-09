# XR 4.4 Universal Intelligence Plane — Pre-Implementation Audit

**Date:** 2026-07-26  
**Baseline:** XR 4.3.0 Durable Agency  
**Commit:** `436b942` (main; includes `bb976e4` and later no-op merges)  
**Package:** `@rrrtx/xr@4.3.0`  
**Auditor:** Implementation Agent  
**Status:** Complete — ready for Phase 5 implementation  

---

## 1. Baseline Verification

| Gate | Result | Notes |
|---|---|---|
| Checkout | ✅ `main` @ `436b942` | After `bb976e4` (PR #15); PRs #16/#17 are non-functional |
| Bun | ✅ 1.3.14 | x64 Linux container |
| `bun install` | ✅ 8 packages | Frozen clean install |
| `bun run set-version:check` | ✅ | package.json ↔ version.ts in sync at 4.3.0 |
| `bun run typecheck` | ✅ | No errors |
| `bun test` | ✅ 712/714 | 2 failures are OS-sandbox dependent (namespace), not code defects |
| Phase 0–1 kernel | ✅ | Lifecycle, registry, health tests pass |
| Phase 2 execution | ✅ | State machine, repository, adapters pass |
| Phase 3 trust | ✅ | Fail-closed policy; 2 sandbox env failures expected |
| Phase 4 durability | ✅ | Checkpoint/lease/recovery tests pass |

**Conclusion:** Prior-phase gates are green. Phase 5 may proceed.

---

## 2. Provider/Model Contract Inventory

### 2.1 Core provider interface (`src/core/types.ts`)

```ts
interface Provider {
  id: string;
  label: string;
  chat(messages, tools): Promise<ModelTurn>;
  health(): Promise<{ ok; latencyMs?; detail? }>;
}
```

- Single operation surface: **chat** only.
- No capability introspection on the instance.
- No model identity separate from construction-time model string.
- Health is live-only (no cached snapshot).

### 2.2 Capability schema (`src/providers/capabilities.ts`)

Boolean flags only:

| Field | Default | Unknown vs unsupported |
|---|---|---|
| chat | true | ❌ conflated (absent = false) |
| reasoning | optional | ❌ |
| vision | optional | ❌ |
| embeddings | optional | ❌ |
| toolUse | optional | ❌ |
| jsonMode | optional | ❌ |
| functionCalling | optional | ❌ |
| streaming | optional | ❌ |

**Gap:** Cannot distinguish *unknown* from *unsupported*. No modalities, context limits, locality, cost, hardware, quality, or rate-limit metadata.

### 2.3 Presets (`src/providers/presets.ts`)

- ~25 built-in providers (local + hosted + enterprise).
- Fields: id, label, kind, tier, baseUrl, apiKeyEnv, authType, defaultModel, knownModels[], capabilities, description, docsUrl.
- **No per-model descriptors** — capabilities are provider-level only.
- `caps()` spreads defaults with `chat: true`; optional booleans default to undefined/falsy.

### 2.4 Registry / factory / health

| Component | Responsibility | Gap |
|---|---|---|
| `registry.ts` | Map preset → factory; custom sync | No model catalog; no capability query API |
| `factory.ts` | Register builtins; `buildProvider` → router | Construction mixed with strategy selection |
| `health.ts` | Live check per provider | No cache; every routing path that checked would be expensive |
| `routing.ts` | Strategy: primary/localFirst/cloudFirst/hybrid/cheapest | No task requirements, no capability filter, no explainable scores |
| `openai-compat.ts` + native/* | Vendor adapters | Thin; OK to keep |

### 2.5 Custom providers

OpenAI-compat wrapper with optional capability object (boolean defaults). No model-class vocabulary.

---

## 3. Capability / Modality Matrix (current)

| Provider | chat | tools | json | stream | vision | embed | reason | locality |
|---|---|---|---|---|---|---|---|---|
| ollama | ✓ | ✓ | ✓ | ✓ | ? | ? | ? | local |
| lmstudio | ✓ | ✓ | ✓ | ✓ | ? | ? | ? | local |
| llamacpp | ✓ | ? | ✓ | ✓ | ? | ✓ | ? | local |
| gpt4all | ✓ | ? | ? | ✓ | ? | ? | ? | local |
| groq | ✓ | ✓ | ✓ | ✓ | ? | ? | ? | cloud |
| google | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ? | cloud |
| deepseek | ✓ | ? | ✓ | ✓ | ? | ? | ✓ | cloud |
| openai | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ? | cloud |
| anthropic | ✓ | ✓ | ✓ | ✓ | ✓ | ? | ? | cloud |
| cohere | ✓ | ✓ | ✓ | ✓ | ? | ✓ | ? | cloud |
| bedrock | ✓ | ✓ | ✓ | ✓ | ✓ | ? | ? | cloud/private |
| perplexity | ✓ | ? | ✓ | ✓ | ? | ? | ? | cloud |
| speech STT/TTS | — via voice stack, not provider contract | | | | | | | local-first |
| image gen | ❌ not present | | | | | | | — |
| rerank | ❌ not present | | | | | | | — |

`?` = unknown (preset does not declare). Phase 5 must represent unknown safely.

---

## 4. Current Routing Map

```
config.defaults.provider/model
        │
        ▼
buildProvider(config, override?)
        │
        ▼
ProviderRouter.resolve({ provider?, model?, strategy? })
        │
        ├─ strategy localFirst  → findBestLocal()
        ├─ strategy cloudFirst  → findBestCloud() if primary local
        ├─ strategy cheapest    → findCheapestAvailable() by tier
        ├─ strategy hybrid/primary/fastest → keep primary (fastest unused)
        │
        ├─ create primary via registry
        ├─ optional FallbackProvider(primary, fallback)
        └─ return Provider
```

**Implicit assumptions:**
1. Explicit override only sets primary id/model; strategy can still rewrite under localFirst/cheapest.
2. Fallback is always try/catch on `chat` — no capability compatibility check.
3. No privacy/local-only hard gate on automatic cloud selection (localModels.routing exists but router only uses localFirst strategy loosely).
4. No task-type awareness (tool-use, vision, embeddings).
5. No historical performance.
6. No decision record / explanation.
7. `fastest` strategy is declared but not implemented.
8. Agent service passes only provider/model overrides — never strategy or task requirements.

---

## 5. Consumer Integration Map

| Consumer | Path | Override support |
|---|---|---|
| AgentService | `providerService.getProvider({provider, model})` | explicit pin only |
| MultiAgentService | task.providerScope → AgentService | per-task pin |
| research/cli | `buildProvider(config, {provider, model})` | CLI args |
| control/cli + tools | `buildProvider(config, {})` | defaults |
| voice/pipeline | `buildProvider(config, {})` | defaults |
| daemon chat/control | `buildProvider(config, {})` | defaults |
| daemon providers | list/set/health | manual |
| interfaces/providers + shell | `buildProvider` | manual set |
| plugins/host | `buildProvider(config, {provider, model})` | plugin-requested |
| telegram/bot | `buildProvider(config, {})` | defaults |
| memory/embed | separate embed target (local Ollama / OpenAI-compat) | env/config, not intelligence plane |
| voice STT/TTS | own backend selection | voice config |

---

## 6. Health / Cost / Latency Data Map

| Source | Reliability for routing |
|---|---|
| `provider.health()` | Live; latency available; expensive if called per candidate |
| CostRepo / pricing table | Reliable for estimate; model match via regex |
| CostGovernor | Per-task ceiling; no historical model quality |
| Durable execution cost | providerId/model/tokens on ExecutionCost | usable if correlated |
| Historical success rates | **Not available** as a first-class store | must start empty with confidence gates |
| localModels.runtimes.*.healthy | Cached runtime status | usable for local availability |

**Decision:** Historical metrics store is new, starts empty, influences routing only when coverage ≥ threshold. Do not fabricate quality from old cost rows.

---

## 7. Privacy / Locality Policy Map

| Control | Location | Enforced by routing today? |
|---|---|---|
| localModels.routing: local-only/hybrid/cloud-first | config | Partially (strategy mapping only) |
| localModels.enabled | config | Soft (fallback prefers local when hybrid) |
| provider kind local/hosted | presets | Used for findBestLocal/Cloud |
| Trust placement | Phase 3 | Not consulted for model selection |
| Voice allowCloudStt/Tts | voice config | Voice-only |
| preferFreeProviders | config | Not used by ProviderRouter |
| egress allowlist | security | Tool egress, not LLM |

**Phase 5 requirement:** Automatic routing must hard-filter cloud under local-only / private-only; never silently escalate locality.

---

## 8. Durable Resume / Fallback Analysis

| Concern | Current behavior | Phase 5 requirement |
|---|---|---|
| Routing decision persistence | Not recorded | Persist on ExecutionRecord / decision store |
| Fallback attempt lineage | FallbackProvider swaps silently mid-chat | New attempt or explicit fallback decision; preserve original selection |
| Resume with unavailable provider | No revalidation of model choice | Revalidate; manual pin never silent-swapped |
| Ambiguous completion | Fallback may double-call | Do not auto-fallback after unknown side-effect |
| Cost across attempts | Meter continues on fallback provider | Charge accurately; re-check budget |
| Duplicate side effects | Risk if tools already ran | Fallback only before side effects or on transport failure of model call |

ExecutionRecord has no `routing` field today. Phase 5 adds optional `routing?: RoutingDecisionRecord` via adapter metadata / evidence without breaking schema (JSON passthrough on meta/evidence).

---

## 9. Manual-Override Compatibility Matrix

| Override | Precedence today | Phase 5 |
|---|---|---|
| CLI/API provider+model | Used as primary; strategy may still rewrite | **Pin wins**; strategy cannot rewrite explicit pin unless pin unavailable + fallback allowed |
| defaults.provider/model | Primary | Same |
| defaults.fallback* | Secondary wrapper | Explicit fallback chain |
| providerEngine.routingStrategy | Rewrites primary | Mapped into intelligence routing mode |
| task.providerScope | Multi-agent pin | Unchanged — highest task-level pin |
| local-only | Soft | Hard filter |

---

## 10. File-by-File Implementation Proposal

### New (`src/intelligence/`)

| File | Responsibility |
|---|---|
| `types.ts` | Model class, modality, capability tri-state, task requirements, routing modes, decisions |
| `capability.ts` | Tri-state helpers; preset → descriptor mapping |
| `catalog.ts` | Provider/model catalog built from registry + presets + custom |
| `evaluator.ts` | Hard filters + rejection reasons |
| `scorer.ts` | Deterministic explainable scoring |
| `metrics.ts` | Bounded outcome metrics + confidence |
| `fallback.ts` | Safe fallback chain construction |
| `router.ts` | select() → RoutingDecision |
| `service.ts` | Platform IntelligenceService |
| `index.ts` | Public exports |

### Modified

| File | Change |
|---|---|
| `src/providers/capabilities.ts` | Extend with tri-state CapabilityValue + model-class helpers; keep boolean compat |
| `src/providers/presets.ts` | Add optional locality, contextLimits, quality hints; unknown stays unknown |
| `src/providers/routing.ts` | Delegate to intelligence router; preserve FallbackProvider + buildProvider API |
| `src/providers/registry.ts` | Capability/catalog query helpers |
| `src/providers/health.ts` | Optional short TTL health cache for routing |
| `src/providers/factory.ts` | Keep construction; routing via intelligence |
| `src/services/provider-service.ts` | Expose route/explain; integrate intelligence |
| `src/services/agent-service.ts` | Pass task requirements; record decision |
| `src/core/tokens.ts` | Tokens.Intelligence |
| `src/core/providers.ts` | IntelligenceServiceProvider |
| `src/core/health.ts` | Degraded catalog report (non-fatal) |
| `src/config/config.ts` | Additive intelligencePlane settings; CONFIG_VERSION 14 |
| `src/commands/providers.ts` | route/explain subcommands |
| `src/daemon/routes/providers.routes.ts` | route explain API |
| `src/cost/estimate.ts` | Candidate cost estimate helper (thin) |
| `src/execution/types.ts` | Optional routing decision on records (non-breaking) |
| `src/execution/adapters/agent-adapter.ts` | Attach routing evidence when present |
| package.json / version | 4.4.0 Universal Intelligence Plane |
| docs/phase5/* | Architecture, migration, validation |
| test/intelligence/* | Contract + routing + privacy + fallback tests |

### Deferred (Phase 6+)

- Memory/context redesign, progressive compression, knowledge graph
- New multimodal product surfaces (image gen UI, vision pipelines)
- Distributed model scheduler / remote execution
- Embedding model training / ML routing models
- Enterprise multi-tenant control plane

---

## 11. Stop-Condition Check

| Condition | Status |
|---|---|
| Phase 0–4 not green | ❌ Not triggered (green) |
| Provider interfaces cannot support contract | ❌ Solvable via compatibility layer + descriptors |
| Auto routing would violate policy | ❌ Design enforces hard filters |
| Historical metrics unavailable | ✅ Start empty; confidence-gated |
| New model type needs memory redesign | ❌ Not doing that |
| Fallback duplicates side effects | ✅ Design: model-call-level fallback only; no silent tool replay |
| Adapter needs agent kernel rewrite | ❌ Bounded contract |

**Proceed to implementation.**
