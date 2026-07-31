# Phase 1 — Architecture Validation (STEP 4)

Validated **before** coding, per task. Any plan that weakens the audit
guarantee, introduces a second write authority, breaks a Phase-0 fix, adds a
feature, or breaks compatibility without a reversible migration was rejected.

| Task | Plan summary | Constitution / scope check | Validated |
|---|---|---|---|
| T1 | Audit append = one `BEGIN IMMEDIATE` transaction (read-last → compute → insert → commit) routed through a single-writer gate; fail-closed append on a broken chain; `xr audit repair --yes` (explicit, audited truncation) + export. | Strengthens Art. VI/IX (one serialized truth). Fail-closed = no ambiguous state (Cmdt 2). Repair requires explicit confirmation (Art. XXIII — no silent data loss; the repair itself is an audit event). | ✅ |
| T2 | Full PRAGMA set (WAL, synchronous=NORMAL, busy_timeout=5000, foreign_keys=ON, wal_autocheckpoint=1000) + per-DB-file single-writer gate + `IMMEDIATE` transactions + busy retry/backoff with jitter + periodic `wal_checkpoint(RESTART)` (background job + on shutdown/close). | Part 5 §2 exactly; single writer at dispatcher level (R1). No new feature. | ✅ |
| T3 | Encode: every mutating statement through the store's connection is executed inside the gate by construction (connection-is-the-writer); runtime `unsafeMutationCount` + static scan; property test; ADR `docs/adr/0001`. | Art. VI/IX; no second write authority — the gate is a *discipline*, not a new engine. | ✅ |
| T4 | Crash-injection matrix: child processes + test-only `XR_CRASH_POINT` hooks; `kill -9` at every persisted transition; assert atomic pre/post states. | Cmdt 2 (no simulated durability — real kill + real restart). | ✅ |
| T5 | Claim-first idempotency primitive (`idempotency_slots` table; INSERT-before-effect) + wire into ExecutionService around the external-effect boundary; document exactly-/at-least-/at-most-once per path. | Part 5 §4. The existing check-then-run dedup is upgraded to claim-then-run — closes the crash window without changing public semantics. | ✅ |
| T6 | Nightly golden path: install → status → verify → first answer (deterministic stub adapter) → restart → resume → second answer → uninstall; Linux + container. | Part 8 T6; effects asserted (Art. XX). The stub adapter is a *test harness*, not a product feature. | ✅ |
| T7 | Cross-platform CI: macOS + Windows (typecheck + unit + golden-path subset); Linux full. Honest gap documentation. | Part 8 T7; Phase-0 discipline (green or documented gaps). | ✅ |
| T8 | Lightweight in-repo mutation harness on gated modules (state/execution/trust/review/credentials); threshold gate. | Part 8 T8. | ✅ |
| T9 | Hermetic artifact E2E: pack → install tarball → golden-path subset against the artifact. | Part 8 T9. | ✅ |
| T10 | `xr uninstall --keep-data | --purge` with per-mode filesystem assertions. | Part 8 T10. Deletion is user-confirmed and mode-scoped; no silent data loss (Art. XXIII). | ✅ |
| T11 | Atomic updater: one contract across git-checkout + npm; install → health canary → atomic swap (blue-green) → auto-rollback; version identity unified (Phase-0 invariant kept); no "signed" claim (Phase 9). | Part 8 T11; Art. XXIII (user data preserved, backups before swap). | ✅ |
| T12 | Reversible-migration framework + round-trip fixtures; new Phase-1 schema is additive (new tables only) so the audit chain continues; downgrade reads upgraded DB. | Art. XXIII; Part 17. | ✅ |
| T13 | Real backup/restore (VACUUM INTO under the write gate) replacing the stub; RPO/RTO stated + drill test. | Cmdt 2 (remove simulated durability); Art. XX (effects asserted). | ✅ |

**Rejected alternatives**
- *Two write authorities (thread pool of writers + per-statement locks):* rejected — violates R1/R3, Part 5 §3.
- *Audit "repair" that silently rewrites history:* rejected — no silent data mutation; repair is explicit + confirmed + itself audited.
- *Blocking appends forever on a broken chain:* rejected for UX; fail-closed *until* the user runs explicit repair — a repair path always exists (Part 22 UX).

**Constitution compliance:** no Article/Commandment/Decision-Rule violation found in this plan; no net-new feature; no Phase-2 work; no Phase-0 regression (all Phase-0 surfaces untouched except additive PRAGMAs + gated writes with identical observable behavior).
