# XR 1.0.0 — Release-Readiness Report

**Date:** 2026-08-13 · **Baseline commit:** `651f9bd` (main) · **Branch:** `release/1.0.0-hardening`
**Scope:** final release-engineering and repository-professionalization pass.

---

## 1. Executive summary

XR was already close to release when this pass began: version identity was consistent at
1.0.0 and machine-stamped, the documentation suite was extensive, 7 CI workflows were in
place, the working tree was clean, and 28 of 29 GitHub checks were green. This pass did
**not** rewrite architecture, delete functionality, or reorganize the tree.

It found and fixed **four defects that a cosmetic polish pass would have missed**, one of
which is a genuine P0 against XR's headline capability:

| # | Severity | Defect | Status |
|---|---|---|---|
| 1 | **P0** | Evaluation run integrity reported `integrityValid: false` for untampered runs, timing-dependent | **Fixed + regression-guarded** |
| 2 | **P1** | `SECURITY.md` contradicted the implementation and shipped a prohibited claim; its root cause was a gap in the claim-lint scope | **Fixed + gate widened** |
| 3 | **P1** | Vulnerability reports were directed to a domain with **no DNS record** — reports would bounce | **Fixed** |
| 4 | **P2** | `.gitignore` covered only `.env`/`.env.local`; other variants were one `git add -A` from publication | **Fixed** |

Plus: `CODE_OF_CONDUCT.md` was missing (added), the Windows CI lane was un-diagnosable
(runner now attributes crashes to a file), and the README's test counts were stale.

**Verdict: READY WITH ONE OPEN BLOCKER.** Everything verifiable on Linux is green
(3,191 tests, 16/16 gates, 17/17 golden-path checks). The Windows parity lane cannot be
closed from this environment and needs one CI run to confirm — see §17.

---

## 2. Repository state before changes

| Property | Value |
|---|---|
| Tracked files | 2,288 |
| Source / test / docs files | 531 / 239 / 415 |
| Version consistency | 1.0.0 across all 6 stamped surfaces (already correct) |
| Working tree | clean; no build output, caches or OS junk tracked |
| CI | 29 checks; 28 pass, **1 fail** (Windows full parity) |
| Governance docs | README, CHANGELOG, CONTRIBUTING, SECURITY, LICENSE, CODEOWNERS present; **CODE_OF_CONDUCT absent** |
| Secrets | none found in tree or history |

## 3. Repository state after changes

| Property | Value |
|---|---|
| Tracked files | 2,290 (+2: Code of Conduct, regression test; +1 report) |
| Tests | **3,191 pass / 0 fail** across **240** files |
| Gates | **16/16 pass** |
| Golden path | **17/17 checks pass**, audit chain valid |
| Governance docs | complete |
| Claim-lint scope | widened to include the governance documents |

---

## 4. Files added

| File | Purpose |
|---|---|
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1; was missing entirely |
| `test/evaluation/integrity-race.test.ts` | Deterministic regression guard for the P0 |
| `docs/release/RELEASE_READINESS_1.0.0.md` | This report |

## 5. Files modified

| File | Change |
|---|---|
| `src/enterprise/evaluation/runner.ts` | P0 fix: one clock read, one provenance object |
| `scripts/parity-suite-runner.sh` | Crash-class failures attributed to a specific file |
| `SECURITY.md` | Removed prohibited claim + self-contradiction; working report route; supported-version table |
| `CONTRIBUTING.md` | Governance-vocabulary lines marked `xr-claim-lint-allow`; documented the marker |
| `README.md` | Restructured; 5 Mermaid diagrams; counts refreshed to measured values |
| `CHANGELOG.md` | 1.0.0 entries for this pass (verified changes only) |
| `release.manifest.json` | `scannedSurfaces` += SECURITY, CONTRIBUTING, CODE_OF_CONDUCT |
| `.gitignore` | `.env.*` glob with template negations |
| `docs/release/1.0.0/inventory.*` | Regenerated (239 → 240 test files) |

## 6. Files deleted

