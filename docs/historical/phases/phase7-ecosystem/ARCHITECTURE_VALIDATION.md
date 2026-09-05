# XR Phase 7 — Architecture Validation (STEP 4, before code)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Every plan item checked against the Constitution and Phase 7 scope. A plan that violated an Article was redesigned before coding.

## Validation per task

| Task | Plan | Constitution check | Result |
|---|---|---|---|
| T1 provenance graph | Metadata + event recording over existing planes; execution stays in each plane | Art. XIV.3 one registry preserved; no second registry — the graph is derived evidence, not a registry; distinct semantics preserved (typed nodes) | **PASS** |
| T2 TUF updates | Signed metadata verifier; applied through existing plugin/skill install/rollback paths | §10.4 updates versioned/verified/reversible/workspace-aware; no new engine | **PASS** |
| T3 evidence trust | Composite scorer over existing signals; popularity ≤5% | Art. XV.4 "never popularity"; §10.2 | **PASS** |
| T4 manifest security | Additive manifest fields + scanner + authority-diff renderer; enable paths show diff | §10.2 human-readable authority diff pre-install/enable; default-deny | **PASS** |
| T5 skill quality | Typed labels; `tools` allow-list enforcement; description-injection guard; parity tests | Art. XV.1/2; prompt-packs never presented as executable | **PASS** |
| T6 MCP allowlist | Signed allowlist artifact; revocation kills client; isolation already namespace-sandboxed | Art. XV.3 default-deny, signed allowlist, kill/uninstall, isolation by risk tier | **PASS** |
| T7 lifecycle+CI gate | Uses existing lifecycle states; CI scan added; crash-isolation test | §10.4 one lifecycle; Art. XX tests assert effects | **PASS** |
| T8 Business OS | Move to `extensions/business-os`; L0 contract in `src/core`; effect-verification; default-exclude; no second engine (modules use canonical execution/workflows) | Art. XVI.1–5; Part Eight permanent rules; Art. XXIV deletion budget (≈10.8k LOC out) | **PASS** |

## Rejected designs
- **Full multi-role TUF repository with delegation chains** — rejected: over-engineering for a local-first single-user system (adopt principles, per STEP 3 §1).
- **Business OS as separate npm package** — rejected: the extension stays in-repo (`extensions/business-os`) so the move is reversible and CI-testable; it is *packaged* as an extension, not a second distribution channel.
- **Lazy-loading Business OS via dynamic import in the provider** — rejected: the code must physically leave the kernel; dynamic import would keep it in-kernel.
- **Popularity-normalized trust** (downloads as a signal with any real weight) — rejected: Art. XV.4 forbids it; capped at ≤5% nudge only.
- **Hot-reload for plugins** — out of scope (recommended practice, not mandatory); skills already hot-refresh via catalog scan; documented as Phase-8+ candidate.

## Test proving each architecture decision
- T1: `provenance-graph.test.ts` (provenance query + what-was-used).
- T2: `tuf-updates.test.ts` (rollback/freeze/mix-and-match attacks blocked; round-trip).
- T3: `evidence-trust.test.ts` (popularity sweep never dominates).
- T4: `manifest-security.test.ts` (unsigned/over-permissive flagged; authority diff pre-enable).
- T5: `skills/quality.test.ts` (typing; allow-list enforcement; description injection).
- T6: `security/mcp-allowlist.test.ts` (default-deny; signed allowlist; revocation).
- T7: `capabilities/lifecycle.test.ts` + `crash-isolation.test.ts` + CI gate script.
- T8: `business/decoupling.test.ts` + `effect-verification.test.ts` + `data-preservation.test.ts`.
