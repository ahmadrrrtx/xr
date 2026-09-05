# XR Phase 8 — STEP 2 Gap Analysis

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Mapped against Constitution Art. X (honest UX), XI/XVIII (versioned contracts), XII (performance), XXI (privacy), XX (testing), the Phase 8 spec tasks, and live audit findings (`01-AUDIT-REPORT.md`). Ordered by dependency. Every gap names the test/gate that proves closure.

## Order 1 — contracts first (everything else builds on it)

| # | Gap (audited) | Requirement (source) | Task | Proving test / gate |
|---|---|---|---|---|
| 1 | 66+ routes at unversioned `/api/*` | Art. XI.2, XVIII.1 | T1 | `test/api/v1-versioning.test.ts`: every v1 route answers under `/api/v1/*`; legacy `/api/*` still answers (deprecation window) with `Deprecation`/`Sunset`/`Link` headers |
| 2 | No OpenAPI/JSON-Schema | Art. XI.2, XVIII.2 | T1 | `test/api/openapi.test.ts`: spec generated from the live route registry, deterministic; `bun run api:schema:check` CI gate fails on drift; served `/api/v1/openapi.json` == generated |
| 3 | No typed client | Art. XI.2 | T1 | `test/api/client.test.ts`: generated typed client round-trips real endpoints against in-process daemon handler; compile-time types from zod inference |
| 4 | No compatibility policy / breaking-change detection | Art. XVIII.3, XXVII | T1 | `test/api/compat.test.ts`: the compat checker flags a removed operation/type change as breaking and accepts additive change; `docs/api/COMPATIBILITY.md` policy |

## Order 2 — observability (privacy-critical; must exist before a11y/UX claims rely on it)

| # | Gap (audited) | Requirement | Task | Proving test / gate |
|---|---|---|---|---|
| 5 | No trace plane (OTel/OTLP), no span model | Phase 8 T2; research §OTel | T2 | `test/observability/tracing.test.ts`: one request produces root HTTP span → child spans (`invoke_agent`/`chat`/`execute_tool`/routing/placement) with correct W3C ids, parent linkage, durations |
| 6 | No structural-default guarantee | Art. XXI.3; GenAI conventions | T2 | `test/observability/privacy.test.ts`: with content flags OFF, an instrumented LLM/tool call emits **no** prompt/tool-content anywhere (spans, logs, metrics, exported payloads); with flags ON it appears (opt-in proof) |
| 7 | No redaction pipeline | Art. XXI; research §redaction | T2 | `privacy.test.ts` redaction corpus: API keys/emails/JWTs/PEM/home paths/IP → `⟨redacted:…⟩` in all signals |
| 8 | No cardinality bounds | Art. XXI.3 | T2 | `test/observability/metrics.test.ts`: label values over budget fold into `xr_other` + overflow counter |
| 9 | No `/metrics` | Phase 8 Part 5 | T2 | `metrics.test.ts`: Prometheus exposition live on daemon, contains XR + GenAI series, bounded label sets |
| 10 | No trace-correlated logs | Phase 8 T2 | T2 | `test/observability/logs.test.ts`: structured log records inside an active span carry its trace_id/span_id; redacted fields |
| 11 | No local-first viewer path; no mandatory cloud proof | Art. XXI, ADR-5 | T2 | `docs/observability/LOCAL-VIEWER.md` (Aspire Dashboard standalone) + `privacy.test.ts`: disabled telemetry performs **zero** network calls (fetch instrumentation proof); OTLP exporter ships to HTTP endpoint only when explicitly enabled |
| 12 | No CPU profiling gate | Art. XII; Phase 8 T2 | T2 | `scripts/profile-gate.ts` + CI job: V8 CPU profile of startup/daemon scenarios with absolute budget + same-host regression band; `docs/perf/profile-baseline.json` committed |
| 13 | Telemetry opt-in mechanics | Art. XXI.1/3 | T2 | `config.test.ts`-level: default config ⇒ telemetry OFF; `xr telemetry enable/disable/status` flips consent and is honored by the runtime |

## Order 3 — accessibility (conformance, automated + manual)

