# XR v1 — Evidence Log

Chronological record of every verification action taken by the Plan Owner.
**Rule:** an entry exists only if the command was actually executed. Expected or
remembered results are never recorded. Where a check could not be run, the entry says
so and names the missing prerequisite.

**Legend:** ✅ PASS · ❌ FAIL · ⚪ NOT RUN · 🚫 BLOCKED (prerequisite absent) · ℹ️ FACT (read, not executed)

---

## §1 Environment register (recorded once, cited as E-01)

**E-01 — Verification environment**

| Field | Value |
|---|---|
| Date | 2026-11-01 (Asia/Karachi) |
| OS | Linux x64 (sandbox), kernel 6.x |
| CPU / RAM | 2 vCPU / 1.9 GiB, **no swap**, ~20 GB free |
| Node | v20.20.2 · npm 10.8.2 · Python 3.13.16 |
| Bun | **1.4.4** installed to `~/.bun` — repo pins `.bun-version = 1.4.2`; `bun install --frozen-lockfile` succeeded, so the deviation is version-line-only (1.4.x) and is recorded, not hidden |
| Rust / cargo | **absent** (`cargo: command not found`) |
| Display server | **absent** — no native Tauri GUI, no webview rendering |
| Audio device | **absent** |
| OS keychain daemon | **absent** — engine printed: "no OS keychain was found … secrets are being stored in the encrypted file fallback" |
| Windows / macOS host | **absent** |
| Paid provider credentials | **absent** |
| Admin rights on the GitHub repo | **absent** (job-log endpoint → 403) |

**Consequences.** The following can never be claimed from this environment: any native
GUI behavior, any non-Linux platform behavior, audio/voice behavior, OS-keychain
behavior, live-provider compatibility or quality, signed/notarized artifacts.

---

## §2 Repository state

**E-02 — Exact commit and working tree** ✅

```
$ git rev-parse --abbrev-ref HEAD         → main
$ git rev-parse HEAD                      → 6b9cb599aebbe8d8de8b100370c3a6434c3240e0
$ git log -1 --format='%ad%n%s'           → Sun Nov 1 17:12:45 2026 +0500
                                            Merge pull request #204 from ahmadrrrtx/work/ui-redesign-2026-10-29
$ git status --porcelain=v1 --branch      → ## main...origin/main   (clean, nothing to commit)
$ git rev-list --count HEAD               → 1347
$ git remote -v                           → origin https://github.com/ahmadrrrtx/xr.git
$ git tag --sort=-creatordate | head -3   → v1.1.0, v1.0.0, v1.0.0-beta.1
```
**No uncommitted user work existed.** Nothing was reset, stashed or discarded; the clone
was fresh.

**E-03 — Release identity surfaces** ℹ️

```
package.json            → "version": "1.1.1-rc.1", "packageManager": "bun@1.4.2"
release.manifest.json   → identity.version 1.1.1-rc.1, codename Graphite,
                          stability "developer-preview",
                          channels.publicVersion "1.0.0",
                          channels.withdrawnTags [v1.1.0]
.bun-version            → 1.4.2
```
The in-development line and the public channel line are **deliberately different**, and
the manifest says so. This is not drift.

**E-04 — Provider preset count, by executing the module** ✅

```
$ cat > /tmp/count-presets.ts  (imports /home/user/xr/src/providers/presets.ts)
$ bun run /tmp/count-presets.ts
PRESET COUNT: 26
LOCAL-ish: 10  ollama,lmstudio,jan,localai,vllm,llamacpp,gpt4all,koboldcpp,textgenwebui,sglang
HOSTED:    16  groq,google,deepseek,cerebras,openrouter,together,mistral,fireworks,
               sambanova,huggingface,openai,anthropic,cohere,xai,perplexity,bedrock
groq keys: id,label,kind,tier,baseUrl,apiKeyEnv,authType,defaultModel,knownModels,
           capabilities,description,docsUrl
```
Confirms the README's "26 built-in presets — 16 hosted and 10 local runtimes".

---

## §3 Live engine verification

**E-05 — Engine boots, fails closed, and tells the truth about secrets** ✅

```
$ HOME=/tmp/xrhome bun run src/index.ts serve --port 47831
⚠ XR: no OS keychain was found (macOS Keychain, Linux secret-tool, Windows PowerShell);
  secrets are being stored in the encrypted file fallback (~/.xr/.env, key in ~/.xr/secrets) …
  XR — Local Server
  ✓ Listening on  http://127.0.0.1:47831
  ✓ Dashboard / Chat
  Token: (hidden — sign in on the dashboard with the token in /tmp/xrhome/.xr/daemon/token …)
  Binding: 127.0.0.1 only — not exposed to the network

$ curl -o /dev/null -w '%{http_code}' http://127.0.0.1:47831/api/v1/providers
401
```
Two things worth noting for the plan: the secret-backend fallback is **announced, not
silent**, and unauthenticated API access is **refused**. Both support AUD-002's
"the subsystem is healthier than the audit implies".

**E-06 — Authenticated provider listing (runtime truth)** ✅

