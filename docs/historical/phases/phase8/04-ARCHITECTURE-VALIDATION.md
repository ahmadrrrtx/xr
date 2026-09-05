# XR Phase 8 — STEP 4 Architecture Validation

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Each task validated against the Constitution **before coding**, using the Art. ADR-1…12 decision rules and Part 13 checklist. A plan is rejected if it: captures prompt/tool content by default, requires mandatory cloud, regresses Phase 0–7, bypasses the canonical envelope/placement, or claims a11y conformance without manual testing.

## T1 — Versioned API + OpenAPI + typed clients — **VALIDATED**

- **ADR-1 boundary:** API contract code lives in `src/daemon/routes/` (the serving layer) + `src/clients/` (generated client) — presentation/delivery, not L0/L1. ✔
- **ADR-2 single authority:** the *route registry is the spec* — OpenAPI, the typed client, and the compat checker all derive from the same registered routes. No second API description exists. ✔
- **Design:** all routes mounted at `/api/v1/*`; legacy `/api/*` mounts remain for one deprecation window with `Deprecation`/`Sunset`/`Link` headers (Art. XXVII cycle; additive, Part 17). Health remains reachable at `/api/health` (unversioned infra convention) **and** `/api/v1/health` (no deprecation headers, canary-safe).
- **Design:** request validation becomes schema-driven (zod → 400 `application/problem+json`-style structured error), replacing ad-hoc string errors on mutated endpoints.
- **ADR-11 compatibility:** legacy answers unchanged (no body mutations); tests pin this. ✔
- **Rejected alternative:** rewriting the router onto a framework (Hono/Fastify) — adds a dependency, no outcome value (ADR-7).

## T2 — Privacy-respecting observability — **VALIDATED** (the privacy-critical task)

- **ADR-1 boundary:** one new home `src/observability/` — observability is an **L1 Runtime** concern per §2.2 ("scheduling/recovery/backpressure; observability"). Kernel untouched. ✔
- **ADR-2:** one observability plane (tracer + meter + logger + exporter); it *consumes* the canonical envelope/placement/routing — it does not wrap, bypass, or re-implement them (instrumentation points are *inside* those services). ✔ (Global rule 8 honored.)
- **ADR-5 local-first:** exporter is opt-in OTLP/HTTP to a user-chosen endpoint; default recommended endpoint `http://127.0.0.1:4318` (local Aspire viewer, R2). Disabled ⇒ **zero network calls** (proven by test). ✔
- **Art. XXI privacy invariants (non-negotiable, test-enforced):**
  - `telemetry.enabled` defaults **false**; nothing emits when off.
  - Structural default: durations, model/provider/tool names, token counts, finish reasons, route ids, statuses, placements, SLOs. **Never** prompts, tool arguments/results, file contents, memory text, secrets.
  - Content capture only via explicit per-flag opt-in (`content.prompt`, `content.toolArgs`) and even then passes the redactor.
  - Redactor (API-keys/JWT/PEM/email/card/home-path/IP) applied to **all** signals pre-record/no bypass.
  - Cardinality budgets per metric label; overflow → `xr_other` + overflow counter.
  - Sampling + batched export; bounded ring buffer; overhead bounded (Art. XII — measured by perf-gate/profile-gate: no startup regression).
- **Metrics:** Prometheus `/metrics` exposition on the daemon (loopback+token, same auth as everything else).
- **Rejected alternatives:** pulling the full `@opentelemetry/*` SDK (runtime size/boot cost vs. ADR-9; wire-format implementation is small and standard); any hosted default endpoint (Art. XXI).
- **Privacy test designated the merge-blocking proof** (Quality Gate Privacy veto applies): `test/observability/privacy.test.ts`.

## T3 — WCAG 2.2 AA — **VALIDATED**

- **Automatable** (axe-core in real Chromium via Playwright, tags wcag2a/2aa/21aa/22aa, 0 violations) **+ scripted-manual** (real browser keyboard driver: full traversal, no traps, focus return, Esc behavior; accessibility-tree/accessible-name+role assertions) **+ unit-tier** (markup lint, computed contrast, target-size CSS) **+ documented human-AT procedure** (NVDA/VoiceOver checklists) with dated records — the four-layer methodology the research mandates (R3). The conformance claim is scoped to what each layer proves (Art. X honesty; no "certified" claim).
- **Scope:** fix-in-place (Part 9): nav anchors → buttons w/ `aria-current`; landmarks + skip link; `:focus-visible` indicator ≥2px ≥3:1; palette-level contrast fixes; live regions; labels for all inputs; ≥24px targets; accessible token-entry replacing the raw 401 dead surface (also an Art. X dead-surface fix); focus-not-obscured via `scroll-margin` + focus-restore; `prefers-reduced-motion`.
- **Art. IX/X guard:** the auth page keeps the P4 secure-cookie/CSRF contract intact (bootstrap + HttpOnly SameSite=Strict + Origin guard) — accessibility changes must not weaken the session model (test `test/daemon/*` stays green + new auth-page tests).

## T4 — Progressive-disclosure UX — **VALIDATED**

- Five-area organization of the existing 26 panels with Getting-Started-first disclosure (persisted), honest readiness (derived from live health, one next action), undo surfaced via a real API route onto the existing `UndoLedger` (no new ledger — ADR-2), standardized capability badges from existing status data.
- **Exception E-1 (recorded per Part Fifteen):** the exit-gate targets *first-task success ≥95%* and *SUS ≥80* are **human-participant metrics**. What is automated and gated: first-task success rate over N=20 scripted fresh-home journeys (real installs, real local answer path) — measured, target ≥95%. SUS: instrument + methodology shipped; **no synthetic user data will be fabricated** (Art. X/Commandment 1-2). Any unmet human-study remainder is reported as the real number + blocker, per Phase-0 honesty discipline. Violated invariant: none; why necessary: agents cannot run human studies; risk bounded: no conformance claim is published without human evidence; owner: @ahmadrrrtx; review: Phase 9.

## T5 — DX — **VALIDATED**

- Generated ownership map (CODEOWNERS = single source → rendered map + stability levels; ADR-2), ADRs 0017–0020, contributor quickstart, curated <5s unit tier measured with CI headroom, observability/profiling/a11y authoring docs.

## Global checks

- **No net-new feature/product surface** (Part 4): everything strengthens existing daemon/dashboard/CLI/docs; the only new *internal* subsystem is `src/observability/` (an L1 gap, not a feature) and mechanically-derived client/schema artifacts.
- **No Phase-10 work:** no hosted observability/SIEM, no enterprise identity/SSO (explicitly deferred; known-limitations updated).
- **No P0–7 regression:** proof = typecheck + 2540-test suite + gates (release/claim/boundaries/size/hot-path/capability) + golden path re-run after implementation.
- **Deletion budget (Art. XXIV):** retire nothing existing prematurely; Phase 8 *adds* gates and *removes* two a11y anti-patterns (focus-erasure CSS, click-only nav); drop any dev-dependency that ends unused (`jsdom` — decision recorded in final review).
