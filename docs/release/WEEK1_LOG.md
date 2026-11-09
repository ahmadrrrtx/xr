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

---

## Ledger hash history

| When | sha256 | Note |
|---|---|---|
| v1 (frozen) | `7621a128995b51fa0ec63c95fc6b4c9293ffccf96d09c90c55562e02e3b5fcdd` | 53 lines, 1 header + 52 tasks |
| after Day 1 | see `sha256sum docs/release/preview1/ledger.jsonl` | append-only; ts normalised once because the v1 header was anchored at `2026-11-10T00:00:00Z` (owner-local date) while the container clock is still `2026-11-09` UTC, which made every append look like it preceded the header |
