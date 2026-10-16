# XR — Fix Tracker

**Initialized:** 2026-10-17 (ACT 1 of the Implementation Orchestrator)
**Scope authority:** `XR_IMPLEMENTATION_PLAN.md` ← which derives from `XR_FINAL_MASTER_AUDIT.md` (findings `P0-x` / `P1-x` / `P2-x`) and `XR_FINAL_LEDGER.md` (verifications `V-nn`).
**Target repo commit:** `662ac98d2288dd8fddc057a43e295d60bdfe6526` (the commit every finding was verified against). If execution starts on a later commit, re-verify each finding's before-state in the phase's AUDIT step before changing anything.

**How to use**
- One row per plan phase. A phase moves ⬜ → 🟨 when its prompt is issued/started → ✅ only when **all** its acceptance criteria are met **and** the evidence is linked.
- **Evidence** must be a durable link or path: commit SHA, CI run URL, test name + output, transcript file, or live-fetch capture. "Done" without evidence is not done.
- If a finding cannot be reproduced at execution time: mark 🟨, write the blocker in Notes, and **stop** — never fix blindly (plan rule).
- If a phase is abandoned: revert to the last green commit, mark 🟨 with the reason, and re-plan before continuing.
- Update the **Date** column with the date of the last state change (Asia/Karachi).

**Status legend:** ⬜ not started · 🟨 in progress / blocked · ✅ done with evidence

---

## 1. Phase status

