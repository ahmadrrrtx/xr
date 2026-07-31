# Branch protection and required status checks

**Status:** documented configuration — the repository settings themselves must be applied by an
account with admin rights on `ahmadrrrtx/xr`.

Branch protection is a **GitHub repository setting**, not a file in the repository. It cannot be
committed. This document therefore records the exact required configuration so it can be applied
and audited, and states plainly what is and is not in force.

---

## What CI already enforces

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) defines five jobs:

| Job | Command | Guards |
|---|---|---|
| `typecheck` | `bunx tsc --noEmit` | Static type safety |
| `truth-gate` | `release:check` + `claim-lint` | Version drift and unsupported public claims |
| `baseline` | `baseline:inventory` | Source-derived inventory regenerates |
| `test` | `bun test` | The full suite |
| **`quality-gate`** | aggregation | Fails if **any** of the above did not succeed |

`quality-gate` runs with `if: always()` and asserts every upstream result is `success`, so it is a
single check that cannot pass while anything else failed. **This is the check to mark as required.**

---

## Required configuration

Apply at **Settings → Branches → Add branch protection rule** for `main`:

- [ ] **Require a pull request before merging**
  - [ ] Require approvals: **1**
  - [ ] Dismiss stale pull request approvals when new commits are pushed
  - [ ] Require review from Code Owners — enforces [`CODEOWNERS`](../../CODEOWNERS)
- [ ] **Require status checks to pass before merging**
  - [ ] Require branches to be up to date before merging
  - [ ] Required check: **`Quality Gate`**
- [ ] **Require conversation resolution before merging**
- [ ] **Require linear history**
- [ ] **Do not allow bypassing the above settings** (applies rules to administrators)
- [ ] **Restrict force pushes** to `main`
- [ ] **Restrict deletions** of `main`

Equivalent via the GitHub CLI:

```bash
gh api -X PUT repos/ahmadrrrtx/xr/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Quality Gate"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true
  },
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "restrictions": null
}
JSON
```

---

## Current gaps (stated honestly)

Recording these rather than implying protection that may not be active:

1. **Branch protection cannot be verified from within the repository.** Nothing in this codebase can
   prove the settings above are applied. Treat the checklist as unverified until an admin confirms
   it in the repository settings UI.
2. **Single maintainer.** With one code owner, "require 1 approval" cannot be satisfied by the
   author's own PR without an additional reviewer. Until a second maintainer exists, either the
   approval requirement stays off (and `Quality Gate` is the real enforcement), or the maintainer
   uses a second account for review. The honest position is that **automated checks, not human
   review, are the enforcement mechanism today.**
3. **CI is Linux-only.** macOS and Windows are not verified. Cross-platform CI is deferred.
4. **No signed commits requirement.** Commit signing is not enforced, and no release artifact is
   signed. XR does not claim signed releases anywhere.

---

## Verifying the configuration

```bash
gh api repos/ahmadrrrtx/xr/branches/main/protection \
  --jq '{checks: .required_status_checks.contexts,
         admins: .enforce_admins.enabled,
         reviews: .required_pull_request_reviews.required_approving_review_count,
         linear: .required_linear_history.enabled,
         force: .allow_force_pushes.enabled}'
```

Expected:

```json
{ "checks": ["Quality Gate"], "admins": true, "reviews": 1, "linear": true, "force": false }
```

A `404` means no protection rule exists on `main`.