**None.** No file in this repository was proven obsolete, duplicated or superseded. Items
that looked like candidates were checked and kept:

| Candidate | Verdict | Evidence |
|---|---|---|
| `docs/historical/`, `docs/release/{3.1.6,4.0,7.0.1}/` | **KEEP** | Frozen release artifacts, deliberately retained and referenced by CHANGELOG §Rebaseline |
| `docs/audits/*` (13 files) | **KEEP** | Prior audit records; deleting them would erase the evidence trail the project is built on |
| `benchmarks/`, `scripts/perf/` | **KEEP** | Consumed by `perf:gate` / `recall-benchmark` |
| `assets/brand/*` | **KEEP** | Official identity assets; `palette-reference.png` documents the palette |
| `plugins/hello` | **KEEP** | Reference plugin used by `test/plugins/` |

## 7. Files moved

**None.** The existing structure already matches implementation reality.

---

## 8. Version changes

**No version number was changed.** The audit confirmed 1.0.0 is already correct and
consistent; there was nothing to normalize.

| Surface | Value | Source |
|---|---|---|
| `package.json`, `src/core/version.ts`, README, `install.sh`, `install.ps1`, website | `1.0.0` | stamped from `release.manifest.json`, drift-gated by `release:check` |
| Homebrew / Scoop / WinGet manifests | `1.0.0` | generated, drift-gated by `channel:check` |
| CLI runtime | `v1.0.0 (Truth)` | verified by execution |

**Independent version systems were correctly left alone** (they are not the product version):

| System | Value |
|---|---|
| Evaluation schema | `xr-7.0.0/evaluation-v1` |
| Release manifest schema | `manifestVersion: 2` |
| Database migrations | integer sequence (1, 2, 3, …) |
| OpenAPI document | `1.0.0` (coincides; independently maintained) |

`grep` for the stale development version `7.1.71` returns matches only inside a prior audit
document *discussing* it — zero live references.

---

## 9. Documentation changes

- **README** — restructured so the first screen answers "what is this, why use it" in plain
  language; architecture depth retained below; long tables behind `<details>`. Five Mermaid
  diagrams (runtime map, task lifecycle, provider architecture, extensibility, security
  boundary) replace ASCII art — **all 5 validated against the real Mermaid parser**. Official
  `assets/logo.png` and `assets/avatar.png` used as-is; no new identity generated. All 20
  internal link/image targets resolve.
- **SECURITY.md** — see §12.
- **CODE_OF_CONDUCT.md** — added, recognized standard text.
- **CONTRIBUTING.md** — documented the `xr-claim-lint-allow` marker and its legitimate use.
- **CHANGELOG.md** — 1.0.0 entries describing only changes verifiable in this diff.

Documentation deliberately **not** created: no `docs/getting-started/`, `docs/user-guide/`
scaffolding was added. Those concerns are already served by `docs/development/GETTING_STARTED.md`
and `docs/guides/`; adding parallel trees would create contradictory documentation, which the
brief explicitly warns against.

## 10. CI changes

One change: `scripts/parity-suite-runner.sh` now bisects a crash-class segment to name the
culprit file. **The gate was not weakened** — verified against synthetic fixtures reproducing
every exit shape:

| Scenario | Required behaviour | Result |
|---|---|---|
| All tests pass | green, no isolation | ✅ exit 0 |
| Real assertion failure | red, **no** isolation, test named | ✅ exit 1 |
| Crash-class file (exit 3, 0 failures) | red, culprit file named | ✅ exit 1, named |
| Every file passes alone | green + loud warning | ✅ exit 0 + warning |
| Real failure inside isolation | red | ✅ exit 1, file named |

## 11. Packaging changes

**None required.** Package metadata was audited field by field and is correct: scoped name,
`bin`, `files`, `engines`, `packageManager`, repository/bugs/homepage, MIT license, one runtime
dependency (`zod`), Playwright correctly `optional`. Channel manifests are generated from the
release manifest and drift-gated.

---

## 12. Security findings

