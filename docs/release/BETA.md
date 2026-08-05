# XR Public Beta — the feedback → acceptance loop (Phase 9 · T6)

XR 7.x is a **Public Beta**. This document defines what that label means, how
feedback moves, and when the label changes. The label itself is stamped from
`release.manifest.json` (`identity.stability`) — it cannot drift per-surface.

## What "Public Beta" commits us to (and what it does not)

- ✅ The golden path (install → first answer → restart → resume → second
  answer → uninstall) is measured nightly on Linux + container, and per-OS in
  cross-platform CI; the install-success metric (>99% target) is published per
  OS family as a nightly JSON artifact.
- ✅ Signed, verifiable releases through the documented channels.
- ❌ Not "stable/GA": APIs follow the versioning contract, but beta releases
  may fix forward faster than enterprise cadence.
- ❌ No enterprise identity/HA/remote execution (Phase 10 — see the
  known-limitations register).

## The prerelease channel

- Maintainer tags `vX.Y.Z-beta.N` → GitHub **prerelease** (flagged honest),
  npm **`beta` dist-tag** (`bun add -g @rrrtx/xr@beta`), Docker **`:beta`**
  image tag. `latest` never moves for a prerelease.
- Promotion: a `-beta.N` line graduates to `latest` only after the nightly
  golden path + beta survey have been green for the candidate.

## How feedback becomes work (the loop)

1. **Signal in** — Beta feedback issue template
   (`.github/ISSUE_TEMPLATE/beta_feedback.yml`): channel + OS + what you tried +
   effect vs expectation; a false-claim template for anything the docs say
   that isn't true (treated as a **defect class**, not a docs chore).
2. **Triage (weekly, owner: release eng)** — each issue becomes one of:
   `docs-fix` (claim was wrong → fix + claim-lint guard if mechanical),
   `defect` (repro → effect test), `support-matrix correction` (platform
   overclaimed), or `not-a-bug` (reason recorded on the issue).
3. **Acceptance** — defects ship in the next patch; a false-claim fix
   **must** add a guard (claim-lint pattern, parity exclusion removal, or a
   test) so it can't recur silently — same rule as every truth fix in this
   project.
4. **Metrics out** — per-OS install-success artifacts (nightly), golden-path
   results, and the first-task survey are the beta scoreboard. The
   known-limitations register is reviewed at every release; entries leave
   only with closing evidence.

## Exit criteria for the "Public Beta" label (promotion to 8.0)

- 4 consecutive weeks: install-success ≥ 99% and nightly golden path green on
  all three OS families.
- Zero open false-claim issues older than one release.
- The channel set in the support matrix marked live by the weekly real-install
  job.
- Phase-10 enterprise readiness starts (identity/operated controls) — the
  label never becomes "stable" before its exit gate.
