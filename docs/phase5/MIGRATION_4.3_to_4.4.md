# Migration Guide — XR 4.3 → XR 4.4

**From:** 4.3.0 Durable Agency  
**To:** 4.4.0 Universal Intelligence Plane  

---

## What changes for users

- Automatic provider selection becomes **capability-aware** and **explainable**.
- Explicit `defaults.provider` / `defaults.model` and CLI pins **still win**.
- New optional config block: `intelligencePlane`.
- New commands: `xr providers route`, `explain`, `catalog`.
- New daemon routes: `GET /api/providers/route`, `GET /api/providers/catalog`.

## What does **not** change

- Provider adapter protocols (OpenAI-compat, native Anthropic/Google/…).
- Agent loop, tools, MCP, plugins, skills APIs.
- Trust/isolation and durable-agency semantics.
- Memory/RAG behavior (no Phase 6 redesign).
- Local-only operation when configured.
- Budget ceilings and credential handling.

---

## Configuration migration

Config version advances **13 → 14**.

On load, XR injects defaults:

```json
"intelligencePlane": {
  "localityPolicy": "any",          // or local_only if localModels.routing was local-only
  "allowFallback": true,
  "allowCloudFallback": false,
  "preferFree": true,
  "latencyPreference": "any",
  "qualityPreference": "any",
  "disableHistorical": false,
  "enableAutomatic": true
}
```

### Legacy strategy mapping

| `providerEngine.routingStrategy` | Intelligence mode |
|---|---|
| `primary` | preferred_with_fallback |
| `localFirst` | automatic (local bias) |
| `cloudFirst` | automatic (cloud bias when keyed) |
| `hybrid` | automatic |
| `cheapest` | cost_constrained |
| `fastest` | latency_constrained |

### Local-only

```json
"localModels": { "routing": "local-only" }
```

or

```json
"intelligencePlane": { "mode": "local_only", "localityPolicy": "local_only" }
```

Cloud models are hard-filtered. Pins cannot bypass this.

---

## API compatibility

| API | Status |
|---|---|
| `buildProvider(config, { provider, model })` | Unchanged signature; uses intelligence plane internally |
| `ProviderService.getProvider({ provider, model, strategy })` | Compatible; adds optional `requirements`, `mode` |
| `ProviderRouter.resolve` | Compatible |
| `FallbackProvider` | Compatible |
| Custom providers in `providerEngine.customProviders` | Compatible |

New:

- `buildProviderWithDecision(...)`
- `ProviderService.route(...)` / `getLastDecision()`
- `Tokens.Intelligence` / `IntelligenceService`

---

## Durable records

- New optional `ExecutionRecord.routing` field (backward compatible).
- Agent fabric may attach routing evidence.
- Old 4.3 records load without routing metadata (treated as unavailable/unknown for history).

Historical quality metrics **start empty**. XR does not invent quality scores from pre-4.4 cost rows.

---

## Rollback

1. Set `"intelligencePlane": { "mode": "manual" }` or `"disabled"`.
2. Keep explicit `defaults.provider` / `model`.
3. Or pin every call with `--provider` / API overrides.
4. Package rollback to 4.3.0 is safe for workspace DBs (routing field ignored).

Rollback never bypasses privacy, budget, trust, or durability checks.

---

## Breaking changes

None intended for normal users. Developers depending on undocumented private helpers of `ProviderRouter` (e.g. assuming strategy always rewrites pins) may see stricter pin precedence — this is intentional.

---

## Known limitations (4.4.0)

- Speech STT/TTS and embeddings still use their existing selection paths; they can declare model classes but are not fully re-homed onto every consumer.
- Image generation / reranking classes are representable but have no shipped adapters.
- Health used for routing prefers cached/runtime metadata; live `checkAll` is not run on every route.
- Historical metrics are in-process unless a caller persists samples.