**No secrets, keys, tokens or credentials were found** in the working tree or in git history
(`--diff-filter=A` across all refs). No personal absolute paths leak: every `/home/`, `/Users/`
match is a documented placeholder or a platform constant (`/opt/homebrew`,
`/home/linuxbrew/.linuxbrew`).

Three real issues, all fixed:

1. **Prohibited claim + self-contradiction in `SECURITY.md`.** It opened by calling XR a
   "secure AI Operating System" — a term `release.manifest.json` prohibits outright — and
   labelled the `node:vm` realm the *"Primary Security Boundary"*, while the implementation it
   documents (`src/plugins/sandbox-worker.ts`) states plainly that `node:vm` is **not** a
   security boundary. For a project positioned on trustworthiness, a security policy that
   overstates its own guarantees is a serious defect. Corrected to the real posture.

2. **Root cause: the honesty gate had a blind spot.** `claim-lint` only scanned
   `README.md`, the website, the installers and `package.json` — the governance documents were
   never checked, which is exactly why #1 survived. `SECURITY.md`, `CONTRIBUTING.md` and
   `CODE_OF_CONDUCT.md` are now in `scannedSurfaces`. **Verified** by planting
   "SOC 2 Type II certified / military-grade" in `SECURITY.md` and confirming the gate fails,
   then reverting.

3. **The vulnerability reporting channel did not exist.** Reports were directed to
   `security@xr-project.org`; the domain has **no DNS record**, so disclosure emails would
   bounce silently — the worst possible failure mode for a security contact. Replaced with
   GitHub Security Advisories, plus a supported-version table and an explicitly
   effort-based (non-contractual) response process appropriate to a single-maintainer project.

Plus the `.env.*` ignore gap (§4 of the summary table).

---

## 13. Test results

All executed locally on Linux x64, Bun 1.3.14.

| Suite | Result |
|---|---|
| Full parity suite | **3,191 pass / 0 fail** across **240** files, exit 0 |
| Typecheck (`tsc --noEmit`) | pass |
| Golden path (hermetic) | **17/17 checks**, `chainValid: true`, install→answer→restart→resume→uninstall |
| Gate battery | **16/16 pass** |
| CLI smoke | `xr --version` → `v1.0.0 (Truth)`; `xr doctor` correctly exits 1 with no provider |

Gates: `typecheck · release:check · channel:check · claim-lint · changelog:check ·
baseline:inventory · api:schema:check · client:check · api:compat · boundaries · size-gate ·
hot-path-lint · ownership:check · website:marketplace:check · ci-capability-gate ·
platform:parity:check`.

**The P0 was caught by running the suite the way CI runs it.** `test/evaluation/` passed in
isolation and failed in a full segmented run — the signature of a load-dependent race, which
is precisely why per-file runs are not sufficient evidence.

## 14. Cross-platform results

| Platform | Status | Evidence |
|---|---|---|
| **Linux** | ✅ verified here | Full suite + golden path + all gates, exit 0 |
| **macOS** | ✅ green on CI | `macOS — full parity` passed at `651f9bd` |
| **Windows** | ⚠️ **open blocker** | `Windows — full parity` fails: Bun `panic: Internal assertion failure` in the `test/perf/` segment, surviving the existing retry |

Portability audit found **no** path-handling, shell-assumption or temp-directory bugs: no
hardcoded `/tmp` in `src/`, path joins use `node:path`, the parity runner is POSIX-only shell
compatible with bash 3.2 (macOS) and 5.x.

**On the Windows lane specifically:** I could not reproduce it — this environment is Linux, and
the failure is a Bun runtime panic, not an XR assertion. Rather than guess (the previous attempt
excluded `binary-smoke.test.ts` on a guess and the lane stayed red), the runner now **names the
culprit file** on the next run. That converts an un-diagnosable red lane into an actionable one.
I deliberately did **not** add a speculative win32 exclusion: that would trade real Windows
coverage for a green badge without evidence.

---

## 15. Claim verification

Every claim in `release.manifest.json` re-checked against implementation:

