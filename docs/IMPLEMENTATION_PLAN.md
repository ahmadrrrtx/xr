# XR Agent Runtime — Launch Implementation Plan & Tracker

**Scope:** XR **Agent Runtime** only. Not XR-OS. XR-OS continues as its own
project; the 3-year roadmap material lives in the audit corpus and is out of
scope here except where a launch gate requires a minimal honest slice.

**Truth sources:** this tracker (one canonical plan) +
[`audits/XR_RUNTIME_AUDIT.md`](audits/XR_RUNTIME_AUDIT.md) (the finding ledger).
No competing implementation plans.

**Status legend:** ☐ todo · ◐ in progress · ☑ done · ⊗ blocked (needs
maintainer credentials/action)
**Priority:** P0 launch blocker · P1 required before RC · P2 important, can
follow launch · P3 future.

---

## Phase 0 — Baseline & safety ☑ (2026-08-08)

| Task | Result |
|---|---|
| Record branch/commit/version/identity | `main @ 9f5840c`, `@rrrtx/xr 7.1.0` |
| Install/typecheck/test/gates | All green — `2,750 pass / 13 skip / 0 fail`; 14/14 local CI gates PASS |
| Runtime probes | CLI, doctor, daemon (loopback + token auth) verified |
| P0-A multi-agent reproduction | Reproduced live → `blocked`, 0 worker agents ran |
| Baseline report | [§Baseline in audit ledger](audits/XR_RUNTIME_AUDIT.md#1-baseline-verified-on-2026-08-08-main--9f5840c) |
| Work branch | `chore/xr-launch-cleanup` |

## Phase 1 — Repository cleanup (docs, artifacts, structure)

| ID | Task | Files | Pri | Deps | Test/verify | Status |
|---|---|---|---|---|---|---|
| C-1 | Delete stale scratch (README-APPLY.txt, CHANGED-FILES.txt, root next-env.d.ts) | git rm | P1 | — | refs-grep = 0 live refs | ☑ |
| C-2 | Archive 29 root campaign deliverables → `docs/historical/phase-deliverables/` | git mv | P1 | — | nodevm-wording scope updated | ☑ |
| C-3 | Archive `stage0/` → `docs/historical/stage0/` | git mv | P1 | — | refs = comments only | ☑ |
| C-4 | Consolidate migration docs → `docs/migration/` | git mv | P1 | — | CHANGELOG link updated | ☑ |
| C-5 | Move `docs/phase*` campaigns → `docs/historical/phases/` | git mv | P1 | — | size-gate register, certification evidence, recall-benchmark writers, comment citations repointed | ☑ |
| C-6 | Rescue living docs out of campaign dirs (THREAT_MODEL, phase12 ops guides, MIGRATION_*) | git mv | P1 | — | certification test green | ☑ |
| C-7 | Create docs index + archive guide + consolidated audit + this tracker | docs/README.md, docs/historical/README.md, docs/audits/, docs/IMPLEMENTATION_PLAN.md | P1 | — | gates green | ☑ |
| C-8 | Regenerate release inventory; full gates + typecheck + tests | docs/release/7.1.0/inventory.* | P1 | C-1..C-7 | all green | ☑ |

## Phase 2 — P0 fixes (launch blockers)

| ID | Task | Files | Pri | Deps | Test/verify | Status |
|---|---|---|---|---|---|---|
| F-1 | Fix multi-agent review-gate deadlock: deterministic `security_checker` emits the strict-JSON contract; executor consumes the structured decision without re-parsing prose; keep fail-closed semantics for model reviewers | `src/services/multi-agent-service.ts`, `src/services/review-decision.ts`, `src/services/multi-agent-task-support.ts` | **P0** | C-8 | new e2e test completes a workflow with stubbed provider; regression test asserts prose still fails closed | ☑ (7a7c270) |
| F-2 | End-to-end workflow test (researcher/builder/reviewer/synthesizer actually run; status reaches `completed`) | `test/multi-agent-e2e.test.ts` (new) | **P0** | F-1 | bun test — 6 tests incl. transport-failure honesty + resume recovery | ☑ (7a7c270) |
| F-3 | Signed `v7.1.0` release: tag + GitHub release + npm publish closes the 3.1.5 drift | release.yml, RELEASING.md runbook | **P0** | all launch gates ☑ (10/10 verified 2026-08-08) | tag exists; npm view = 7.1.0; cosign/SLSA artifacts verify | ⊗ maintainer credentials only — publish per `docs/release/LAUNCH_HANDOFF.md` |

## Phase 3 — P1 correctness & honesty

| ID | Task | Files | Pri | Deps | Test/verify | Status |
|---|---|---|---|---|---|---|
| H-1 | Claims hygiene per A-3: reframe README "True AI OS/Provable Security"; extend manifest prohibited/supervised terms; verify claim-lint guards them | README.md, website/src/lib/site.ts, src/interfaces/onboard.ts, src/daemon/api/openapi.ts, release.manifest.json | **P1** | F-1 | claim-lint green + grep proves phrases gone + negative-test proves guard fires | ☑ |
| H-2 | Secrets at rest (A-4): encrypt file fallback (AES-256-GCM, key in OS keychain or per-install machine key, documented migration) + disclosure tests | `src/security/secrets.ts`, `src/config/config.ts`, `test/security/secrets.test.ts`, `docs/migration/secrets-at-rest.md` | **P1** | F-1 | security tests: at-rest file is ciphertext; round-trip works; legacy plaintext migrates | ☑ |
| H-3 | Launch-docs truthfulness: A-7 provider framing (5 wired native + OpenAI-compat presets + shipped Cerebras native adapter), A-13 scheduler/executor limitations explicit in getting-started | README.md, docs/development/GETTING_STARTED.md | **P1** | H-1 | docs build review; claim-lint green; table defaults match presets.ts mechanically | ☑ |
| H-4 | Minimal getting-started + first-task guide (extract from README; golden path mirrors `scripts/golden-path.ts`) | docs/development/GETTING_STARTED.md | **P1** | H-1 | golden-path test green; single doc (no duplicate family — docs/guides/ left empty deliberately) | ☑ |

## Phase 4 — P1 stabilization & UX verification

| ID | Task | Files | Pri | Deps | Test/verify | Status |
|---|---|---|---|---|---|---|
| S-1 | First-run flow probe: install → onboarding → provider setup → first task, on Linux; record friction | install.sh, src/install/, src/interfaces/onboard.ts | **P1** | F-1 | manual runbook + `golden-path`; LIVE-verified 2026-08-08 (fresh XR_HOME + stub provider): doctor→onboarding→provider→first task REAL e2e→verify-log→serve→uninstall. Friction: F1 doctor-defaults cosmetics (P3), F2 onboarding non-interactive flag → **RESOLVED 2026-08-08** (`xr onboarding --yes` + prompt EOF semantics; 4 tests in test/ux/onboarding-yes.test.ts), F3 env base-URL override unsupported → **FIXED this pass** (`config.envOverrides` + `envOverridesLocked`, 10 tests), F4 doctor "ready" ≠ key-valid (documented in guide) | ☑ |
| S-2 | Agent experience regression pass: cancellation, retries, budget stop, memory consent, approval gates — confirm tests pin each; add missing failure test if a path is unpinned | src/core/agent.ts, test/agent.test.ts, test/execution/ | **P1** | F-2 | bun test | ☑ (all five pinned: approvals 3 tests + denied-approval envelope test; budget stop cost/agent-service; memory consent 5 tests incl. decline/exclusion/forget/explainable-recall; cancellation 3 new in test/execution/cancellation.test.ts; retry reality = fail-closed no-retry pinned by 4 tests — ledger A-19 records the discovery; agent-service abort-threading = P2 follow-up) |
| S-3 | Dashboard/CLI smoke (token auth, panels, chat stream) post-changes | src/daemon | **P1** | F-1 | daemon tests + live probe: LIVE-verified 2026-08-08 — 401 no-token + bad-token; open health; agents/budget/memory panels real data (2 workflows incl. 1 completed); SSE chat stream `data:{text}`/`[DONE]`; **multi-agent flagship run live via CLI → `status: completed`** (planner→gates→researcher/builder→reviewer approved→synthesizer) | ☑ |
| S-4 | Migration-note check: ensure nothing in cleanup breaks an existing `~/.xr` install (paths, config, stores untouched) | docs/migration/ | **P1** | C-8 | LIVE upgrade probe 2026-08-08: legacy `9f5840c` home (config v18, plaintext `.env`) → current tree: config hydrated loss-free incl. hardened/allowlist/workspace; `.env` auto-sealed to `XRG1` with exact value round-trip (key reached provider); audit chain intact across trees (6 → more entries, still ✓); CLI/daemon/multi-agent all work on the migrated home | ☑ |

## Phase 5 — P2 hardening & polish (post-RC candidates)

| ID | Task | Pri | Notes | Status |
|---|---|---|---|---|
| R-1 | Enterprise adversarial/authz test parity (A-5) | P2 | verified current layout (11 enterprise + 3 evaluation + 4 business test files; audit's tenant/authz/pii module list predates 7.x consolidation); closed the real gap: test/business/adversarial-boundaries.test.ts — 12 adversarial tests | ☑ |
| R-2 | `as any` tightening at provider/routing/config seams (A-6) — no blanket refactor | P2 | **43 seam sites → 0** (src/providers 9, src/intelligence 3, src/config 1, src/daemon 30): validated narrowing helpers at zod-passthrough seams (`providerOverrideBaseUrl` typeof-guarded), anthropic literal-`as const`, openai-compat options built as typed locals, catalog direct ModelCapabilities indexing (proved `embeddings` key exists), enum whitelist validators for untrusted HTTP query params (ModelClass, CapabilityType, riskTier, locality), `BusinessOS` real type + one carrier-aware resolver replacing 12 duplicated registry sniff blocks + the triple-redundant status.get blob; dead `src/daemon/control-api.ts` removed (0 refs; broken SQL `ORDER BY ts` vs real `created_at`; superseded by control.routes.ts `recentAudit`). Remaining `as any`: none at seams (other dirs untouched per scope). 415 seam-adjacent tests green | ☑ |
| R-3 | De-duplicate known-limitations registers (A-15): canonical register + release excerpt | P2 | canonical register = `docs/security/KNOWN_LIMITATIONS.md` (17 stable-numbered rows; runbook refs preserved); 7.1.0 doc declared frozen excerpt; stale `docs/phase-1/` pointer repointed | ☑ |
| R-4 | Document control/computer division (A-10); merge only on true duplication | P2 | division written into `docs/environment/README.md` (verified vs imports: control/ = governed pipeline; computer/ = single-shot SYSTEM_TOOLS; no duplication → no merge) | ☑ |
| R-5 | Onboarding capability detection surfacing (A-12) | P2 | done via reuse, not duplication: onboarding renders a "What works on this machine" section from `probeHealth()` (the doctor/status detection engine — one authority), post-`saveConfig`, offline-safe (network probe skipped); pins in onboarding-yes unit test; live output verified (runtime/voice/browser/control/secrets rows + remediations + `xr doctor` pointer) | ☑ |
| R-6 | Provider canaries (known-limitation) — optional live smoke per provider | P3 | nightly CI | ☐ |
| R-7 | Branch retirement + remote hygiene (A-16) | P3 | maintainer action | ☐ |
| R-8 | Test hygiene: suite leaves ~220 MB temp dirs on /tmp per run (spurious SQLITE_FULL on full tmpfs); `test/capabilities/provenance-graph.test.ts` "graph is bounded" takes ~4.04 s alone (80% of bun's 5 s default timeout) and flakes under parallel load (observed 5,021 ms once) | P2 | **FIXED 2026-08-08:** (1) `bunfig.toml [test].preload` → `test/helpers/suite-tmp.ts` routes the whole suite (incl. spawned children — TMPDIR is on the MCP env allow-list) into one owned `xr-suite-*` root; cleanup layered: start-up stale-sweep (120 s grace — survives SIGKILL; probed: bun's runner never fires `exit`/`beforeExit` JS hooks) + `afterAll` + exit hooks; `XR_TEST_TMP_KEEP=1` debug escape hatch. Verified: full run leaves **0** temp dirs (was ~220 MB). (2) bounded-graph test gets explicit 15 s timeout (8,200 inserts pay an O(events) per-cap prune rebuild past the 500-event floor — bound semantics, not prune speed, are what it pins). One suite-owned root chosen over patching 291 mkdtemp sites (no blanket refactor). Full suite re-green: 2,795/13/0; ownership gate fired on the new `test/helpers/` area → map regenerated (154 areas) — gate works as designed. | ☑ |

## Dependency graph (blocking order)

```
Phase 0 baseline ☑
   └─→ Phase 1 cleanup (C-1..C-8)
         └─→ F-1 multi-agent fix ──→ F-2 e2e test ──┐
              └─→ H-2 secrets at rest               │
                    └─→ H-1/H-3/H-4 claims & docs   ├─→ Phase 4 probes ──→ RC ──→ F-3 signed release (maintainer)
                          └─→ Phase 5 P2 items (may follow RC)
```

Rules: no P2 before P0/P1; no README claims-edit before F-1 (a fixed flagship
changes what the README may say); F-3 is credential-gated and is *prepared*
here, executed by the maintainer.

## Launch gates — 10/10 verified 2026-08-08 (all must be true to declare `v7.1.0` candidate)

Verified at `chore/xr-launch-cleanup @ 2637119`; dated evidence below.
Gate 10 is preparation-complete — the publish action itself is
maintainer-owned (F-3 ⊗ credentials). F-3's "all launch gates" dependency is
therefore **met**; only the credentials remain.

| # | Gate | Status | Verified evidence (2026-08-08) |
|---|---|---|---|
| 1 | **Build** | ☑ | Clean worktree clone at HEAD: `bun install --frozen-lockfile` (52 pkgs) + `tsc --noEmit` exit 0 |
| 2 | **Tests** | ☑ | Full suite **2,795 pass / 13 skip / 0 fail** across 223 files (~48 s); F-2 e2e `test/multi-agent-e2e.test.ts` (6 tests) green |
| 3 | **Gates** | ☑ | 14/14 local CI gates PASS (release:check, channel:check, claim-lint, changelog:check, baseline:inventory, ownership:check, boundaries, size-gate, hot-path-lint, ci-capability-gate, api:schema:check, client:check, api:compat, website:marketplace:check) |
| 4 | **Multi-agent** | ☑ | Live CLI run `wf_6acaa135` vs stub provider: planner → gates → researcher/builder → reviewer (strict-JSON approved) → synthesizer; `status=completed`, workers executed; dashboard agents panel reflected the run |
| 5 | **Claims** | ☑ | `claim-lint` green; grep of prohibited phrases ("True AI Operating System", "AI OS Kernel", "Provable Security", "AI Business Operating System", deterministic-injection-benchmark framing) over all scanned surfaces = **0 hits**; negative tests prove the guard fails the build |
| 6 | **Secrets** | ☑ | H-2 chosen path: at-rest file fallback **is ciphertext** (`XRG1` AES-256-GCM); 7 disclosure tests incl. legacy-plaintext migration + corrupt-key fail-closed; `docs/migration/secrets-at-rest.md` publishes the honest threat model |
| 7 | **Security** | ☑ | Security suites green: `verify-log` chain verification, guard corpus, egress fail-closed, dashboard auth probes (401 no/bad token live-verified), secrets disclosure ×7, business adversarial boundaries ×12 |
| 8 | **First-run** | ☑ | S-1 fresh-Linux-home journey end-to-end (doctor → onboarding → provider → real task → verify-log → serve → uninstall); friction F1 (P3) / F4 documented, F2 → RESOLVED (`xr onboarding --yes` + EOF-fail-closed prompts, 4 tests); `scripts/golden-path.ts` regression green |
| 9 | **Install/migration** | ☑ | S-4 upgrade probe from pre-cleanup `9f5840c` home: config v18 hydrates loss-free, plaintext `.env` auto-seals to `XRG1` with exact value round-trip, audit chain intact across trees; `xr doctor` honesty limits documented |
| 10 | **Distribution prep** | ☑ (prep) | `docs/release/LAUNCH_HANDOFF.md` runbook written + refreshed; artifact list defined (tag, notes, cosign/SLSA/SBOM as wired). Publish = maintainer action (F-3 ⊗) |

## Work log

- 2026-08-08 — Phase 0 complete: baseline recorded; P0-A reproduced; gates green.
- 2026-08-08 — Phase 1 batches C-1..C-7 executed on `chore/xr-launch-cleanup`.
- 2026-08-08 — Phase 1 C-8 + Phase 2 F-1/F-2 complete (commit 7a7c270): review-gate deadlock fixed (deterministic checker emits strict-JSON contract; executor consumes structured decision; prose reviewers still fail closed); honest failure mapping (transport/budget/approval stops = task failure, no fake completions); `test/multi-agent-e2e.test.ts` green; full suite 2,759 pass / 13 skip / 0 fail; 14/14 gates.
- 2026-08-08 — H-2 complete: `~/.xr/.env` fallback sealed with AES-256-GCM (`XRG1` format, per-install key `secrets/.file-key`, fail-closed corrupt key, verbatim carry-through of undecryptable entries, transparent legacy migration); `config.ts` hydration routed through `listFileSecrets()`; 7 disclosure tests; migration doc `docs/migration/secrets-at-rest.md`.
- 2026-08-08 — H-1 complete (A-3 + A-11): reframed "True AI Operating System"/"AI OS Kernel"/"Provable Security"/"AI Business Operating System"/"deterministic injection benchmark" on all scanned surfaces (README, website site.ts, onboarding banner, OpenAPI summary); fixed adjacent stale claims found by verification (canonical `xr attacks` command, 12→11 templates, dropped Proposal Generation, `src/business/` tree → real `extensions/business-os` layout, XR-15 default-off status, `enable all`/`deploy --all` → real syntax); manifest gained 4 prohibited patterns (AI Operating System / AI OS Kernel / Provable Security / Business Operating System) + supervised "AI OS"/"operating system"; negative tests prove the guard fails the build; SEO strategy doc marked superseded. Supervised "operating system" is deliberately strict: any scanned-surface mention needs rephrase-or-evidence.
- 2026-08-08 — H-3/H-4 complete (A-7 + A-13): README providers section rewritten against `presets.ts`/`factory.ts` — 26 presets (16 hosted + 10 local), 5 wired native adapters named, OpenAI-compatible transport stated, Cerebras wiring nuance recorded, stale model labels replaced with real `defaultModel` values, switch semantics documented; new `docs/development/GETTING_STARTED.md` mirrors the CI golden path (install → onboarding → provider → first task → restart/resume → uninstall) with doctor exit-code honesty, secrets-backend pointer, A-13 workflow limitations box, and verified uninstall flags. Single guide — no duplicate doc family.
- 2026-08-08 — S-2 + R-1 complete: agent-experience behaviors verified pinned (approvals, budget stop, memory consent ×5, workflow cancel) + 7 new tests for the two unpinned paths (`test/execution/cancellation.test.ts` ×3 — cooperative cancel, watchdog-stamped honest `cancelled`, durable flag; `test/execution/service.test.ts` ×4 — fail-closed retry semantics). Verification surfaced that automatic same-run retry is intentionally unreachable post-side-effect (fail-closed design) — ledger A-19 records it; abort-through-agent-service logged as P2 follow-up. R-1: adversarial boundary tests for the business extension (`test/business/adversarial-boundaries.test.ts`, 12 tests) after verifying the audit's module list predates the 7.x consolidation.
- 2026-08-08 — Test-count drift note: phase deltas touch many files; per policy, suite re-run + all gates after every batch (see each commit message).
- 2026-08-08 — Phase 4 complete (S-1..S-4 all live-verified): first-run journey on fresh Linux XR_HOME end-to-end (F1 doctor-defaults cosmetics P3, F2 onboarding `--yes` absent → documented P2, F3 env base-URL override unsupported → **fixed with `config.envOverrides`/`envOverridesLocked` + 10 tests incl. run-path regression**, F4 doctor-ready ≠ key-valid → documented); upgrade probe from pre-cleanup `9f5840c` home — config v18 hydrates loss-free, plaintext `.env` auto-seals with exact value round-trip, audit chain intact across trees; daemon smoke — token auth (401 no/bad token), real panels, SSE chat stream; multi-agent flagship workflow run live via CLI to `completed`.
- 2026-08-08 — RC-1: launch gates recorded — **10/10 verified** with dated evidence at `2637119` (clean-clone build; 2,795-pass suite; 14/14 gates; live multi-agent `wf_6acaa135` completed; claim grep 0 hits; secrets ciphertext at rest; security suites green; S-1 fresh-run; S-4 upgrade probe; distribution-prep runbook). F-3's gate dependency met — only maintainer credentials remain (publish per `docs/release/LAUNCH_HANDOFF.md`).
- 2026-08-08 — RC-2: `docs/release/RELEASE_CANDIDATE_NOTES.md` — engineering delta since baseline, per-phase with ledger IDs, totals, known-limitations pointers, open P2/P3, maintainer actions; indexed in docs/README.md.
- 2026-08-08 — R-3 (A-15 RESOLVED): known-limitations dedup — `docs/security/KNOWN_LIMITATIONS.md` = canonical living register (stable #1–#9; #10–#17 merged from the release register), 7.1.0 doc = frozen excerpt; stale `docs/phase-1/` pointer in test/platform/exclusions.json repointed.
- 2026-08-08 — R-4 (A-10 RESOLVED): control/computer division documented in `docs/environment/README.md`, verified against imports; no duplication found → deliberately no merge.
- 2026-08-08 — R-8 complete: suite temp hygiene via bunfig preload (`test/helpers/suite-tmp.ts`) — owned root + stale-sweep + afterAll/exit hooks; empirically probed that bun's runner skips `exit`/`beforeExit` JS hooks; bounded-graph test timeout 15 s. **Post-reconstitution full verification: typecheck clean, 2,795 pass / 13 skip / 0 fail, 14/14 gates, 0 temp dirs remain after a full run.** Ownership gate caught the new `test/helpers/` area (map regenerated, 154 areas) — architectural invariants working as designed.
- 2026-08-08 — **Environment incident (transparency record):** the execution sandbox re-provisioned mid-program, discarding the Bun toolchain and the repo's `.git` metadata; the **working tree persisted fully intact**. Baseline `9f5840c` was re-fetched from origin (verified still the tip of `main` — zero upstream drift) and the branch was reconstituted as one squashed commit containing exactly the recorded work. SHAs cited elsewhere in this log (`21f13fc` Phase-1, `7a7c270` F-1/F-2, `b0b1d2e` H-2, `021a740` H-1, `fa6cc25` H-3/H-4, `343845a` S-2+R-1, `2637119` Phase-4, `297da3d` RC-1, `f62b712` RC-2, `70f1df4` R-3, `fd82fff` R-4; earlier-window `a041379` F-3-era publisher-parity is subsumed) refer to the pre-incident history — content identical, re-verified by full suite + all gates after reconstitution.
- 2026-08-08 — F-2 (S-1 friction) RESOLVED: `xr onboarding --yes` accepts every prompt at its default (same semantics as `xr install --yes`; rogue-stdin e2e proves answers are ignored); deeper defect found while testing — **prompt EOF hang**: any unanswered EOF on stdin (closed pipe; the second+ question creates a fresh readline that never re-emits `close`) froze every interactive flow forever. Fixed in `src/interfaces/cli.ts`: module-level EOF tracking, asks fall back to defaults, and **consent gates fail closed** (`approvePrompt` passes `eofApproves: false` — verified a blanket default would have auto-approved on EOF); install wizard already fails closed via `!isTTY`. Known remaining quirk (documented, not fixed by design): piping an answer SEQUENCE into the interactive wizard loses buffered lines between per-question interfaces — scripted callers should use `--yes`. Tests: test/ux/onboarding-yes.test.ts ×4 (unit, rogue-stdin e2e, EOF-completion e2e — 90 s hang → 263 ms, primitive probe: ask=default / plain-confirm=default / gate=deny).
- 2026-08-08 — R-5 (A-12 RESOLVED): onboarding capability detection surfaced — new post-`saveConfig` "What works on this machine" section rendered from `probeHealth()` (the single doctor/status detection engine; deliberately NO duplicate detection code), offline-safe, with per-capability remediation and `xr doctor` pointer. Live-verified output on this host (voice/browser/control runtimes + linux-secret-service backend row). Pinned in the onboarding unit test.
