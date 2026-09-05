# XR Phase 0 — Completion Report

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Repository:** `ahmadrrrtx/xr` · **Base commit:** `7be03d9` · **Release:** 7.0.1 "Truth"
**Date:** 2026-07-31 · **Platform verified:** Linux x64, Bun 1.3.14, TypeScript 5.9.3

Companion documents: [`AUDIT_REPORT.md`](AUDIT_REPORT.md) (STEP 1),
[`GAP_ANALYSIS_AND_DESIGN.md`](GAP_ANALYSIS_AND_DESIGN.md) (STEPS 2–4).

---

## 1. Audit summary (STEP 1)

18 hypotheses reconciled against live code: **15 VERIFIED** (12 at the exact line cited, 3 with
shifted line numbers), **2 NOT-FOUND** (absent scaffolding, as predicted), **1 CHANGED** (baseline
tooling present but stamped to a stale version).

**8 defects were discovered that the reports did not contain:**

| ID | Defect | Disposition |
|---|---|---|
| N1 | `system_apps` returned `ok:true` with "not available on this platform" | Fixed (T7) |
| N2 | `system_notify` returned `ok:true` on Linux/Windows while only implementing macOS | Fixed (T7) |
| N3 | `system_screenshot` returned `ok:true` wrapping a redirect message | Removed (T7) |
| N4 | Reviewer promoted `pending → approved` outside `inferReviewState` | Fixed (T10) |
| N5 | The **active** routing path had no fallback-diversity check (only the legacy path did) | Fixed (T11) |
| N6 | `set-version.ts` covered 3 of 6 surfaces — why CI stayed green during a 3-way version contradiction | Fixed (T1) |
| N7 | `docs/release/` contained only the stale `3.1.6/` | Fixed (T13) |
| **N8** | **Both bundled plugins declared `>=1.0.0 <2.0.0`, making them uninstallable on XR 7.x** | Fixed (T8) |

N8 is notable: XR's two shipped examples of its own extensibility could not be installed at all.
It was found only because the T8 parity test performs a *real* plugin install rather than a mock —
the effect-testing requirement paying for itself immediately.

**Pre-change baseline:** 1,771 tests passing, typecheck clean. This was the regression floor.

---

## 2. Tasks completed (T1–T13)

| Task | Outcome | Test evidence |
|---|---|---|
| **T1** Release manifest + version authority | `release.manifest.json` owns identity; 6 surfaces stamped; `release:check` fails on drift | `release:check` in CI; `test/phase0/install-container.test.ts` asserts installer stamping |
| **T2** Claim/version linter | `scripts/claim-lint.ts`, 4 gates (drift, prohibited, evidence+expiry, supervised terms) | Seeded-violation behaviour proven by 36→0 violation run; wired into CI `truth-gate` |
| **T3** Purge unsupported claims | 24 prohibited claims removed; 2 dead links and 2 dummy forms replaced; "what XR is / is not" added | `claim-lint` green; grep re-scan clean |
| **T4** Honest `doctor` | Readiness = "can run a task"; exits 1 when not runnable; `--deep` added | `test/baseline/status.test.ts` (5 cases); live: exit 1 no-provider / exit 0 with provider |
| **T5** Credential vault restart-safety | Per-record salt + AES-256-GCM envelope encryption; legacy refused; migration + rotation | `test/phase0/credential-vault.test.ts` — **16 tests** |
| **T6** End workflow simulation | Tool nodes execute via injected executor or fail; timers wait for real or park | `test/phase0/workflow-effects.test.ts` — **9 tests** (real file + real HTTP + real elapsed time) |
| **T7** Remove stub tools | 6 tools removed; `assertNoNoOpSuccess` structural guard added | `test/phase0/stub-tools.test.ts` — **15 tests** |
| **T8** Reconnect interactive surfaces | Shell/Telegram/Voice resolve plugins+MCP+skills via shared bridge | `test/phase0/surface-parity.test.ts` — **5 tests**, real plugin install |
| **T9** Canonical policy gate | `realpath` + WHATWG `URL` + host normalisation; expanded deny-list; egress scheme/IP coverage | `test/phase0/policy-gate-adversarial.test.ts` — **90 tests** |
| **T10** Fail-closed reviewer | Strict JSON contract; anything else → `changes_requested` | `test/phase0/reviewer-fail-closed.test.ts` — **39 tests** |
| **T11** CLI spine | Exit contract (0/1/2); one-word routing; fallback diversity on all 3 paths; legible routing reason | `test/phase0/cli-spine.test.ts` — **17 tests** (black-box, real exit codes) |
| **T12** Install + container | Container-aware bind (`0.0.0.0` inside, loopback publish); unattended install proven | `test/phase0/install-container.test.ts` — **14 tests** |
| **T13** Baseline + scaffolding | Manifest-driven release artifacts; CONTRIBUTING/CODEOWNERS/templates; known-limitations | `bun run baseline:measure` green; files verified present |

