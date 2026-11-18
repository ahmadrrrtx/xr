# Local patch review: compatibility and scanner boundaries

## Reproducible upstream comparison — not a full upstream-suite pass

Upstream input: commit `6bb40679c218cefba5d4e9662408c5fdf699a8bb`,
source archive SHA-256
`e279e77320873e51b444f121081e717444732250a8ab316ff7545017ce15813a`.
The unchanged 37-file Mocha suite has 1,983 tests in 131 suites.
Review environment: Mocha 10.8.2, fill-range 7.1.1, Node 20.20.2, Linux x64.
Original archives, checksums and full JSON accompany the qualification evidence.

| Variant | Unchanged upstream expectations | Disposition |
|---|---|---|
| Upstream 4.0.7 | 1,983 pass / 0 fail | Vulnerable baseline |
| Initial broad prefix guard | 1,969 pass / 14 fail | Rejected; broke ordinary safe overlaps |
| Provisional commuting-word/wildcard r1 | 1,979 pass / 4 fail | Rejected; five additional bypasses time out in isolated Node children |
| Provisional literal-only r2 | 1,883 pass / 100 fail | Rejected; unnecessarily refused standalone classes and finite wrappers |
| Conservative r2 with classes/finite unions | **1,917 pass / 66 fail** | Candidate only; requires actual consumer and release gates |

The 66 remaining differences are completely listed in
`XR-COMPATIBILITY-RESULTS.json`, tied to the parser SHA-256. They include:

- Repeated nested negations such as `*(!(foo))` and `+(!(f))`.
- Nested repetitions such as `*(f*(o))`, `*(of+(o))`, `*(f*(o)x)` and deeper
  compositions, including variants embedded in larger patterns.
- Mixed nested alternation/optional constructs not covered by the finite
  literal-word proof, and a malformed-bracket expectation.
- The original repeated-wildcard cases, and explicit recursion opt-outs which
  previously re-enabled unsafe expressions. Settings cannot disable this fix.

**Not every conservatively refused pattern has been proven vulnerable.** Some
are safe but outside the supported proof language. This is a real compatibility
restriction, not a transparent replacement or a fully green upstream test run.
No expectation was deleted/rewritten, and these differences cannot excuse a
failing actual application API, lint, build, test or packaging gate.

Safe ordinary globs, fixed extglobs, `js|jsx`, `fo|foo`, standalone/POSIX classes,
finite `@(...)` unions, escaped/quoted stars and upstream character-class
flattening are tested independently. The five reproduced bypasses are nested
plus, wrapped ambiguity, brace ambiguity, quoted ambiguity and the three-word
`a|ab|ba` code. Pairwise overlap checks alone were insufficient.

This does not certify raw-regex options, interactions between separate pattern
components, every possible glob, or framework-embedded copies. Arbitrary
attacker-provided expressions require further syntax/length restrictions or a
bounded worker/non-backtracking matcher.

## All affected package-manager graphs, not a blind global bump

The private package is a local devDependency in six projects;
`overrides.picomatch = "$picomatch"` makes npm resolve nested peers relative to
that direct file dependency. A plain relative transitive override fails under
npm. Five Bun and four npm locks record the same actual local tarball/SRI.
No unrelated parent version or bytes are updated. The graphs formerly using
upstream 2.3.2 must pass their real parent APIs and lint/build/packaging checks;
version labels or a frozen-install exit code alone cannot prove compatibility.
Clean installations disable install scripts and must not mutate any lock.

## Scanner boundaries, including framework-embedded code

OSV/bun audit cannot certify an unpublished private fork. Zero findings means
only that the registry inventory has no unsuppressed matching advisory; local
source/provenance/adversarial and consumer gates remain mandatory. Existing
unrelated OSV exceptions are unchanged; no new ignore is introduced.

Next 16.4.5 contains an **unversioned internal compiled picomatch** at
`next/dist/compiled/picomatch`, outside package-manager overrides. It still
compiles risky forms and is **not patched/certified by this change**. The
installed-code inventory distinguishes it from resolved package leaves.
Reviewed runtime callers take image hostname/path patterns from developer
configuration, not request-supplied glob expressions; this repository's remote
hostname/path patterns are fixed `**`, with no repeated extglob and no configured
local pattern. Other reviewed references are build/tracing/middleware tools.
This is only a current-configuration exposure assessment, not an upstream fix,
adversarial embedded-copy timing result or complete embedded-component SBOM.
Do not introduce untrusted/dynamic patterns into those configuration paths.
Review with the upstream retirement work no later than 2026-12-16.

MIT license/attribution, original bytes, source archive, exact patch and
reproducible payload are retained. No signing/publication/production-readiness
or live-provider claim follows from this candidate patch.
