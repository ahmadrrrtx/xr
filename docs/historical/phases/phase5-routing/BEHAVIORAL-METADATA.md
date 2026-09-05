# Behavioral Capability Metadata (Phase 5)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Charter §9.8:** model behavior is *measured and recorded*, never
vendor-claimed. This note defines what XR measures, how it is stored, and
exactly how it changes (and does not change) routing.

---

## 1. What a behavioral contract is

`BehavioralContract` (`src/intelligence/behavioral.ts`) — produced by
offline probes against a real provider adapter:

| Field | Meaning |
|---|---|
| `structuredOutputFidelity` | fraction of probes returning clean parseable JSON |
| `toolUseFidelity` | fraction of probes emitting a valid expected tool call |
| `contextRetention` | fraction of anchor facts correctly recalled |
| `refusalRate` | fraction of benign prompts refused (lower is better) |
| `overallFidelity` | weighted blend (tools .30 · structured .25 · retention .25 · non-refusal .20) |
| `samples` / `confidence` | probe count + confidence growing with it |
| `measuredAt` | epoch ms of the measurement |
| `source` | `"measured"` (from probes) — static presets are `declared` by absence of a contract |
| `refusalPatterns` | observed refusal categories (safety/over-caution/format/unknown) |

Nothing else is claimed. There is no "quality score", no benchmark brand,
no certification word in the data.

## 2. How measurement happens (offline only)

```
xr providers measure [--provider P] [--model M] [--json]
```

- Runs 7 bounded probes per model: 2 structured-output, 2 tool-use
  (scripted `xr_probe.echo`), 2 benign refusal, 1 retention
  (anchor `XR-ANCHOR-7741`).
- **Never on the hot path.** `route()`/`resolveProvider()` never call the
  evaluator. Probes may cost paid tokens on cloud providers; the CLI says
  so and honors the workspace locality policy (a target the policy could
  not route to is skipped, recorded, not probed — no silent egress).
- Credential-less targets skip honestly (`"credentials missing"`).
- **Unreachable targets are not measured.** If no probe returns a turn, the
  evaluator throws and the target is *skipped* with the transport error —
  no fabricated zero-fidelity contract is saved (Art. IV).

Results persist to `$XR_HOME/cache/intelligence/behavioral.json`
(atomic tmp+rename; secret-free: fidelities and counts only, never
payloads).

## 3. How routing uses contracts (decision-path semantics)

1. **Fidelity floor (capability gate).** A task's difficulty derives a
   floor (easy .40 / standard .60 / hard .75 / frontier .85). A model with
   a *measured* `overallFidelity` below the floor is rejected
   (`fidelity_below_floor`). Unmeasured models are **not** gated — static
   priors apply, cold start unaffected.
2. **Scoring prior replacement.** For measured models the quality term
   blends requirement-weighted measured fidelities — the factor list says
   `measured fidelity 0.95 (n=7)`; unmeasured models show
   `quality from static prior (unmeasured)`. Price tier never imputes
   ability once a measurement exists.
3. **Degradation levels.** Both endpoints measured ⇒ L1 when the fallback
   is within 0.1 overall fidelity of the selected model, else L2.
4. **Cost-per-quality SLO.** Outcome cost × measured fidelity flows into
   the SLO stream (see ROUTING-SLOS.md).

## 4. What routing deliberately does NOT do with contracts

- No contract ⇒ no penalty (measured gating is opt-in by evidence).
- Pinned selections skip the floor (manual override is complete, §9.5) —
  a below-floor measured pin still routes, with a factor warning.
- Contracts never inject credentials, prompts, or payloads into logs.
- Contracts are **inputs**, cached for the authority only; the store is not
  a public API and no other plane consumes it.

## 5. Operator workflows

Refresh after a model upgrade: `xr providers measure --provider ollama`.
Inspect what routing sees: `xr providers explain` (detailed factors show
measured-vs-static basis). Audit history: the store keeps the latest
contract per target plus `measuredAt`; SLO JSONL keeps cpq events.

## 6. Known limits (full list in KNOWN-LIMITATIONS.md)

- 7 probes per model ⇒ coarse confidence for borderline models; the
  contract carries `confidence` so downstream logic can weigh it.
- Probes measure *probe-worthy* behavior; they are not a benchmark.
- Provider-level `providerCapabilities.<id>` overrides (set via
  `xr providers add`) tune **catalog UX**; the decision path reads
  per-model declarations (`providerCapabilities.<id>.models.<model>`) —
  a seeded model-level declaration is honored (and a pin can override it).
