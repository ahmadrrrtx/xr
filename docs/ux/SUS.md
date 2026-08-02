# System Usability Scale — Protocol, Instrument & Record

**Last updated:** 2026-08-03 · **Build:** 7.0.1 + Phase-8 branch
**Phase-8 target:** mean SUS ≥ 80.
**Current status:** `study pending — no human SUS data exists and none is claimed` (honesty exception E-1, `docs/phase8/04-ARCHITECTURE-VALIDATION.md`).

---

## 1. The instrument (verified)

`scripts/sus.ts` implements the canonical SUS:

- The **10 unmodified Brooke (1996) items**, alternating positive/negative wording.
- Scoring: odd items contribute *response − 1*, even items *5 − response*; the
  sum is scaled by **2.5** → 0–100. Pinned by exact-math tests
  (`test/ux/sus.test.ts`: max pattern → 100, worst → 0, all-neutral → 50,
  worked example → 85; garbage input is rejected, never scored).
- Adjective ratings use the Sauro–Lewis curved grading (Bangor, Kortum &
  Miller 2008). Note under curved bands **80.0 sits mid-"good", not
  "excellent"** — the Phase-8 ≥80 target is therefore a demanding-but-honest
  bar, and this file does not relabel it.
- `--report` **exits 1 unless n ≥ 5 AND mean ≥ 80**, so a green SUS claim can
  never come out of an empty or tiny results file.

## 2. Data handling (privacy by construction)

`--collect` appends responses to `docs/ux/sus-results.local.jsonl`, which is
**git-ignored** — raw individual answers never enter the repository; only the
study aggregate recorded in §4 by a human is public. Participants use
pseudonyms; no names or emails are requested (*never* record identifiers).

## 3. Study protocol (before the ≥80 claim may be made)

1. Recruit **≥8 participants** (5 is the statistical floor; 8 gives margin)
   who have used XR for a real task in the prior session — SUS measures the
   *system as experienced*, ideally right after the §5 first-task protocol in
   `FIRST-TASK.md` rather than in a vacuum.
2. Administer the 10 items immediately after task completion, one sitting, no
   assistance with the items themselves.
3. Compute scores with `bun run scripts/sus.ts --report` (never by hand).
4. Record the aggregate table below together with n, mean, median, rating,
   and the date. **If mean < 80, file the finding, fix, retest with fresh
   participants — do not average studies to reach 80.**

## 4. Record

| Study date | n | Mean | Median | Rating | Verdict |
|---|---|---|---|---|---|
| — | — | — | — | — | **study pending — do not claim SUS ≥ 80 anywhere** |

### Standing rule

Any README, release note, dashboard caption, or sales material quoting a SUS
number for XR before this table is filled is an honesty violation under
Constitution Art. X and fails `claim-lint` review.
