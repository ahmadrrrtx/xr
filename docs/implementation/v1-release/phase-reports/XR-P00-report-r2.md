# XR-P00 — Executor Report (prompt revision r2)

**Executor status: `IMPLEMENTATION_REPORTED`** (the executor may not mark the phase
accepted; acceptance is the Plan Owner's decision after re-running these claims).

> Filename note: r2 §10 still literally names `XR-P00-report-r1.md` (unchanged from r1).
> This report executes **r2**, so it is filed as `-r2` per the `phase-reports/` naming
> convention (`XR-Pnn-report-rN.md`). Recorded as a prompt inconsistency, §15.

---

## 1. Phase, revision, SHAs

| Field | Value |
|---|---|
| Phase | `XR-P00` — Governance and evidence substrate |
| Prompt executed | **r2** (`phase-prompts/XR-P00-r2-6b9cb59.md`), owner-confirmed in-session after the attached r1 was found superseded by r2 in the repository (r1 preserved unmodified) |
| Product baseline | `6b9cb599aebbe8d8de8b100370c3a6434c3240e0` |
| Start SHA (actual tree) | `230ad998b38e39018a2d0d197639ad8a7f1b907a` = baseline + PR #205 (plan documents + four precedence banners only; verified by `git diff --name-only 6b9cb599..230ad998`, 15 doc files, zero product files) |
| Branch | `phase/P00-governance-substrate` (local) |
| Implementation commits | `518c9835` `ci(gates): …`, `4e9ec9e8` `test(architecture): …` |
| Final SHA | The `docs(implementation)` commit containing this report. It cannot contain its own SHA; read it with `git rev-parse HEAD` on the branch (also given in the executor's chat response). |
| Push / PR / merge / tag | **None.** Owner instruction quoted: “for now keep branch and local commits very carefully”. No GitHub credentials exist in the executor environment in any case. |
| Git identity of local commits | Repo-local only: `XR-P00 execution agent (local, unpushed) <xr-p00-executor@localhost.invalid>` — deliberately not the owner's identity. `.git/config` also holds no credential. |

Owner instructions relied on (quoted): “here those docs
https://github.com/ahmadrrrtx/xr/tree/main/docs/implementation/v1-release”;
changelog: “its unavaliblee find it” (satisfied: `DECISIONS.md` D-020 read in full);
commits: “for noww keep branch and local commits very carefully”; revision:
owner selected “Execute r2 from main@230ad998” over “r1 literal” and “r2 from 6b9cb599”.

## 2. Preflight answers (r2 §3, literal results)

1. **Baseline.** First contact: workspace contained no repo. Fresh clone of the public
   repo: `HEAD=6b9cb599…`, clean tree, `docs/implementation/v1-release/` **absent**
   (absent on every fetched ref). Per §3.1 the executor stopped and escalated. Owner
   pointed to `main:docs/implementation/v1-release`; by then `main` had advanced
   `6b9cb599..230ad998` (PR #205: `0a766577`, `d98ae72d`, `02adc495`, merge `230ad998`)
   containing exactly the 7+2 plan files, both prompt revisions, and the four banners.
   Executor fast-forwarded (no reset/clean/stash; nothing to discard — tree was clean)
   and branched from `230ad998`. `git rev-parse HEAD` → `230ad998…`, `git status
   --porcelain` → 0 lines.
2. **Five gates uninvoked (command form).**
   `grep -rn "placeholder-lint\|desktop-sink-lint\|ci-capability-gate\|generate-marketplace" .github/workflows/*.yml` → no matches, `EXIT=1`.
   `grep -rn changelog .github/workflows/*.yml` → only `release.yml:209`
   (`scripts/changelog.ts --version "$V" --write`, the generator, never `--check`).
   E-29's two corrected gates confirmed enforced: `cross-platform.yml:71` +
   `release.yml:77` (`platform-parity.ts --validate`), `ci.yml:738`
   (`ownership-map.ts --check`, job `unit-tier`). Executor's own battery↔workflow
   inventory (direct name + underlying-file forms) reproduced E-29 exactly.
3. **`bun run changelog:check` → `EXIT=1`**:
   `[changelog] FAIL — no CHANGELOG.md entry for 1.1.1-rc.1. …`.
4. **`quality-gate` needs** (ci.yml:768-771) = `[typecheck, truth-gate, baseline,
   website, vscode-extension, test-core, test-security, test-reliability-spawn,
   test-e2e-blackbox, boundaries, mutation-gate, perf-gate, api-contract, a11y,
   profiling, unit-tier]` — matches E-30/E-31; `test-e2e-blackbox-proof` and
   `quarantine` intentionally absent (untouched).
5. **Governance, the D-023 way (two of three signals obtainable unauthenticated):**
   `GET /repos/ahmadrrrtx/xr/rulesets` → `[{id:19119579, name:"main protection",
   enforcement:"active"}]`, HTTP 200.
   `GET /rulesets/19119579` → conditions `refs/heads/main`; rules `deletion`,
   `non_fast_forward`, `pull_request` {`required_approving_review_count:0`,
   `require_code_owner_review:false`,
   `require_extra_approval_for_unattributed_changes:true`,
   `allowed_merge_methods:[merge,squash,rebase]`,
   `dismiss_stale_reviews_on_push:false`, `required_reviewers:[]`,
   `require_last_push_approval:false`, `required_review_thread_resolution:false`},
   `required_status_checks` {`strict_required_status_checks_policy:false`,
   `do_not_enforce_on_create:false`, contexts: `Quality Gate`(15368) **twice**}.
   The unauthenticated ruleset response carries **no `bypass_actors` key** (E-32,
   authenticated, recorded `[]`; executor could not re-read that field).
   Behavioural signal: `GIT_TERMINAL_PROMPT=0 git push origin main` (no new commits) →
   `fatal: could not read Username for 'https://github.com': terminal prompts
   disabled`, `EXIT=128`. That is an **auth failure, not a GH013 ruleset proof** —
   recorded as NOT RUN for behavioural purposes (E-33's historical GH013 stands as
   prior evidence; the executor does not claim it).
   Discrepancy recorded (not used as evidence, per D-023): legacy
   `GET /branches/main` today returns `protected:true` with
   `protection.enabled:false, enforcement_level:"off"` — E-16 recorded
   `protected:false` from the same endpoint. Either reading is meaningless for the
   ruleset, which is the endpoint trap itself.
6. **GitHub permissions:** none. `gh` absent (`EXIT=127`), no `GH_*`/`GITHUB_*` token
   env, no `~/.config/gh`, no git credential helper; unauthenticated API
   `permissions: null`; `GET /branches/main/protection` → HTTP 401. Executor can read
   public state, cannot write repo settings. → §4.1 is `BLOCKED — OWNER ACTION` (§16).
7. **§3.7 commanded set at baseline:** `typecheck EXIT=0`;
   `bun test test/architecture/ EXIT=0` (71 pass / 9 files); `ci:policy EXIT=0`
   (“6 required checks, 21 workflows”); `claim-lint EXIT=0`; `release:check EXIT=0`
   (10 surfaces). Additionally all five unwired gates pass *locally*
   (placeholder/sink/capability/marketplace `EXIT=0` <1 s each; changelog `EXIT=1`),
   plus channel/baseline/api/client/compat/size/hot-path/boundaries/ownership/parity
   all `EXIT=0` (baseline’s `inventory` by-products were executor-generated and removed).
8. **Quarantine:** exactly one entry — `test/daemon/phase2b.test.ts`, owner
   `@ahmadrrrtx`, expires `2026-12-01`. Untouched throughout.

## 3. Root cause (executor's words, with citations; accord vs XRD-006/XRD-013)

- **§4.1 shallow ruleset.** Protection was never absent; its *review parameters* were
  left at zero. The settings state itself has no in-repo location — the in-repo trace
  is the unfulfilled intent: `ci.yml:742-745` (“Mark "Quality Gate" as a required
  status check…”), `.github/required-checks.json` `$comment` (“The status checks
  branch protection must require…”), and `CODEOWNERS` (per-subsystem
  `@ahmadrrrtx`) which nothing enforces. Live API (§2.5) shows approvals `0` +
  code-owner review `false`, so one actor can open and merge their own PR — exactly
  XRD-006 as corrected. **No discrepancy** with XRD-006/E-32/E-33.
- **§4.2 five unwired gates.** `package.json:27` (`scripts.ci`) names the battery; no
  workflow invokes the five (§2.2). The mechanism gap: nothing compared the battery
  against the workflows — `scripts/ci-policy.ts:1-20` enumerates 7 policy rules
  (action pins, bun pin, aggregate shape via `required-checks.json`,
  continue-on-error, naming, quarantine, runner images) and battery coverage is not
  among them. Matches XRD-013/E-29. **No discrepancy.**
  Sub-cause specific to `changelog:check`: the entry it demands is only ever created
  at release time (`release.yml:209`, `--write`), so the documented contributor
  battery is structurally red between releases (D-020's statement, reproduced).
- **Why the aggregate never noticed.** `quality-gate` (ci.yml:768-791) asserts the
  results of jobs in its `needs:`; a gate with no job produces no failing result to
  aggregate. And `ci-policy` rule 3 only checks the aggregate needs every *job that
  exists* (minus advisory) — satisfied at baseline, yet five battery scripts had no
  job at all. The new test (§6) targets precisely that blind spot.

Additional defect found while reproducing D-020 — **recorded, not fixed** (out of scope):
`previousTagFor("1.1.1-rc.1", tags)` in `scripts/changelog.ts` returns `v1.0.0`.
Mechanism (executor-verified): `"1.1.1-rc.1".split(".").map(Number)` →
`[1, 1, NaN, 1]`, so the patch comparison against `v1.1.0` is always false and the
closest older tag wins as `v1.0.0`. A generated `1.1.1-rc.1` section therefore covers
404 commits, of which 247 (`v1.0.0..v1.1.0`) are already documented under
`## 1.1.0`. Existing test `previousTagFor picks the closest older semver tag` passes —
it evidently does not cover a prerelease target. Suggested owner-phase: whichever
resolves D-020 (or XR-P08), not XR-P00.

Also observed, not changed: `scripts/apply-branch-protection.sh` prints a *legacy*
branch-protection `gh api` command (contexts + `strict:true`) and assumes legacy
protection pre-exists. Under the ruleset reality (D-023) and r2's
“do not change `strict_required_status_checks_policy` in this phase”, that script's
output must **not** be used as the §4.1 mechanism. Recorded for the Plan Owner.

## 4. Files added / changed / removed

| File | Δ | Justification |
|---|---|---|
| `.github/workflows/ci.yml` | +17/−0 (one block in `truth-gate`) | §4.2: wire 4 gates as own-named steps (commit `518c9835`) |
| `test/architecture/gate-enforcement.test.ts` | new, 292 lines | §4.3: gate-inventory test (commit `4e9ec9e8`) |
| `docs/implementation/v1-release/PHASE_STATUS.md` | P00 row → IMPLEMENTATION_REPORTED; deferred-check obligation (dated, owned); blocker rows updated; register note | §6.5 named surface; AC10 |
| `docs/implementation/v1-release/EVIDENCE_LOG.md` | + entry `E-34` (append-only) | §6.5 named surface |
| `docs/implementation/v1-release/phase-reports/XR-P00-report-r2.md` | new | §10 report (this file) |

Nothing else. In particular: no `src/**`, `desktop/**`, `mobile/**`, `cloud/**`, no
existing test/assertion, no `test/quarantine.json`, no `AGENTS.md` /
`docs/CONSTITUTION.md` / security / shield / release-script content, no dependency,
`.bun-version`, or action-pin change (the new steps use no actions at all). Removed
along the way and restored byte-identically: temporary negative-demo edits (§6);
executor-generated `docs/release/1.1.1-rc.1/{INVENTORY.md,inventory.json}`
(`baseline:inventory` by-products, deleted each time, never committed).

## 5. The implemented correction (concretely)

**§4.2 wiring.** One comment block + four steps in `truth-gate`, immediately after
`claim-lint` (ci.yml lines ~150-165 in the new tree):

```yaml
- name: Gate placeholder-lint (XR-P00)
  run: bun run placeholder-lint
- name: Gate desktop:sink-lint (XR-P00)
  run: bun run desktop:sink-lint
- name: Gate ci-capability-gate (XR-P00)
  run: bun run ci-capability-gate
- name: Gate website:marketplace:check (XR-P00)
  run: bun run website:marketplace:check
```

Why consolidation is faithful to the prompt: each gate is its own **named step**
(name contains the gate name → observable in run summaries); `truth-gate` already has
Bun pinned and root+desktop deps installed when these run; `truth-gate` is already in
`quality-gate.needs` (ci.yml:771→now shifted by +17), so the aggregate *requires*
these steps' success — “add each new job to `needs:`” is satisfied by construction
for consolidated steps, and `ci:policy` (which derives “aggregate needs every job”
from `required-checks.json`) stays green without a needs edit. No runner, timeout, or
version pin of any job changed; `test-e2e-blackbox-proof` and `quarantine` untouched.
Each gate measured <1 s locally, so no D-021 “report-only for runtime” exception was
needed.

**`changelog:check` — D-020 outcome: NEITHER option completed; BLOCKED.**
D-020a was *previewed* without writing (`bun run scripts/changelog.ts` stdout mode):
a **432-line / 38,982-byte** section, 404 commit bullets ranging `v1.0.0..HEAD`, 247
already under `## 1.1.0` (root cause §3). Writing it would publish mis-attributed
release evidence and grows `CHANGELOG.md` (1,791 lines) by ~24%; the prompt's stop
rule (“if the generator rewrites large swathes… stop and report — release-evidence
surface needs owner review”) was invoked, and `CHANGELOG.md` was never written
(preview mode verified: tree stayed clean). D-020b as written in `DECISIONS.md`
additionally requires an `AGENTS.md` re-scope the executor is forbidden to make
(prompt §5.2/§7), and prompt-§4.2-B alone (release.yml-only) cannot make
`bun run ci` exit 0 while `changelog:check` remains in `scripts.ci`. The gate is
therefore **not wired** (wiring it as-is turns `main` permanently red — explicitly
forbidden) and appears in the test as a dated, decision-referenced exemption to be
deleted when the owner resolves D-020. Options for the owner are in §16.

**§4.1 ruleset:** nothing changed (no admin credential). Exact payload in §16.

## 6. The new test and its exact failures

`test/architecture/gate-enforcement.test.ts` (new file; directory conventions kept:
`bun:test`, `node:fs` reads, header comment naming finding/evidence). Offline and
deterministic: parses `package.json` as JSON and workflows with `Bun.YAML.parse`
(the same primitive `scripts/ci-policy.ts` uses; no shell, no `gh`, no network).
Three tests mirror §4.3 exactly: (1) every `scripts.ci` gate is invoked by some
workflow — script-name form, alias-script form (same body or `bun run <gate>`
wrapper), or command form requiring the gate's **mode flags** on the same logical
line (`--write` ≠ `--check`) — or is in `GATE_EXEMPTIONS` (small declarative map;
currently exactly one entry, `changelog:check`, reason quoted in the file);
(2) for every aggregate in `.github/required-checks.json`, each battery gate its
workflow implements must be implemented by a non-advisory job the aggregate
`needs:` (advisory set read from the same file — E-30's two intentional exclusions
honoured); (3) reverse: battery names exist; battery may not shrink below the
XR-P00 19-entry floor; every root-context `bun run <name>` in any workflow step
names a real root script; `needs:` entries name real jobs; exemptions name real
battery gates, carry ≥40-char reasons, and fail if stale (gate becomes enforced).
Runtime: full file 98-102 ms locally (well inside a 5 s unit-tier budget if the
tier ever adopts it; it was **not** added to `scripts/unit-tier.ts`'s manifest —
that file is outside §6.5's named surfaces — and **not** quarantined). It is
collected by `bun test`, the architecture lane, and the parity computation
(test-file count 484→485, §9).

**Baseline failure (written first, before wiring) — `EXIT=1`**, 2 pass / 1 fail,
violations exactly:
`placeholder-lint: … invoked by no workflow …`, and the same line for
`desktop:sink-lint`, `ci-capability-gate`, `website:marketplace:check`
(`changelog:check` covered by the recorded exemption).

**Temporary-revert failure (after wiring):** deleting only the placeholder step
→ `EXIT=1` with the single `placeholder-lint:` violation; restored from backup,
`git diff` md5 before/after identical (`176b7630…`), test `EXIT=0`.

**Aggregate-needs failure (AC7):** removing `truth-gate` from `quality-gate.needs`
→ `EXIT=1` listing six violations (`release:check`, `claim-lint`, and the four new
gates, each “…but Quality Gate needs none of them — the aggregate would pass while
this gate fails (E-30)”); restored, md5 identical, test `EXIT=0`.

## 7. Every command executed, with actual exit codes

`PASS` = ran and exited 0 · `FAIL` = ran, non-zero (expected cases noted) ·
`BLOCKED` = could not run as specified · `NOT RUN` = not attempted (reason given).
Preflight-baseline results are §2; below are the post-wiring/final-tree results
(baseline-only commands marked †).

| Command | Result | Evidence note |
|---|---|---|
| `git clone`, fetch, ff to `230ad998`, branch create | PASS 0 | §1/§2.1 |
| Bun install `1.4.2`; root+desktop `bun install --frozen-lockfile --ignore-scripts` | PASS 0 | tree stayed clean; bun == `.bun-version` |
| † battery↔workflow inventory scripts (executor python) | PASS 0 | reproduced E-29 (§2.2) |
| † `bun run scripts/changelog.ts` (preview, no `--write`) | PASS 0 (output rejected, §5) | 432 lines; tree untouched |
| `bun test test/architecture/gate-enforcement.test.ts` at baseline | FAIL 1 (expected) | §6 verbatim violations |
| same, after wiring / after each restore | PASS 0 (3 tests, ~100 ms) | §6 |
| `bun run typecheck` | PASS 0 (37 s) | root + desktop programs |
| `bun test test/architecture/` | PASS 0 | **74 pass** / 10 files (was 71/9) |
| `bun test test/release/ci-policy.test.ts` | PASS 0 (13) | workflow parser consumers unaffected |
| `bun run ci:policy` | PASS 0 | 6 required checks, 21 workflows |
| `bun run claim-lint` | PASS 0 | re-run after doc edits before docs commit |
| `bun run release:check` | PASS 0 | 10 surfaces in sync |
| `bun run boundaries` | PASS 0 | |
| `bun run ownership:check` | PASS 0 | 243 areas |
| `bun run platform:parity:check` | PASS 0 | **485 test files** |
| `bun run placeholder-lint` / `desktop:sink-lint` / `ci-capability-gate` / `website:marketplace:check` | PASS 0 each | the wired gates themselves |
| `bun run channel:check` / `baseline:inventory` / `api:schema:check` / `client:check` / `api:compat` / `size-gate` / `hot-path-lint` | PASS 0 each | remainder of battery, run individually |
| `bun run scripts/unit-tier.ts --budget=5000` | PASS 0 | 17 files · 1382 ms (new test not in tier; file alone ~100 ms) |
| `bash scripts/parity-suite-runner.sh linux` | PASS 0 | **“executed 484 of 484 files”**, 0 `(fail)` lines (§9) |
| `bun run changelog:check` | **FAIL 1** | D-020 blocked (§5) — unchanged from baseline |
| `bun run ci` | **FAIL 137** | monolithic `bun test` OOM-killed; see §9. Never reported as pass |
| `GIT_TERMINAL_PROMPT=0 git push origin main` (no-change behavioural attempt) | BLOCKED 128 | auth failure ≠ GH013 (§2.5) |
| ruleset PATCH / legacy protection change | NOT RUN | no admin credential (§16) |
| scratch-PR blocked-merge proof | NOT RUN | requires push/PR rights (§16) |
| actionlint/shellcheck (truth-gate workflow-lint step) | NOT RUN locally | pinned binaries fetched only in CI; YAML validity covered by `Bun.YAML.parse` in test + `ci:policy` |
| `git push` (branch), PR, merge, tag | NOT RUN | owner instruction + no credentials |

## 8. Acceptance-criteria matrix (P00-AC1…AC11)

| ID | Verdict | Evidence pointer |
|---|---|---|
| AC1 ruleset deepened (approvals ≥1, code-owner, dedupe) | **BLOCKED — OWNER ACTION** | Live params §2.5 (unchanged: 0/false/×2); exact payload §16 |
| AC2 negative merge blocked + recorded | **BLOCKED** | No push/PR credential; auth-failure transcript §2.5 (honestly not GH013); steps §16. Prior E-33 proof exists but is not executor evidence |
| AC3 four gates invoked + required by aggregate | **PASS** (remote run NOT RUN) | ci.yml diff §5; `truth-gate ∈ quality-gate.needs`; test (2) asserts it; each gate `EXIT=0`. No Actions run exists for the unpushed branch |
| AC4 changelog via one named D-020 option | **BLOCKED** | §5: A previewed→stopped (432 lines, mis-ranged), B needs forbidden `AGENTS.md` edit; `changelog:check EXIT=1` recorded; exemption cites D-020 |
| AC5 `bun run ci` exits 0 | **FAIL** | `EXIT=137` (env OOM in monolithic `bun test`, §9) **and** battery contains `changelog:check EXIT=1` regardless. Segmented suite + all other 17 sub-gates individually 0 |
| AC6 inventory test fails when gate unwired | **PASS** | baseline + temporary-revert transcripts §6 |
| AC7 test asserts aggregate `needs:` | **PASS** | negative needs-removal transcript §6 |
| AC8 seven named gates exit 0 | **PASS** | §7 table (typecheck, boundaries, ownership, parity, ci:policy, claim-lint, release:check all 0) |
| AC9 no out-of-scope changes | **PASS** | `git diff 230ad998..HEAD --stat` = ci.yml +17, test +292; docs diff = the two §6.5 surfaces + this report (§4) |
| AC10 deferred required-check obligation dated + owned | **PASS** | `PHASE_STATUS.md` obligation row: owner `@ahmadrrrtx`, recorded 2026-11-01, due XR-P09 |
| AC11 plan-owner documents intact | **PASS — substituted evidence (owner-approved deviation §15)** | Set is *committed* (PR #205) rather than dirty-tree: `git ls-tree origin/main` lists 7 files + prompts/reports + 4 banners; only the two §6.5 updates modify them |

## 9. Platform / environment

Linux `6.1.158` x86_64 (sandbox), 2 CPU, **1.9 GiB RAM, no swap**; Bun **1.4.2**
(= `.bun-version`, no deviation); Node v20.20.2; git 2.47.3; `gh` absent; Playwright
browsers not installed (not needed by any command run above; the a11y lane was not
re-run and is not claimed). Complete `bun run ci`: **no** — the battery's monolithic
`bun test` was **OOM-killed**: `bun run ci EXIT=137`; `dmesg`: `oom-kill:… task=bun,
pid=3996` / `Out of memory: Killed process 3996 (bun) total-vm:7733376kB,
anon-rss:862168kB`, dying inside `test/security/nodevm-wording.test.ts` after
4,183 `(pass)` / 0 `(fail)` lines. This is the §6.7 environment-blocked case: the
blocked sub-gate is named (`bun test` monolith in 1.9 GiB), and the remainder ran
individually (§7), including the repo's own low-memory full-suite path
(`parity-suite-runner.sh linux`, `EXIT=0`, 484/484 files, quarantine excluded by
that script per XR-LAUNCH-012). The segmented result is *equivalent file coverage*,
not a `bun run ci` retry — AC5 stays FAIL.
Lanes NOT run locally and not claimed: all GitHub-hosted workflows for this branch
(unpushed), a11y/browser, mutation/perf/profiling jobs, desktop/Rust, website build,
Windows/macOS anything.

## 10. Security and regression review

- **No secret** in the diff: executor grep over the full pending diff for
  key/token/password/private-key/token-prefix patterns → no credential hits (one
  variable initially named `token` was renamed to avoid scanner noise). No token was
  ever present in this environment; remote URL is bare `https://github.com/…`.
- **No gate weakened:** changes only *add* invocations; `scripts.ci` untouched;
  the new test adds a battery-shrink ratchet; `ci:policy` results unchanged; no
  `continue-on-error`, no timeout inflation, no skip, no quarantine change, no
  fixture relaxation. The single exemption *records* a pre-existing non-enforcement
  (changelog) loudly instead of creating one, and self-fails once stale.
- **Risks introduced by executor:** (a) `truth-gate` grows by four sub-second steps;
  if any of the four scripts behaves worse on a clean hosted runner than locally,
  PRs could redden — mitigated by each gate already being green at baseline
  (E-27 pristine run + executor runs) and needing no network. (b) The inventory
  test parses `scripts.ci` strictly (`bun run X` entries); a future battery entry
  in another form fails the test **loudly** (intended — update the parser with the
  battery change, consciously). (c) False-positive risk: a future workflow that
  mentions a gate name in a *step comment* does not count (only `run:` lines in
  root-context steps are scanned); a future gate invoked only from a
  `working-directory:` subpackage step would be missed and flagged — again loud,
  not silent. (d) Windows/macOS behaviour of the new test is by construction
  (path joins, YAML parse, text) but **unverified on those OSes** (§12).

## 11. Known failures and limitations (observed, not fixed — later phases own these)

- `changelog:check EXIT=1` at baseline and final tree (D-020; §5) → the documented
  `bun run ci` battery cannot exit 0 until the owner resolves it.
- `scripts/changelog.ts` `previousTagFor` prerelease mis-range (§3) — product bug
  recorded, not fixed.
- Native lanes as observed 2026-11-01 on `230ad998` (unauthenticated Actions API):
  `CI` success; `Cross-Platform CI` success (was FAILURE at `6b9cb599`, E-14);
  `Desktop App` **cancelled**; `Clean-Machine Journey` **cancelled**;
  Supply Chain / Channel Install / npm Pack Smoke success. One green
  Cross-Platform run on a docs-only commit is **not** treated as “lane green”
  evidence, and cancellations are not failures causes — no diagnosis attempted
  (XR-P09 owns; job logs need admin, E-15).
- `main` ruleset still shallow until owner applies §16 (0 approvals, no code-owner
  review, duplicated `Quality Gate`, native lanes not required).
- Full-suite monolith cannot complete in 1.9 GiB locally (OOM, §9); segmented
  authority completed instead — hosted CI remains the monolith's arbiter.

## 12. Unverified requirements (explicit)

1. §4.1 in full (settings change; D-023 signal 3; AC1/AC2) — no admin credential.
2. Any GitHub Actions run of the new steps (run-summary step names, runner timing,
   actionlint over the edited `ci.yml`) — branch unpushed by owner instruction.
3. New test on Windows/macOS runners — will be exercised when the branch's first
   Cross-Platform run executes (it is in the parity set: win32 469 files).
4. `bypass_actors` current value — invisible unauthenticated (E-32 said `[]` when
   authenticated); owner PUT in §16 sets it explicitly to `[]`.
5. Whether the four gates stay sub-second on hosted runners (measured locally only).
6. D-022's wider required-context set vs r2's narrow “only these parameters”
   (discrepancy §15/§16) — owner/Plan Owner must reconcile; executor changed nothing.

## 13. Migration implications

None. No schema, data, API, or persisted-state change. (Had any appeared, the
executor would have stopped per instructions.)

## 14. Suggested rollback

- Gate wiring: `git revert 518c9835` (removes the four steps; `truth-gate` returns
  to baseline; nothing else referenced them).
- Test: `git revert 4e9ec9e8` (deletes the single new file; independent of wiring
  except that without the wiring the test fails by design — revert both together
  to return to the exact baseline, or the test alone to return to “wired but
  unguarded”).
- Docs: revert the `docs(implementation)` commit containing this report
  (PHASE_STATUS/EVIDENCE_LOG/report only).
- Ruleset (once owner applies §16): re-apply the *current* parameter set —
  approvals `0`, `require_code_owner_review:false`, contexts `Quality Gate` (+its
  duplicate if byte-fidelity is ever wanted), all other fields as in §2.5. Capture
  the authenticated `GET /rulesets/19119579` **before** changing anything and keep
  it as the rollback payload. Never “rollback” by disabling the ruleset.

## 15. Scope deviations and approval status

| # | Deviation from r2 as written | Approval |
|---|---|---|
| 1 | Start tree `230ad998` with the plan set **committed**, not baseline-`6b9cb599` + dirty tree (§3.1/AC11 method substituted: `ls-tree`) | **Owner-approved in-session** (selected option “Execute r2 from main@230ad998”; docs URL supplied by owner) |
| 2 | Report filed as `XR-P00-report-r2.md` while r2 §10 still says `-r1` | Not separately approved; follows `phase-reports` naming + executed revision. Plan Owner may rename; content unchanged |
| 3 | `changelog:check` handled by *exemption + BLOCKED report*, completing neither D-020a nor D-020b | Not approved — this is the prompt's own stop rule firing (§4.2) compounded by §5.2; **blocker until owner decides D-020** (§16) |
| 4 | `bun run ci` could not complete (environment); segmented runner + individual sub-gates substituted as evidence, AC5 marked FAIL | Contingency is written into prompt §6.7/AC5; no claim upgraded |

Internal inconsistencies found in governing docs (executor changed none of them):
`PHASE_STATUS.md` P00 row said “Executor runs …-r1-…” while its own register marks
r2 CURRENT (row updated as part of the §6.5 status update); r2 §10 filename (above);
D-022's required-context list vs r2 §4.1 “change only these parameters” (§16);
r1's bootstrap context names (“Supply Chain”, “Channel Install Tests”…) are
workflow names — the actual check contexts in `.github/required-checks.json` are
“Supply Chain gate”, “Clean-Machine Journey gate”, “npm Pack Smoke gate”, etc.

## 16. Owner actions still required

### 16.1 §4.1 — apply the ruleset deepening (needs repo admin; D-001/D-022 approval)

Prerequisite sanity (30 s): `bun run ci:policy` (already green). Then capture the
current ruleset, apply the change, and verify with all three D-023 signals.

Equivalent UI path: GitHub → repo **Settings → Rules → Rulesets → `main
protection`** → set *Required approvals* `0 → 1`, tick *Require review from Code
Owners*, remove the duplicate `Quality Gate` required check, Save. Touch nothing
else (`deletion`, `non_fast_forward`, bypass list, merge methods,
`require_extra_approval_for_unattributed_changes`, `do_not_enforce_on_create`,
`strict_required_status_checks_policy` stay as-is; strict-mode remains a recorded
open question — it forces up-to-date branches, which interacts with the not-yet-
green native lanes).

API path (`PUT` replaces the ruleset — the payload below is the *complete*
current ruleset with only the three r2 changes applied):

```bash
# 0) rollback snapshot (keep this file)
gh api repos/ahmadrrrtx/xr/rulesets/19119579 > ruleset-19119579.before.json
# 1) apply
gh api --method PUT repos/ahmadrrrtx/xr/rulesets/19119579 --input ruleset-19119579.after.json
# 2) verify signal 1+2: list + params
gh api repos/ahmadrrrtx/xr/rulesets
gh api repos/ahmadrrrtx/xr/rulesets/19119579
# 3) verify signal 3a: direct push must be rejected (expect GH013), then rake:
git push origin main        # from a checkout with a throwaway commit on main — REJECTED expected; reset the throwaway locally, never force
# 4) verify signal 3b: scratch branch + commit that fails Quality Gate -> open PR -> merge attempt must be blocked -> close PR unmerged -> delete branch
```

`ruleset-19119579.after.json` (copy-paste verbatim):

```json
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "exclude": [], "include": ["refs/heads/main"] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": false,
        "required_reviewers": [],
        "require_code_owner_review": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "require_extra_approval_for_unattributed_changes": true,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [{ "context": "Quality Gate", "integration_id": 15368 }]
      }
    }
  ]
}
```

**D-022 discrepancy for the owner to resolve at the same sitting:** D-022 (b) also
names, as required *now*, `Supply Chain` + the already-green lanes. In true
check-context names (`.github/required-checks.json`) those aggregates are:
`Supply Chain gate`, `Clean-Machine Journey gate`, `npm Pack Smoke gate`
(all `integration_id: 15368`). r2 §4.1 instructs changing **only** the three
parameters above, so the executor's payload does not add them. If the owner wants
D-022's full bootstrap set, append those three objects to
`required_status_checks` in the same edit — *after* confirming each is green on
the merge-base SHA (Journey was **cancelled**, not green, at `230ad998`).
`Cross-Platform gate` and `Desktop gate (bundles + latest.json + journey)` stay
out until XR-P09 (dated obligation now in `PHASE_STATUS.md`, owner `@ahmadrrrtx`,
recorded 2026-11-01). Do **not** use `scripts/apply-branch-protection.sh` for any
of this (legacy endpoint + `strict:true`; §3).

### 16.2 D-020 — decide the changelog sequencing (unblocks AC4/AC5 and deletes the exemption)

Pick one, record it in `DECISIONS.md`:
(a) Fix `previousTagFor` for prerelease targets (product change; needs its own
test), then `bun run changelog:generate`, review the (then correctly-ranged)
entry, add the `changelog:check` step next to the other four in `truth-gate`,
and delete `GATE_EXEMPTIONS["changelog:check"]` — in that order, battery green
end-to-end; **or** (b) approve the re-scope exactly as DECISIONS D-020(b) writes
it: remove `changelog:check` from `scripts.ci`, amend the `AGENTS.md` command
table saying the gate is release-only (owner edit — executor may not), keep the
release.yml generation step, and delete the exemption + battery-floor entry in
the new test in the same change.

### 16.3 Then

Push `phase/P00-governance-substrate` and open the PR (executor did neither).
First Actions run will exercise: the four new steps, actionlint over `ci.yml`,
the new test on all parity OSes — review those before merge. Phase acceptance
remains the Plan Owner's `REVIEW PHASE REPORT XR-P00`; nothing here unlocks
XR-P01 until then.

---

*Executor's closing statement: the in-repo half of XR-P00 (4.2 minus changelog,
plus 4.3) is implemented and locally verified as recorded above; the
platform half (4.1) and the changelog decision are blocked on named owner
actions, and are reported as such rather than redefined. No claim in this
report rests on intent — each maps to a command, an API read, or a diff
reproduced during this execution.*
