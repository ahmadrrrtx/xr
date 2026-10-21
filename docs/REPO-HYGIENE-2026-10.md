# Repository hygiene pass — 2026-10-21 (evidence log)

One-time professionalization of the repository surface. Every deletion/move below was
classified by evidence first; nothing was removed blindly. Complaints restore: any deleted
branch is recoverable from `main`'s history or from merge `refs/pull/*/head` while retained.

## 1. Branches (remote)

Classified against `main` with `git merge-base --is-ancestor` and `git cherry` (patch
equivalence) on a full clone at `8f661ab7`:

| Class | Count | Rule |
|---|---|---|
| Ancestor of main (0 unique commits) | 141 | Released: tip is merged history — deleting loses nothing |
| Patch-equivalent (unique commits, same patches as main) | 4 | Same: `fix/consumer-smoke-async-spawn`, `hamd/phase-3-artifact-truth`, `phase/26-discord-surface`, `phase10/production-cert` |
| Branch with real unmerged commits | 9 | **Kept — owner decision required** (list below) |
| Operational | 3 | Kept: `main`, `launch-audit/docs-final` (open PR), `launch-audit/ship-readiness` (merge source, delete once PR #191 merges) |

The 9 branches with real unmerged work — reviewed by hand, all small:

| Branch | Unique commits | Tip date | What it contains |
|---|---|---|---|
| `feature/phase12-enterprise-trust-and-operations` | 8 | 2026-07-28 | enterprise-module generic fixes |
| `feat/v2-operator-phase2` | 7 | 2026-09-22 | stop-button / operator control UI tweaks |
| `phase/26-discord` | 4 | 2026-10-11 | discord windows-mode fix + follow-ups |
| `phase/26-discord-whatsapp` | 2 | 2026-10-10 | bot runtime guarantee tests |
| `phase/30-business` | 1 | 2026-10-14 | docs: PR-body CI-failure record |
| `sec06-win32-fix` | 2 | 2026-09-20 | real-device-matrix setup-bun owner fix |
| `phase2/elite-workstation` | 1 | 2026-09-20 | win32 control-channel close fix |
| `win-portable-fix` | 1 | 2026-09-20 | portable artifact = real zip |
| `stage-2` | 1 | 2026-10-20 | XR_FIX_TRACKER stage-completion update — **its content was adopted into main in this pass** (docs/audits/XR_FIX_TRACKER.md); branch now fully redundant but kept for owner review |

Recommendation: after reviewing, merge or close the 8 stale work branches; `stage-2` and the
two `launch-audit/*` branches are deletable once PR #191 lands.

## 2. Repo-surface moves (this pass)

| From | To | Why |
|---|---|---|
| `HANDOFF_PHASE_2.{1,2,3,4,4_DESIGN,5}.md` | `docs/audits/handoffs/` | Stage handoffs = audit evidence, not product docs; root stays first-impression clean |
| `XR_FIX_TRACKER.md` | `docs/audits/` (+ adopted the completed content from `stage-2`) | Same; it was the working tracker of the Oct-17..20 public-truth + fail-closed runtime stages |

References updated (`docs/release/RELEASING.md`, `scripts/claim-lint.ts` comment, tracker header
note). No code, tests, gates, or workflows referenced these paths,

## 3. Added / rewritten

| Item | |
|---|---|
| `README.md` | Rewritten: photos of the real UI, factual corrections found during verification (6 native adapters incl. Cerebras — was "five"; 6+source binary matrix — was "5 targets"; v1.1.0's actual 5 desktop assets vs the "21 signed" v1.0.0 set), machine-gated blocks preserved verbatim |
| `README-{es,ur,fr,de,pt-BR,zh-CN,ja,hi}.md` | Full translations of the new English README; English remains the source of truth |
| `AGENTS.md` | agents.md-convention briefing (setup, gates, hard rules) |
| This document | Evidence for every delete/move |

## 4. Looked at, deliberately NOT touched

| Candidate | Size | Why kept |
|---|---|---|
| `previews/` PNG archive | 65 MB, 268 images | Tracked design/UX history referenced by 4 docs; deleting the working tree does not shrink history (a history rewrite was judged out of scope). New README reuses two files from it as real UI screenshots. |
| `docs/historical/` | 184 files | Archived history, already properly hidden behind a directory |
| Tag `backup-before-agent` | — | Pre-agent safety net; costs nothing |
| `satellites/`, `mobile/`, `cloud/`, `website/` | — | Real products with their own versions/docs — explicitly out of scope for deletion |
| `docs/phases/` (57), `docs/xr-3.1/`, `docs/xr-rebuild/` | — | Development records referenced by ADRs/CHANGELOG |