**Phase 0 test total: 205 tests across 8 new files.**

---

## 3. Exit Gate (Part 13) — evidence

| # | Gate | Evidence |
|---|---|---|
| 1 | Version unified; claim-linter green; no unsupported claim | `release:check` → *all 6 surfaces in sync at 7.0.1*; `claim-lint` → *8 evidenced claims, 0 violations* |
| 2 | `doctor` exits non-zero when not runnable, never falsely `ok:true` | No provider → exit **1**, `ok:false`, `runnable:false`; reachable provider → exit **0**, `ok:true` |
| 3 | Credential vault survives restart | 16/16 pass, including write → discard instance → new vault → decrypt |
| 4 | No workflow node succeeds without a verified effect | 9/9 pass; asserts real file bytes, real HTTP body received, real elapsed ms; negative cases fail closed |
| 5 | No stub tool exported; no `ok:true` on unavailable | 15/15 pass; registry excludes all 6; guard downgrades violations |
| 6 | Shell/Telegram/Voice reach plugins/MCP | 5/5 pass; surface tool-set **equals** CLI tool-set after real plugin install |
| 7 | `checkAction` blocks adversarial suite; reviewer fails closed | 90/90 + 39/39 pass |
| 8 | Failed tasks exit non-zero; free-form routing; no same-target fallback | Live: task failure → **1**, usage → **2**, version → **0**; `xr hello` routes to task mode; diversity enforced on all 3 fallback paths |
| 9 | Unattended install works; container reachable | `install.sh --yes </dev/null` → exit **0**; TCP effect test against container bind address |
| 10 | Baseline captured; known-limitations published | `docs/release/7.0.1/baseline-measurements.json`; `known-limitations.md` |
| 11 | CONTRIBUTING/CODEOWNERS/templates/branch protection | All present; branch protection **documented with honest gaps** (see §5) |
| 12 | All Phase 0 tests pass on Linux CI; no regression | **1,980 pass / 0 fail** (up from 1,771); `bun run ci` fully green |

---

## 4. Baseline measurement

Environment: Bun 1.3.14, Node 24.3.0, linux/x64, 1,985 MiB RAM. 3 samples per scenario, isolated
`XR_HOME`.

| Scenario | Median | p95 | Expected exit |
|---|---:|---:|---|
| `cli-version` | 175 ms | 178 ms | 0 |
| `cli-help` | 177 ms | 178 ms | 0 |
| `doctor-json` | 460 ms | 460 ms | 0 or **1** |
| `workspace-list` | 407 ms | 408 ms | 0 |
| `doctor-perf` | 404 ms | 416 ms | 0 |

Quality: typecheck clean · 1,980 tests / 7,166 assertions in ~16 s · install (unattended) ~2 s.