```
$ TOKEN=$(cat /tmp/xrhome/.xr/daemon/token)      # 48 chars
$ curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:47831/api/v1/providers
HTTP=200
top keys: ['primary','model','providers']
COUNT: 26
sample(ollama): {id, label:"Ollama (Local)", tier:"free", kind:"local", locality:"local",
                 description, docsUrl, baseUrl:"http://localhost:11434/v1",
                 authType:"none", keyless:true, knownModels:[9],
                 hasKey:true, authOk:false, healthy:false,
                 healthState:"unknown", authState:"unverified", checkedAt}
```
The API separates **credential presence** (`hasKey`) from **authentication**
(`authOk`/`authState`) from **health** (`healthy`/`healthState`) — the distinction the
audit demands already exists in the wire contract.

---

## §4 Build, gate and typecheck battery

**E-07 — Desktop production build** ✅

```
$ cd desktop && bun run build
✓ built in 3.31s
dist/assets/router-DPUiRbr_.js  1,500.10 kB │ gzip: 430.35 kB
(!) Some chunks are larger than 500 kB …   (warning only)
[INEFFECTIVE_DYNAMIC_IMPORT] src/lib/detect.ts is dynamically imported by
  src/screens/Onboarding/StepDownload.tsx but also statically imported by
  StepDownload.tsx, StepMicSetup.tsx, StepModelSetup.tsx, StepSystemCheck.tsx
  → dynamic import will not move module into another chunk
[INEFFECTIVE_DYNAMIC_IMPORT] src/budget/enforce.ts … (same pattern)
BUILD EXIT=0
```
Recorded because the first warning is cited in AUD-001: the "lazy" detection module is
in fact loaded eagerly by four onboarding steps.

**E-08 — Pinned provider tests** ✅

```
$ bun test test/providers/offline-listing.test.ts
(pass) GET /api/providers is offline; credentials do not fabricate auth or health
(pass) offline inspection retains only measured fresh health for the same endpoint
(pass) GET /api/providers carries the preset metadata the desktop catalog needs (2026-11-01)
3 pass / 0 fail / 251 expect()

$ bun test test/desktop/provider-catalog.test.ts
(pass) derives every engine provider — hosted, local and custom — plus the custom endpoint
(pass) groups local runtimes after hosted and maps desktop modal kinds
(pass) engine docsUrl is the keysUrl when no curated override exists
(pass) degraded fallback when the engine is unreachable or lists nothing
(pass) every catalog entry carries an icon component
(pass) the custom endpoint entry is immutable shared state
6 pass / 0 fail / 40 expect()
```

**E-09 — Production seed gate** ✅

```
$ bun run scripts/desktop-seed-gate.ts
desktop-seed-gate: no build output at …/desktop/dist — run `vite build` first.   ← first call, before E-07
$ bun run scripts/desktop-seed-gate.ts        (after the build)
desktop-seed-gate: OK — 7 seed probes absent from desktop/dist.
```

**E-10 — Repository gates** ✅

```
release:check     → [release-manifest] all 10 surfaces in sync at 1.1.1-rc.1 (Graphite)   EXIT=0
channel:check     → ok — 5 channel stable configs in sync at public v1.0.0                EXIT=0
claim-lint        → ✓ no unsupported claims · 20 evidenced claims · every cited Article
                     exists in docs/CONSTITUTION.md · v1.1.1-rc.1                          EXIT=0
placeholder-lint  → ✅ no placeholder markers — 77 files scanned under website/src        EXIT=0
desktop:sink-lint → scanned 495 renderer file(s) · 0 violation(s) · 3 declared exception(s) EXIT=0
```
Note: `placeholder-lint` scans **`website/src` only** — it does not cover the renderer,
so it could not have caught a fake-data surface in `desktop/src`. Recorded for `XR-P04`.

**E-11 — TypeScript (root + desktop)** ✅

```
$ bunx tsc --noEmit                        → ROOT_TSC_EXIT=0
$ bunx tsc -p desktop/tsconfig.json --noEmit → DESKTOP_TSC_EXIT=0
```

