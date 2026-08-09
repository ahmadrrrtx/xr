# XR Phase 8 — STEP 3 Research Notes (principles adopted, with sources)

Verified 2026-08-03. Principle = what XR adopts; it is never a copy/paste from any one source.

## R1 — OpenTelemetry GenAI observability (adopted for T2)

**Principles adopted:**
1. **Three span archetypes**, named `{operation} {name}`: `invoke_agent <agent>`, `chat <model>`, `execute_tool <tool>`. Tool calls and LLM requests are spans; agent invocations parent them so sub-agents nest naturally in one trace tree.
2. **Structural-by-default attributes** (no content): `gen_ai.operation.name`, `gen_ai.provider.name` (successor to `gen_ai.system`, both sent for interop), `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`, `gen_ai.agent.name`, `gen_ai.tool.name`, `gen_ai.tool.type`, `gen_ai.conversation.id`; metric `gen_ai.client.operation.duration`. **Prompt/tool content is opt-in only** — the conventions themselves treat content recording as privacy-sensitive.
3. **OTLP/HTTP** is a first-class transport (gRPC 4317 / HTTP 4318; JSON encoding at `/v1/traces`, `/v1/metrics`, `/v1/logs`) — XR implements OTLP/HTTP+JSON with **zero new runtime dependencies** rather than pulling a heavy SDK; the wire format is the standard.
4. **Trace-correlated logs**: emit `trace_id`/`span_id` (W3C Trace Context, 32/16 lower-hex) on every structured log record produced inside an active span — the model used by the Claude Agent SDK / OTel SDKs.
5. **PII-redaction in-pipeline before export** (collector-processor pattern applied in-process): every attribute/log field passes the redactor; content capture requires explicit per-flag opt-in (`prompt`, `toolArgs`).
6. **Cardinality budgets**: bounded label sets per metric; overflow folds to a sentinel + overflow counter.
7. **Sampling/batching**: root-sampling decision propagates to children; exporter batches (time/size) with fail-quiet circuit breaking — telemetry must never break the app.

