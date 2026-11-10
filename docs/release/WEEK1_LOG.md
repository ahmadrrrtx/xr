# XR Preview 1 — Week 1 Log

Plan: `XR Release Plan Agent Brief and Master Plan.md` (v2, 10 Nov 2026).
Branch: `release/preview-1` · Base commit: `1834fd16cecc18997d94764603fdceb16fcea89b`
Release identity target: XR Preview 1 — `0.1.0-preview.1`, tag `v0.1.0-preview.1`.

Status vocabulary: **PASS / FAIL / BLOCKED / NOT RUN** (evidence = exact command + output excerpt).
A BLOCKED or NOT RUN item is never reported as PASS. Dates are the container's UTC clock.

---

## Day 1 — 2026-11-09/10 (Phase 0 + first P0)

### Drift-check: OK

- Plan sections 1, 3, 10 re-read at session start and before this entry.
- `bun run scripts/release-smoke/ledger-check.ts` → `LEDGER OK - 52 tasks (done=3, doing=1, todo=45, needs_owner=3), 5 commit(s) since 1834fd16`.
- Ledger v1 frozen at 52 tasks + header. The checker was itself tested against 5 kinds of
  drift (§ below) before any code was written.

### Done

| # | Item | Commit | Evidence |
|---|---|---|---|
| 1 | Environment: Bun **1.4.2** (the repo's pin, `.bun-version`), Node v20.20.2, 4 GB swap, `NODE_OPTIONS=--max-old-space-size=1400` | — | `bun --version` → `1.4.2`; `free -h` → `Swap: 4.0Gi` |
| 2 | Clone + `bun install --frozen-lockfile` (82 pkgs) + `desktop/bun install` (457 pkgs) | — | both exit 0 |
| 3 | Base commit recorded, branch `release/preview-1` created | — | `git rev-parse HEAD` → `1834fd16cecc…` |
| 4 | Ledger v1 (52 tasks: T01–T09 defects, T10–T17 workstreams, T20–T33 features, T40–T50 OWASP, T60–T66 Windows, T70–T72 owner) | `4615ff68` | `docs/release/preview1/ledger.jsonl` |
| 5 | `ledger-check.ts` written **and proven to fail** on 5 drift classes | `4615ff68` | §"Checker self-test" |
| 6 | **T01 / D1 (P0): `new Function()` RCE removed** from workflow branch conditions, end to end | `b5a72c88`, `d3493f23` | `docs/release/preview1/evidence/T01-d1-workflow-expression-rce.md` |
| 7 | T02 / D2 investigated — **not reproducible**; test left untouched | `8a2fd59a` | `…/evidence/T02-d2-voice-not-reproduced.md` |
| 8 | Ownership map regenerated (my new dir caused the drift, not a pre-existing defect) | `863b1e9e` | `bun run ownership:check` → in sync |
| 9 | `security:check` → **PASS** (7/7 stages) once the pinned Bun was installed | — | §"Release Gate Lite snapshot" |

### Release Gate Lite snapshot (local items only; items 9 needs G1)

| # | Gate | Result | Evidence |
|---|---|---|---|
| 1 | `npx tsc --noEmit` (root) + desktop typecheck | **PASS** | exit 0 both |
| 2 | Tests, per directory | **PASS** — `5282 pass, 41 skip, 0 fail`, re-run after every commit on the branch | `/home/user/logs/baseline-final/summary.tsv` |
| 3 | `bun run security:check` | **PASS** (7/7) | pinned-bun 1.4.2, unshare=true bwrap=false, deps audit clean |
| 4 | `claim-lint`, `placeholder-lint`, `release:check`, `changelog:check` | **PASS** (all exit 0) | `v1.1.1-rc.1`, 10 surfaces in sync, 20 evidenced claims |
| 5 | `api:schema:check`, `client:check` | **PASS** | 292 operations; typed client in sync |
| 6 | `desktop:sink-lint` | **PASS** | no raw HTML/eval sinks |
| 7 | `smoke-sidecar.sh` | NOT RUN | needs a compiled sidecar (WS5) |
| 8 | `consumer-smoke`, `journey:cli` | NOT RUN | next |
| 9 | `desktop-app.yml` Linux+Windows legs | **BLOCKED** | needs G1 (no `GITHUB_TOKEN`) |
| 10 | WS3 smoke scripts | NOT RUN | T12 |

### Checker self-test (Phase 0 requirement: a gate that cannot fail is not a gate)

Each case was made in a throwaway clone, run against the checker, and reverted.

| Injected drift | Result |
|---|---|
| commit subject without `[Txx]` | `LEDGER FAIL — subject has no [Txx] id` |
| `[T99]` not in ledger | `LEDGER FAIL — id T99 is not in the ledger` |
| commit touching `README.md` under a task whose paths exclude it | `LEDGER FAIL — "README.md" is outside the task's paths` |
| task marked `done` with no evidence | `LEDGER FAIL — status done but no evidence file` |
| invalid JSON line | `LEDGER FAIL — line 54: invalid JSON` |
| append-only update with a later ts | passes (correct) |

It then caught two real drifts of mine during the day (`docs/OWNERSHIP.md` under T01, the T02
evidence path) — which is the behaviour we want.

### Findings that contradict the plan (FACT, verified here)

1. **`test/desktop` was not broken — the environment was.** 6 failures in the first baseline
   were `Cannot find module 'react/jsx-dev-runtime'`. Root `package.json` has no `workspaces`,
   so `desktop/` needs its own `bun install` (457 packages). After installing: `491 pass, 0 fail`.
   *Consequence for WS4 and for `README` quick-start: the desktop build has a second install step
   that is easy to miss.*

2. **The full suite fails for environmental reasons on a small box.** First full run: `322 fail`.
   Cause found: `df -h /tmp` → `tmpfs 992M`, and the log holds 75 × `ENOSPC: no space left on
   device` — the suite's temp root overflows a RAM-backed `/tmp`, then every later suite fails
   for unrelated reasons. With `TMPDIR` on the real disk: `5193 pass, 41 skip, 7 fail` (and 7 was
   1 real + 6 desktop-deps). *Anyone reproducing the plan's "1 failing" claim on a small machine
   must set `TMPDIR`.*

3. **The suite is not order-independent.** On the pinned Bun 1.4.2 a single-process
   `bun test` gives `5174 pass, 106 fail`; the same 106 tests pass when their directory is run
   alone (`bun test test/api/` → `115 pass, 0 fail`). The failures are cross-file interference
   over shared daemon/server state (e.g. an auth test expecting `401` receives `200` because
   another file's server config is still in effect). This is **why Gate Lite item 2 says "per
   directory"** — it is not a formality. Recorded as a quality risk; root single-process
   `bun test` should not be advertised as the way to test XR.

4. **`security:check` fails on the wrong Bun.** It pins `.bun-version` = `1.4.2`; the box had
   1.4.4, so the gate reported `FAIL: actual 1.4.4; expected 1.4.2` while all six behavioural
   stages passed. Not a product defect. *Fix: install the pin — which was done, not the gate.*

5. **`size-gate` polices growth of waived files, and the tree is at 99.9 % of its ceiling**
   (the tree is at 99.9 % of its stamped ceiling; 17 modules are over 800 LOC). My first D1 patch tripped it
   (`engine.ts 1381 → 1386`, `types.ts 851 → 867`). Resolved by moving the new allow-list into
   `src/execution/workflow/conditions.ts` and holding both waived files at exactly their
   recorded size, rather than raising a baseline. **Anyone adding code to a waived module must
   keep it at or below its recorded size — there is only ~214 LOC of headroom in the whole tree.**

6. **D2 (the plan's one failing test) does not reproduce** — see T02 evidence. Five
   configurations tried, including the two the plan nominated as suspects.

7. **Release identity is more tangled than section 2 says.** GitHub API, today: releases
   `v1.1.0` (**`prerelease=false`**, 5 assets) and `v1.0.0` (21 assets), `v1.0.0-beta.1`
   (prerelease). Tags with **no** release: `v3.0.0`, `v4.3.0`, `v4.5.0`, `v7.0.0`. Meanwhile
   `release.manifest.json` lists `v1.1.0` under `withdrawnTags` for a failed release gate. So
   the GitHub releases page currently advertises as *stable* a release the manifest says was
   never published. **This is a live false signal to users** and is D4 work (fix at G3, per D4:
   mark `prerelease` + Legacy note, delete no tags).

8. **`xr env capabilities --json` is honest and works.** On this box: `desktop` →`unsupported`
   (missing `xdotool`, `wmctrl`), `browser` → supported, `application` → supported, and the
   secret backend warns that no OS keychain exists and falls back to an encrypted file.
   Consistent with D5's "refuse clearly, keep the rest working" policy.

### In progress

- T08 (claims): README has **zero** Firecracker/Kata/gVisor mentions; `KNOWN_LIMITATIONS.md`
  row 2 states microVMs are detection-only and fail closed; no `firecracker` string in
  `src/commands/`. Remaining: UI strings and CLI help sweep.

### Blocked

| Item | Why | Who can unblock |
|---|---|---|
| **G1** (push + CI + Windows workflows) | **`GITHUB_TOKEN` is not set** in this environment. Anonymous clone/read works because the repo is public, so all Stage-1 local work proceeds normally. Every CI-dependent task (T06, T60–T66, Gate item 9) stays BLOCKED. | **Owner: export `GITHUB_TOKEN`** (`repo` + `workflow` scope) |
| T07, T21 real-provider runs | No provider key in env | Owner: one capped key |
| T60–T66 Windows evidence | Needs GitHub-hosted Windows runners → G1 | Owner |
| macOS, code signing, microphone, GUI | No such hardware here | Owner (checklist at Day 6) |

### Risks

1. **Token absent** — Day 3 ends at G1. If it has not arrived, the Windows/CI half of the plan
   (Days 4–5) cannot start, and the readiness report will say so plainly rather than claim PASS.
2. **Suite order-dependence** (finding 3) — CI must keep running per directory; a future
   "simplify CI to one `bun test`" would produce a red build for reasons that look like product
   bugs and are not.
3. **0.1 % size headroom** (finding 5) — every remaining task will fight `size-gate`. D9's
   "do not refactor" now has a sharper edge.
4. **D4 could exceed its half-day cap** (finding 7: 4 extra tags) — fallback is `1.2.0-preview.1`
   per section 3/D4.

### Next (Day 2)

- T04 / D4 release identity to `0.1.0-preview.1` (half-day cap), starting with
  `npm view @rrrtx/xr versions dist-tags` — the precondition nobody has run yet.
- T12 / WS3 first smoke scripts (`scripts/release-smoke/`), mock providers.
- T22 spend-cap adversarial tests, T23 security-plane tamper test.
- Then T03 (dead UI) and T05 (Windows sandbox-only refusal).

---

## Day 1 (continued) — credentials landed: token check + first real-provider run

The owner supplied a GitHub token and a Groq key. Both were placed in a `chmod 600` file
**outside the repository**, in a path excluded from workspace snapshots, and verified absent from
the working tree, every commit on this branch, `git config` and the remote URL. Neither value was
printed at any point.

### Token scope — PASS

Read from the `X-OAuth-Scopes` response header only, never from the token:

```
x-oauth-scopes: delete:packages, gist, read:audit_log, read:project, repo, workflow, write:discussion, write:packages
login=ahmadrrrtx   permissions: admin=true push=true pull=true
```

`repo` + `workflow` are exactly what G1 and G3 need. **Nothing was pushed and no workflow was
dispatched** — G1 still requires the owner's `APPROVE G1`.

### Real provider — PASS (first real call in the project's history)

```
$ XR_SECRETS_ENV_COMPAT=1 … xr "Reply with exactly the token SMOKE-OK and nothing else." \
    --provider groq --model openai/gpt-oss-20b --budget 0.05
SMOKE-OK
✓ … 2.0k tok ≈ $0.0002 / $0.05 estimated admission threshold      exit=0
```

Total spend on live calls: **$0.0002**. Full evidence:
`docs/release/preview1/evidence/T07-real-provider-groq.md`.

### Two new defects found and fixed because of it

| ID | Priority | What | Status |
|---|---|---|---|
| **T21.a** | P1 | Groq preset defaulted to `llama-3.3-70b-versatile` and listed 3 more ids Groq **no longer serves** (verified against the live `/openai/v1/models` on 2026-11-10). Selecting Groq failed on the first request. Preset replaced with the verified catalogue. | **done** |
| **T22.a** | P1 | The budget governor refuses an unpriced model *before sending* (correct — unpriced is never free), but the CLI replaced that reason with `budget limit reached (raise it in the desktop app …)`. Raising the cap can never clear it. The real reason is now carried into the result and passed through, naming the operator-rate path that does work. | **done** |
| **T21.b** | P2 | Price facts exist for only 3 of 26 presets (openai 4, anthropic 3, google 2 models). The rest need sourced prices per model. Preview 1 ships the proven operator-declared-rate path instead of a hastily-filled registry. | todo (after Preview) |

### New finding (FACT) — BYOK does not work the way the claim reads

`release.manifest.json` claim `byok`: *"Bring your own API key — provider credentials stay in your
environment."* In practice XR's secret broker **ignores ambient `process.env` by default**
(`XR_SECRETS_ENV_COMPAT` off in v1.x), so `export GROQ_API_KEY=…` followed by `xr doctor` reports
`API key GROQ_API_KEY not set`. The documented path is `xr onboarding` (imports into the sealed
store); the compat flag is the scripted path. `KNOWN_LIMITATIONS.md` #4 discusses the flag but
frames it as keys *remaining* in `process.env`, which is the opposite direction. **WS6 must fix the
wording, not the control** — refusing ambient env is the safer default.

### Gate re-run after all changes — all PASS

```
claim-lint ✓   placeholder-lint ✓   release:check ✓ (10 surfaces, 1.1.1-rc.1)
changelog:check ✓   channel:check ✓   api:schema:check ✓   client:check ✓
size-gate ✓   desktop:sink-lint ✓   tsc --noEmit exit 0
test/providers + test/cli: 382 pass, 0 fail
```

---

## Day 2 · D4 — release identity, including the documented fallback

**Decision (owner-approved plan §3/D4):** the release identity is **`1.2.0-preview.1`**, codename
**Preview 1**. The plan's primary target was `0.1.0-preview.1`; §3 names `1.2.0-preview.1` as the
fallback and it is the one that survived contact with the repository's own contracts.

**Why the primary target failed (FACT, reproduced locally):**

1. `identity.stability` is an enum with no `preview` member — a `0.x` preview cannot be described in
   the manifest's own vocabulary (it had to claim `public-beta`).
2. `scripts/release-manifest.ts#validateChannels` rejects a pre-release `publicVersion` unless
   `channels.claimed == ["github-releases"]`. Preview 1 wants the npm/Homebrew/WinGet/Scoop/Docker
   rows to stay claimed for the **1.0.0 public line**, so a `0.x` public version is refused.
3. 16 tests across `test/release`, `test/update` and `test/phase0` encode "1.0.0 stays public"
   as the shipped truth — including the README channel gate, the six-channel live check, the `.deb`
   round-trip and the installer pin. Re-baselining that suite is a bigger change than D4's half-day
   cap, and loosening it would have weakened a gate to make a version number fit.

**Fallback applied instead:** only `identity.version` and `identity.codename` moved
(`1.1.1-rc.1`/Graphite → `1.2.0-preview.1`/Preview 1), `stability = public-beta`,
`channels.publicVersion` stays **1.0.0** and `channels.claimed` is untouched. The product is called
**XR Preview 1** in every user-facing string; semver is an implementation detail.

**Deviation recorded (T04.a):** the primary identity `0.1.0-preview.1` was attempted and abandoned.
The attempt was reverted in full (`git checkout --` across every stamped surface,
`docs/release/0.1.0-preview.1/` and the `0.x` WinGet manifest removed) before the fallback was
applied, so no `0.x` string survives in the tree.

**Two derived artifacts had to be regenerated, and one test pin was wrong:**

- `docs/api/openapi.json` — the version string is embedded; `api:schema:check` fails on stale and CI
  would have gone red. Regenerated (`api:schema:generate`); the diff is only the version.
- `CHANGELOG.md` — regenerated from git (`changelog:generate`, 189 commits since v1.1.0).
- `test/daemon/dashboard-split.test.ts` — **a real defect in the pin, not in the dashboard.** The
  pinned post-hardening document hash normalized the generated *version* but not the generated
  *codename*, and the rendered identity is `"<version> (<codename>)"`. Any codename change therefore
  broke the pin (D4 changed Graphite → Preview 1). Normalizing both halves restores the pin
  **byte-for-byte** at the pin-time values (`1.1.0` / `Graphite`) while keeping the DOM/CSP guard
  exact — verified: the normalized hash equals the committed constant.

**Gates after the fallback (all PASS):** `release:check` (10 surfaces @ 1.2.0-preview.1),
`channel:check` (5 configs @ public 1.0.0), `claim-lint` (20 evidenced claims),
`changelog:check`, `api:schema:check`, `ci:policy`.

**Tests after the fallback:** full per-directory sweep re-run — 4,864 pass / 0 fail across 54
directories (`test/fixtures` and `test/helpers` hold no test files, which is their documented state).

**README:** the install table still describes the **1.0.0 public line** the six channels serve
today; a paragraph above it states plainly that Preview 1 is not installable from those channels and
points at the release-scoped limitations document. `known-limitations.md` for `1.2.0-preview.1`
carries the same statement plus the "why not 0.1.0" note.

## Day 2 · T60.a — the Windows runner found three real defects in the T60 workflow

The first `windows-preview-test.yml` run (`42703322271`) failed, and it failed usefully. Nothing
here is a product defect; all three were defects in the new workflow file, i.e. the evidence lane
was wrong, not the software.

| Defect | Symptom on the runner | Fix |
|---|---|---|
| Unpinned actions | CI `Quality Gate` + `Truth gate` red on `ci-policy` (run `42703345499`): the file used `checkout@v5`, `upload-artifact@v4`, `dtolnay/rust-toolchain@stable` | Every action pinned to the repo's own commit SHAs with `# vN.N.N` comments |
| Hand-rolled bundle | `Windows CLI (x64)` died: `Could not resolve: "chromium-bidi/lib/cjs/bidiMapper/BidiMapper"` — `bun build --compile` without `--external playwright --external playwright-core` | Build through `scripts/compile-sidecar.ts`, the repo's ONE computation source, then copy the sidecar to `out/xr.exe` |
| Missing sidecar precondition | `shell-test-windows` `cargo test` died at `tauri-build`: `resource path binaries\xr-engine-x86_64-pc-windows-msvc.exe doesn't exist` — `build.rs` validates `bundle.externalBin` before compiling anything | Install Bun, `bun install --ignore-scripts`, compile the sidecar, *then* `cargo test --locked --jobs 1 --lib` (mirrors `desktop-app.yml`) |

**Windows is still NOT RUN as evidence.** The workflow is fixed but the fixes are uncommitted, so no
runner has executed them yet. T60 stays `doing` until a real `windows-latest` run is green; Linux
results are never promoted to Windows evidence and Wine is never evidence.

## Day 2 · environment loss and recovery (FACT)

The sandbox that holds this workspace was restored from a snapshot between sessions. Content
survived; three things did not, and the loss is recorded here because it shaped the day:

- **`.git/` was absent** from the working copy — no commits, no branch, no remote config. Recovered
  by cloning `github.com/ahmadrrrtx/xr` fresh, checking out `release/preview-1` at the pushed tip
  `b75969a2`, and layering the surviving working tree over it. The three commits made after that
  point were re-made locally against the real tip, so history is linear and correct.
- **`/home/user/.cache/xr-release/` (token, Groq key, helper scripts) was absent** — that directory
  is deliberately outside the repo and snapshot-excluded. It was **not** recoverable, and nothing
  else on disk (or in the environment) contained a copy. Pushing and any GitHub API call therefore
  stop until the owner re-supplies the token. Nothing was written to the repo in the meantime, and
  no secret was ever printed, echoed or committed.
- **`node_modules/` and the Bun install were absent** (installed tooling is not snapshotted).
  Reinstalled Bun at the repo pin (`1.4.2`) and `bun install --frozen-lockfile`.

One real defect was found *by* the recovery: three `scripts/*.sh` files came back with mode `644`
instead of `755` (executable bit dropped). Reset from the object store — worth knowing because a
lost exec bit on an installer script is the kind of thing that only fails on someone else's machine.

Verification after recovery: `ci:policy`, `release:check`, `channel:check`, `claim-lint`,
`changelog:check`, `api:schema:check` all PASS, and `test/{daemon,whatsapp,workflow,release,update,phase0}`
green (308/35/58/288/38/217 pass, 0 fail) — including `test/daemon` (308 pass), which had been the
only red directory before the loss and is green now that the codename half of the DOM pin is
normalized.

## Day 2 · Windows evidence arrives, and it is evidence (FACT)

`Windows Preview Test` run **42707408342** on `9d67a41f` — **all three jobs green**, from a
GitHub-hosted `windows-latest` runner and nothing else:

| Job | Result | What it actually proved |
|---|---|---|
| Windows CLI (x64) | success | the release smoke lane against the compiled `xr.exe`: **9 passed · 0 failed · RESULT: PASS** on `MINGW64_NT-10.0-26100` |
| Rust Windows tests | success | `cargo test --locked --jobs 1 --lib` compiles and passes once the sidecar exists (the T60.a fix) |
| Installers (msi/nsis) | success | inspection path ran; no bundles were present and it said so rather than claiming a build |

Two results from that run are worth more than a green tick:

1. **D5 is real on Windows, not asserted.** The isolation smoke reads the live guarantee
   matrix on the host it runs on: `win32/x64`, hardened mode on, `shell / arbitrary code` →
   tier2_isolated, placement **`BLOCKED (fail-closed)`**, kernel boundary ✗, fail-closed ✓,
   remediation naming Docker Desktop/Podman or the experimental AppContainer. Refuse, never
   run in-process — exactly the contract.
2. **Path-escape policy runs natively there.** 122 assertions pass on Windows across
   `filesystem-authority`, `filesystem-implicit`, `filesystem-index-context` and
   `canonical-bypass` — replacing the four fake "denials" the first version of this workflow
   produced (see the false-pass note below).

Artifacts committed under `docs/release/preview1/evidence/`: `T60-windows-smoke.log`,
`T60-windows-escape-tests.log`, `T60-windows-env-capabilities.json`.

macOS: **NOT RUN**, best-effort in this plan, claimed nowhere.

---

## Ledger hash history

| When | sha256 | Note |
|---|---|---|
| v1 (frozen) | `7621a128995b51fa0ec63c95fc6b4c9293ffccf96d09c90c55562e02e3b5fcdd` | 53 lines, 1 header + 52 tasks |
| after Day 1 | see `sha256sum docs/release/preview1/ledger.jsonl` | append-only; ts normalised once because the v1 header was anchored at `2026-11-10T00:00:00Z` (owner-local date) while the container clock is still `2026-11-09` UTC, which made every append look like it preceded the header |

## Day 2 continuation — release hold and drift check (2026-11-10)

**Drift-check: FAIL.** Re-read plan §§1, 3 and 10 and ran
`bun run scripts/release-smoke/ledger-check.ts` at `e551b234`: exit 1, 71 problems.
The append-only ledger contains six historical entries without `commits`; several `done`
entries have prose where the checker requires an evidence-file path or lack commit attribution;
and already-pushed commits have multi-ID/range or missing-ID subjects rejected by the checker.
Some file scopes also disagree. Appending corrections does not repair invalid historical lines or
commit subjects. Do not silently weaken the checker or rewrite published history: owner decision
is needed on a transparent reconciliation. The drift existed before this checkpoint; it is not OK.

**Done:** `e551b234` CI and Cross-Platform CI succeeded; `42897512989` gitleaks succeeded.
The ownership map and journey default were committed in `e551b234`. T17.b is now recorded.

**Open / risk:** Supply Chain `42897512989` failed on OSV finding RUSTSEC-2026-0459
(`libsqlite3-sys` 0.35.0). The previous report understated the exposure: the desktop archive
import path extracts `.db-wal` and opens imported `.db` files. Exploitability is untested;
no owner risk acceptance has been obtained. Desktop dispatch `42895932985` on `895fd306` has
successful Linux and Windows x64 bundle jobs but failed Flatpak source build and is still in
progress. PR packaging run `42897513049` on `e551b234` is also in progress: its Flatpak metadata
checks passed, but the Flatpak source build was **skipped**, not passed. No current artifacts
have been inspected. The Clean-Machine Journey PR run `42897513138` was cancelled.

**Next:** resolve the SQLite advisory with a tested Rust dependency/toolchain update; inspect
Linux/Windows artifacts and complete packaging; reconcile ledger drift transparently. No GO until
release blockers are resolved and owner gates are respected.

**B1 recheck:** `bun run consumer-smoke` at the current local tip returned exit 0,
`ok:true`, `doctorExit:0`, `taskExit:0`. This is the source-mode stub path, not a live model.

**Signing clarification:** `.github/workflows/desktop-app.yml` uses owner-controlled secrets and
`scripts/desktop-signing-plan.ts` requires Windows Authenticode and macOS signing/notarization
for *all tag candidates*, including previews. The plan permits unsigned preview builds but the
existing repository policy blocks unsigned tags. With presence flags unset locally, the tag
preflight exits 1 listing those prerequisites; this does **not** establish whether GitHub
environments have them. No release policy or signing controls were bypassed.

**Rust toolchain correction:** the desktop workflow already pins Rust 1.99.1. The crate declares
1.77, while rusqlite 0.41 requires 1.89. The CI toolchain itself may already meet that requirement;
the manifest/lock update and actual builds remain unverified.

## Follow-up audit (2026-11-10) — drift-check FAIL

Re-read plan §§1, 3 and 10; at `c133a393`, `bun run
scripts/release-smoke/ledger-check.ts` exited 1 with 68 problems. **FAIL**, not OK. A full audit
of current ledger status shows 22 todo, 3 doing and 5 owner-dependent entries before the
corrections below. The week-1/week-2 work is not all implemented or fully verified.

Corrected an ID collision: T33 was already the installers/channels feature, but had been reused
for the new SQLite advisory. Restored the original task by appending it and moved the advisory to
T11.b. Historical T33 advisory entries remain as a transparent record; they are not deleted.
Corrected LLM03's earlier stale "Verified" label while the recursive supply-chain scan is red.

Desktop dispatch 42895932985 on 895fd306: Linux/Windows x64 bundle jobs succeeded, but Flatpak
source build failed with `DNSResolveFailed`, Ubuntu 24.04 installed journey failed because the
engine still listened 15 seconds after app closure, and the overall run concluded cancelled.
The cause of the latter is not yet known; no unsupported flake diagnosis. PR run 42897513049 on
e551b234 has successful x64 bundle jobs but its overall journey gate has not completed.
Windows Preview Test 42897499989 completed successfully, but its installer job inspected only
artifacts actually present; that does not by itself establish the full §13 install/uninstall.

## Owner-authorized ledger reconciliation (2026-11-10)

Owner approved targeted repair and G1. The pre-repair ledger SHA-256 was
`88977fe9819a0d22758c64267db02dd661b41fa1433ac6e72110e02ef93e1324`; that
version remains in Git. Six specific historical lines missing `commits` were corrected by adding
an empty array; no other original fields were changed. All subsequent corrections use appended
records. Eight already-pushed nonconforming subjects map to exact full commit SHAs in the checker,
including the T33/T11.b collision. Every mapped commit still undergoes task-scope checking.
No Git history was rewritten. Evidence descriptions were preserved in notes and evidence file
paths point to retained excerpts or pre-existing logs. T05, T11, T11.a, T12, T13 and T14 were
reopened because the plan's actual acceptance remains incomplete.

Drift-check after reconciliation: `bun run scripts/release-smoke/ledger-check.ts` → exit 0,
63 tasks, 8 explicit legacy mappings. This is a reconciled pass, **not** a claim that all
historical subjects originally conformed. `bun test test/release/ledger-check.test.ts` → 6 pass,
0 fail, including negative tests for malformed entries, out-of-scope files, missing IDs, new
multi-ID subjects and absent evidence. These checks do not prove that each feature is complete.

## T11.b — SQLite dependency fix candidate (2026-11-10)

Read-only GitHub runner 42902810943 generated the lock with Cargo 1.99.1; artifact
13804585049 contains the candidate. It changes `rusqlite` 0.37.0 → 0.41.1,
`libsqlite3-sys` 0.35.0 → 0.39.1 and declared minimum Rust 1.77 → 1.89. Five added
crate-version checksums match the crates.io API. The generated lockfile uses format 4.
Local `osv-scanner -r --format table .` → exit 0 / No issues found, with 23 pre-existing
policy-filtered findings; `bun audit` → 0 root findings; `bun test test/supply-chain/` →
17 pass / 0 fail; `release:check`, `ci:policy` and `ownership:check` → exit 0. The temporary
read-only workflow is removed after retrieving the artifact. The fix is **not yet proven**:
native desktop builds/tests and the required Supply Chain gate must pass on the new commit.

Flatpak correction: its manifest explicitly states build-time sources are not vendored and
Flatpak builders have no network. DNS failure in the source build may reflect that structural
condition; do not label it merely transient without an offline-source fix and a passing build.

## LLM01 test correction

The original scripted provider always requested a shell command on turn two, regardless of
whether it had seen the poisoned file. That was not adequate evidence that the injection was
actually presented to the mock. The mock now checks for the injected instruction in its
conversation before simulating the request; a benign-file negative control proves it does not
request the command without the payload. `bun test test/security/llm01-injection-e2e.test.ts`
→ 5 pass / 0 fail; `bun test test/security/` → 382 pass / 0 fail. This is a scripted simulated
model, not evidence that a real model obeyed or resisted an injection. Web-page and MCP cases
and the remaining OWASP acceptance checks are still open.

## T12.a — smoke aggregate fail-open corrected

The parent runner ignored child exit status and treated missing counters as zero. A child that
crashed before its summary could therefore be masked by other successful suites. The runner now
fails on nonzero child exit or a missing/incomplete summary, while still reporting blocked checks.
`bun test test/release/smoke-runner.test.ts` → 6 pass / 0 fail (including exit-42 negative
controls); `bash scripts/release-smoke/run-all.sh` → 9 pass / 0 fail on Linux. A rerun on
Windows is still needed. This fix does not fill the separately missing per-feature WS3 coverage.

## Feature-label audit

The tier document had asserted voice and computer control were already labeled Experimental in
the product, without evidence of consistent in-app labels. Reclassified the table as proposed,
and added a candid Preview 1 status to the README. Fixture tests and mock integrations are not
real microphone, GUI, local-model or live messaging evidence. Owner tier decisions and in-app
label verification remain open; the docs task is doing, not done.

**Supply Chain CI:** run 42903110699 passed all jobs on SQLite-fix commit 43267857,
including recursive OSV and gitleaks. The native Rust checks on dispatch 42903107866 remain
in progress; its Flatpak source-build job failed. The newer branch tip needs its own CI evidence.
The existing README and CODING_CONTRACTS describe other unresolved boundary limitations
(filesystem authority, estimated spend and desktop pause); these require targeted code/test
review, not a blanket claim that all P1 work is closed.

**Native follow-up:** desktop dispatch 42903107866 on 43267857 reached the Linux Rust
lane; Clippy failed with `unnecessary_map_or` at `desktop/src-tauri/src/crash.rs:206` after
the declared MSRV rose to 1.89. Changed the expression to Clippy's equivalent `is_none_or`
(which is available under that MSRV). This is a candidate until the native CI rerun passes.

## T14 — earlier x64 artifacts inspected (not current-tip proof)

Downloaded Linux and Windows x64 artifacts from run 42897513049 on e551b234. The Linux
archive contains deb/rpm/AppImage; the deb metadata says version 1.2.0-preview.1, amd64, and
contains an x86-64 shell and engine. The extracted engine reported the expected version and
passed `scripts/smoke-sidecar.sh` with health and handshake. The Windows archive contains MSI
and NSIS installers; static `file` inspection identifies their installer formats. No Windows
install, execution, payload architecture, or signature was verified here. RPM and AppImage
were listed but not unpacked. Checksums and details: `preview1/evidence/T14-earlier-artifact-inspection.log`.
These artifacts predate the SQLite fix and cannot close the current candidate's gate.

**Latest CI follow-up:** on 43267857, Windows `cargo test` and sidecar smoke steps passed,
but the job was subsequently cancelled during cache cleanup; the Linux job failed its Clippy
step. The Clippy correction was committed as dfefcf3c. A fresh desktop dispatch 42904607032
on ddd97858 was queued. GitHub CI outcomes are commit-specific; do not promote partial job
steps or previous artifacts into a completed current-tip gate.

## Session continuation — drift-check OK; T20.a

Re-read plan §§1, 3 and 10. At 756c7703, the ledger checker passed with eight documented
legacy mappings. PR #210 already exists; no duplicate PR was opened. G3 approval is conditional
on verified readiness, so no releases or old release metadata were changed.

Core CI run 42904836734 failed one launcher test after the default 5-second timeout while
spawning Node; subsequent launcher tests found Node. The exact resource cause is not proven.
T20.a increases only that spawn-heavy test's budget to 20 seconds and includes the underlying
spawn error in diagnostics; assertions and no-retry policy are unchanged. Local targeted
launcher tests: 19 pass / 0 fail; full `test/cli/`: 262 pass / 0 fail. CI rerun pending.

## T33.a — Flatpak offline build candidate

Repeated dispatch failures showed the Flatpak build sandbox could not resolve package hosts;
the manifest had no vendored dependency sources. Added a staging script that makes a clean Git
archive, populates Bun caches from frozen lockfiles without lifecycle scripts, and asks Cargo
to vendor locked crates outside the sandbox. The manifest installs from those caches and builds
Cargo offline. No build-sandbox network permission was added. The pre-existing job-level
`continue-on-error` could hide failures, so it was removed; the job is now honestly gating.

Local evidence: frozen root and desktop Bun installs were reproduced from the staged cache
with `--offline` (82 and 457 packages); the staging guard rejects an existing directory; full
staging was rehearsed with **mocked Cargo**, not real Rust; Flatpak metadata tests 14/0,
desktop tests 492/0, ownership:check and ci:policy pass. Actual Cargo vendoring and Flatpak
build/install remain pending on GitHub Actions. This is not a Flathub source-manifest submission.

Desktop dispatch 42904607032 on ddd97858 now has both Linux Rust check/Clippy and Windows
Rust tests green on the SQLite upgrade; its earlier Flatpak build failed and bundle legs remain
in progress. Native job results do not replace a completed full desktop gate.

## Continuation checkpoint — drift-check OK (2026-11-10)

Re-read plan §§1, 3 and 10 and ran the ledger check: 66 tasks, eight exact-SHA
legacy mappings; all other commit subjects carry a known task ID. `f783d63f` pushed to
release/preview-1 under G1 and PR #210 remains open and unmerged. The original G3 approval
is conditional on all fixes and verification; neither publishing nor archiving was performed.

Dispatch 42904607032 passed Linux Rust check/Clippy and Windows Rust tests but its Flatpak
build failed and the bundle legs were cancelled. New dispatch 42907089739 on f783d63f is
pending; no real Cargo vendor or Flatpak build has yet validated the candidate. The prior
Ubuntu journey's 15-second containment failure remains unresolved. Source inspection shows
main-window close is intentionally intercepted and hides the app, whereas the WebDriver journey
uses session deletion then expects the engine to exit. This discrepancy is a possible cause,
not proof of the runner failure or proof that genuine app quit stops the engine. A proper quit
journey and its native result are still required; do not weaken the containment assertion.

Still open: current-tip CI and installer inspection; actual native desktop journeys and owner
Windows/manual checks; uncompleted Week 1/2 tasks, including Windows sandbox coverage and
OWASP web/MCP red-team cases; owner tier decisions; a capped live-provider key; and signing
preflight. Recommendation remains NO-GO.
