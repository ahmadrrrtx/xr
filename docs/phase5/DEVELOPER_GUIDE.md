# XR 4.4 — Developer Guide (Intelligence Plane)

## Adding a provider (bounded adapter)

1. **Adapter** — implement `Provider` (`chat` + `health`) in `src/providers/` or `native/`.
2. **Preset** — add `ProviderPreset` in `src/providers/presets.ts` with honest capabilities.
3. **Register** factory in `src/providers/factory.ts` `registerBuiltins()`.
4. **Pricing** (optional) — `src/cost/pricing.ts`.
5. **Tests** — identity, capability declaration, unsupported ops, locality metadata.

You do **not** edit the agent kernel, multi-agent supervisor, or every consumer.

### Capability honesty

```ts
capabilities: caps({ toolUse: true, jsonMode: true, streaming: true })
// Omit fields you have not verified — they become "unknown", not true.
```

Optional config override (advanced):

```json
"providerEngine": {
  "providerCapabilities": {
    "myprovider": {
      "vision": true,
      "models": { "my-vision-1": { "contextWindow": 64000 } }
    }
  }
}
```

## Declaring task requirements

```ts
import type { TaskRequirements } from "../intelligence/types.ts";

const requirements: Partial<TaskRequirements> = {
  modelClass: "tool_use",
  require: { toolUse: true, jsonMode: true },
  minContextTokens: 16_000,
  localityPolicy: "local_only",
  allowFallback: true,
  allowCloudFallback: false,
  summary: "refactor module",
};

const provider = providerService.getProvider({
  requirements,
  // provider/model pins still win when set
});
```

## Manual override

```ts
getProvider({ provider: "anthropic", model: "claude-3-5-sonnet-20241022" });
// strict pin — no silent swap unless requirements.allowFallback === true
```

## Explaining a decision

```ts
const { decision, record } = providerService.route({ requirements });
console.log(decision.explanation, decision.factors, record);
```

CLI:

```bash
xr providers route --local-only
xr providers explain --class tool_use --json
xr providers catalog
```

Daemon:

```
GET /api/providers/route?localOnly=true&detailed=true
GET /api/providers/catalog
```

## Fallback rules for authors

- Only model-call failures should trigger `FallbackProvider`.
- After tools may have run, treat completion as `unknown_completion` — do not auto-fallback.
- Re-check budget and locality before constructing the next candidate.

## Future model classes

1. Add class to `ModelClass` union (if new).
2. Map capability field in `evaluator.ts` `CLASS_CAP_FIELD`.
3. Ship adapter + preset declaring the capability as `supported`.
4. Consumers pass `modelClass` in requirements.

Unsupported classes fail closed with a clear rejection reason.

## Contract test checklist

- [ ] Identity (`id`, `label`)
- [ ] Capability declaration (no false supported)
- [ ] Health without leaking keys
- [ ] Cost + locality metadata
- [ ] Credential requirements
- [ ] Unsupported operation behavior
- [ ] Local-only routing never selects this cloud adapter
