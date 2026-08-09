# Phase 9 — Test & Validation Results (STEPS 6–8)

**Validated on:** `feat/phase9-packaging` (working tree @ 7.1.0 stamp) · Bun 1.3.14, Linux x64 sandbox
**Rule applied:** every line below is a command that was actually executed, with its real output.
Nothing here is a projection of what CI *would* do; CI-runner evidence is listed separately in §5.

---

## 1. Full test suite

The sandbox has ~2GB RAM and a ~1GB tmpfs `/tmp`. A single-process `bun test` over all
2,796 files accumulates past the memory ceiling and is SIGKILLed mid-run (observed twice,
exit 137 at exactly 279 pass). That is a **sandbox resource limit, not a test failure** —
the same single-process run completed in ~50s on this repo earlier in the phase when the
sandbox was fresh. To obtain a complete, trustworthy result the suite was executed in
per-directory segments (each segment a fresh `bun test` process, `TMPDIR` moved off tmpfs
after `/tmp` filled with test scratch mid-run — an environmental ENOSPC, also not a test
failure).

**Result (segments, union = entire suite):**

```
TOTAL: 2749 pass / 1 fail* / 13 skip   (62 segments, 73s)
*see §2 — afterwards fixed and re-run green.
```

Segment totals sum exactly to the prior floor (2685 pass / 13 skip at 7.0.1) plus the 65
tests added by Phase 9 (2763 total) — so coverage is complete, each test executed exactly
once. The 13 skips are the pre-existing live-browser a11y probes that skip cleanly without
a browser (unchanged from the phase floor).

Phase-9-owned tests (all green):

| File | Tests | Asserts |
|---|---|---|
| `test/release/channels.test.ts` | — | channel manifest generation, drift detection, stamp-from-signed-sums fail-closed |
| `test/release/changelog.test.ts` | — | conventional-commit grouping, `--check` drift gate, version stamping |
| `test/release/release-workflow.test.ts` | — | release.yml wiring: gates precede build, digests output consumed by SLSA, sign-after-assemble, npm OIDC, channel stamp order |
| `test/release/platform-parity.test.ts` | — | parity authority: exclusions.json is the only difference between OS lanes; undocumented exclusion fails |
| `test/release/beta-survey.test.ts` | — | survey metric: healthy asset set → 100%; integrity failure / missing sums entry → fail closed |
| `test/release/installer-verify.test.ts` | — | install.sh/install.ps1 fetch sums first, refuse when unstamped/mismatched, report "installed and verified" |
| `test/update/channels-update.test.ts` | — | channel detection, per-channel update plans, forced-failure rollback pinning (`brew install xr@7.1.0` etc.) |

## 2. The one failure, and its disposition → fixed, re-run green

`test/intelligence/model-class-contract.test.ts` › *"provider add is ADAPTER-ONLY"* failed
in the working tree: it asserted `git diff HEAD -- src/core …` is empty, and the Phase-9
7.1.0 stamp had legitimately rewritten `src/core/version.ts` (the Art. XXII release-stamp
surface). The gate's *intent* (Phase 5, Art. VII: no kernel/loop edit to add a provider)
was never violated — a version constant is not kernel logic — but as encoded it made the
documented release flow (stamp → `bun run ci` → tag, `docs/release/RELEASING.md`) fail on
every future release.

**Fix (narrowing the encoding to the stated intent, not weakening the gate):** the test
now uses `git status --porcelain` (which additionally covers *untracked* kernel files the
old `git diff` missed — strictly stronger) and excludes exactly one path,
`src/core/version.ts`, with an in-test rationale. Any other change under `src/core/`,
`src/core/execution/`, or `src/services/agent-service.ts` still fails it.

Re-run after fix: `bun test test/intelligence/` → **198 pass / 0 fail**.
`bun run typecheck` → **PASS**.

**Final post-fix full-suite run (all 62 segments, after every edit in this phase):**

```
TOTAL: 2750 pass / 0 fail / 13 skip   (71s)
```

