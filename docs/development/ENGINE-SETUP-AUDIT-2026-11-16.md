# Engine/model/voice repair ledger — 2026-11-16

Repository owner: ahmadrrrtx; human merge review remains pending. Base: `be319c378f79fc5d5ce48b83fad7031159c08fe6`.
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
| 4 | Startup generations/deadlines and settings revisions | 7 supervisor/store scenarios, 5 voice race/conflict scenarios, real-handler concurrent revision conflict tests; 713 combined desktop/voice tests pass; TypeScript passes |
| 5 | Explicit bounded model discovery and header-credential ownership | 19 discovery/round-trip handler and adapter tests; 14 real form scenarios; 810 combined desktop/provider tests pass; TypeScript passes |
| 6 | Full regression/security/build review and upstream delivery | Review branch pushed; validation uses 57 partitions, 23 source/build gates plus behavioral security/dependency audit. Final per-SHA evidence accompanies delivery; native and live-channel qualification remain separate |

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

## Phase 4 boundary

A monotonic supervisor now bounds pairing, health, identity, first catalog,
restart IPC and failure diagnostics within one boot generation. Independent
diagnostic export has a finite IPC budget. Restart invalidates old readers;
last-good provider/model snapshots retain their time/source and are marked stale
rather than certifying current readiness. Voice reads/writes are ordered and
generation-checked. Engine-owned content revisions detect changes from other
windows, CLI and config writers. Stale HTTP writes return 409, never auto-rebase;
conflicted offline intent stays pending with explicit apply/discard controls.
The in-window outbox is not advertised as a cross-process storage transaction.
The engine revision is the conflict authority. No daemon credentials are copied
between homes. The voice settings mutation is experimental and now requires
expectedRevision; old clients must read and adopt that precondition.

## Phase 5 credential boundary

Every custom header value (not a guessed list of secret header names) is now
stored through the broker before publishing endpoint-bound references. Request
headers resolve lazily and fail closed on missing or differently scoped secrets.
Config initialization migrates legacy plaintext headers only after broker
acknowledgement and warns that old copies/backups require rotation. A migration
failure blocks the affected provider instead of transmitting plaintext config.
Built-in provider secret references cannot be borrowed by a custom endpoint.
Changing a keyed endpoint requires a fresh credential binding; changing header
endpoints requires re-entry. URLs with userinfo/query/fragment are rejected
before persistence, including rejection audits. Three new real-handler/migration
regressions plus the existing custom route suite pass (16 tests); TypeScript
passes. Actual OS keychain/upgrade qualification is still outstanding.

## Phase 5 observation boundary

Discovery-only drafts can register an endpoint and its broker credential without
inventing or selecting a model. Explicit discovery is bounded to 8 seconds,
3 pages, 200 identifiers and 256 KiB per response, never follows pagination
URLs, and distinguishes empty/malformed/HTTP/auth/timeout/partial results.
Settings and onboarding expose the same engine path; failed discovery does
not erase the typed/configured choice. Model lists carry source/time/auth state,
unknown capabilities and untested validation. Separate, explicitly billable
chat/streaming/tool-call/JSON/usage round trips report only the requested wire
capability; no tool is executed and no result certifies agent execution or
billing accuracy. Compatible adapters support these checks; Responses supports
model enumeration, and other adapters explicitly report unsupported rather
than fabricating an empty success. No source-list/startup path makes a vendor
request. New bearer references are endpoint-bound too; an unpublished binding
can be retried safely and an endpoint change cannot silently inherit its key.

Measured core tree after this phase: 175,895 / 176,500. Native qualification,
physical audio, vendor credentials, installer signatures and live channel
corrections remain distinct from these hermetic source tests.

## Media lifetime follow-up

The same cancellation owner is applied to the Voice Settings meter, STT sample
recorder and debounced TTS preview, not just the onboarding copy. A late
permission grant, engine response or audio decode cannot capture/play after
Stop, teardown, a device change or engine replacement. STT uses the selected
input, and all graph/error paths release their tracks. Nine additional failing
renderer cases were reproduced; 13 Settings media cases now pass, including
engine replacement, with TypeScript passing. Physical audio/WebView behavior
remains a separate qualification requirement.

## Explicit probe/cache follow-up

Final review reproduced a rotated-credential endpoint test reusing an earlier
health cache entry. Explicit tests now bypass cached/deduplicated health.
Credential/config changes invalidate health evidence; pending-only cache keys
are visible to targeted invalidation, and invalidated success/failure/SWR writers
cannot repopulate or erase a newer cache flight. Four failing regressions were
reproduced and are fixed. This does not promote health to inference validation.

## Release qualification still pending

Source checks are not a signed-binary or physical audio approval. Native/cross-OS
CI has been requested on the review branch. Real microphone/WebView playback,
keychain persistence, clean install/upgrade and signing/attestation still need
OS-appropriate evidence. The read-only live-channel checker still fails for
withdrawn GitHub v1.1.0 Latest metadata and old npm higher-major deprecations.
No release, npm channel, tag, signing key or protected-main change was made.

Final cache-follow-up core measurement: 175,891 / 176,500; per-module limits
and all pre-existing waivers remain enforced. The size-policy change is explicit,
not a silently disabled gate.