| Claim | Evidence | Status |
|---|---|---|
| 65 bundled skills | `ls skills \| wc -l` → **65**; mechanically enforced by claim-lint | **PROVEN** |
| 26 presets, 16 hosted + 10 local | `PRESETS` keys → **26**; kind split → **16/10** | **PROVEN** |
| Local-first / offline | 10 local runtimes are first-class presets | **PROVEN** |
| BYOK | No key ships; `apiKeyEnv` resolution; secrets redacted | **PROVEN** |
| Spend-capped | `src/cost/governor.ts` enforced in-loop; `test/cost.test.ts` | **PROVEN** |
| Tamper-evident audit | Hash chain verified by golden path (`chainValid: true`) | **PROVEN** — *and hardened by the P0 fix* |
| Provider-neutral | Registry + native adapters + OpenAI-compat transport | **PROVEN** |
| Plugin + MCP | `src/plugins/manager.ts`, `src/mcp/manager.ts` | **PROVEN** |
| TypeScript on Bun | Zero Rust sources; `engines.bun` | **PROVEN** |
| Signed releases | `release.yml`: cosign + SHA256SUMS + SBOM + SLSA3 | **PARTIALLY PROVEN** — machinery exists and is wired; **no tagged release has exercised it yet** |
| Validated channels | Generated + drift-gated + install-tested | **PARTIALLY PROVEN** — same reason; publication pending first tag |
| "3,191 tests / 240 files" (README) | Measured this run | **PROVEN** |
| npm `latest` is stale at `3.1.5` | Disclosed prominently in README + known-limitations | **PROVEN (as a disclosed limitation)** |

No claim was found that presents planned as implemented, or experimental as stable. The
"XR is not" list and the in-process-policy honesty box were preserved verbatim.

## 16. Release checklist

| Check | Status |
|---|---|
| Repository builds / typechecks | ✅ |
| Tests pass | ✅ 3,191 / 0 |
| Golden path passes | ✅ 17/17 |
| CLI works | ✅ |
| Version consistent across all surfaces | ✅ 6/6 |
| Changelog correct | ✅ |
| License correct (MIT, unchanged) | ✅ |
| Security policy exists and is accurate | ✅ (fixed) |
| Contributing guide exists | ✅ |
| Code of Conduct exists | ✅ (added) |
| GitHub workflows valid | ✅ 7/7 parse |
| Issue/PR templates valid | ✅ 4/4 parse |
| README links resolve | ✅ 20/20 |
| Mermaid diagrams valid | ✅ 5/5 |
| Logo / avatar render | ✅ official assets, correct paths |
| No secrets / personal paths | ✅ |
| No stale dev artifacts | ✅ |
| **Windows CI lane green** | ❌ **open** |

---

## 17. Remaining blockers

**One blocker, one caveat.**

1. **BLOCKER — Windows full-parity lane.** Bun panics in the `test/perf/` segment. The next CI
   run will name the culprit file in the check annotations (`CRASH CULPRIT: <file>`). Then
   choose, with evidence in hand: fix the test if it is an XR defect, or add an
   `exclusions.json` entry citing the Bun defect if it is upstream (the file mechanism already
   exists and requires a written reason). **Do not tag until this lane is green or the
   exclusion is justified in writing.**

2. **CAVEAT — npm `latest` is `3.1.5`.** Because `3.1.5` sorts higher than `1.0.0`, publishing
   1.0.0 does **not** move `latest` automatically. The dist-tag must be re-pointed explicitly
   (§19). This is already disclosed in the README and known-limitations register.

`signed-releases` and `validated-channels` remain *partially proven* until the first tag
actually exercises the pipeline — that is expected, and honestly labelled.

## 18. Recommended release procedure

```
merge hardening branch
   ↓
CI green on main (incl. Windows lane — the blocker above)
   ↓
verify locally: bun run ci && bun run golden-path
   ↓
tag v1.0.0  →  release.yml builds 5 targets, signs, publishes GitHub Release
   ↓
npm publish  →  re-point the latest dist-tag (mandatory, see below)
   ↓
verify from a clean machine
```

## 19. Exact commands

### SAFE PREPARATION — inspect and land the changes

