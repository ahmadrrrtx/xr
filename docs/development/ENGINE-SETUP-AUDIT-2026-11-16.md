# Engine/model/voice repair ledger — 2026-11-16

Owner/reviewer: ahmadrrrtx. Base: `be319c378f79fc5d5ce48b83fad7031159c08fe6`.
This is a source-repair ledger, **not a release approval**. Published installers
are separate artifacts and do not inherit fixes merely because main changes.

| Phase | Scope | Evidence/status |
|---|---|---|
| 1 | Private dev handshake, bounded pairing/JSON, cancellation and stale caches | 32 focused desktop tests pass |
| 1 | Custom onboarding, keyless/edit identity, acknowledged credential publication | 17 daemon/transaction tests pass |
| 1 | Durable voice intent, canonical mode/noise fields | 35 voice/replay/contract tests pass |
| 1 | Observed local readiness rather than built-in-preset presence | 13 tests pass |
| 2 | Settings custom add/edit/rotation/keyless/default/test path | 10 real React form scenarios; 7 reproduced failures fixed |
| 2 | Endpoint observation uses registered engine adapter | Real handler + loopback adapter receives selected model and broker key; no capability certification |
| 3 | Voice audition/download/mic lifetime | 19 real React scenarios, including late permission/playback, failure/timeout and verified install; 698 combined desktop/voice tests pass; TypeScript passes |
| 4 | Startup generations/deadlines and settings revisions | Pending |
| 5 | Explicit bounded model discovery and header-credential ownership | Pending |
| 6 | Full regression/security/build review and upstream delivery | Pending |

## Deliberate size budget

The old core-tree limit had four lines of headroom (175,496 / 175,500).
Phase 2 measures 175,539: +43 lines for its authenticated observation route,
request contract and generated client. The fixed limit is deliberately raised
by 1,000 to 176,500 for this repair program's engine-owned probe/discovery,
header-secret and revision-conflict contracts. This is not permission for an
unbounded new subsystem. All modules must still satisfy the 800-line rule or
their existing owned split plan; no security gate or test is disabled.
Review the final measured delta before merge and retain the fixed ceiling.

## Unavailable qualification is not a pass

A GitHub credential cannot substitute for real provider keys, a microphone,
OS keychains, code-signing credentials or npm publishing permission. Keep native
and signed-artifact qualification and live distribution policy separate from
local frontend/test success. Endpoint probes may send a minimal billable call;
a successful models endpoint is not a verified inference/capability result.

## Phase 3 boundary

Audition and meter operations now have an unconditional component owner, abort
signal and identity checks. Stop, selection changes and teardown invalidate late
results even if an API ignores abort. Speed uses the engine-supported range and
the durable preference outbox. Bundle progress remains observable through
terminal failure/cancellation, not merely while a file fetch is active. Download
completion requires the requested voice and runtime to be installed. These
checks use deferred media doubles; real WebView playback and physical inputs
remain part of native qualification, not a claimed pass. IPC grants are unchanged.
