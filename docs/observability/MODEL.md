# XR Observability Model

**Phase:** 8 · T2 — implements Constitution Art. XXI (privacy) and Art. XII (no startup regression).
**Gates:** `test/observability/privacy.test.ts` (merge-blocking), `bun run profile:gate` (CI).

---

## 1. What this is

An opt-in, local-first observability plane for XR: **traces, metrics, and
logs** following the OpenTelemetry data model and the OpenTelemetry **GenAI
semantic conventions** (`chat <model>`, `execute_tool <tool>`,
`invoke_agent <agent>` spans; `gen_ai.*` attributes;
`gen_ai.client.operation.duration` metric), exportable over **OTLP/HTTP
(JSON)** to any OTLP collector — with the standalone **Aspire Dashboard** as
the default local viewer. No cloud account is ever required.

## 2. Privacy non-negotiables (Art. XXI)

| Guarantee | Mechanism | Proof |
|---|---|---|
| **Opt-in** | `telemetry.enabled` defaults to `false`; when disabled the exporter is inert and performs **zero** network calls | `privacy.test.ts` intercepts `fetch` and asserts zero calls while running instrumented code |
| **Structural by default** | Spans/metrics carry durations, model/provider/tool **names**, token **counts**, placements, SLOs — never prompt/tool content | `no prompt/tool content by default` tests serialize every span/metric and scan for planted content strings |
| **Content is explicit opt-in** | `telemetry.content.prompt` / `telemetry.content.toolArgs` flags, both default `false`; `xr telemetry enable --content …` makes the choice deliberate | even *with* opt-in, the redactor still runs (opt-in ≠ unredacted) |
| **Redaction always on** | Every span attribute/event is passed through the PII/secret redactor (API keys, bearer tokens, `api_key=`/authorization strings, e-mail-ish values…) → `⟨redacted:kind⟩` | redaction corpus test + span-enforced redaction test |
| **Cardinality bounded** | Per-metric label budgets (e.g. route ids 80, provider×model 40); overflow folds into the `xr_other` bucket and increments `xr_cardinality_overflow_total` | cardinality folding test |
| **Local-first** | Default OTLP endpoint is `http://127.0.0.1:4318` (local viewer). See `LOCAL-VIEWER.md` | config default + telemetry command tests |

`xr telemetry status [--json]` always answers *"what exactly is being
captured right now?"*

## 3. Signals

### Traces

| Span | Kind | Key attributes |
|---|---|---|
| `{METHOD} {path}` (daemon request) | server | `http.request.method`, `http.route`, `http.response.status_code`, `xr.api.mount` (v1/legacy) |
| `chat {model}` | client | `gen_ai.operation.name=chat`, `gen_ai.provider.name` (+`gen_ai.system` twin for interop), `gen_ai.request.model`, `gen_ai.usage.input_tokens/output_tokens`, `gen_ai.response.finish_reasons` |
| `execute_tool {tool}` | internal | `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.type`, outcome |
| `invoke_agent {agent}` | internal | `gen_ai.agent.name`, `gen_ai.agent.id` |
| `xr.routing.select` | internal | `gen_ai.provider.name`, `gen_ai.request.model`, `xr.routing.reason`, `xr.routing.unavailable` — **never the task text** |
| `xr.isolation.place` | internal | `xr.placement.tier`, `xr.placement.backend`, `xr.placement.blocked` |
| `execute {kind} {name}` (canonical envelope) | internal | `xr.capability.kind`, `xr.outcome`, `xr.run.id` |

Parentage: tool/LLM/routing/placement spans nest under the ambient span via
async-local context (no explicit context threading). An end-to-end daemon
request therefore produces one trace with the children above
(`instrumentation-e2e.test.ts`, `envelope-trace.test.ts` assert exactly that).

### Metrics (Prometheus text + OTLP)

`GET /api/v1/metrics` (auth-gated like every API route) renders the live
registry in Prometheus exposition format (`# EOF`-terminated):

- `xr_http_requests_total`, `xr_http_request_duration_ms` — by route id, method, status
- `gen_ai_client_operation_duration` — GenAI call latency by provider/model
- `xr_llm_tokens_total` — token counts by provider/model/direction
- `xr_routing_decisions_total` — by target provider + reason
- `xr_routing_selection_ms` — routing latency histogram
- `xr_isolation_placements_total` — by tier/backend/outcome
- `xr_capability_executions_total` — by capability kind/outcome
- `xr_cardinality_overflow_total` — budget overflow folding signal

### Logs

The structured logger emits records with severity + bounded attributes; when
a span is active the record is **trace-correlated** (`trace_id`, `span_id`).
Pushed over OTLP as logs when `exportLogs` is on. `XR_LOG_LEVEL` controls
verbosity.

## 4. Export pipeline

`OtlpExporter` (batched; default flush every 5 s / 100 spans; exponential
backoff on failure; **fail-quiet** — observability must never crash the
product or block requests). Wire format: OTLP/HTTP **JSON** on the
configurable endpoint (`/v1/traces`, `/v1/metrics`, `/v1/logs`; hex trace
ids, `timeUnixNano` strings, standard status codes).

Sampling: root sampling ratio `telemetry.sampleRatio` (default 1.0);
children inherit the root decision.

Local inspection without any exporter: the daemon keeps a bounded
recent-spans ring buffer (default 512) served at `GET /api/v1/traces/recent`.

All local endpoints work **with telemetry disabled** — they inspect the
local buffers, not a backend.

## 5. Config surface

`telemetry:` config section / `XR_TELEMETRY_*` env / `xr telemetry` command:

```
enabled: false            # opt-in, master switch
endpoint: http://127.0.0.1:4318
serviceName: xr
sampleRatio: 1
content: { prompt: false, toolArgs: false }
exportMetrics: true
exportLogs: true
batch: { intervalMs: 5000, max: 100 }
ringBufferSize: 512
cardinality: { …per-metric budgets… }
```

## 6. Overhead budget (Art. XII)

- Disabled: three boolean checks per instrumented call; no-op spans share a
  singleton; **zero allocations beyond the check** on the hot path and zero
  network I/O.
- Enabled: span records are small structs written to the ring buffer; export
  is off-thread batched.
- CI `bun run profile:gate` CPU-profiles CLI cold starts
  (`version`/`help`/`workspace list`/`doctor`, `--cpu-prof`) and gates wall
  time + CPU against the recorded baseline with a +30% band
  (`docs/perf/profile-baseline.json`).

## 7. What this is NOT (honest boundaries — Phase 10+)

- No hosted/managed observability backend, no SIEM integration — local
  viewer only (bring-your-own OTLP collector is supported but not shipped).
- No long-term trace storage; the ring buffer is bounded and volatile.
- No automatic PII *detection* beyond the redaction corpus — content flags
  remain a deliberate operator choice.
