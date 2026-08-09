# Remote Hygiene — Branch Retirement Runbook (R-7 / audit A-16)

**Prepared:** 2026-08-08 · **Survey basis:** fresh `git fetch origin --prune`
against `origin/main` (tip `9f5840c` — note: the launch branch
`chore/xr-launch-cleanup` adds the launch program on top; it retires into
main at merge time just like the branches below).
**Status:** analysis + runbook **complete**; execution is maintainer-owned
(it needs the same push credentials as the F-3 publish — nothing here was
executed from the engineering sandbox).

Audit A-16's observation: ~697 commits worth of history, one human founder +
AI coding agents, **33 long-lived remote branches, most merged**. This
document turns that observation into a review-proof retirement list: every
branch is classified against ancestry, never by name or age.

---

## 1. Survey result (31 tracked remote branches + tags)

| Class | Count | Verdict |
|---|---|---|
| **Fully merged into `main`** (0 unique commits, ancestor of main tip) | **30** | **Safe to delete — byte-for-byte nothing is lost** |
| Unmerged (unique commits not on main) | **1** (`feature/phase12-enterprise-trust-and-operations`) | Maintainer review — §3 |
| Tags | `v3.0.0` `v4.3.0` `v4.5.0` `v7.0.0` `backup-before-agent` | Keep (tags are the recoverability net) |

Classification command (re-run before acting — the remote may have moved):

```bash
git fetch origin --prune
for b in $(git branch -r --format='%(refname:short)' | grep -v 'origin/main$'); do
  if git merge-base --is-ancestor "$b" origin/main; then echo "MERGED   $b"; else echo "UNMERGED $b  (+$(git rev-list --count origin/main.."$b") unique)"; fi
done
```

## 2. The 30 safe-retire branches

Every one of these satisfies `git merge-base --is-ancestor <b> origin/main`
with **zero** commits of its own (`git rev-list origin/main..<b>` is empty).
Evidence snapshot from the 2026-08-08 survey (last-commit dates 2026-07-22 →
2026-08-06):

```
ahmadrrrtx-patch-1..5                                  (5 web-editor patch branches)
fix/phase0-ci-doctor-json                              fix/timeout-test-threshold
fix/phase4-ci-round3
phase-0/truth-and-foundation-reset                     phase-1/reliability-persistence-core
phase-2/architecture-simplification                    phase0/xr-3.1.6-baseline-integrity
phase1/runtime-kernel                                  phase3/perf-runtime
phase3/trust-and-isolation                             phase4/durable-agency
phase4/security-trust-hardening                        phase5/universal-intelligence-plane
phase6/knowledge-and-context-os                        phase7/agent-and-workflow-os
phase8/environment-interaction-os                      phase9-xr-5.2-capability-ecosystem
feat/phase5-routing-quality                            feat/phase6-context-quality
feat/phase7-capability-ecosystem                       feat/phase8-ux-a11y-observability-dx
feat/phase9-packaging-release                          feat/phase10-enterprise-readiness
feature/phase2-security-hardening                      feature/phase-11-local-cloud-hybrid-operating-plane
feature/phase-12-enterprise-trust-and-operationss      (merged twin — note the double-s typo)
```

Execute (maintainer, with push credentials):

```bash
# NOTE: run the §1 classification command FIRST and treat its output as the
# list — this block mirrors the 2026-08-08 snapshot, not a live measurement.
git push origin --delete \
  ahmadrrrtx-patch-1 ahmadrrrtx-patch-2 ahmadrrrtx-patch-3 ahmadrrrtx-patch-4 ahmadrrrtx-patch-5 \
  fix/phase0-ci-doctor-json fix/timeout-test-threshold fix/phase4-ci-round3 \
  phase-0/truth-and-foundation-reset phase-1/reliability-persistence-core \
  phase-2/architecture-simplification phase0/xr-3.1.6-baseline-integrity \
  phase1/runtime-kernel phase3/perf-runtime phase3/trust-and-isolation \
  phase4/durable-agency phase4/security-trust-hardening \
  phase5/universal-intelligence-plane phase6/knowledge-and-context-os \
  phase7/agent-and-workflow-os phase8/environment-interaction-os \
  phase9-xr-5.2-capability-ecosystem feat/phase5-routing-quality \
  feat/phase6-context-quality feat/phase7-capability-ecosystem \
  feat/phase8-ux-a11y-observability-dx feat/phase9-packaging-release \
  feat/phase10-enterprise-readiness feature/phase2-security-hardening \
  feature/phase-11-local-cloud-hybrid-operating-plane \
  feature/phase-12-enterprise-trust-and-operationss

# Verify afterwards — expect only main + §3's review branch (+ this launch branch):
git ls-remote --heads origin
```

Even if the verification step is skipped, **the deletion list carries zero
content risk**: every listed ref is reachable from `main` after the launch
branch merges, and the tags remain.

## 3. The one unmerged branch — review before dropping

`feature/phase12-enterprise-trust-and-operations` — 8 unique commits,
~6,916 insertions across 26 files, last commit 2026-07-28. Its history:

- `feat: XR 6.1 — Enterprise Trust and Operations (Phase 12)` + 7 CI/type
  fix commits (incl. two "force-push corrected" messages).
- **Superseded in practice:** the twin branch
  `feature/phase-12-enterprise-trust-and-operationss` (double-s) holding the
  same campaign **is fully merged** and its substance lives on main (the
  enterprise module, disclosure machinery in `src/commands/environment.ts` /
  `src/config/config.ts` / CLI surfaces). This unmerged ref is the earlier,
  divergent attempt (`git cherry` shows no patch-equivalence because main
  received the campaign via the twin and later phases rebuilt on top).
- Heads-up artifact: its headline file `src/enterprise/vulnerability-disclosure.ts`
  does **not** exist on main; the disclosure concern area exists under
  different file layout. If anything from the branch is still wanted, it is
  that feature — inspect with:

```bash
git log --oneline origin/main..origin/feature/phase12-enterprise-trust-and-operations
git diff origin/main...origin/feature/phase12-enterprise-trust-and-operations -- src/enterprise/vulnerability-disclosure.ts | less
```

**Recommended action:** archive-then-delete — push an archival tag pointing
at its tip (recoverability identical to a branch, sorted out of the branch
list), then delete the branch:

```bash
git fetch origin feature/phase12-enterprise-trust-and-operations
git tag archive/btn-phase12-enterprise-trust origin/feature/phase12-enterprise-trust-and-operations
git push origin archive/btn-phase12-enterprise-trust
git push origin --delete feature/phase12-enterprise-trust-and-operations
```

## 4. Keep it from re-filling (settings, one-time)

1. Repo settings → General → **Automatically delete head branches** (merged
   PR branches delete themselves — exactly the pile A-16 observed).
2. Branch protection on `main`: require PR + status checks (`ci`), restrict
   pushes, keep linear history (the squash-merge pattern this campaign used
   is what made 30/31 branches trivially safe to retire).
3. Optional: stale-branch reminder bot (monthly) instead of manual surveys.

## 5. What was NOT done

- No branch was deleted, retagged, or pushed — this sandbox has no push
  credentials by design. The F-3 publish (`LAUNCH_HANDOFF.md`) and this
  runbook share the same credential gate; doing both in the same maintainer
  session costs one login.
- The `backup-before-agent` tag is untouched (pre-dates the agent-era
  rebase; harmless, recoverability-positive).
