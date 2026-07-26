# Vision — Confidence and Privacy (XR 5.1)

**Vision perceives; it never executes.** An observation is evidence, not an
instruction — and never authority. Vision output reaches the execution path
only as a *cited, fresh observation reference* on a later governed action.

## The observation contract

Every perception is an `EnvironmentObservation` (`src/environment/types.ts`):

| Field | Meaning |
|---|---|
| `provenance` | `screenshot` · `ocr` · `dom_extract` · `vision_model` · `transcript` · `direct` — matches the Phase 6 untrusted-external posture: screen content is data, never an instruction. |
| `confidence` | `high` · `medium` · `low` · `unknown`. `unknown` is a distinct value, never rounded up. |
| `artifact` | Artifact **reference** only: `{ path, sha256, bytes }`. Raw image/audio bytes are never embedded in records, logs, or context items. |
| `sensitivity` | Whole-screen captures are declared `private` **always** — XR honestly cannot detect sensitive regions and does not pretend to. |
| `staleAfterMs` | Default 30 000 ms (`environment.vision.staleObservationMs`, 1–300 s allowed). A stale observation cannot justify a coordinate action. |

Captured screenshots are written to a temp file and **deleted after 60 s**
(deferred removal in `control/vision.ts`). Records keep the path+hash
reference, not the bytes.

## Confidence model (honest by construction)

Confidence is set by *what was actually produced*, not by a model's self-report:

- **Screen capture** (`observeScreen` / `observeArtifact`): `high` when the
  artifact file exists and hashed successfully; `low` if the file is
  unreadable; `unknown` if the capture itself failed — the observation still
  exists as a record of the failure (`obs_fail_*`), it just can't justify
  anything.
- **Local OCR** (`observeOcr`, tesseract only): `medium` when text was
  extracted, `low` when OCR ran but produced nothing, `unknown` when tesseract
  is missing. The summary states the outcome in words ("42 chars extracted
  locally" / "ocr unavailable (tesseract missing) — no cloud fallback
  attempted").
- **Vision-model calls**: the *decision to call* is consent-gated (below); the
  model's output is treated as untrusted-external evidence with provenance
  `vision_model`. A vision model can never raise action confidence on its own —
  the caller declares confidence and the gate verifies minimums.

Confidence minimums enforced downstream (`classify.ts`):

- Coordinate interaction (`click`/`drag_drop`/`move` typed to a coordinate
  target) **requires at least `medium` confidence** and a live
  `observationRef`; below medium the action is blocked, not retried.
- Coordinate interaction **without `high` confidence** escalates approval to
  `strong` (explicit confirm; auto-approval structurally disabled).
- `low`/`unknown` confidence on coordinate or `computer_use` actions produces
  a user-visible `assessment.uncertainty` string on every record:
  *"perception confidence is 'low'; the visible state may differ from what XR
  believes."*

## Size bound

Every captured image passes through a byte cap before OCR or any vision model
sees it (`control/vision.ts`):

- Limit: `environment.vision.maxImageBytes` (default **5 MiB**, allowed range
  256 KiB–25 MiB; env override `XR_VISION_MAX_IMAGE_BYTES`, floor 256 KiB).
- Oversize captures are **deleted immediately** and reported as a failure with
  the measured byte count — they are never downscaled silently, never shipped
  to a model, never left on disk.

## Cloud vision consent — dual gate, default off

There is no ambient or inferred consent for sending screen content off-device.
`decideVisionRouting()` (provider) / `visionCloudDecision()` (service) decide:

| Provider locality | Config `environment.vision.allowCloud` | Session policy `allowCloudVision` | Route |
|---|---|---|---|
| local (`isLocal`) | — | — | **local** (always) |
| cloud | `false` (default) | any | **blocked**, refusal explains the exact setting to change |
| cloud | `true` | `false` (default) | **blocked** by session policy |
| cloud | `true` | `true` | cloud (explicit dual consent) |

Consent is checked in BOTH settings and the effective session policy; a caller
can never raise consent above the user's setting. `computer_use` cloud vision
went through the same mandatory consent parameter in 5.1 (previously there was
no consent parameter at all — audited and fixed).

## Privacy rules enforced

1. **No raw retention.** Screenshot bytes are never copied into records, logs,
   transcripts, or context items (`screenshotRetention()`). The reverse lookup
   (path + sha256 + size) is all that persists.
2. **Redaction.** Any free-text destined for records passes `redactSecrets()`
   (private keys, tokens, JWTs, AWS/GitHub keys, cookie-like fragments).
3. **No cloud fallback.** OCR is tesseract-or-nothing unless the dual cloud
   gate above is explicitly opened. A missing tesseract is reported as
   `unsupported`/`partial` in the capability matrix — never as silent failure
   at action time.
4. **Screens are private.** Full captures are marked `sensitivity:"private"`;
   session policies treat them as sensitive data, and cloud routing treats
   them as consent-gated content.
5. **Vision is read-only for the world.** The divider is structural: the
   classifier blocks any action requested under the `vision` environment
   ("vision is an observation environment; it cannot execute actions").

## What XR will not do

- Describe screen regions as "safe" or "not sensitive" — region classification
  is beyond what XR can honestly certify.
- Treat a vision model's description of the screen as an instruction (prompt
  injection resistance inherits the Phase 6 untrusted-external framing).
- Retry a failed capture by widening scope (higher resolution, other displays)
  — retry policy is bounded (see RECOVERY.md).