**No startup regression.** No eager imports were added to the boot path; T7 removed six tool objects
from a module-level array. `cli-version` and `cli-help` are unchanged within sample noise.

The harness gained an `expectedExitCodes` field because `doctor` exiting 1 with no provider is now
**correct**. Treating that as a harness failure would have pushed the baseline back toward rewarding
a dishonest exit code.

---

## 5. Deferred to Phase 1+ (with rationale)

Recorded rather than silently skipped, per "no net-new features" and the phase boundaries:

| Item | Why deferred |
|---|---|
| **Full execution-envelope unification** | Explicit Phase 2 scope. T8's guard permits reconnection only; the surfaces share extensibility but still construct their own agent invocation. |
| **Kernel/VM isolation** | Phase 4. Phase 0 hardened the in-process gate and corrected wording that implied more. |
| **Signed releases, SBOM, SLSA** | Phase 9. Identity is unified and signing-ready; XR does not claim "signed" anywhere. |
| **Cross-platform CI (macOS/Windows)** | Phase 1. Phase 0's gate is Linux CI. Recorded in known-limitations. |
| **Mutation testing on critical modules** | Phase 1. Effect tests were the Phase 0 priority. |
| **Hermetic black-box E2E from a published artifact** | Phase 1. Golden path verified via unattended install + CLI, not a published package. |
| **Branch protection settings applied** | Cannot be committed — it is a GitHub setting. Exact configuration and verification command documented in `docs/developer/branch-protection.md`, with honest gaps stated (single maintainer means automated checks, not human review, are the real enforcement today). |
| **Legacy credential recovery without the original key** | Cryptographically impossible: the old code never persisted the salt. Documented; records are refused rather than mis-decrypted. |

---

## 6. Constitutional compliance

| Requirement | Status |
|---|---|
| No public claim without evidence + expiry (Art. XIX/XXII, ADR-10) | All 8 claims evidenced with expiry; linter enforces |
| No success without a verified effect (Cmdt 2, Art. XX) | Enforced in code (`assertNoNoOpSuccess`, executor delegation) and in tests |
| Authority separated from intelligence; fail closed (Art. IV/IX) | Policy gate canonicalises then denies; reviewer requires explicit approval |
| No net-new feature | None added. Every change fixes truth or a P0 defect. |
| Shell reconnect is a bridge only (Phase 2 boundary) | Three call-sites re-pointed; no envelope, no new abstraction over the agent loop |
| No new boundary `any` / empty `catch` | Verified by grep across all touched trust/CLI/policy/credential paths |
| No startup regression (Art. XII) | Measured before and after; neutral |
| Migrations reversible; user data preserved (Art. XXIII) | Vault migration never deletes; config migration preserves explicit values; `site.ts` stamping preserves nav/footer |
| One source of truth per concern (Cmdt 6) | `set-version.ts` **retired**, not left beside the manifest |
| Deletion before addition (ADR-8) | Removed 6 stub tools, 24 false claims, 2 dead links, 2 dummy forms, 1 superseded script |

---

## 7. Signed statement

Phase 0 is complete. Every Exit Gate item in Part 13 passes against live evidence gathered by
executing the code, not by reading it.

The implementation contains **no TODOs, no placeholders, and no partial implementations**. Where
something could not be done, it is not silently omitted: it is listed in §5 with its rationale, and
in the published [known-limitations register](../release/7.0.1/known-limitations.md) where users
will actually see it.

Two claims I will *not* make, because they would themselves be Phase 0 violations:

1. **Branch protection is not verified.** It is a repository setting outside this codebase. The
   configuration is documented precisely; whether it is applied must be confirmed by an admin.
2. **Only Linux is verified.** macOS and Windows changes are type-checked and logically sound but
   were not executed on those platforms.

Verified on Linux: `bun run ci` → typecheck clean · **1,980 tests pass, 0 fail** · 6/6 surfaces in
sync at 7.0.1 · 8 evidenced claims, 0 claim violations.
