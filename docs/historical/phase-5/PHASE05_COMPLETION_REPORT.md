# XR Phase 5 — Scope Shrink & Naming Truth
## Completion report and evidence pack

**Branch:** `phase5/scope-shrink-naming-truth` (from `main` @ `fdae480`)
**Date:** 2026-09-05
**Scope discipline:** Phase 5 only. No P6–P9 work, no enforcement added or removed.

---

## 1. What the phase was for

Five findings, all of them versions of the same problem — **the repository was
making claims its contents did not support**:

| ID | Claim | Reality before Phase 5 |
|---|---|---|
| F-18 | Core is a local-first agent runtime | Carried 33,759 LOC of enterprise/business surface with zero users |
| F-07 | "XR Shield" protects you | Named a host scanner on no execution path; the real boundary had no name |
| F-17 | The Constitution is law, cited ~300 times | The document did not exist |
| F-29 | The docs tree is navigable | 171 archived documents, none marked as frozen |
| F-25 | Deprecations have deadlines | Pointed at "8.0.0", a version the 1.0.0 re-baseline deleted |

Phase 5 is subtraction and renaming. Every finding is closed by making the
repository smaller or more honest, never by adding capability.

---

## 2. Results against the acceptance criteria

| Criterion | Result | Evidence |
|---|---|---|
| Core tree shrunk | **154,426 → 131,050 LOC** (−23,376, −15.1%); 603 → 551 files | `loc-census.md` |
| 0 imports of extracted packages, CI-enforced | **0 edges**, enforced 3 independent ways | `import-census-after.txt`; `boundaries` gate; 2 architecture tests |
| LOC gate re-baselined to measured truth | `TREE_CEILING = 135,000` in `scripts/size-gate.ts`, with the arithmetic and the ≤110k rejection written into the code comment | `11-final-gates.txt` |
| `xr hygiene` works | ✅ | `07-hygiene-help.txt`, `09-hygiene-output.txt` |
| `xr shield` aliases with deprecation notice | ✅ exit 0, notice on stderr | `08-cli-relocation.txt` |
| README "XR Shield" table describes the boundary | ✅ 7 components, generated from `XR_SHIELD_COMPONENTS` | README §Security |
| `docs/CONSTITUTION.md` exists | ✅ 30 Articles, [V]/[R] provenance per clause | `docs/CONSTITUTION.md` |
| claim-lint enforces cited Articles | ✅ Gate 5, negative-control verified | §5 below |
| Fresh npm install has no enterprise/business-os code | ✅ asserted on the real tarball, wired into the release workflow | §6 below |
| Docs tree published with HISTORY ladder | ✅ structural ladder + 170 watermarked archives | `docs/HISTORY.md` |
| Patch debris deleted | ✅ `XR_PHASE05.patch`, `fix-ci.patch` | `git status` |
| Limitations register updated | ✅ rows #18–#20 added | `docs/security/KNOWN_LIMITATIONS.md` |
| Core suite green | **2,951 pass / 0 fail / 19 skip** across 297 files | `10-final-tests.txt` |
| All CI gates green | **15/15 PASS** | `11-final-gates.txt` |

---

## 3. The four maintainer decisions, and what the evidence said

All four were correct. Two of them contradicted the written plan, and the
evidence supported the maintainer, not the plan.

**Keep `src/research` and `src/repo` in core.** The plan grouped them with
enterprise sprawl. The import census found research supplies **5 agent tools and
11 versioned `/api/v1` operations** (committed in `docs/api/openapi.json`, wired
into the voice pipeline) and repo supplies **6 agent tools** plus agent context
seeding. Extracting them would have removed operations from a versioned contract
whose `api-compat` gate defines BREAKING as "operation removed" — the extraction
could only have landed by disabling a correctness gate.

**Re-baseline the LOC gate.** The plan's ≤110k was written against a
**149,722**-LOC tree from four phases earlier; the tree was 154,426 when the
phase began. Even extracting everything listed lands near 124k. Reaching 110k
meant cutting ~14k from `src/context`, `src/daemon`, `src/platform` — deleting
the product to satisfy an estimate. The gate now holds **135,000**, the line
actually achieved, and the reasoning is a comment in `size-gate.ts` rather than
a number with no story.

