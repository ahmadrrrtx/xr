# XR 4.4 — Universal Intelligence Plane Architecture

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Version:** 4.4.0  
**Codename:** Universal Intelligence Plane  
**Phase:** 5  
**Previous:** XR 4.3 Durable Agency  

---

## 1. Purpose

XR already had provider adapters, presets, health checks, and a strategy-based router. Phase 5 adds a **provider-neutral intelligence plane** that:

1. Declares model/provider capabilities in a vendor-independent contract.
2. Discovers candidates from the existing registry/catalog.
3. Filters by task requirements and policy (privacy, budget, credentials, health).
4. Scores remaining candidates with a deterministic, explainable model.
5. Selects, records, and optionally fails over — without rewriting the agent kernel.

Governing rule:

> XR chooses intelligence according to task constraints and measured capability, while advanced users retain complete manual control.

---

## 2. Layer Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Consumers (Agent, Multi-Agent, Research, Voice, CLI, API)  │
└───────────────────────────┬─────────────────────────────────┘
                            │ RouteRequest / pins
┌───────────────────────────▼─────────────────────────────────┐
│              IntelligenceService (Tokens.Intelligence)       │
│  catalog · route · resolveProvider · explain · metrics       │
└───────────┬─────────────────────────┬───────────────────────┘
            │                         │
   ┌────────▼────────┐       ┌────────▼────────┐
   │ IntelligenceRouter│       │ ProviderRegistry │
   │ filter → score → │       │ + factory (thin) │
   │ select → explain │       └────────┬─────────┘
   └────────┬────────┘                │
            │                 ┌───────▼────────┐
   ┌────────▼────────┐       │ Provider adapters│
   │ Decision record  │       │ (openai-compat,  │
   │ (durable/audit)  │       │  native, custom) │
   └─────────────────┘       └──────────────────┘
```

Routing logic does **not** live in provider adapters or UI code.

---

## 3. Capability Contract

### Tri-state support

| Value | Meaning |
|---|---|
| `supported` | Verified / declared supported |
| `unsupported` | Known not to work |
| `unknown` | Not declared — **never treated as true** |

Legacy `ProviderCapabilities` booleans remain for presets/UI. The intelligence plane maps them via `fromLegacyCapabilities()` where `undefined → unknown`.

### Model classes

`chat | completion | reasoning | code | tool_use | structured_output | vision | speech_to_text | text_to_speech | image_generation | image_understanding | embeddings | reranking | multimodal | unknown`

Only classes with real adapters are selected in practice. Unknown/unimplemented classes are representable and rejected clearly.

### Descriptors

- **ProviderDescriptor** — identity, locality, auth, capability floor, health snapshot.
- **ModelDescriptor** — per-model classes, modalities, context limits, cost/latency/quality profiles, limitations.

---

## 4. Task Requirements

Callers pass only selection-relevant fields:

- `modelClass`, `modalities`, `require.*`
- `minContextTokens`, latency/quality preferences
- `maxCostUsd`, `localityPolicy`
- `pin` / `preferred`, `allowFallback`, `allowCloudFallback`
- `disableHistorical`, `summary` (safe)

Memory retrieval and context compression are **out of scope** (Phase 6+).

---

## 5. Routing Modes

| Mode | Behavior |
|---|---|
| `manual` | Pin only (defaults act as pin) |
| `preferred_with_fallback` | Defaults preferred; fallback allowed |
| `local_only` | Hard filter: local locality only |
| `private_only` | Local + private endpoints |
| `automatic` | Full filter + score |
| `cost_constrained` | Emphasize free/cheap |
| `latency_constrained` | Emphasize fast profiles |
| `quality_constrained` | Emphasize quality profile |
| `disabled` | No automatic selection |

Legacy `providerEngine.routingStrategy` maps into these modes. Explicit pins always outrank automatic preference unless the pin is unavailable **and** fallback is explicitly allowed.

---

## 6. Filtering then Scoring

**Filter first** (hard rejects): capability, modality, context, locality, budget extremes, credentials, health (non-stale), strict pins.

**Then score** (0..1 factors, inspectable weights):

- taskFit, quality, latency, cost, locality, preference, historical, availability

Historical influence requires `samples ≥ 3` and `confidence ≥ 0.3`. Sparse data is ignored (neutral score).

Tie-break: preference → free → lexical `providerId/modelId`.

---

## 7. Fallback & Escalation

- Model-call level only (`FallbackProvider` / chain).
- Never silently escalate local → cloud without `allowCloudFallback`.
- `unknown_completion` **cannot** auto-fallback (duplicate side-effect safety).
- Budget/privacy failures revalidate rather than blind retry.
- Empty chain → `humanHandoff.required`.

---

## 8. Decision Persistence

`RoutingDecision` (full) and `RoutingDecisionRecord` (durable, bounded):

- requirement summary, mode, selected provider/model
- factors, fallback chain, locality policy
- rejected count, confidence, handoff flag

Attached to:

- audit event `intelligence.route`
- agent fabric evidence `routing:<decisionId>`
- optional `ExecutionRecord.routing`

No secrets, no raw prompts.

---

## 9. Kernel Registration

- `Tokens.Intelligence` → `IntelligenceService`
- `IntelligenceServiceProvider` registered after `LlmServiceProvider`
- Catalog degradation does not fail core readiness

---

## 10. Configuration (`intelligencePlane`)

Additive under config version **14**:

```json
{
  "intelligencePlane": {
    "mode": "automatic",
    "localityPolicy": "any",
    "allowFallback": true,
    "allowCloudFallback": false,
    "preferFree": true,
    "disableHistorical": false,
    "enableAutomatic": true
  }
}
```

Defaults preserve XR 4.3 hybrid behavior. `localModels.routing: "local-only"` maps to `localityPolicy: local_only`.

---

## 11. Phase Boundaries

### Owned by Phase 5

Model/provider capability, discovery, filtering, scoring, routing modes, fallback policy, decision records, consumer wiring for selection.

### Explicitly not owned

- Memory/context OS, progressive compression, knowledge graph (Phase 6+)
- New multimodal product surfaces
- Distributed schedulers / remote execution
- Trust authority or durable attempt semantics (consumed, not replaced)

---

## 12. Key Modules

| Path | Role |
|---|---|
| `src/intelligence/types.ts` | Contracts |
| `src/intelligence/capability.ts` | Tri-state + preset mapping |
| `src/intelligence/catalog.ts` | Catalog build |
| `src/intelligence/evaluator.ts` | Hard filters |
| `src/intelligence/scorer.ts` | Deterministic scores |
| `src/intelligence/metrics.ts` | Bounded outcomes |
| `src/intelligence/fallback.ts` | Safe chain |
| `src/intelligence/router.ts` | select + explain |
| `src/intelligence/service.ts` | Platform facade |
| `src/providers/routing.ts` | Compat wrapper + FallbackProvider |