```bash
# 1. Review exactly what changed
git status
git diff main..release/1.0.0-hardening --stat
git diff main..release/1.0.0-hardening

# 2. Re-run the full battery locally
bun install --frozen-lockfile
bun run ci
bun run golden-path
bash scripts/parity-suite-runner.sh linux

# 3. Land it (PR preferred so CI runs on the branch)
git push -u origin release/1.0.0-hardening
#    open a PR, confirm all lanes — especially "Windows — full parity"
```

### RESOLVE THE WINDOWS BLOCKER (required before tagging)

```bash
# Read the annotation from the Windows lane: "CRASH CULPRIT: test/perf/<file>"
# Then EITHER fix the file, OR record an evidence-bound exclusion:
#   test/platform/exclusions.json  → add { pattern, excludeOn: ["win32"], since, reason }
bun run scripts/platform-parity.ts --validate   # exclusion must name a real file + reason
```

### ⚠️ ACTUAL PUBLISH — destructive/public, run only when the above is green

```bash
# Tag and push — this TRIGGERS the release workflow (build, sign, GitHub Release)
git checkout main && git pull
git tag -a v1.0.0 -m "XR 1.0.0 (Truth)"
git push origin v1.0.0

# Publish to npm (after the tag's artifacts verify)
npm publish --access public

# MANDATORY: 3.1.5 sorts above 1.0.0, so `latest` does NOT move on its own
npm dist-tag add @rrrtx/xr@1.0.0 latest
npm dist-tag ls @rrrtx/xr          # confirm: latest -> 1.0.0

# Verify from a clean machine
npx @rrrtx/xr@latest --version     # expect: v1.0.0 (Truth)
curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash
xr doctor
```

Nothing in this pass published, tagged, or pushed anything.

---

## 20. Release-readiness score

| Category | Status | Evidence | Remaining issue |
|---|---|---|---|
| Architecture | **READY** | `boundaries` gate clean, 522 modules, 0 violations | — |
| Runtime | **READY** | 3,191 tests; P0 integrity race fixed | — |
| CLI | **READY** | `--version`, `doctor`, golden path verified | — |
| TUI / UI | **READY** | a11y lane green (WCAG 2.2 AA), dashboard render budget met | Not manually driven here |
| Backend (daemon) | **READY** | OpenAPI schema + client + compat gates pass | — |
| Security | **READY WITH MINOR FIXES** | Policy accurate now; gate widened; no secrets | In-process policy only — documented, not a sandbox |
| Testing | **READY** | 3,191/0 across 240 files; regression test added | — |
| CI | **READY WITH MINOR FIXES** | 28/29 green; runner now self-attributing | **Windows lane (blocker §17)** |
| Cross-platform | **BLOCKED** | Linux + macOS green | Windows panic unresolved |
| Packaging | **READY** | Metadata audited; channels generated + drift-gated | — |
| Installation | **READY WITH MINOR FIXES** | install.sh syntax-checked; golden path covers install/uninstall | npm dist-tag must be re-pointed |
| Documentation | **READY** | Links 20/20, diagrams 5/5, counts measured | — |
| Open-source hygiene | **READY** | CoC added; templates, CODEOWNERS, MIT all present | — |
| Versioning | **READY** | 6/6 surfaces at 1.0.0; independent schemes preserved | — |
| Release process | **READY WITH MINOR FIXES** | Workflow wired end to end | Unexercised until first tag |
| Performance | **READY** | Budgets + regression gate pass | — |
| Developer experience | **READY** | `bun install` → `bun run ci` works from clean clone | — |
| User experience | **READY** | Onboarding, doctor, honest exit codes | — |
| Claims / evidence | **READY** | Every claim mapped; 2 honestly marked partial | — |

**Overall: READY WITH ONE OPEN BLOCKER (Windows parity lane).**

This is deliberately not scored 100%. Two claims are unexercised until the first tag, and the
Windows lane needs one CI run to attribute. Calling that "100% ready" would be exactly the kind
of unevidenced claim this repository's own tooling is built to reject.
