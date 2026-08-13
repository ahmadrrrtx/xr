# XR — IMPLEMENTATION PLAN (final release hardening)

**Date:** 2026-08-13 · **Basis:** `main @ 82402df` · Companion to `XR_FINAL_RELEASE_AUDIT.md`.

> **V-1 DECISION (blocker, user action):** the mission targets version **1.0.0**, but the repository is
> coherently stamped at **7.1.0 "Truth"** with npm published at 3.1.5 and remote tags to `v7.0.0`.
> Moving to 1.0.0 is a **semver downgrade** that orphans the tag/changelog lineage. **Recommended:** consolidate
> *to* **7.1.0** (fix only the true stragglers) and treat 7.1.0 as the release identity. If the operator still
> wants 1.0.0, Phase P2 will do it as a deliberate, fully-documented rebaseline (all ~178 references + `docs/release/7.1.0/`
> tree + baselines + changelog header) — but it must be an explicit choice, not an accidental edit.
> **This plan is written version-agnostic; P2 executes whichever branch is chosen.**

Rules honored: audit-first (done), one phase at a time, test after every phase, no test-weakening, no fake evidence, root-cause fixes, backward compatibility, no irreversible publishing.

---

## P0 — Blockers: cross-platform CI + version decision

**Objective:** make `Cross-Platform CI` deterministic and green on Linux, macOS, Windows; settle V-1.
**Files:** `src/state/workspace-store.ts` (open/PRAGMA/migration retry), `test/daemon/phase-g.test.ts`, `test/evaluation/*` (realpath), `test/platform/exclusions.json` (+ reason) for the Windows perf panic, `test/capabilities/lifecycle.test.ts`.
**Dependencies:** none.
**Tasks:**
1. CF-1 — Trace the exact `database is locked` path (open vs PRAGMA vs migration); bring it under the busy-retry/write-gate contract with a bounded retry. Keep the test's strict `0 locked, 0 lost` assertion.
2. CF-2 — `realpathSync`-normalize both sides of the macOS path assertions.
3. CF-3 — Reproduce/confirm the Windows `test/perf` panic is a Bun-runtime crash (not a product bug); if so, exclude that file on win32 with a reason in `exclusions.json`; otherwise fix the product code. Harden lifecycle cleanup retry.
4. V-1 — apply the user's version decision (see box).
**Risks:** masking a real concurrency bug (mitigate: keep strict assertions; add a focused regression test); over-broad Windows exclusion (mitigate: one file, documented reason, guard test).
**Tests:** `bun test test/reliability/ test/daemon/ test/evaluation/ test/capabilities/ test/perf/`; full `bun test`; `platform-parity --validate`; golden path.
**Acceptance:** full suite green locally; each CI failure class addressed at root cause with a regression test; exclusions remain evidence-bound.
**Rollback:** revert per-commit; exclusions are additive and reversible.

## P1 — Security + contract correctness

**Objective:** close the one High finding and re-verify the contract claims that prior audits flagged.
**Files:** `src/core/agent.ts` (+ `src/context/*` as needed), `src/cli/errors.ts`/exit-code plumbing, `--json` surfaces in `src/commands/agents.ts` etc., `src/skills/counts.ts`/`skills list` output.
**Tasks:**
1. B10 — wire the injection-safe context channel into the default agent path (or correct the README claim if the design intentionally keeps `legacy`); add a regression test that tool output is delimited before reaching the prompt.
2. D5 — verify a failed/blocked command exits non-zero; fix or document each surface.
3. D6 — verify each `--json` surface emits parseable JSON; fix `agents run --json` banner leak if present on HEAD.
4. D7 — make `xr skills list` report the mechanically-counted number consistently (65 bundled; distinguish marketplace/legacy records).
**Risks:** destabilizing the agent loop (mitigate: additive context-path switch + full suite + golden path).
**Tests:** new regression tests + full suite + `claim-lint`.
**Acceptance:** no High findings; D5/D6/D7 re-verified with evidence.

## P2 — Version consolidation (execute V-1 branch)

**Objective:** one authoritative release identity; every derived reference consistent.
**Branch A (recommended — consolidate at 7.1.0):** fix ~20 stale `3.1.5 (Helios)` / `3.1.6` header comments; confirm `release:check` + `changelog:check` + `claim-lint` green.
**Branch B (explicit 1.0.0 rebaseline):** run `release:stamp` after editing `release.manifest.json`, regenerate all stamped surfaces, rename `docs/release/7.1.0/`→`docs/release/1.0.0/`, re-point references, regenerate perf baselines, update changelog header with an explicit "rebaselined to 1.0.0" note, and verify every `release:check`/`claim-lint`/`changelog:check` gate.
**Acceptance:** `release:check` 6/6 in sync at the chosen version; zero legacy product-version references in active code paths; gates green.

## P3 — Architecture consistency & cleanup

**Objective:** remove only proven-dead artifacts; fix stale headers.
**Files:** repo-wide (candidate list produced by reference analysis, not deletion-by-guess).
**Tasks:** reference-analyze (grep) every candidate before removal; remove only dead/orphaned files (stale reports are largely already archived under `docs/historical/`); fix remaining stale comments.
**Acceptance:** `boundaries`, `size-gate`, `ownership:check`, full suite green after each removal batch.

## P4 — Performance verification

**Objective:** confirm no regression; fix only meaningful bottlenecks.
**Tasks:** run `perf:baseline`, `perf:gate`, `hot-path-lint`, `profile:gate`, `unit-tier`; compare vs `docs/perf/baseline-7.1.0-source.json` (or the P2 baseline).
**Expected:** no changes; record numbers.

## P5 — Cross-platform verification pass

**Objective:** re-verify parity after P0–P2.
**Tasks:** `platform-parity --validate`; local Linux full suite + golden path; document Windows/macOS status from CI evidence (this sandbox is Linux-only).

## P6 — CI/CD hardening

**Objective:** deterministic, bounded, self-diagnosing CI.
**Tasks:** add bounded per-step timeouts (safety net only, after root causes fixed); confirm the crash-class retry + executed-files guard; ensure every job has a clear pass/fail reason; no timeout-bump-as-fix.
**Acceptance:** workflows are deterministic; failures name the culprit.

## P7 — Repository & documentation

**Objective:** professional, accurate docs.
**Tasks:** final README audit (it is already strong — verify numbers/claims against P0–P2); confirm `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT` (if present), `CHANGELOG.md`, issue/PR templates, CODEOWNERS are current; update any stale cross-references after P2.

## P8 — Packaging & installation

**Objective:** reproducible install from a clean machine.
**Tasks:** verify `install.sh`/`install.ps1` stamp; run the `.deb` build path if tooling permits in-sandbox; verify `channel:check`; document prerequisites honestly. (Windows/macOS native installs are CI-validated, not reproducible in this Linux sandbox — stated, not faked.)

## P9 — Release readiness (STOP before irreversible actions)

**Objective:** prepare, do not publish.
**Tasks:** version bump (per P2), changelog + release notes regeneration, git-tag strategy, GitHub-release + npm strategy (per RELEASING.md), verification checklist. **No npm publish, no tag push, no GitHub release** (RULE 15 — requires explicit authorization + maintainer credentials).

---

## Phase ordering rationale
P0/P1 address the only evidence-backed blockers; P2 consolidates identity; P3–P6 are verification/consistency; P7–P8 are professionalization; P9 is preparation-only. Every phase ends with typecheck + full suite + the affected gates, and stops on any failure.