### Stage 1 — Public Truth & Claim Integrity
| Stage | Phase | Title | Report IDs | Status | Evidence | Date |
|---|---|---|---|---|---|---|
| 1 | 1.1 | Legal identity completion + placeholder gate | `P0-1` | ✅ | branch `stage-1` · commit `fix(website): fill legal identity, add placeholder-lint gate (P0-1)` · `bun test` 4381p/19s/0f (405 files) · `bun run ci` 19/19 (CI_EXIT=0) · `placeholder-lint` ✅ 75 files, negative proof exit 1→0 · `TO FILL` src 5→0 · live 12+2 pending deploy · handoff `HANDOFF_PHASE_1.1.md` | 2026-10-17 |
| 1 | 1.2 | Deletion promise ↔ capability alignment | `P0-2` | ✅ | branch `stage-1` · commit `fix(website,cloud): align deletion copy with actual capability (P0-2)` · 15 sites rewritten (14 inventoried + 1 found in-flight) · capability re-check: 8 `app.delete` routes unchanged, 0 writers of `deletionScheduledAt`/`purgedAt`, no scheduler · new test `test/website/legal-capability-alignment.test.ts` 8p/0f, negative proof fails→passes · `bun test` 4389p/19s/0f (406 files) · `bun run ci` 19/19 · website build = baseline route table · cloud suite 28p/0f · forbidden patterns 0/website/src · live `/privacy` 14 phrase hits pending deploy · handoff `HANDOFF_PHASE_1.2.md` | 2026-10-17 |
| 1 | 1.3 | One source of truth for numbers/versions/links | `P1-11`, `P2-19`, `P2-11` | ✅ | branch `stage-1` · commit `docs+ci: single-source published numbers, fix generated 1.1.0 register link, add docs-integrity gates (P1-11)` · ceiling single-sourced (README:720 marker + register row #20 re-baselined w/ `xr:numeric-history`; README:787 prose reworded; `--stamp-docs` mode added, idempotent ×2; TREE_CEILING untouched) · README:717 tuple truthful: **4,406p/19s/0f/407 files** (measured 2×; was "3,241/317" undated) + `docs/release/TEST-BASELINE.json` (bun 1.4.3 · linux · b40edf1a · 2026-10-17) + RELEASING §1f/§1g refresh steps · 1.1.0 register snapshot created (retroactive §1e, honesty-labeled; canonical rows #1–#21; §7b vs measured npm state) so the generated README link resolves · register row #21 link re-pointed in-tree · claim-lint +2 gates (`numeric-claim`, `doc-link`; gates 1–5 unchanged) + `test/release/numeric-claims.test.ts` 17t · negative proofs on real tree: marker→999,000 exit 1→revert→0 · fabricated link exit 1→revert→0 · stale-ceiling grep 0 hits outside history lines · gates: `bun run ci` 19/19 exit 0 · release:check ✓ · channel:check ✓ · website build ✓ · handoff `HANDOFF_PHASE_1.3.md` | 2026-10-17 |
| 1 | 1.4 | Public-surface completeness & honest labels | `P2-10`, `P2-9` | ✅ | branch `stage-1` · commit `feat(website): add /accessibility + /imprint, label demo preview (P2-10, P2-9)` · routes +2 (`website/src/app/accessibility/page.tsx`, `website/src/app/imprint/page.tsx`), build route table **44 → 46** page routes, both static `○`, none dynamic `ƒ` · live /accessibility + /imprint still 404 **pending deploy** · footer `site.footer.legal` += Accessibility + Imprint (route dirs test-asserted) · preview: chip `Sample data`, `Live` pill → `Preview` (dot de-pulsed zinc), caption under card, aria-label `XR dashboard preview — sample data, not a live system`; stats 1,284 / 48.2M / 98.7% retained · a11y page: W3C components (scope / status `automated-verified · manual-pass-pending-human` / verified-gates list / pending: screen-reader + zoom/forced-colors / report via support@xr.rrrtx.ai); no panel counts, no conformance claim · imprint: publisher/entity/office/DPDP values extracted **cross-file** from Phase-1.1 sources by the test (no retyped copies) · tests `test/ux/website-surface.test.ts` 21 pass / 0 fail · negative proofs: label-removed → exit 1 (1 targeted fail) · footer-removed → exit 1 (2 fails) · both reverted byte-identical · gates: root `bun test` **4,427p/19s/0f/408 files** (baseline re-measured per RELEASING §1g after +1 test file; TEST-BASELINE.json + README:717 updated, commit field = a6f7f67) · claim-lint ✓ · `bun run ci` 19/19 · website build+tsc ✓ · phase-scoped eslint clean — repo-wide eslint fails on 4 **pre-existing** errors at 662ac98 (members:86, CookieBanner:25, data.tsx:182/190; outside scope, recorded) · handoff `HANDOFF_PHASE_1.4.md` | 2026-10-17 |

### Stage 2 — Fail-Closed Runtime & Honest Wiring
| Stage | Phase | Title | Report IDs | Status | Evidence | Date |
|---|---|---|---|---|---|---|
| 2 | 2.1 | Request-trust boundary: Origin, Host, health | `P1-3`, `P1-5`, `P2-21`, `§15#27` | ⬜ | — | — |
| 2 | 2.2 | Strict write schemas (no phantom success) | `P1-6` | ⬜ | — | — |
| 2 | 2.3 | Approval fabric fail-closed | `P1-2` | ⬜ | — | — |
| 2 | 2.4 | Mobile & LAN control path (wire + prove) | `P1-1`, `P2-3`, `§15#10` | ⬜ | — | — |
| 2 | 2.5 | CLI contract, onboarding & dev hygiene | `P1-4`, `P1-16`, `P2-15`, `P2-16`, `P2-17`, `§15#16`, `§15#21` | ⬜ | — | — |

### Stage 3 — Paid Surface & Platform Guarantees
| Stage | Phase | Title | Report IDs | Status | Evidence | Date |
|---|---|---|---|---|---|---|
| 3 | 3.1 | Cloud RLS + org-admin second factor (A+B) | `P1-7`, `P2-5`, `P2-6` | ⬜ | — | — |
| 3 | 3.2 | Satellites green & CI-covered | `P1-8` | ⬜ | — | — |
| 3 | 3.3 | ADR-0028 extraction — headroom | `P1-9` | ⬜ | — | — |
| 3 | 3.4 | Platform guarantees: browser, Windows, handles | `P1-14`, `P2-2`, `§15#28` | ⬜ | — | — |
| 3 | 3.5 | Front-end delivery & release trust | `P1-10`, `P2-12`, `P2-14`, `P2-23` | ⬜ | — | — |

### Stage 4 — Vision Surfaces, Proof & Caretaking
| Stage | Phase | Title | Report IDs | Status | Evidence | Date |
|---|---|---|---|---|---|---|
| 4 | 4.1 | Voice loop + telephony decision | `P1-12`, `P1-13` | ⬜ | — | — |
| 4 | 4.2 | Code health: god-modules, type debt, tests | `P2-4`, `P2-7`, `P2-8`, `P2-13`, `P2-18`, `P2-20`, `P2-22` | ⬜ | — | — |
| 4 | 4.3 | Operational friction & marketplace truth | `P2-24`, `P2-25`, `§15#30`, `§15#40` | ⬜ | — | — |
| 4 | 4.4 | Documentation rot & fabricated telemetry | `P2-1`, `§15#3`, `§15#6`, `§15#12`, `§15#19`, `§15#24`, `§15#26` | ⬜ | — | — |
| 4 | 4.5 | External validation & caretaking plan | `P1-15`, §21 carry-overs | ⬜ | — | — |

**Totals:** 19 phases (4 + 5 + 5 + 5) · 43 findings (P0 × 2, P1 × 16, P2 × 25) · 0 findings unassigned · 15 items deliberately in `XR_IMPLEMENTATION_PLAN.md §7 Backlog`.

---

## 2. Stage gates

A stage is closed only when every phase in it is ✅ and the gate below is signed off.

| Stage | Gate criteria | CI evidence | Owner review | Date |
|---|---|---|---|---|
| 1 | 0 `[TO FILL]` live · deletion copy matches capability · numbers/links lint-clean · `/accessibility` + `/imprint` live · `bun test` + `bun run ci` green | — | ⬜ | — |
| 2 | Live probe matrix passes (localhost 200 / evil Host 4xx / unknown field 400 / approval denies without approver / cert-fingerprint 200 authed / `--nonsense-flag` exit 2 / LAN 25-of-25 on the shipping daemon) · fresh-clone typecheck instructive · suite + `ci` green | — | ⬜ | — |
| 3 | RLS on all tenant tables + cross-tenant negatives pass · TOTP + step-up pass · satellites 8/8 + CI lane · tree ≤168k · a11y mandatory 0 violations · CSP without `unsafe-inline` · chunk budget test · signing/A1 stance documented | — | ⬜ | — |
| 4 | Offline voice loop transcript · god-modules split · env/docs/links lint-clean · init-safety + update-notice tests · pentest RFP issued + drills run + register updated | — | ⬜ | — |

---

## 3. Decisions log (owner)

The plan's §9 lists seven decisions that phases will block on. Record the ruling here when made, then unblock the phase.

| # | Decision | Needed by phase | Owner ruling | Date |
|---|---|---|---|---|
| 1 | Legal identity (name / service address / contact / DPDP grievance officer) | 1.1 | Entity **RRRTX Labs** · registered office **Remote-first · Chiniot, Punjab, Pakistan** (owner resolved the either/or) · DPDP officer **Muhammad Ahmad** `<ahmadrrrtx333@gmail.com>`, **24 hr** · "Published by Muhammad Ahmad" kept · privacy contact unchanged (`privacy@xr.rrrtx.ai`) | 2026-10-17 |
| 2 | Deletion promise: copy fix (default) vs build endpoint + purge job | 1.2 | **Copy fix (report option b) per the plan's safe default** — the `DELETE /account` + purge-job build is deferred to plan §7 Backlog #1 (recommended after Stage 3.1 RLS) | 2026-10-17 |
| 3 | Satellites: publish to npm vs "not yet fetchable" wording (default) | 3.2 | — | — |
| 4 | Telephony: remove from vision (recommended) vs build behind the spine | 4.1 | — | — |
| 5 | Pentest: approve RFP scope/budget vs triage-only fallback | 4.5 | — | — |
| 6 | Signing: buy certificate/notarization vs documented unsigned + checksums (default) | 3.5 | — | — |
| 7 | A1 macOS/Windows authority: fund backends vs explicit "unsupported, refuses loudly" row (default) | 3.5 | — | — |

---

## 4. Deviation & discovery log

Anything that changes the plan while executing goes here **before** the code diverges. Types: `scope-out` (found outside the report — goes to plan §7 Backlog, not into the phase), `derived` (a `[DERIVED]` necessity discovered mid-phase), `severity` (evidence contradicting a finding's severity → stop, re-open with the audit evidence), `order` (a dependency turned out to differ).

| Date | Phase | Type | What was found | Action taken | Report ID touched |
|---|---|---|---|---|---|
| 2026-10-17 | 1.1 | derived | `ownership:check` (T5) requires every top-level `test/`+`scripts/` area in the committed `docs/OWNERSHIP.md`; adding `test/website/` + `scripts/placeholder-lint.ts` drifted the generated map | Regenerated via `bun run scripts/ownership-map.ts` (generated file, +2 rows, 208 areas) — A6 intended-file list effectively widened by one generated file | — (repo gate hygiene) |
| 2026-10-17 | 1.1 | derived | `test/security/phase31-bucket-b.test.ts` asserted the audit's before-state as expected content (`"Grievance officer: [TO FILL:"`, `"[TO FILL: Registered Entity Name]"`) — passes only while `P0-1` is unfixed | Flipped exactly those 2 assertions to pin the filled identity (`"Grievance officer: Muhammad Ahmad"`, `"XR RRRTX Labs"`); test names/structure untouched | `P0-1` |
| 2026-10-17 | 1.1 | scope-out | DMCA page intentionally labels its designated agent as "to be registered … at launch" (documented in-file; no `TO FILL` marker) | No change — intentional honest label; noted as context for Phase 1.4 | — |
| 2026-10-17 | 1.2 | derived | Claim family larger than the audit's 2 sentences: prompt verified 14 sites in 7 files; a **15th** surfaced in-flight via the prompt's own relational forbidden pattern — privacy §8 ("self-service in the console — export and delete need no ticket at all") | Rewritten in-phase to the request path (same fix rule); the new regression test's relational pattern now keeps the whole family pinned | `P0-2` |
| 2026-10-17 | 1.2 | derived | Customer-visible cancellation message in `cloud/src/services/subscriptions.ts:90` asserted "…before they are purged" — same defect class as `P0-2`, inside the paid product | One-clause rewrite to the request-based truth; verified first that **no cloud test pins the string** (no contract flip) | `P0-2` |
| 2026-10-17 | 1.2 | derived | Dashboard compliance row `P6.1` asserted a console-visible purge as `state: "ok"` | Flipped to `state: "warn"` + honest note (component's own partial-honesty vocabulary); the "implemented" counter drops by design | `P0-2` |
| 2026-10-17 | 1.2 | scope-out | Plan §Phase-1.2 Step 8 also asks for a known-limitations/roadmap line ("self-serve deletion is not built"); the commissioned prompt's file allowlist (A8) excludes docs | Not done in-phase; flagged for the owner to schedule (e.g. folded into Phase 1.3/1.4 which own docs) | — |
| 2026-10-17 | 1.3 | derived | `extensions/vscode/package.json` (0.2.0, added 2026-06-04) is a **4th independent version surface** the audit's release-manifest review did not name (only cloud/mobile/Cargo were convicted) | Included in the RELEASING.md "Independent version surfaces" classification and the claim-lint completeness list, same evidence standard as the other three | `P2-11` |
| 2026-10-17 | 1.3 | derived | RELEASING §1e had never run for the v1.1.0 tag cut — the README's generated identity link pointed at a non-existent file | Took the commissioned snapshot path (not the generator re-point alternative): created `docs/release/1.1.0/known-limitations.md` retroactively with a provenance note; it carries the same XR:TREE-CEILING marker, making it a **3rd `--stamp-docs` target** beyond the brief's "two published locations" so the snapshot cannot itself drift | `P1-11` |
| 2026-10-17 | 1.4 | derived | The plan's named test file `test/ux/marketing-claims.test.ts` did not exist (§3F of the phase prompt) | Created `test/ux/website-surface.test.ts` per the prompt's own correction — one new file, 4 groups, 21 tests | `P2-10`, `P2-9` |
| 2026-10-17 | 1.4 | scope-out | Panel-count drift: `docs/a11y/CONFORMANCE.md` says "all 26 panels" (2026-08-02, build 7.0.1) while `test/a11y/browser-axe.test.ts:195` pins "ALL 23 panels" | Recorded only per stop rules — new page cites no panel count (qualitative scope wording); flagged for a later docs phase together with 1.3's lint-scope note | — |
| 2026-10-17 | 1.4 | scope-out | `sitemap.ts` keeps an explicit ROUTES array that deliberately omits same-class legal pages (`/cookies`, `/refund`, `/security`) | Followed the file's convention: new routes not added; no sitemap edit | — |
| 2026-10-17 | 1.4 | derived | Adding the phase's test file grew the root suite (407 → 408 files), which correctly tripped 1.3's numeric-claim gate (README tuple vs TEST-BASELINE.json) | Re-measured per RELEASING §1g: root `bun test` 4,427/19/0 across 408; refreshed TEST-BASELINE.json + README:717 tuple (this is 1.3's mechanism working as designed, an A8 file-list widening by 2 generated/truth files) | — |
| 2026-10-17 | 1.2 | scope-out | Cloud route `billing.ts:227` still says audit logs "can be exported before the retention window closes" — customer-visible, implies a scheduled window end, but asserts no purge | Not edited (outside A8 files; no purge claim). Noted for the owner alongside Backlog #1 | — |

---

## 5. Release posture after each stage

Fill in when a stage closes; the plan deliberately does not pre-choose version numbers.

| After stage | Version/tag decision | `release:check` | `channel:check` | `changelog:check` | Notes |
|---|---|---|---|---|---|
| 1 | — | ⬜ | ⬜ | ⬜ | — |
| 2 | — | ⬜ | ⬜ | ⬜ | — |
| 3 | — | ⬜ | ⬜ | ⬜ | — |
| 4 | — | ⬜ | ⬜ | ⬜ | — |

---

_Tracker initialized by ACT 1. Next action is **ACT 2 — owner review of the plan**. No phase prompt is written until you explicitly commission one (ACT 3), one phase at a time, stage brief first._
