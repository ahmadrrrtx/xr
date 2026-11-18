# XR private picomatch security patch

This is **not an upstream release** or upstream security certification.
The input is picomatch **4.0.7**, npm SRI verified against registry metadata,
Git tag/commit `6bb40679c218cefba5d4e9662408c5fdf699a8bb`.
`XR-PROVENANCE.json` records every upstream file and the exact local delta.
MIT license and original attribution are retained.

## Why a private fork

GHSA-fc5q-39xc-vjpf / CVE-2026-112366 affects every published picomatch
version through 4.0.7 in the reviewed advisory. Updating the label to 4.0.7
is not a fix. Upstream PR 194 explicitly leaves `+(*a)` exponential.
`@xr/picomatch-security@4.0.7-xr.2` is private/unpublished and identifies only
these locally reviewed bytes. It is not a fabricated registry release.
The provisional, never-published r1 patch was rejected after bounded children
exposed additional nested/quoted/brace/three-word ambiguity bypasses.

## Actual mitigation

Repeated `+(...)` / `*(...)` bodies are allowed only when the local analysis
can establish one of these deliberately narrow forms:

- A finite set of nonempty literal ASCII words, optionally wrapped in bounded
  `@(...)` unions. A bounded Sardinas–Patterson residual procedure establishes
  unique factorization of the **complete** codeword set. Pairwise prefix or
  commuting-word checks are insufficient: `aba = a.ba = ab.a` defeats them.
  Quotes/escapes are decoded conservatively; case-insensitive words are folded
  before analysis. Regex escapes and unsupported constructs are refused.
- Exactly one character class (including a POSIX class), consuming one code
  unit per iteration, with no hidden concatenation or nested quantifier.
- The upstream algebraic single-character star-sequence rewrite, preserving
  every branch, e.g. `*(*(a)*(b))` and `+(*(a)|*(b))` become `[ab]*`.

A wildcard star, ambiguous factorization, unsupported syntax or exhausted
analysis budget makes the **whole repeated extglob literal**, using the
existing parser's escaping path. No regex with that rejected repeated body
is emitted. Independent safety checks cannot be disabled by the legacy
`maxExtglobRecursion` option. Compile analysis is bounded to a 2,048-character
body, 64 alternatives, eight finite union wrappers and 32,768 residual steps;
exceeding a bound rejects, never assumes safety.

## Deliberate compatibility restriction, not a transparent drop-in

The unchanged upstream suite is **1,917 pass / 66 fail**, not fully green.
The 66 differences include conservatively unsupported nested repetitions and
negations which have **not** individually been proven vulnerable; they must
not all be described as unsafe patterns. Even explicit legacy unsafe-recursion
opt-outs are refused. See `XR-COMPATIBILITY.md` and the complete machine-readable
`XR-COMPATIBILITY-RESULTS.json`. No upstream expectation was deleted/rewritten.

Ordinary globs, fixed-word extglobs, uniquely decodable overlaps (`js|jsx`,
`fo|foo`), standalone classes and safe flattening remain tested. Consumers must
pass their actual API/lint/build/packaging checks before this override is
qualified. A registry scanner returning zero cannot waive that requirement.
This is not an all-pattern ReDoS proof: raw regexes, interactions between
separate pattern components and framework-embedded copies remain outside it.
Do not admit arbitrary untrusted glob/regex syntax without additional syntax
and length restrictions or bounded workers/non-backtracking matching.

## Verification and inventory

- Tests assert literalized regex source **before** potentially adversarial
  matching. Real Node child processes then have hard deadlines for 50,000-byte
  nonmatches, including all five bypasses and a safe overlapping-word case.
  Small finite codebooks also receive an independent collision enumeration.
- All six manifests and nine npm/Bun lock graphs resolve one reproducible,
  integrity-pinned local tarball. Source/provenance/graph tests and actual
  installed-byte checks are mandatory alongside unchanged OSV/raw registry
  scans. The SBOM names the real private identity, local version and SRI.
- Next's internal compiled matcher is outside package-manager overrides and
  remains **unpatched**. Its inventory and narrowly reviewed configuration
  exposure are separate; no all-copies-fixed claim is made.

Owner: release/supply-chain maintainers. Retire for a genuine upstream fix
only after adversarial, compatibility, clean frozen install and full applicable
native/CI qualification; review no later than **2026-12-16**. No new advisory
ignore, signing, publication or production-readiness claim is authorized.
