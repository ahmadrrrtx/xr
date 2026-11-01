# Empty by design

No file exists here yet. Prompts and reports are created **only** on explicit request:

- `phase-prompts/` — written when the owner issues `GENERATE PHASE PROMPT XR-Pnn`.
  Naming: `XR-Pnn-rN-<baseline-sha7>.md`. Historical revisions are never overwritten.
- `phase-reports/` — written by execution agents as `XR-Pnn-report-rN.md`, and by the
  Plan Owner as `XR-Pnn-review-rN.md`. Failed and abandoned attempts are kept.

Nothing in this directory may be pre-populated with speculative content.