**E-12 — Full Linux parity suite (the repo's own quality gate)** ✅

```
$ bash scripts/parity-suite-runner.sh linux --exclude '^test/e2e-blackbox/'
running 473 test files (per-directory segments, one computation authority)
… 54 segments …
executed 473 of 473 files
TOTALS (summed from per-segment summaries): 5119 pass · 0 fail · 41 skip
EXIT CODE: 0
```
Selected evidence relevant to findings:
- `test/api/chat-stream.test.ts` — 15 pass: ordered token deltas, `provider_ready`
  before first token, `tool_call→tool_result→continue`, truthful stream error, exactly
  one `[DONE]`, no tokens after terminal, cancellation mid-turn stops the run.
- `test/multi-agent-e2e.test.ts` — 7 pass incl. "a worker that fake-completes an EMPTY
  turn fails the workflow, never 'completed'", "resume retries a failed worker", and
  "model reviewer emitting prose still fails closed".
- `test/a11y/browser-axe.test.ts` — **13 skipped**: "Playwright chromium binary not
  found". Recorded as a real skip (not a pass); live browser a11y is unverified here.
- `test/api/openapi.test.ts` — 12 pass incl. "committed artifact matches the live
  registry (drift gate equivalent)" and "every served route id has contract metadata".
- The suite prints `[suite-tmp] N WorkspaceStore connection(s) were still open at exit`
  in several segments (7, 10, 79). Handles are closed by the harness; recorded as an
  observation, not a failure.

**Excluded from this run:** `test/e2e-blackbox/` (excluded by the same regex CI uses),
`test/daemon/phase2b.test.ts` (quarantined by owner policy until 2026-12-01), and the
13 live-browser a11y tests (no chromium). CI additionally runs those lanes.

---

## §5 Live release-channel and CI truth

**E-13 — npm registry state** ✅

```
$ curl -sS https://registry.npmjs.org/@rrrtx/xr
dist-tags: {'latest': '1.0.0', 'beta': '1.0.0-beta.1'}
versions: 8 · newest: 3.0.1, 3.0.2, 3.0.3, 3.1.5, 1.0.0-beta.1, 1.0.0
```
`latest` = `1.0.0`, matching `release.manifest.json` `publicVersion`. **No `1.1.1-rc.1`
was ever published** — consistent with the README's preview warning.

**E-14 — GitHub Actions state at the verified SHA** ❌

```
$ curl -sS 'https://api.github.com/repos/ahmadrrrtx/xr/actions/runs?per_page=20'
2026-11-01T12:37:52Z  Real-Device Matrix (non-gating)   main  6b9cb599  completed/skipped
2026-11-01T12:12:49Z  Channel Install Tests             main  6b9cb599  completed/success
2026-11-01T12:12:49Z  CI                                  main  6b9cb599  completed/success
2026-11-01T12:12:49Z  Cross-Platform CI                   main  6b9cb599  completed/FAILURE
2026-11-01T12:12:49Z  Clean-Machine Journey               main  6b9cb599  completed/success
2026-11-01T12:12:49Z  Desktop App (Tauri packaging)       main  6b9cb599  completed/FAILURE
2026-11-01T12:12:49Z  npm Pack Smoke                      main  6b9cb599  completed/success
2026-11-01T12:12:49Z  Supply Chain                        main  6b9cb599  completed/success
2026-11-01T12:12:48Z  Workflow Audit (non-gating)         main  6b9cb599  completed/success
2026-11-01T11:54:08Z  Channel Live                        main  8e72ac6c  completed/FAILURE
```
Failed-job detail:
```
run 41305393269 (Cross-Platform CI)
  FAILED JOB  macOS — full parity (typecheck + suite + golden path)
     step: Full unit suite for this OS (one computation authority) -> failure
  FAILED JOB  Cross-Platform gate / Every required job succeeded -> failure
run 41305393234 (Desktop App)
  FAILED JOB  Desktop journey — linux-x64 on ubuntu-22.04   step: Journey -> failure
  FAILED JOB  Desktop journey — linux-x64 on ubuntu-24.04   step: Journey -> failure
  FAILED JOB  Desktop native validation (bundles + journeys) -> failure
  FAILED JOB  Desktop gate (bundles + latest.json + journey) -> failure
```
**This is a material discrepancy with the supplied audit**, which reported a *Supply
Chain* failure on 2026-10-28 and did not report these two. `Supply Chain` is now green;
`Cross-Platform` (macOS) and `Desktop App` (Linux journeys) are red on the integration
commit.

**E-15 — CI job logs** 🚫

```
$ curl -sSL .../actions/jobs/<job-id>/logs
{"message":"Must have admin rights to Repository.","status":"403"}
```
Root cause for E-14's two failures is therefore **UNVERIFIED**. No inference from the
job *names* is recorded as a cause.

**E-16 — Branch protection on `main`** ❌ (governance)

```
$ curl -sS https://api.github.com/repos/ahmadrrrtx/xr/branches/main
protected: {'enabled': False,
            'required_status_checks': {'enforcement_level': 'off', 'contexts': [], 'checks': []}}
commit sha: 6b9cb599aebbe8d8de8b100370c3a6434c3240e0
open_issues: 2  (default_branch main, archived false)
```

**E-17 — GitHub releases** ✅

```
v1.1.0        prerelease=False draft=False assets=5   published=2026-10-15T01:12:58Z
v1.0.0        prerelease=False draft=False assets=21  published=2026-09-08T13:22:54Z
v1.0.0-beta.1 prerelease=True  draft=False assets=21  published=2026-09-03T00:53:01Z
```
`v1.1.0` is live, **not** marked prerelease, and carries only 5 assets — exactly what
`release.manifest.json`'s `withdrawnTags` note predicts ("The GitHub release only carries
5 unsigned desktop bundles … Superseded"). The manifest's disclosure is accurate; the
channel state is inconsistent, and the owner repair is outstanding.

**E-18 — Documentation corruption scan** ❌

```
pattern: [a-z]{2,}\d{1,3}[a-z]{2,}   (word fused with digits)
  21  docs/release/PROGRESS.md
  11  docs/release/RELEASE_CANDIDATE_REPORT.md
   6  docs/release/V1-RELEASE-LEDGER-2026-10-28.md
   2  docs/release/RELEASING.md
   2  docs/release/VERIFICATION_COMMANDS.md
   2  docs/release/RELEASE_CANDIDATE_NOTES.md
   2  docs/release/V1-RELEASE-CHECKLIST-2026-10-28.md
   2  docs/IMPLEMENTATION_PLAN.md
   1  docs/release/SUPPORT_MATRIX.md, DESKTOP-SUPPORT-MATRIX.md, GITHUB_HANDOFF.md,
      V1-FEATURE-MATRIX-2026-10-28.md
```
Specimens: `across10mandatory surfaces` · `returned **v1.1.0, not prerelease,5assets**` ·
`.15versioned categories,5smoke` · `Stable public defaults remain1.0.0`.

**E-19 — Published test baseline vs. measured baseline** ❌ (stale claim)

```
README.md:594 → "4,972 pass / 29 skip / 0 fail across 450 files" (measured at a2b6a735, 2026-10-22)
E-12 measured → 5,119 pass / 41 skip / 0 fail across 473 files at 6b9cb599 (2026-11-01)
```

---

## §6 Static inspection record (code-path findings)

Each row is a read of the actual file at `6b9cb599`, cited so an executor can re-check it.

**E-20 — Desktop engine lifecycle** ℹ️

| Claim | Location |
|---|---|
| Sidecar spawned with ephemeral port + parent watch | `desktop/src-tauri/src/engine.rs:124,146-156` |
| Banner parsed (`Listening on`, `Token: <48 hex>`) | `desktop/src-tauri/src/engine_state.rs:22-44` |
| Independent desktop home, `XR_HOME` overridden for the child | `desktop/src-tauri/src/desktop_home.rs:5`, `engine.rs:144` |
| Containment: Job Object / PDEATHSIG / parent-watch | `engine.rs:1-30` doc block; `win.rs`; `unix.rs` |
| Honest failure state (`spawned:false` + reason) | `engine.rs:293,308-313` |
| User-visible failure surface with Retry/Start/Diagnostics | `desktop/src/components/engine/EngineDownBanner.tsx:1-80` |
| Engine link polling `up`/`down`/`unauthorized` | `desktop/src/stores/engineStore.ts:1-40` |
| **No version/schema negotiation** | `desktop/src/engine/transport.ts` — zero matches for `apiVersion|schemaVersion|contractVersion|minEngine` |
| Engine advertises `apiVersion` | `src/daemon/routes/meta.routes.ts:45` |

**E-21 — Onboarding** ℹ️

| Claim | Location |
|---|---|
| 10-step wizard, steps 1–3 not skippable | `desktop/src/screens/Onboarding/index.tsx:34-45` |
| Only gate on Continue is the step-2 checkbox | `index.tsx:60-64` |
| No terms/privacy/consent anywhere | `grep` over `desktop/src/screens/Onboarding/*.tsx` → 0 matches; `grep termsAccepted` over `desktop/src/` → 0 matches |
| Promise step is prose + "understood" checkbox, no persisted version | `StepPromise.tsx:5-23` |
| Voice preview = OS Web Speech, configured voice = Piper id | `StepVoice.tsx:30,55-76` vs `src/voice/models.ts` presets |
| Real Ollama NDJSON download with progress/error/retry | `StepDownload.tsx:11-26,116-145` |
| Real hardware detection (system/GPU/mic/ollama) | `StepSystemCheck.tsx:3,32-64`, `StepMicSetup.tsx:27,53` |
| Engine-driven cloud provider list, 5-entry offline fallback | `StepModelSetup.tsx:18-38` |
| **No success predicate** | `StepAllSet.tsx` (no engine/health/provider assertion) |
| Completion = one boolean flag | `desktop/src/stores/onboarding.ts` (`finishOnboarding`), `OnboardingScreen.tsx:28,51` |

**E-22 — Provider truth** ℹ️

| Claim | Location |
|---|---|
| Catalog derived from engine | `desktop/src/engine/providerCatalog.ts:206-215` |
| Grouped hosted/local/custom + custom endpoint entry | same file `:186-198` |
| Offline fallback = 10 ids, flagged `degraded` | same file `:161-180`; `degraded` surfaced at `ModelsTab.tsx:487` |
| Configured rows come from the **desktop settings store** | `ModelsTab.tsx:299`, `settingsStore.ts:34-46,199` |
| Writes to that store exist only in two dialogs | `Settings/tabs/ModelsTab.tsx:197,219`; `Budget/components/ModelsTab.tsx:169` |
| `engineKnowsProvider` fails **open** when engine list is null | `desktop/src/engine/providers.ts:33-36` |
| Second, independent Models screen | `screens/Budget/components/ModelsTab.tsx` (621 lines, price registry at `:59,67`) |

**E-23 — Trust plane (enforcement is real)** ℹ️

| Claim | Location |
|---|---|
| Approval gate refuses when no approval can be obtained | `src/execution/service.ts:1046-1060` (`denied`, `code:"approval_unavailable"`) |
| Approval grant/deny audited | `src/execution/service.ts:1087-1103` |
| Per-tool `requiresApproval` | `src/tools/files.ts:33`, `src/tools/git.ts:67`, `src/tools/control.ts:37` |
| Capability policy modules | `src/capabilities/{policy,grant,authorize,request}.ts` |
| OS-open restricted to XR roots + inert types | `desktop/src-tauri/src/reveal_policy.rs:1-27` |
| Unknown price ≠ free | `src/cost/pricing.ts:2-8` (`NaN` internally, `known:false`, `"unavailable"`) |
| Budget reservation/settlement | `src/cost/governor.ts:18,86-96,136-143,254-328` |

**E-24 — Artifacts, automation, demo data** ℹ️

| Claim | Location |
|---|---|
| No artifact concept in Chat | `grep -rn artifact desktop/src/screens/Chat/` → 0 |
| No generic artifacts API; only `business.artifacts.list` | `src/daemon/routes/business.routes.ts:224`; `contract.ts:603` |
| No `ArtifactRecord` type anywhere | `grep -rn ArtifactRecord src/ desktop/src/` → 0 |
| Artifact **verifier** exists for multi-agent missions | `src/services/multi-agent-orchestration.ts:210-284`; README:457-462 |
| Automation engine + routes exist | `src/automation/triggers.ts`; `src/daemon/server.ts:836-837`; `contract.ts:322-343` |
| Desktop has no automations surface | `desktop/src/router.tsx` (16 routes, none automated); grep → 1 unrelated match |
| Demo data debug-gated | `desktop/src-tauri/src/seed_purge.rs:29-35`; `desktop/src/budget/api.ts:322`; `desktop/src/lib/llm.ts:141-156` |
| Demo run labelled when no model answers | `desktop/src/brain/demo.ts:16-32` |
| "brain cell" metric does not exist | `grep -rin "brain cell\|braincell"` → 0 |

**E-25 — Competing planning documents** ℹ️

```
docs/IMPLEMENTATION-PLAN.md              67 KB  "XR IMPLEMENTATION PLAN — v1.0 Final … One agent per phase"
docs/IMPLEMENTATION_PLAN.md              35 KB  "Launch Implementation Plan & Tracker"
docs/implementation/*.md                 12 files, a different phase numbering
docs/release/IMPLEMENTATION_PLAN.md
docs/release/V1-RELEASE-LEDGER-2026-10-28.md   most recent, most accurate ledger
```
Four+ phase systems coexist. This plan (XRD-009) adds a fifth **by necessity** and
therefore declares an explicit precedence rule (D-005) instead of silently competing.

**E-26 — Issue and governance inventory** ℹ️

```
open issues: #203 "ci: bump the actions group with 2 updates" (2026-10-29)
             #183 "Windows parity: dev server lifecycle (static) — start returns error frame"
                  (2026-10-14) — pre-existing, test/daemon/builder-routes.test.ts:293,
                  suspects findFreePort()/Bun.serve on Windows
quarantine:  test/daemon/phase2b.test.ts — owner @ahmadrrrtx, XR-LAUNCH-012,
             expires 2026-12-01 (policy: 10 consecutive green main runs to clear)
CODEOWNERS:  exists, per-subsystem, "@ahmadrrrtx" everywhere  → advisory until E-16 is fixed
```

**E-27 — Gate enforcement audit: declared vs. actually run** ❌

Method: for each script named in `package.json` → `scripts.ci`, count how many
`.github/workflows/*.yml` invoke it (`grep -rl "run <gate>" .github/workflows/`), then run
the full battery against a **pristine worktree** of the verified commit
(`git worktree add /tmp/xr-clean 6b9cb599`, `node_modules` symlinked, no files touched) so
that no edit of mine could influence the result.

```
gate                        run by a workflow?
typecheck                   ci.yml, publish-vscode.yml, release.yml
release:check               ci.yml, release.yml
claim-lint                  ci.yml, release.yml
baseline:inventory          ci.yml
api:schema:check            ci.yml
client:check                ci.yml
api:compat                  ci.yml
boundaries                  ci.yml
size-gate                   ci.yml
hot-path-lint               ci.yml
security:check              ci.yml, release.yml
desktop:ipc-acl             ci.yml
desktop:coverage            ci.yml
support-matrix              ci.yml
ci:policy                   ci.yml
channel:check               release.yml
placeholder-lint            — NONE
desktop:sink-lint           — NONE
platform:parity:check       — NONE
changelog:check             — NONE
ci-capability-gate          — NONE
ownership:check             — NONE
website:marketplace:check   — NONE
```

Pristine-worktree gate run (all independently verified, no local edits present):

```
$ cd /tmp/xr-clean   # detached HEAD 6b9cb599, clean
baseline:inventory        EXIT=0
ci-capability-gate        EXIT=0
api:schema:check          EXIT=0
client:check              EXIT=0
api:compat                EXIT=0
size-gate                 EXIT=0
hot-path-lint             EXIT=0
ownership:check           EXIT=0
website:marketplace:check EXIT=0
boundaries                EXIT=0
release:check             EXIT=0
channel:check             EXIT=0
claim-lint                EXIT=0
placeholder-lint          EXIT=0
desktop:sink-lint         EXIT=0
platform:parity:check     EXIT=0
changelog:check           EXIT=1   ← the documented battery is RED at the baseline commit
```

```
$ bun run changelog:check
[changelog] FAIL — no CHANGELOG.md entry for 1.1.1-rc.1. Releases are evidence-bound:
run `bun run changelog:generate` at release time (Art. XIX/XXII).
```

Reading: seven gates that `AGENTS.md` calls "CI-enforced" are enforced by **nothing**;
`ci.yml` runs 15 of the 22; and `AGENTS.md`'s "must be green before a PR → `bun run ci`"
is not satisfiable at the verified commit. Two contributing observations, recorded
without judging intent: `release.yml` generates the changelog at release time
(`scripts/changelog.ts --version "$V" --write`), so the red gate may be a sequencing
choice — but the documented contributor rule still cannot be followed as written.

**E-28 — Plan-document gate compatibility (self-check of this deliverable)** ✅

The seven new documents were written into `docs/implementation/v1-release/` and the four
prior planning docs received a one-line precedence banner (D-005). Gates re-run:

```
release:check      EXIT=0   (all 10 surfaces in sync)
claim-lint         EXIT=0   ← was EXIT=1 on first attempt: the banner's relative link
                              depth was wrong for docs/release/* (../../ vs ../);
                              corrected with sed, then re-verified green
placeholder-lint   EXIT=0
platform:parity:check EXIT=0  (484 test files registered)
```
The linkage failure is recorded rather than hidden because it demonstrates the
`claim-lint` doc-link rule working as designed against a new document.

**E-29 — Correction: gate enforcement re-measured by *command form*** 🔁 (supersedes part of E-27)

E-27 matched each gate against its **npm script name** (`grep -rl "run <gate>"`). That
method produces false negatives when a workflow invokes the underlying script instead.
Re-measured by command form:

```
$ grep -rn "platform-parity" .github/workflows/*.yml
cross-platform.yml:71:  run: bun run scripts/platform-parity.ts --validate
release.yml:77:         run: bun run scripts/platform-parity.ts --validate
$ grep -n "ownership-map" .github/workflows/ci.yml
738:  run: bun run scripts/ownership-map.ts --check        (job: unit-tier)
```

So `platform:parity:check` and `ownership:check` **are** enforced. Re-checking the other
five by command form returns nothing:

```
$ grep -rn "placeholder-lint"    .github/workflows/*.yml   → (no matches)
$ grep -rn "desktop-sink-lint"   .github/workflows/*.yml   → (no matches)
$ grep -rn "ci-capability-gate"  .github/workflows/*.yml   → (no matches)
$ grep -rn "generate-marketplace" .github/workflows/*.yml  → (no matches)
$ grep -rn "changelog"           .github/workflows/*.yml   → only release.yml:209
                                   `scripts/changelog.ts --version "$V" --write`
                                   (the generator, never the `--check` gate)
```

**Corrected conclusion:** exactly **five** gates in the `bun run ci` battery are invoked
by no workflow — `placeholder-lint`, `desktop:sink-lint`, `ci-capability-gate`,
`website:marketplace:check`, `changelog:check`. The E-27 conclusion about the red battery
(`changelog:check` exits 1 at `6b9cb599`) is unaffected and was re-confirmed.

This correction is retained rather than edited away because the flawed method is
reproducible and an executor would repeat it. **Instruction to `XR-P00`'s executor:** do
not re-derive the gate list by script name; use `E-29`'s table and verify each entry by
command form before changing any workflow.

**E-30 — The aggregate required check is already designed, but not enabled** ℹ️

`ci.yml` declares an aggregate gate whose own comment states the intent that is not
currently in force:

```
  # ── 6. Aggregation: the single status check required by branch protection ──
  # Runs even when a dependency fails (if: always()), then asserts every
  # upstream job succeeded. Mark "Quality Gate" as a required status check in
  # Settings → Branches so failing typecheck/tests/version-sync blocks merges.
  quality-gate:
    name: Quality Gate
    if: always()
    needs: [typecheck, truth-gate, baseline, website, vscode-extension, test-core,
            test-security, test-reliability-spawn, test-e2e-blackbox, boundaries,
            mutation-gate, perf-gate, api-contract, a11y, profiling, unit-tier]
```

Consequences recorded for the plan: (i) the repository already contains the mechanism a
protection policy should name, which **lowers** the cost of D-001/D-006 — the required
check can be the single context `Quality Gate`, plus the cross-platform and desktop
aggregate gates; (ii) `Quality Gate`'s `needs` list does **not** include
`test-e2e-blackbox-proof` (advisory) or `quarantine` (non-blocking) — both omissions are
intentional per their comments and must not be "fixed" during `XR-P00`; (iii) `ci.yml`'s
own jobs do not cover the five gates in E-29, so wiring them in *and* adding them to the
`needs` list is what makes `Quality Gate` a truthful aggregate.

**E-31 — Verified check-context inventory (for the protection policy)** ℹ️

Job `name:` values that can be named as required status checks:

```
ci.yml             Typecheck (tsc --noEmit) · Truth gate (release:check + claim-lint) ·
                   Baseline inventory · Website (typecheck + build) ·
                   VS Code extension (typecheck + tests + package) · test / core ·
                   test / security · test / reliability-spawn · test / e2e-blackbox ·
                   test / e2e-blackbox-proof (F-02/F-03 kill proofs) ·
                   Architecture (boundaries + size gate) · API contract (schema + client + compat) ·
                   Accessibility (axe + keyboard, WCAG 2.2 AA) · Profile gate (startup overhead) ·
                   Mutation gate (T8) · Performance (budgets + regression gate) ·
                   DX (unit tier <5s + ownership map) · test / quarantine (non-blocking) ·
                   Quality Gate   ← the aggregate
cross-platform.yml Cross-Platform gate (aggregate; macOS/Linux/Windows parity jobs)
desktop-app.yml    Desktop gate (bundles + latest.json + journey) (aggregate)
supply-chain.yml   (runs on this repo; green at 6b9cb599)
```

**E-32 — Governance is enforced by a RULESET, not legacy branch protection** 🔁 (corrects E-16)

`E-16` reported `protected: {enabled: false}` from
`GET /repos/ahmadrrrtx/xr/branches/main` and concluded `main` was unprotected. **That
endpoint does not report repository rulesets, and the conclusion was wrong.**

```
$ curl -H "Authorization: token ***" .../repos/ahmadrrrtx/xr/rulesets
HTTP=200
id=19119579 name='main protection' target=branch enforcement=active

$ curl .../repos/ahmadrrrtx/xr/rulesets/19119579
name: main protection | enforcement: active | target: branch
conditions: {"ref_name": {"exclude": [], "include": ["refs/heads/main"]}}

  RULE deletion
  RULE non_fast_forward
  RULE pull_request
     required_approving_review_count: 0
     dismiss_stale_reviews_on_push: False
     required_reviewers: []
     require_code_owner_review: False
     require_last_push_approval: False
     required_review_thread_resolution: False
     allowed_merge_methods: ['merge','squash','rebase']
     require_extra_approval_for_unattributed_changes: True
  RULE required_status_checks
     strict_required_status_checks_policy: False
     do_not_enforce_on_create: False
     required_status_checks: [{'context':'Quality Gate','integration_id':15368},
                              {'context':'Quality Gate','integration_id':15368}]   ← duplicated

bypass_actors: []
```

**Corrected reading.** Direct pushes, force-pushes and deletion are blocked; a PR is
required; `Quality Gate` is required. What is **not** enforced: any approving review
(`0`), code-owner review (`false`), the native lanes, and strict up-to-date checks. So
`CODEOWNERS` is documentation, not enforcement, and one actor can self-merge a PR in a
single step.

**E-33 — Behavioural proof (and the mechanism that caught the error)** ✅

Attempting the requested push of the plan documents:

```
$ git push origin main
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - 2 of 2 required status checks are expected.
 ! [remote rejected]   main -> main (push declined due to repository rule violations)
```

The rejection is the authoritative evidence that protection is active — and it is also how
`E-32`'s correction was discovered: a *settings* read had said the opposite for days of
this session. Method change adopted as **D-023**: governance claims now require the
ruleset list **and** the full rule parameters **and** a behavioural proof.

Method note: the push used `GIT_ASKPASS` with a `0600` helper script so the credential was
never written into the remote URL, `.git/config`, or any tracked file; a `grep` for the
token fragment across the whole worktree returned **zero** matches before and after.

**E-34 — `XR-P00` r2 execution (2026-11-01, executor evidence; full record in `phase-reports/XR-P00-report-r2.md`)** ⚠️ (in-repo half done; owner-gated half blocked)

Start tree `230ad998` (product baseline `6b9cb599` + PR #205 plan documents and four
banners only — the plan set was **committed**, not the dirty tree r2 §3.1 expects;
owner directed the executor to the committed set). Local branch
`phase/P00-governance-substrate`, commits `518c9835` (ci) + `4e9ec9e8` (test),
**unpushed**. Bun `1.4.2` (pin-exact), Linux x86_64, 2 CPU / 1.9 GiB.

```
preflight: changelog:check EXIT=1 (as expected) · typecheck/arch-tests(71)/ci:policy/claim-lint/release:check EXIT=0
rulesets: GET /rulesets -> 19119579 active; full params unchanged (approvals 0, code-owner false, Quality Gate x2)
note: legacy GET /branches/main today says protected:true + protection.enabled:false (E-16 saw false) — not used, per D-023
new test at baseline: EXIT=1, exactly placeholder-lint/desktop:sink-lint/ci-capability-gate/website:marketplace:check unwired
after wiring (4 own-named truth-gate steps): gate test EXIT=0 (98 ms); unit-tier script 1382 ms / 5000 ms budget
negative proofs: remove placeholder step -> EXIT=1 naming it; remove truth-gate from quality-gate needs -> EXIT=1 naming 6 gates; both restored (diff md5 identical)
segmented suite: bash scripts/parity-suite-runner.sh linux EXIT=0, "executed 484 of 484 files" (485 - 1 quarantined), 0 "(fail)" lines
bun run ci: EXIT=137 — monolithic bun test OOM-killed (dmesg: Killed process 3996 (bun), anon-rss 862168kB) at test/security/nodevm-wording.test.ts after 4183 pass / 0 fail; NOT a pass. Every other battery sub-gate run individually: all EXIT=0 except changelog:check EXIT=1
D-020a preview (no write): 432 lines / 404 commits; previousTagFor("1.1.1-rc.1")=v1.0.0 (patch parses as NaN) so 247 commits already documented under ## 1.1.0 would be re-listed — STOPPED per prompt, recorded as a defect to report, not fixed
OWNER ACTION (§4.1): executor has no GitHub credentials (gh absent, push attempt -> auth failure EXIT=128, NOT a GH013 behavioural proof). Exact ruleset payload + D-022 context discrepancy in report §16.
Actions at 230ad998 (observed 2026-11-01): CI success, Cross-Platform success (once), Desktop App cancelled, Clean-Machine Journey cancelled — no lane claimed green on this evidence.
```

**E-35 — `XR-P00` pushed; hosted CI evidence (2026-11-01; record in `phase-reports/XR-P00-report-r2-supplement-01.md`)** ✅ (Quality Gate) / ⚠️ (two native lanes)

```
owner authorized push+PR with a supplied credential (0600 /tmp file, never in repo; worktree scan 0 hits; hosted gitleaks success; owner to rotate)
push: phase/P00-governance-substrate only; main verified unchanged 230ad998. PR #206 opened, NOT merged, no settings changed.
attempt 1 (4be679e4): Truth gate SUCCESS (4 new steps green); Typecheck FAILURE TS2304 gate-enforcement.test.ts(276,71) 'token' — one missed rename, executor bug; fixed 761df3df (local typecheck EXIT=0 first, this time)
attempt 2 (761df3df): CI SUCCESS (Quality Gate success, actionlint success); Cross-Platform SUCCESS (win/mac/linux parity incl. new test); Supply Chain/Channel/npm Pack/Audit SUCCESS.
Journey + Desktop: CANCELLED (macos-14 legs cancelled; macos-15-intel journey failed at "Upload journey evidence") — same pattern on main@230ad998 pre-branch; untouched code; XR-P09 scope, not fixed.
bun run ci local verdict unchanged FAIL (OOM monolith + changelog:check EXIT=1 D-020). AC1/AC2/AC4 remain BLOCKED-OWNER as in E-34.
```

---

## §7 Actions deliberately **not** taken (and why)

| Action | Reason |
|---|---|
| `cargo check` / Tauri build | cargo absent; installing it plus GTK3/WebKit2GTK4.1 on a 2 vCPU / 1.9 GiB box is not a bounded investigation and was explicitly excluded by the audit rules (no large dependency installs to investigate) |
| `bunx playwright install chromium` to un-skip 13 a11y tests | sizable download; the skip is already honestly reported and CI runs that lane |
| Fetching CI job logs | requires admin (E-15) |
| Running `release:verify --strict` | would fail closed on absent owner signing material; the failure would be an artifact of this sandbox, not new evidence. Recorded as 🚫 BLOCKED rather than "FAIL" |
| Live provider calls | no credentials; would violate Rule C (no paid calls to investigate) |
| Modifying any product code, test, gate, workflow or governance file | Rule C — this stage is audit + planning only |
| Editing `AGENTS.md`, `docs/CONSTITUTION.md`, `src/xr-shield/**`, `.github/workflows/**` | protected governance surfaces (D-001 approval required) |

---

## §8 Environment limitations carried into the plan

1. **No native GUI evidence.** Every desktop-screen claim in this log is *static
   inspection*, and every phase that changes a screen must return native or
   renderer-under-test evidence before it can be accepted.
2. **No non-Linux platform evidence.** Windows/macOS status stays `Not run` until a
   native lane is green at the candidate SHA.
3. **No live-provider evidence.** Provider behavior is verified against fixtures and the
   engine's own contract; account compatibility and model quality remain unproven.
4. **Bun version deviation** (1.4.4 vs pinned 1.4.2) — same minor line; CI uses
   `.bun-version`, so CI evidence is authoritative for the pin.
5. **Two red CI lanes on the verified SHA** (E-14) with **unknown** causes (E-15). No
   phase may claim a green native lane until this is resolved at the candidate SHA.

---

*Entries are append-only. Corrections are added as new dated entries that reference the
superseded one; nothing is silently edited.*