**Publish a reconstructed Constitution.** See §5.

**Execute full Phase 5.** Done, all nine steps.

---

## 4. Findings I could not have predicted, found by doing the work

These are the reason the phase took the shape it did. Each was found by
measuring rather than reading.

**`src/enterprise/baseline/status.ts` was not enterprise code.** 313 LOC of
Phase-0 health helpers consumed by `xr doctor`, `src/install/system.ts` and four
baseline scripts. Extracting it — as the plan directed — would have made
**`xr doctor`, XR's central honesty command, depend on an optional enterprise
package.** Repatriated to `src/install/baseline-status.ts`.

**Two "type-only" imports were real build coupling.** `business.routes.ts` and
`credentials.ts` imported types from the extension tree. Type-only imports are
erased at compile time, so both audits and the boundary gate scored them
harmless — but they made core **unbuildable without the extension checked out
beside it**. Core now declares the shapes at L0 and the extension satisfies them
structurally, with no import in either direction.

**A runtime edge would have 500'd in production.** `business.routes.ts` loaded
`JOURNEY_DEFINITIONS` directly from extension source at request time behind a
dynamic `import()`. Once extracted, `GET /api/business/journeys` would have
thrown module-not-found — in a file otherwise scrupulous about honest 503s.

**My own facade shipped a security bypass, and an existing gate caught it.** The
first `src/xr-shield/index.ts` re-exported `control/approvals.ts`, the legacy
approval queue. `test/phase2/architecture-boundaries.test.ts` allows exactly two
importers of it. Re-exporting it from the module named "the security boundary"
would have handed every future caller a supported-looking path around the
durable-store seam Phase 2 built. Now exports `approval-store.ts`; a new test
asserts the legacy path can never come back.

**The hot-path security lint silently lost coverage.** `scripts/hot-path-lint.ts`
listed `src/security/shield.ts` and skipped missing files — so after the rename
it scanned nothing and reported green. The scanner has **16 sync I/O calls** that
were invisible. A missing hot-path entry is now a hard failure.

**`xr hygiene` was still advertising a feature deleted in Phase 2.** The help
text read *"AI-powered Security & Privacy layer"*; `analyzeThreatWithAgent()`
was removed in Phase 2 precisely to avoid implying an AI that was not there. The
banner also still said "XR Shield Protection Status" — directly under the notice
explaining that XR Shield is something else. Both corrected.

---

## 5. F-17 — the Constitution

`docs/CONSTITUTION.md` reconstructs 30 Articles from **~300 citations** across
the codebase (`05-article-citations.txt`, copied to
`docs/historical/phase-5/article-citations.txt`).

**The honesty machinery matters more than the document.** Every clause carries
provenance: **[V]** = verbatim text quoted in a citing file; **[R]** =
reconstructed from how the Article is cited and enforced. The preamble states
plainly that the Articles are real, the original prose is lost, and this is a
reconstruction. Articles **XIII, XVII, XXV, XXVI** have zero citations and are
recorded as **unattested** rather than invented — the tempting move was to write
four plausible Articles, and that would have been fabrication.

**Gate 5 (`constitution`) in `scripts/claim-lint.ts`** scans `src/`, `test/`,
`scripts/`, `.github/` for `Article <roman>` / `Art. <roman>` and fails when the
Article has no heading in the document, with a distinct message for unattested
Articles.

Negative control (the gate is not decorative):

```
── constitution (1) ──────────────────────────────────────
  src/core/version.ts:87
    > // negative control: Article XXV does not exist in the Constitution
    Cites Article XXV, which docs/CONSTITUTION.md records as UNATTESTED
    (no surviving text). Remove the citation or reconstruct the Article.
```

