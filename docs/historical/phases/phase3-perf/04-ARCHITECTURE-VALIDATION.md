# XR Phase 3 — STEP 4 Architecture Validation (per task)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Every task validated against the Constitution + Phase 3 scope BEFORE coding.

| Task | Design | Constitution check | Scope check | Budget + gate |
|---|---|---|---|---|
| T1 lazy boot | Router static→literal-path dynamic; XRApp.bootstrap({profile}) filters the provider set; commands lazy via CommandRegistry.registerLazy | ✅ Art. VI.4/Cmdt 11 (boots only what it needs); Art. III (single composition root preserved — XRApp remains the only root); Art. VI.2 (composition root may load L1 modules) | ✅ No new feature; same commands, same behaviors | version-warm/help-warm + boot-profile tests |
| T2 binary | build matrix per target; binary-first launcher; atomic-updater binary layout; installers binary-first | ✅ Art. XII recommended practice; Art. XXII (identity still from version.ts); no secret embedded (source-only bundle) | ✅ No capability change; contributor source path retained | binary-smoke tests; compile-safe proof |
| T3 async/stall | WorkspaceManager async load; stall detector; fast-path lint | ✅ Art. XII.4; fail-closed preserved (async load falls back to sync for standalone) | ✅ No behavior change (fallback identical) | hot-path lint + stall tests |
| T4 scan cache | Merkle fingerprint + payload cache; cache is a mirror, never an authority | ✅ Correctness preserved (miss ⇒ full scan of real files); Art. XII recommended practice | ✅ No new surface | scan-cache tests |
| T5 dashboard | Already split (Phase 2); benchmark + gate; no new client work beyond measurement | ✅ | ✅ | render-perf test + gate |
| T6 model-switch | State machine wrapping the EXISTING setActiveProvider config write; injectable deps | ✅ Fail-safe (canary failure keeps previous); Art. X honesty (never claims a switch that didn't verify) | ✅ Same config surface; `--force` documented | model-switch tests (rollback) |
| T7 metrics | Collector at ProviderService.getProvider (single choke point); bounded JSONL; no secrets | ✅ Art. III (one provider plane instrumented once); Part 20 (no secrets) | ✅ No new user-visible behavior | metrics-capture tests |
| T8 admission | Pure verdict over detected hardware; wired into models install before pull | ✅ Fail-closed (deny oversized loads; --force documented escape) | ✅ No new feature | load-admission tests |
| T9 incremental index | content_hash column + skip-unchanged reindex | ✅ Correctness: hash mismatch ⇒ re-embed; cache is a mirror | ✅ Same `memory reindex` surface | incremental-index tests |
| T10 gate | budgets.json + baseline artifacts + CI job + waivers | ✅ Art. XII.2 exactly | ✅ Tooling only | perf-gate tests + seeded regression |

**Rejected designs:** (a) computed-string dynamic imports for commands —
violates Global Rule 7 (proven by T2 build failure); (b) async conversion of
the whole config substrate — 40+ call-site blast radius for ~1 ms, rejected as
net-negative risk (documented exception P6 instead); (c) eager provider set
in the kernel — would recreate the 214 ms import tax; (d) network canary for
cloud model switches — would send paid traffic (free authOk canary instead,
P8).
