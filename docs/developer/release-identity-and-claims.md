# Release identity and claim governance

**Audience:** contributors and maintainers
**Applies to:** XR 7.0.1 and later

This document explains the two pieces of machinery that keep XR's public statements true: the
**release manifest** (one source of truth for version identity) and the **claim linter** (CI gate
that fails on any unsupported claim).

---

## Why this exists

XR previously shipped four different versions of itself simultaneously:

| Surface | Claimed version |
|---|---|
| `src/core/version.ts` | 7.0.0 |
| `package.json` | 7.0.0 |
| `README.md` | 3.1.6 — *described as "canonical from `src/core/version.ts`"* |
| `install.sh` / `install.ps1` | 1.0.0 |

The README's claim was self-refuting: it cited the very file that contradicted it.

Critically, **a version-sync CI job already existed and was green**. It stamped three surfaces
(`package.json` → `version.ts` → `website/src/lib/site.ts`) and simply did not know about the README
or the installers. A gate is only as strong as its coverage, so the fix widens what is checked
rather than adding another gate beside it.

---

## The release manifest

[`release.manifest.json`](../../release.manifest.json) at the repository root owns release identity
and every public claim.

```jsonc
{
  "identity": {
    "name": "@rrrtx/xr",
    "version": "7.0.1",
    "codename": "Truth",
    "description": "...",
    "repo": "...", "homepage": "...", "npm": "..."
  },
  "stampTargets": [ /* every surface derived from identity */ ],
  "claims": [ /* evidenced public claims */ ],
  "prohibitedClaims": [ /* patterns that fail the build outright */ ],
  "supervisedTerms": [ /* words that require backing */ ],
  "scannedSurfaces": [ /* where the linter looks */ ]
}
```

### Stamped surfaces

`stampTargets` declares what is generated, and each entry has a `kind` that selects the rewrite
strategy:

| `kind` | Target | Strategy |
|---|---|---|
| `json-version` | `package.json` | Rewrites identity fields, preserves everything else |
| `generated-module` | `src/core/version.ts` | Fully regenerated |
| `site-identity` | `website/src/lib/site.ts` | **Surgical field update** — nav/footer structure is preserved |
| `marker-block` | `README.md` | Replaces the block between the `XR:RELEASE-IDENTITY` markers |
| `shell-var` | `install.sh` | Rewrites `VERSION="…"` |
| `powershell-var` | `install.ps1` | Rewrites `$Version = '…'` |

Two of these deserve a note:

- **`site-identity` is surgical, not generative.** The website's `site` object also carries
  navigation and footer structure that is not release identity. Regenerating the file would delete
  it, which would be a silent break (Article XXIII). Only the release-owned scalars are rewritten.
- **A missing declared target is itself a failure.** `release:check` fails if a `stampTargets` entry
  points at a file that does not exist, so coverage cannot silently shrink.

### Commands

```bash
bun run release:stamp     # rewrite every surface from the manifest
bun run release:check     # CI gate: fail on any drift
bun run scripts/release-manifest.ts --print   # resolved identity as JSON
```

### Cutting a release

1. Edit `identity.version` (and `codename` if changing) in `release.manifest.json`.
2. `bun run release:stamp`
3. `bun run ci`
4. Commit the manifest **and** the stamped surfaces together.

Never hand-edit a stamped file. The next stamp reverts it, and `release:check` fails meanwhile.

---

## The claim linter

`bun run claim-lint` runs four independent gates. Any one of them fails the build.

### Gate 1 — version drift

Delegates to `evaluateSurfaces()`, so the linter and the stamper can never disagree about what
"in sync" means.

### Gate 2 — prohibited claims

Patterns in `prohibitedClaims` fail on sight, each with a stated reason:

| Pattern | Why |
|---|---|
| `SOC 2`, `ISO 27001`, `HIPAA`, `PCI-DSS`, `FedRAMP` | XR holds no such audit or certification |
| `12,000+ skills` | The repository ships 65 |
| `Rust core` | XR is TypeScript on Bun; there is no Rust |
| `74k` | Fabricated star count |
| `kernel-level isolation` | XR enforces in-process policy, not kernel isolation |
| `unhackable`, `100% secure`, `military-grade` | Not evidenceable |

### Gate 3 — evidence and expiry

Every entry in `claims[]` must have a non-empty `evidence` pointer and a future `expires` date. A
claim that outlives its proof fails the build, which forces periodic re-verification instead of
permanent drift.

Claims may also be **mechanically verified**:

```jsonc
{
  "id": "skills-count",
  "text": "65 bundled skills.",
  "evidence": "Directory count of skills/ — verified mechanically by scripts/claim-lint.ts",
  "expires": "2027-07-31",
  "mechanical": { "kind": "skill-count", "value": 65 }
}
```

The linter counts `skills/` and fails if reality disagrees. Prefer this whenever a claim is
countable: a cited number can go stale, a counted one cannot.

### Gate 4 — supervised terms

`certified`, `enterprise-grade`, `fully supported`, `production-ready`, `complete` and `guaranteed`
require a matching evidenced claim. This implements Article XXII.4 ("no release label without
evidence").

Two deliberate exemptions keep the gate credible rather than annoying:

- **Disclaimers pass.** A line that explicitly denies a term — "XR is **not** SOC 2 certified" — is
  honesty, not a claim. Detected by `DISCLAIMER_MARKERS`.
- **Action completion passes.** "bootstrap complete", "migration complete", "done in 3 steps" report
  that a real action finished, which is exactly what Commandment 2 asks software to do. Detected by
  `ACTION_COMPLETION`. Anything describing *XR itself* as complete still fails.

A linter that cries wolf gets ignored, and an ignored linter governs nothing.

### Escape hatch

For a genuinely justified edge case, add `xr-claim-lint-allow` to the line. Use it rarely, and
explain why in the PR — reviewers will ask.

---

## Adding a public claim

1. Add the claim to `release.manifest.json` with real evidence and an expiry:

```jsonc
{
  "id": "my-capability",
  "text": "XR does X.",
  "evidence": "src/path/to/implementation.ts; proven by test/path/to/proof.test.ts",
  "expires": "2027-07-31"
}
```

2. Point `evidence` at code and a **test**, not at prose. "It is documented in the README" is not
   evidence; a passing test is.

3. Run `bun run claim-lint`.

4. If the claim is countable, add a `mechanical` block.

---

## CI wiring

The `truth-gate` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs both
checks and feeds the `quality-gate` aggregation job, which is the single required status check for
branch protection:

```yaml
truth-gate:
  name: Truth gate (release:check + claim-lint)
  steps:
    - run: bun run release:check
    - run: bun run claim-lint
```

Neither script needs `bun install` — both use only Node builtins, so the gate stays fast and cannot
be broken by a dependency problem.