**Deliberate limit:** the gate validates **Article-level** citations only.
Clause numbers (`IV.4`, `XII · Rule 4`) are cited with more precision than the
reconstruction can honestly vouch for; failing CI on a clause the document does
not spell out would enforce a precision XR does not have. The rationale is in
the `lintConstitution()` doc comment, not just this report.

---

## 6. Tarball scope — asserted, not assumed

`package.json#files` already excluded the satellites, but that is exactly the
kind of claim that stops being true when someone adds a directory. The real
tarball is now inspected:

```
$ bun run scripts/consumer-smoke.ts --tarball dist/rrrtx-xr-1.0.0.tgz
{"ok":true,"totalFiles":1930,"offenders":[]}
✅ tarball scope: 1930 files, no extracted satellite code
```

Negative control — inject `package/src/enterprise/policy.ts` and repack:

```
❌ tarball ships extracted satellite code (2):
   package/src/enterprise/
   package/src/enterprise/policy.ts
```

Four `business`-matching files remain in the tarball **by design** and are
allowlisted with the reason in code: `business-l0.ts` (the L0 interfaces),
`providers/business.ts` (the optional loader), `business.routes.ts` (committed
`/api/v1` operations), `business-os.skill.json` (a schema). Per Art. XVI the
kernel holds a thin contract; the extension holds the implementation. Wired into
`.github/workflows/release.yml` immediately after `npm pack`.

---

## 7. Final verification

```
bun test        2,951 pass · 0 fail · 19 skip · 297 files · 13,566 expect() calls
```

| Gate | Result | | Gate | Result |
|---|---|---|---|---|
| typecheck | PASS | | api:schema:check | PASS |
| boundaries | PASS (569 modules, 0 violations) | | client:check | PASS |
| size-gate | PASS (131,081 / 135,000 LOC) | | api:compat | PASS |
| hot-path-lint | PASS | | baseline:inventory | PASS |
| claim-lint | PASS (incl. constitution gate) | | ci-capability-gate | PASS |
| release:check | PASS | | channel:check | PASS |
| changelog:check | PASS | | website:marketplace:check | PASS |
| ownership:check | PASS | | | |

**372 files changed, +5,475 / −3,834.**

---

## 8. What is deliberately not done

Recorded as limitations rows #18–#20 rather than left for someone to discover:

1. **The satellites are not published.** They are complete, tested packages in
   `satellites/` with manifests, bins and READMEs, plus a publish runbook
   (`satellites/PUBLISHING.md`) — but no npm publish or repo push happened,
   because this branch has no credentials. Keeping them in-tree until then means
   the isolation claim stays *verifiable on every PR* instead of unfalsifiable.
2. **The Constitution is a reconstruction**, and the gate is Article-level.
3. **135k is a no-regrowth ceiling, not the plan's 110k aspiration.**

Two ADRs record the decisions: **ADR-0027** (naming) and **ADR-0028**
(extraction). Both were numbered 24 in the plan; 0024 was taken four phases ago,
and ADRs are never renumbered.

---

## 9. Evidence files

| File | What it holds |
|---|---|
| `PHASE05_PREFLIGHT_AUDIT.md` | Pre-flight audit: Findings A–E, import census, corrected plan |
| `00-baseline-typecheck.txt`, `01-baseline-gates.txt`, `02-baseline-tests.txt` | Pre-change baselines |
| `03-post-extraction-tests.txt` | First post-extraction run (pre-fix) |
| `05-article-citations.txt` | 25 Articles × ~300 citations — the reconstruction source |
| `06-post-rename-tests.txt` | Post-rename run that surfaced the 4 real failures |
| `07-hygiene-help.txt` | `xr hygiene --help` and `xr shield --help` |
| `08-cli-relocation.txt` | Deprecation notice + all three relocation shims (exit 2) |
| `09-hygiene-output.txt` | Corrected hygiene banner and status output |
| `10-final-tests.txt` | Final suite: 2,951 pass / 0 fail |
| `11-final-gates.txt` | All 15 CI gates PASS |

In-repo: `docs/historical/phase-5/` holds `loc-census.md`,
`import-census-after.txt`, `article-citations.txt`, `gates-before.txt`.
