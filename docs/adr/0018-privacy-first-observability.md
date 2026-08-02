# ADR-0018 — Privacy-first observability (opt-in, structural, local-first)

- **Status:** accepted (Phase 8 · T2)
- **Owner:** src/observability · **Review:** 2026-08-03

## Context
An agent runtime handles prompts, tool payloads, and file contents — data a
user never consented to stream anywhere. Most observability defaults in the
industry (always-on SDKs, content-rich spans, cloud-required exports) violate
Constitution Art. XXI. XR needs visibility into itself **without** becoming a
data exfiltration surface.

## Decision
1. **Off by default, opt-in only**: telemetry activates via
   `xr telemetry on` (persisted) or `XR_TELEMETRY=1` per-process. The default
   build records nothing and opens no sockets.
2. **Structural by default**: spans/metrics carry shape — route ids, op
   kinds, durations, token counts — never prompt text, tool arguments, file
   contents, or paths. Content capture exists solely behind explicit flags
   (`XR_TELEMETRY_CONTENT=1`, off by default, documented as a debugging-only
   escape hatch).
3. **PII-redaction processor** in the pipeline (`redaction.ts`): even
   accidental or future attribute additions pass through the redactor; tests
   prove emails/keys/Authorization headers never leave.
4. **Cardinality budgets**: label sets are whitelisted with explicit series
   caps (`budgets.ts`); a runaway attribute fails the budget test instead of
   silently exploding the metrics plane.
5. **Local-first**: OTLP export is optional; `xr serve` exposes `/metrics`
   and `traces/recent` locally, and `docs/observability/LOCAL-VIEWER.md`
   shows a full local trace without any cloud account. No hosted/SIEM
   backend is built in (deferred to Phase 10 by design).
6. **OTel GenAI semantic conventions** for LLM spans so external tooling
   understands the same traces XR does.

## Consequences
- "Privacy-safe telemetry" is falsifiable: the redaction suite + default-off
  posture are CI-enforced (`docs/phase8/05-TEST-RESULTS.md` §T2).
- Correlation is real: trace ids thread through logs (`trace-correlated
  logs`), so local debugging needs no hosted product.
- Negligible disabled overhead: the profiling CI job (`profile:gate`) holds
  startup within the published budget with wiring present.

## Tests
`test/observability/` (23 tests: opt-in posture, redaction, budgets, E2E
trace with tool/LLM children, `/metrics` liveness) + telemetry-command tests
(3); `test/perf/profile-gate.test.ts`; CI job `profiling`.