Sources: OTel GenAI agent tracing conventions 2026 (spans `invoke_agent`/`chat`/`execute_tool`; attrs `gen_ai.request.model`, `gen_ai.usage.*`; agent/tool identity `gen_ai.agent.*`, `gen_ai.tool.*`) [1](https://veraexmachina.com/tech/opentelemetry-genai-agent-observability-production/) [2](https://dev.to/x4nent/opentelemetry-genai-semantic-conventions-the-standard-for-llm-observability-1o2a); GenAI conventions incl. privacy note ("content fields … opt-in rather than enabled by default") + naming `{operation} {model}` + `gen_ai.conversation.id` [3](https://deepwiki.com/open-telemetry/semantic-conventions/3.5-generative-ai-conventions); naming-migration lesson + `gen_ai.tool.name` flat path + content-recording privacy default [4](https://dev.to/vola-trebla/opentelemetry-just-standardized-llm-tracing-heres-what-it-actually-looks-like-in-code-2e5f); stable client-span attrs + `gen_ai.client.operation.duration` metric [5](https://callsphere.ai/blog/vw3c-opentelemetry-genai-conventions-ai-agents-2026).

## R2 — Local-first viewer (adopted for T2)

**Principle adopted:** the .NET **Aspire Dashboard standalone container** is a free/open-source OTLP viewer that runs fully locally with **no cloud account** and displays traces, metrics, and structured logs from *any* OTLP-emitting app — matching XR's local-first posture. Canonical local invocation:

```
docker run --rm -it -p 18888:18888 -p 4317:18889 -p 4318:18890 \
  -e DOTNET_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS=true \
  -d --name aspire-dashboard mcr.microsoft.com/dotnet/aspire-dashboard:latest
# UI → http://localhost:18888 ; OTLP gRPC :4317, OTLP HTTP :4318
```

Anonymous mode is a **local-only** convenience (never to be recommended for non-local binds). XR also ships a built-in offline path (`/metrics` + recent-traces JSON) so a viewer is nice-to-have, never required.

Sources: standalone dashboard usage + ports/map of 18888/18889(gRPC)/18890(HTTP) + anonymous flag semantics [1](https://dev.to/asimmon/net-aspire-dashboard-is-the-best-tool-to-visualize-your-opentelemetry-data-during-local-development-9dl) [2](https://medium.com/@rajkumar.rangaraj/exporting-telemetry-from-asp-net-core-to-aspire-dashboard-with-otlp-ac7e-665314) (port mapping 4317→18889, 4318→18890); official configuration reference (endpoints, auth modes, telemetry limits) [3](https://learn.microsoft.com/en-us/dotnet/aspire/fundamentals/dashboard/configuration).

## R3 — WCAG 2.2 AA (adopted for T3)

**Principles adopted:**
1. **Conformance = automated + manual.** axe-core catches ~57% of issues *by volume* but fully automates only ~29.5% of WCAG 2.2 success criteria; ~60% require manual testing. A green automated score certifies only the automatable minority — the CI gate is necessary but never sufficient. XR pairs axe (tags `wcag2a,wcag2aa,wcag21aa,wcag22aa`) with scripted keyboard traversal (real browser keyboard driver) + accessibility-tree/name assertions + a documented NVDA/VoiceOver procedure, recorded per release.
2. **New-in-2.2 AA criteria handled explicitly** (a 2.1 checklist silently skips them): **2.4.11 Focus Not Obscured (Minimum, AA)**; **2.5.7 Dragging Movements (AA)**; **2.5.8 Target Size ≥24×24 CSS px (AA)** (the only new-2.2 criterion axe automates, rule `target-size`); **3.2.6 Consistent Help (A)**; **3.3.7 Redundant Entry (A)**; **3.3.8 Accessible Authentication (AA)** — no cognitive function tests to authenticate (XR: token paste allowed, no CAPTCHA).
3. **Core patterns**: full keyboard operability (Tab/Shift+Tab/Enter/Space/Arrows/Escape; no traps; focus returns to invoker on dialog close); **visible focus ≥2px at ≥3:1**; contrast 4.5:1 normal text / 3:1 large text + non-text UI components & focus indicators (1.4.3/1.4.11); ARIA on custom widgets, **prefer native HTML** (`<button>` over clickable `<a href-less>`/`div`); status messages via `role=status`/`aria-live=polite`, errors via `role=alert`; landmarks + skip link + logical heading order.
4. **Testing stack**: axe-core inside a real Chromium (Playwright, already an optional repo dependency) for the automatable set plus raw keyboard events for traversal; unit-tier a11y tests (markup lint: labels, aria-hidden icons, role checks; computed contrast ratios; target-size CSS gates) — fast, dependency-free; pa11y-style `--standard WCAG2AA` semantics achieved via axe tags.

Sources: axe ~57% by volume / 29.5% fully automatable / 60.2% manual; only `target-size` reliably automatable among new 2.2 criteria; new-criteria enumeration (2.4.11, 2.4.12, 2.4.13 AAA, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8, 3.3.9 AAA); axe+Playwright `withTags` gating pattern; "manual testing covers focus management, screen reader narration, cognitive load" [1](https://crosscheck.cloud/blogs/axe-vs-wave-vs-pa11y-accessibility-testing/) [2](https://www.digitalapplied.com/blog/wcag-2-2-accessibility-audit-checklist-2026-reference) [3](https://qaskills.sh/blog/ai-accessibility-testing-tools-2026) [4](https://qaskills.sh/blog/playwright-accessibility-testing-axe-complete-guide) [5](https://crosscheck.cloud/blogs/best-accessibility-testing-tools-wcag/).

## R4 — API versioning + schema generation (adopted for T1)

**Principles adopted:** public APIs are **path-versioned** (`/api/v1`) with a published compatibility policy; **OpenAPI 3.1 + JSON-Schema (2020-12) generated from the serving code** (the route registry is the single source of truth — the spec can never drift from what is served; CI regenerates and diffs); **typed clients generated from the same contract** (zod-inferred request/response types); **breaking-change detection** in CI (classifier: removed op/property, narrowed type, new required request field = breaking; additive = compatible) with the Art. XXVII deprecation cycle (announce → warn → migrate → remove) implemented via `Deprecation` + `Sunset` + `Link: rel="deprecation"` response headers on legacy mounts.

(Principles per Constitution Art. XI/XVIII/XXVII and the Phase 8 spec; industry-standard OpenAPI 3.1/JSON-Schema 2020-12 practices.)

## R5 — Profiling in CI (adopted for T2/T5)

**Principle adopted:** latency budgets (P3 perf-gate) are necessary but blind to *where* CPU goes. XR adds a **CPU-profile gate**: V8 CPU profiles (`bun --cpu-prof` style `.cpuprofile`) captured for startup + daemon scenarios; total CPU ms under an absolute budget plus a same-host regression band (same 30% band philosophy as perf-gate — measured CI variance) with a committed baseline artifact. This is regression *gating*, not dashboards (Phase-10 scope).

## R6 — Progressive disclosure + UX measurement (adopted for T4)

**Principles adopted:** first-success-before-complexity (Art. X.2) = a single "Getting started" unit + five areas disclosed progressively, persisted per-user; honest readiness = Ready / Setup-required / Degraded computed from live health, each state with exactly one next action; undo for reversible mutations; the **System Usability Scale (SUS, 10 items, 0–100)** is the standard UX instrument — tooling + methodology shipped, human-participant results recorded honestly (cannot be synthesized by an agent — see Architecture Validation exception E-1).
