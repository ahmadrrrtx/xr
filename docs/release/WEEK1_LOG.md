# XR Preview 1 — Week 1 Log

Plan: `XR Release Plan Agent Brief and Master Plan.md` (v2, 10 Nov 2026).
Branch: `release/preview-1` · Base commit: `1834fd16cecc18997d94764603fdceb16fcea89b`
Release identity target: XR Preview 1 — `0.1.0-preview.1`, tag `v0.1.0-preview.1`.

Status vocabulary: **PASS / FAIL / BLOCKED / NOT RUN** (evidence = exact command + output excerpt).
A BLOCKED or NOT RUN item is never reported as PASS.

---

## Day 1 — 2026-11-10 (Phase 0)

### Drift-check: OK

- Plan sections 1, 3, 10 re-read. Scope = sections 3, 4, 5, 6, 10 only.
- `bun run scripts/release-smoke/ledger-check.ts` → `LEDGER OK - 52 tasks (todo=49, needs_owner=3)`.
- Ledger v1 frozen at sha256 `7621a128995b51fa0ec63c95fc6b4c9293ffccf96d09c90c55562e02e3b5fcdd` (53 lines, 1 header + 52 tasks).

### Done

| # | Item | Evidence |
|---|---|---|
| 1 | Environment brought up: Bun `1.4.4`, Node `v20.20.2`, 4 GB swap added, `NODE_OPTIONS=--max-old-space-size=1400` | `bun --version`; `free -h` shows `Swap: 4.0Gi` |
| 2 | Clone + dependency install | `git clone` OK; `bun install --frozen-lockfile` → `82 packages installed [786.00ms]` |
| 3 | Base commit recorded | `BASE_SHA=1834fd16cecc18997d94764603fdceb16fcea89b`, branch `main`, tip `2026-11-09 22:33:15 +0500` |
| 4 | Ledger v1 + ledger check written | 52 tasks seeded from sections 3,4,5,6,13 (T01–T09 defects, T10–T17 workstreams, T20–T33 features, T40–T50 OWASP, T60–T66 Windows, T70–T72 owner items) |
| 5 | Root typecheck baseline | `npx tsc --noEmit` → `EXIT=0` (clean, matches the plan's claim) |
| 6 | D1 reproduced | `src/execution/workflow/engine.ts:1099` — `new Function("ctx", ...)` confirmed present, host realm, input = `c.expression` |

### Verified claims vs. reality (section 2 cross-check)

- **Confirmed:** repo size/scale, `bun install --frozen-lockfile` works, root `tsc --noEmit` clean, `release.manifest.json` says `1.1.1-rc.1` + `publicVersion 1.0.0` + `withdrawnTags: [v1.1.0]`, D1 code is exactly where the plan says.
- **Correction to the plan (FACT → GitHub API, 2026-11-10):** the plan says tag `v1.1.0` "was withdrawn after its CI gate failed". The manifest agrees (never published to channels), **but the GitHub release `v1.1.0` exists and is marked `prerelease=false`** — i.e. published as a normal release with 5 desktop assets. This is a live false signal to users today and belongs to T04/D4 (fix at G3, per D4: mark it `prerelease` with a Legacy note; no tag deletion).
- **Additional finding:** tags `v3.0.0`, `v4.3.0`, `v4.5.0`, `v7.0.0` exist with **no** GitHub release, while `docs/release/` carries `3.1.6`, `4.0`, `7.0.1` records. Release identity is more tangled than section 2 states. Feeds T04.
- **npm: NOT RUN** — `npm view @rrrtx/xr versions dist-tags` is a D4 precondition and is not yet executed.

### In progress

- T10 (Phase 0 close-out: ledger negative tests + first commit).

### Blocked

| Item | Why | Who can unblock |
|---|---|---|
| `GITHUB_TOKEN` (T70) | **Not present in the environment.** Anonymous clone/read works (repo is public, HTTP 200), so all Stage-1 local work proceeds. G1 (push + workflow dispatch) and section 13 Windows evidence **cannot** run without it. | Owner: export `GITHUB_TOKEN` with `repo` + `workflow` scope |
| Real-provider tests (T07, T21, T72) | No provider key in env (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, … all unset) | Owner: one capped key |
| Windows evidence (T60–T66) | Needs GitHub-hosted Windows runners → needs G1 → needs the token | Owner |
| macOS / code-signing / microphone / real-GPU | No such hardware here | Owner |

### Risks

1. **Token absent at Day 1** — the G1 gate (scheduled end of Day 3) cannot be executed unless it arrives. Local work continues; CI-dependent scope (T06, T60–T66, Windows/macOS claims) stays BLOCKED until then.
2. **2 GB RAM** — root `tsc` peaks near 1 GB. Full `bun test` must run per directory, one at a time. Baseline test run is the next heavy step.
3. **D4 identity churn (T04)** is capped at half a day. The extra tags found above may lengthen it; fallback is `1.2.0-preview.1` per section 3/D4.

### Next

- Finish T10 (negative tests for the checker, commit `[T10]`).
- WS1 baseline: per-directory `bun test` with logs → record passes/failures/skips.
- T01 (D1, P0): replace `new Function` with a restricted parser + hostile-payload tests.