(two segments report exit 1 with 0/0/0 — `test/fixtures/` and `test/platform/` contain no
`.test.ts` files, and `bun test` exits 1 on an empty filter; both are helper/authority dirs,
and every real file is accounted for in the 2750 = 2685 floor + 65 added by Phase 9.)

## 3. Gate chain (the `ci` script, minus the in-process `bun test` covered in §1)

```
PASS  release:check          (6 stamped surfaces in sync at 7.1.0 "Truth")
PASS  channel:check          (homebrew/winget/scoop manifests == generator output)
PASS  claim-lint             (every public claim is evidence-bound)
PASS  platform:parity:check  (218 files linux/darwin, 214 win32 — 4 documented POSIX exclusions)
PASS  changelog:check        (CHANGELOG.md == generator output @ 7.1.0)
PASS  baseline:inventory     (docs/release/7.1.0/INVENTORY committed, in sync)
PASS  ci-capability-gate
PASS  api:schema:check       (openapi.json in sync, 98 operations)
PASS  client:check           (generated client in sync)
PASS  api:compat
PASS  boundaries             (dependency-cruiser acyclic)
PASS  size-gate
PASS  hot-path-lint
PASS  ownership:check        (151 areas)
```

Supply chain: `bun run supply:check` → 53 packages license-clean, SBOM generated.

## 4. Behavioral proofs (effects, not mocks)

| Proof | Command | Result |
|---|---|---|
| Perf gate (Art. XII budgets) | `bun run perf:gate` | **PASSED** — all 9 scenarios within budget (version cold p95 44.4ms/300, help cold 40.7/300, doctor 475.6/1500, workspace-list 128.1/1000, dashboard 7.7/1000, retrieval@100k 37.8/250, route-decision 0/20) |
| Golden path @ 7.1.0 | `XR_HOME=… bun run golden-path` | **ok:true** — all 17 checks; install→first answer→audit chain valid→restart→recovery→uninstall-keeps-data; `chainValid:true` |
| Canonical build | `bun run build:binary:local` | linux-x64 94.0 MiB, smoke PASS |
| Beta install survey (T6 metric) | `beta-install-survey.ts --release-dir=<fresh dist> --runs=3 --target=0.99` | **rate 1.0 (3/3)**, p95 795ms: hash-verified install → `--version`/`doctor` smoke → clean-room uninstall, for each attempt |
| .deb payload | `dpkg-deb` extract/compare (STEP 5) | payload byte-identical to staged tree; md5sums match |
| Channel stamp | `channel:sync` then `channel:check` | winget/homebrew/scoop manifests byte-stable (drift gate green) |

## 5. What this sandbox could NOT validate (stated, not masked)

- **Real Rekor entries / real cosign keyless signatures.** The workflow wires
  `cosign sign-blob` with OIDC identity `@v*` tags + issuer pinning and ships
  verification docs/commands, but no tag has been pushed from this environment;
  the first tagged release produces the first real transparency-log entry.
  Installers and channel stamping were validated against structurally identical
  local assets (fail-closed paths exercised by tests).
- **Real macOS/Windows runners.** `cross-platform.yml` runs the *same* suite and
  golden path on macos+windows; the parity `--check` gate + 4 documented win32
  exclusions were validated locally, but darwin-arm64/x64/win32-x64 binaries and
  lanes can only be evidenced on GitHub runners.
- **Real package-manager installs.** Homebrew tap push is gated on
  `vars.HOMEBREW_TAP_PUBLISH` + secret; WinGet/Scoop submissions happen at the
  vendor repos; apt repo hosting is operator infrastructure. `channel-install.yml`
  tier-1 (real `dpkg` install/remove of the built .deb on PR) and tier-2 (weekly
  real channel installs from published assets) provide the runner evidence; the
  local dpkg-deb validation proves artifact correctness here.
- **npm OIDC publish.** `NODE_AUTH_TOKEN` was removed in favor of trusted
  publishing; the first `v7.1.0` tag is the first live exercise of that path.