| # | Gap (audited) | Requirement | Task | Proving test / gate |
|---|---|---|---|---|
| 14 | Primary nav not keyboard-operable | WCAG 2.1.1; Art. X | T3 | `test/a11y/keyboard.test.ts` (Playwright/Chromium): Tab reaches every nav control; Enter/Space activates; focus order == visual order |
| 15 | Focus not visible/obscured | WCAG 2.4.7, 2.4.11 (2.2) | T3 | axe run + static CSS gate: `:focus-visible` 2px ≥3:1 indicator on all interactives; no `outline:none` without replacement |
| 16 | Contrast failures (muted/dim text, non-text) | WCAG 1.4.3/1.4.11 | T3 | `test/a11y/a11y-static.test.ts` computed-ratio assertions ≥4.5:1 text / ≥3:1 large+non-text for every token pair; axe color-contrast rule |
| 17 | No landmarks/skip-link/live regions/labels | WCAG 1.3.1, 2.4.1, 4.1.3 | T3 | axe (landmark, label, region rules) + static asserts (skip link, `role=status`/`role=alert`) |
| 18 | Targets < 24px | WCAG 2.5.8 (2.2) | T3 | axe `target-size` run + CSS min-size static gate |
| 19 | Auth = raw 401 JSON | WCAG 3.3.7/3.3.8 (2.2); Art. X dead-surface ban | T3 | Accessible token-entry page (paste-allowed, labeled, no cognitive test); Playwright flow: login → cookie → dashboard loads |
| 20 | No automated a11y gate | Phase 8 Part 5 | T3 | CI job `a11y` (Playwright chromium + axe tags wcag2a/2aa/21aa/22aa, 0 violations) |
| 21 | No manual methodology/records | Art. X; exit gate | T3 | `docs/a11y/MANUAL-TESTING.md` + dated pass records (keyboard traversal executed via real Chromium keyboard driver; AX-tree/accessible-name assertions; honest human-AT notes) |

## Order 4 — UX (builds on T3 markup)

| # | Gap | Requirement | Task | Proving test / gate |
|---|---|---|---|---|
| 22 | All 26 panels exposed at first run | Art. X.2 progressive disclosure | T4 | `test/ux/progressive-disclosure.test.ts`: fresh state renders five-area disclosure (Getting Started + collapsed "All areas"); first-success flag recorded |
| 23 | No honest readiness with next action | Art. X.1 | T4 | `test/ux/readiness.test.ts`: banner states derived from live health — no provider → "Setup required" + single next action; healthy → "Ready"; never "ok" when broken |
| 24 | Undo not end-to-end | Art. X rec.; Phase 8 T4 | T4 | `test/ux/undo.test.ts`: memory revoke → API undo → ledger restored (effect asserted), dashboard control wired |
| 25 | First-task success unmeasured | Art. X acceptance ≥95% | T4 | `scripts/first-task-survey.ts`: N=20 fresh-home first-task attempts, success-rate evidence artifact (nightly gate ≥95%) |
| 26 | SUS unmeasured | Phase 8 exit ≥80 | T4 | `scripts/sus.ts` instrument (real 10-item SUS + scoring) + methodology doc; **honest note:** human-participant SUS cannot be synthesized — recorded as measured-status (see 04-ARCHITECTURE-VALIDATION.md exception) |
| 27 | Badges not standardized in dashboard | Art. X rec. | T4 | Capability/area badges (works-now / setup-required / experimental / unsupported-here) rendered from existing status data |

## Order 5 — DX

| # | Gap | Requirement | Task | Proving test / gate |
|---|---|---|---|---|
| 28 | No generated ownership map | Art. XI/XXVIII | T5 | `scripts/ownership-map.ts` (+test): every `src/`, `test/`, `extensions/` top-level module has exactly one owner + stability level; drift = test failure |
| 29 | Onboarding unmeasured | Art. XI.3 | T5 | CONTRIBUTING quickstart ladder + `docs/DEVELOPER.md` first-PR-in-a-day path; evidence = the Phase 8 changes themselves executed from docs |
| 30 | No <5s unit tier | Art. XI.4, XX.2 | T5 | `scripts/unit-tier.ts` curated manifest, measured wall-time assert < 5.0s (target ≤2s local for CI headroom); CI job |
| 31 | No observability/a11y/contract docs | Art. XIX | T5 | `docs/api/*`, `docs/observability/*`, `docs/a11y/*`, `docs/DEVELOPER.md` updates; claim-lint stays green |

## Sequencing logic

T1 (contracts) → T2 (observability) → T3 (a11y markup) → T4 (UX on the same surfaces) → T5 (DX/docs aggregates). CI wiring lands with each task; final docs + final review last. Rationale: the dashboard a11y surgery (T3) and progressive disclosure (T4) touch the same three files — merge their markup work to avoid rework; the API contract (T1) must exist before the client/docs reference it; observability (T2) is privacy-critical so it precedes any UX claims built on instrumented surfaces.
