# XR-P00 r2 — Supplement 01: push, PR and hosted-CI evidence (2026-11-01)

**Executor status remains `IMPLEMENTATION_REPORTED`.** This supplement records
only what changed after the owner authorized pushing the branch:
`XR-P00-report-r2.md` stands unmodified as the local-execution record.
**Nothing in this supplement was allowed to widen scope:** fixes were made
only where hosted CI failed inside XR-P00's own surfaces (`ci.yml` steps,
the new test, plan docs).

Owner authorization (quoted, abbreviated for the credential): “use that token
to push branch carefully … verify create pull request and watch ci … fix
error and make it green if it meant to be only according to scope and write
final report”. The credential was used from a `0600` file outside the repo,
never written into the repo, remote URL, logs, or this report (verified by
scan, below), and is to be **revoked/rotated by the owner** (it transited a
chat transcript).

## 1. Push and PR (verified)

| Item | Evidence |
|---|---|
| Token identity | `GET /user` → login `ahmadrrrtx`; repo `permissions.admin=true`; scopes include `repo`, `workflow` |
| Branch pushed | `phase/P00-governance-substrate` only (new branch, fast-forward from `230ad998`); `main` verified unchanged at `230ad998` before and after |
| PR | **#206** — `https://github.com/ahmadrrrtx/xr/pull/206` (`base 230ad998`, open, not draft, **not merged by executor**) |
| Ruleset / branch protection | **not modified** (owner authorized push+PR only; §4.1 remains `BLOCKED — OWNER ACTION`, payload in main report §16) |

## 2. Hosted CI, attempt 1 (head `4be679e4`) — FAILURE, in-scope, fixed

Runs: CI `41334591609`, Cross-Platform `41334591789`, +6 more.
Outcome: `Truth gate` **success** (the four new gate steps passed on the
hosted runner on the first attempt), but `Typecheck` **failure** on every OS →
`Quality Gate` failure. Job log, one line:

```
test/architecture/gate-enforcement.test.ts(276,71): error TS2304: Cannot find name 'token'.
```

Root cause (executor's): the `token`→`scriptName` rename in the new test
(performed after the local gate battery, followed locally only by `bun test`,
which does not type-check) missed one interpolation in a rarely-executed
branch. Local `typecheck` evidence in the main report predated that rename.
Fix — commit `761df3df` (`test(architecture): fix missed rename…`, 1 line);
locally re-verified before pushing: `bun run typecheck EXIT=0`, gate test
`EXIT=0`, plus a synthetic bogus-script negative exercising the repaired
branch at runtime (`EXIT=1` with the intended violation message, restored).

## 3. Hosted CI, attempt 2 (head `761df3df`) — Quality Gate GREEN

8 workflows ran for the PR. 83 check-runs on the head commit.

| Workflow (run id) | Conclusion |
|---|---|
| CI (`41336067231`) | **success** — incl. `Quality Gate` **success**; `Truth gate` steps 9-12 = `Gate placeholder-lint (XR-P00)`, `Gate desktop:sink-lint (XR-P00)`, `Gate ci-capability-gate (XR-P00)`, `Gate website:marketplace:check (XR-P00)` all **success**; `Workflow lint (actionlint + shellcheck)` success; all 19 CI jobs success |
| Cross-Platform CI (`41336067349`) | **success** — Linux/macOS/Windows full parity incl. typecheck; `Cross-Platform gate` success (new test therefore green on all three OSes, closing main-report §12.3) |
| Supply Chain (`41336067239`) | **success** (`Supply Chain gate` success; gitleaks success over this diff) |
| Channel Install Tests (`41336067230`) | **success** |
| npm Pack Smoke (`41336067266`) | **success** |
| Workflow Audit (non-gating) (`41336067242`) | **success** |
| Clean-Machine Journey (`41336067235`) | **cancelled** — two `macos-14` legs cancelled; `CLI journey — binary on macos-15-intel` failure at step `Upload journey evidence`; aggregate then failure. Journey code untouched by this PR; same cancellation pattern observed on `main@230ad998` before this branch existed. **Not fixed (XR-P09 scope).** |
| Desktop App (`41336067256`) | **cancelled** after all bundle/journey jobs listed as success except `Desktop journey — darwin-arm64 on macos-14` cancelled; aggregates (`Desktop native validation`, `Desktop gate`) failure as a consequence. Desktop code untouched; same cancellation on `main@230ad998`. **Not fixed (XR-P09 scope).** |

PR state after attempt 2: `mergeable: true`, `mergeable_state: unstable`
(GitHub's label while non-required checks are unsuccessful/cancelled — the
only *required* context, `Quality Gate`, is green). The executor did not
merge, approve, or modify any settings.

## 4. Updated acceptance view (supplements main report §8; deltas only)

| ID | Was | Now | Why |
|---|---|---|---|
| AC3 | PASS (remote NOT RUN) | **PASS (remote-proven)** | Named steps + Quality Gate success on hosted runner (§3) |
| AC5 | FAIL | **FAIL unchanged** | Local `bun run ci` still cannot exit 0: monolith OOM in 1.9 GiB **and** `changelog:check` EXIT=1 (D-020 owner decision). Hosted CI (the lane Quality Gate names) is green; that does not rewrite the local battery result |
| AC2 | BLOCKED | **BLOCKED unchanged** | PR#206 itself being un-merged-with-green-Quality-Gate proves the PR path exists, but the specified negative proof (deliberately-red scratch PR merge attempt) was outside the owner's push/PR instruction and was not performed; E-33 remains the historical GH013 evidence |
| AC1, AC4 | BLOCKED | **BLOCKED unchanged** | No settings changed; D-020 undecided (main report §16) |

## 5. Security closure for this step

- Credential lived only at a `0600` path under `/tmp`, was passed to git via
  an ephemeral credential-helper closure, and has been deleted from the
  executor environment at the end of this step.
- Worktree scan for the credential value across the repo (value never
  printed): **0 hits**; remote URL contains no credential; no commit, PR
  body, report, or log in the repo contains it. Hosted `Secret scan
  (gitleaks)` check on the PR head: **success**.
- Still required from the owner: **revoke/rotate the pasted token** — chat
  transcripts are not a secret store.

## 6. What remains

Plan Owner: `REVIEW PHASE REPORT XR-P00` (this PR + both reports). Owner:
§4.1 payload (main report §16.1), D-020 decision (§16.2), token rotation.
XR-P09 owns the Journey/Desktop `macos-14` cancellation + evidence-upload
failures recorded in §3. The docs-only commit carrying this supplement is
itself subject to `Quality Gate`; its run id/conclusion are recorded in the
executor's final chat report and on PR #206 (a file cannot cite its own
commit's CI).

*End of supplement 01. Executor status: `IMPLEMENTATION_REPORTED`.*
