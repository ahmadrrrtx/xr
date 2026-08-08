# XR 7.1.0 (Truth) — Release Candidate Notes

**Status:** release candidate · **Date:** 2026-08-08
**Branch:** `chore/xr-launch-cleanup` · **Tip at record time:** `fd82fff`
(pre-incident SHA — see tracker §Work log, "Environment incident": the branch
was later reconstituted as one squashed commit with identical content)

This document is the **engineering delta** of the 7.1.0 release candidate —
what changed relative to the pre-cleanup baseline `main @ 9f5840c`, with the
verified evidence. It complements (does not replace) the product-facing
[`7.1.0/RELEASE_NOTES.md`](7.1.0/RELEASE_NOTES.md). The canonical tracker is
[`../IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md); findings ledger:
[`../audits/XR_RUNTIME_AUDIT.md`](../audits/XR_RUNTIME_AUDIT.md).

---

## 1. Launch gates — 10/10 verified (2026-08-08)

Every gate in the tracker's §Launch-gates block is green with dated evidence:
clean-clone build (`tsc --noEmit` exit 0), full suite **2,812 pass / 13 skip
(live-browser a11y) / 0 fail** across 226 files (re-verified post-R-6 at
`d3017c0`), 14/14 local CI gates, a live
multi-agent flagship workflow run to `status=completed`, zero prohibited
claims on scanned surfaces, ciphertext secrets at rest, security suites
green, first-run and upgrade probes live-verified, distribution prep
complete. **The only remaining release action is maintainer-held credentials**
(F-3): publish per [`LAUNCH_HANDOFF.md`](LAUNCH_HANDOFF.md).

## 2. What changed since the baseline

| Phase | Change | Ledger | Commit |
|---|---|---|---|
| 1 — Cleanup | Repository hygiene: 29 root campaign deliverables archived to `docs/historical/`, stale scratch removed, migration docs consolidated, phase campaigns moved under `docs/historical/phases/`, docs index + consolidated audit + this tracker created, release inventory regenerated | — | `21f13fc` |
| 2 — P0 | **Multi-agent review-gate deadlock fixed.** Deterministic `security_checker` emits the strict-JSON decision contract; the executor consumes the structured decision directly; prose-only reviewers still fail closed. Honest failure mapping: transport/budget/approval stops mark the task failed instead of faking completion. The flagship workflow (planner → workers → reviewer → synthesizer) now completes end-to-end — proven by the new `test/multi-agent-e2e.test.ts` (6 tests) and a live CLI run (`wf_6acaa135`) | A-1 | `7a7c270` |
| 3 — P1 | **Secrets at rest encrypted.** `~/.xr/.env` file fallback is sealed with AES-256-GCM (`XRG1` format, per-install key `secrets/.file-key`, chmod 600); legacy plaintext auto-migrates on next load; corrupt key fails closed; undecryptable entries carry through verbatim rather than silently dropping. 7 disclosure tests; threat model in [`../migration/secrets-at-rest.md`](../migration/secrets-at-rest.md) | A-4 / D-1 | `b0b1d2e` |
| 3 — P1 | **Claims hygiene.** "True AI Operating System" / "AI OS Kernel" / "Provable Security" / "AI Business Operating System" / deterministic-benchmark framing reframed on every scanned surface (README, website copy, onboarding banner, OpenAPI summary). `release.manifest.json` gained prohibited patterns + supervised terms; negative tests prove the guard fails the build on regression. Adjacent staleness fixed while verifying (canonical `xr attacks`, 12→11 templates, real `extensions/business-os` layout, XR-15 default-off status) | A-3 / A-11 | `021a740` |
| 3 — P1 | **Provider/docs truthfulness.** README provider table now mechanically matches `presets.ts` defaults (26 presets = 16 hosted + 10 local; 5 wired native adapters named; OpenAI-compatible transport stated; Cerebras wiring nuance recorded). New [`../development/GETTING_STARTED.md`](../development/GETTING_STARTED.md) mirrors the CI golden path with doctor exit-code honesty and the A-13 workflow-limitations box | A-7 / A-13 | `fa6cc25` |
| 4 — Probes | **Execution semantics pinned by tests.** Automatic same-run retry is intentionally unreachable post-side-effect (fail-closed design) — now recorded in the ledger and pinned by 4 tests; cancellation semantics pinned by 3 new tests (cooperative + watchdog-stamped `cancelled`, durable record). 12 new adversarial-boundary tests for the business extension (RBAC escalation/deny paths, approval replay/expiry fail-closed, workspace isolation) | A-19 / A-5 | `343845a` |
| 4 — Probes | **`config.envOverrides` contract.** Deployments can now redirect provider/base-URL-class env values through config (schema-validated, forbidden-path-guarded, fail-closed re-validation; `envOverridesLocked` to disable) — discovered missing during the first-run probe; 10 tests including a run-path regression. Verified live: a previously failing `xr run` against a custom endpoint now routes correctly | S-1 F3 | `2637119` |
| 4 — Probes | **All four stabilization probes live-verified:** fresh-Linux first-run journey (S-1), agent-experience regression (S-2), daemon/dashboard smoke incl. token auth 401s + SSE chat (S-3), loss-free upgrade from a pre-cleanup `~/.xr` home (config v18 hydrate, plaintext `.env` auto-seal, audit chain intact across trees — S-4) | — | `2637119` |
| RC | Launch gates recorded 10/10; F-3 reduced to maintainer credentials | A-2 | `297da3d` |

**Totals (program):** test floor rose from 2,750 → **2,812 passing with zero
failures at every recorded run**; final tree re-verified after the P2 batch,
R-9, and R-6 (`d3017c0`):
2,812 pass / 13 skip (live-browser a11y) / 0 fail over 226 files, 14/14 CI
gates, `tsc --noEmit` clean, zero suite temp-dirs left on /tmp.

## 2b. P2 batch landed after RC-1 (all verified, none blocking)

| Item | Change | Ledger | Evidence |
|---|---|---|---|
| R-3 | **Known-limitations registers de-duplicated** — `docs/security/KNOWN_LIMITATIONS.md` is the canonical living register (stable #1–#9 + #10–#17 merged in); the 7.1.0 register is a frozen release excerpt pointing back | A-15 | platform-parity 5/5, ownership sync |
| R-4 | **control/ vs computer/ division documented** in `docs/environment/README.md` (verified against imports: governed pipeline vs single-shot `SYSTEM_TOOLS`; no duplication → deliberately no merge) | A-10 | imports traced |
| R-8 | **Test-suite hygiene** — `bunfig [test].preload` routes the whole suite (incl. children) into one owned temp root with stale-sweep + `afterAll` cleanup (bun's runner skips exit hooks — probed); full run now leaves **0** bytes on /tmp; bounded-graph flake fixed with an explicit 15 s timeout | — | full run 0 leftovers |
| R-5 | **Onboarding capability scan (A-12)** — "What works on this machine" section from the same `probeHealth()` engine doctor uses (no duplicate detection) | A-12 | live output verified |
| R-2 | **Zero `as any` at the A-6 trust seams** — all 43 sites (providers/intelligence/config/daemon) rewritten with validated narrowing; cast archaeology surfaced two bugs (dead daemon file with broken SQL removed; anthropic literal cast) | A-6 | 415 seam tests green |
| F-2 | **`xr onboarding --yes`** + prompt **EOF-fail-closed** semantics (consent gates deny on vanished stdin); wizard EOF completion: 90 s hang → 263 ms | S-1 F2 | 4→5 tests pin |
| F-1 | **Doctor/onboarding defaults follow the keyed provider** on any validation outcome; key validation probes the preset's real `baseUrl` | S-1 F1 | unit-pinned |
| U-1 | **`docs/guides/cli-compat.md`** — exit codes, global flags, per-command `--yes`, scripting envs, prompt-piping rules, envOverrides | — | vs src line-by-line |
| R-9 | **Abort signal threaded AgentService→runner→loop (A-19)** — cooperative checkpoints (step top / post-chat pre-tools / between tool calls), honest `stopped: "cancelled"` + `session.cancelled` audit; Shell Ctrl+C/Esc abort for real (pending approval denied fail-closed); `xr run` SIGINT → exit 130 with cooperative wrap-up; `stopWorkflow` aborts the in-flight worker (live `{record, controller}` map) and a cancelled worker fails honestly, never completes; no-bypass contract untouched | A-19 | 7 pins (`test/agent-cancel.test.ts`) + LIVE: SIGINT @ step 6 → cancelled → 130 → audited → chain ✓ |

| R-6 | **Provider canary machinery (register #11)** — `bun run canary:providers` + nightly `provider-canaries` workflow: live-probes each key-configured provider via its own `health()` (canary ≡ doctor truth), fails the job on live-probe errors, honest SKIP for unconfigured presets (never a fake pass); coverage scales with the 15 hosted key secrets provisioned in CI | #11 | 5 pins + LIVE: 401 → exit 1; stub-override → PASS |

Remaining open items are P3/maintainer: provider-canary **secrets** in CI
(R-6 machinery shipped; coverage activates with them), remote-branch
retirement **execution** (R-7 — runbook + evidence in
[`REMOTE_HYGIENE.md`](REMOTE_HYGIENE.md); 30 branches are provably
zero-content-loss, 1 reviewed), the cross-process workflow-stop precision
(ledger A-19 — in-process surfaces including the daemon cancel fully; a
second process's `stopWorkflow` reaches only the durable record), and the
external docs-page diff (U-2 — pending the maintainer's current page
markdown).

## 3. Known limitations (read before operating)

- [`../security/KNOWN_LIMITATIONS.md`](../security/KNOWN_LIMITATIONS.md) —
  canonical register (policy-isolation scope, cosign real-tag note, env
  hydration, doctor-readiness honesty).
- [`7.1.0/known-limitations.md`](7.1.0/known-limitations.md) — the 7.1.0
  release excerpt (§4 covers the A-13 scheduler/executor limitations).
- [`../development/GETTING_STARTED.md`](../development/GETTING_STARTED.md) —
  golden path plus the "what the workflow engine does **not** do yet" box.
- First-run friction register (S-1): F1 doctor-defaults cosmetics (P3),
  F2 onboarding non-interactive flag (P2), F4 doctor "ready" ≠ key-valid —
  each documented at its touch point.

## 4. Open follow-ups (tracked, non-blocking)

The Phase-5 plan (§2b) is complete except P3/maintainer items: the secrets
for provider-canary coverage (R-6 machinery shipped 2026-08-08 — nightly
workflow live, coverage scales with provisioned secrets),
remote-branch retirement execution (R-7 — runbook + evidence complete in
[`REMOTE_HYGIENE.md`](REMOTE_HYGIENE.md); maintainer on remotes),
and the cross-process workflow-stop precision recorded in ledger A-19
(in-process cancel is done and pinned; reaching a *running* workflow from
another process belongs to the remote control-plane roadmap).
The external docs-page paste-handoff (U-2) ships when the maintainer
supplies the current page markdown (paste-ready content was prepared
separately against the verified claims in this note).

## 5. Maintainer actions (credential-gated)

1. Merge/push `chore/xr-launch-cleanup`.
2. Publish per [`LAUNCH_HANDOFF.md`](LAUNCH_HANDOFF.md) — prepare script,
   gates re-run, tag `v7.1.0`, then verify: npm `latest` = 7.1.0, cosign /
   SLSA / SBOM artifacts verify, channel manifests stamped.
3. After publish: close ledger A-2 / tracker F-3 with the publish evidence.

## 6. Sources of truth

- Tracker: [`../IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md)
- Findings ledger + discrepancy register:
  [`../audits/XR_RUNTIME_AUDIT.md`](../audits/XR_RUNTIME_AUDIT.md)
- Audit-basis note: the uploaded audit corpus was used for **planning**; every
  shipped change above was verified against the repository itself
  (DOCUMENTED-BUT-NOT-IMPLEMENTED / ALREADY-RESOLVED / DISCREPANCY labels in
  the ledger).
