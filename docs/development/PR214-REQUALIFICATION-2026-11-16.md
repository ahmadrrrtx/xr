# PR 214 requalification and main installer plan

Owner: ahmadrrrtx. Scope: qualify/fix PR 214, merge only after current applicable
checks pass, then independently qualify and package the resulting main commit.
This is not tag, release, registry publication or signing authorization.

## Baseline actually examined

PR head `21d6c04258e41781e5d25be6780305c038389f33`; main
`23b6607a832e72e405cc460ff8155a396d869bc0`. Five of seven current PR workflows
failed, despite earlier historical qualification. The Truth gate's full log
identifies a missing `TREE_CEILING` export, not a fixture-disconnect message.
Three published ceiling markers were also lost. Restoring the existing 176,500
allocation and those markers passes 36 contract/numeric/architecture tests;
800 lines/module, 16 owned waivers and 500 ms responsiveness gates are unchanged.

All 22 workflow sources were reviewed; checksum-pinned actionlint 1.7.12 with
shellcheck 0.11.0 passes. Workflow lint is not pipeline execution proof.
Two historical macOS jobs never acquired a runner; capacity is neither an app
runtime failure nor a pass and must not justify deleting a required lane.

## Verification boundaries

- Initial targeted source run: 712 desktop/engine/model/voice tests passed.
  This is fixture/handler evidence, not a native WebView, physical mic or live
  provider account certification. Fresh full per-head results are separate.
- Actual source catalog: 26 built-in provider presets and 84 offline catalog
  model entries, not a four-model dropdown. The small curated facts/pricing
  registry contains 11 facts plus six renderer local rows; it must not be
  misrepresented as 27 independently verified live models. Configured/custom
  identifiers remain engine-owned and dynamic. Catalog presence is not health,
  credentials, model installation, inference or agent validation.
- The real loopback handler/renderer-adapter test observes the complete 84-row
  catalog, unauthorized/wrong-session 401s, authenticated contract negotiation,
  and a dynamically registered custom selection. It caught Bedrock's false
  keyless/credential-ready classification. One shared synchronous presence seam
  now covers the gateway, catalog/cache fingerprint and service fallback; AWS
  requires both broker credentials and role/CLI presence is not guessed. Presence
  still does not certify the native Bedrock signing/inference implementation.
  Provider/intelligence/service/loopback precommit coverage: 392 pass / 0 fail.
  The disposable fixture exits explicitly after scoped shutdown and is not a
  native process-exit/leak or WebView qualification.
- Onboarding publishes completion after the engine-acknowledged credential /
  model transaction. Voice intent is durable, revision-aware and conflict-bound;
  failed/pending writes do not invent backend success. Permission, microphone,
  playback and cancellation scenarios still need native/physical qualification.

## Supply-chain repair, not advisory suppression

No published picomatch fix exists through 4.0.7 in the reviewed advisory.
The private MIT fork applies actual parser changes and keeps its source archive,
file provenance, exact delta and reproducible local tarball. Nine graph checks
and clean frozen installs verify real bytes, not a changed version label.
The OSV policy is not broadened. Private packages and framework-embedded code
have scanner limits: see canonical limitation #31 and the explicit
compatibility restrictions in `vendor/picomatch/XR-COMPATIBILITY.md`. The
provisional r1 fork was rejected after five independently bounded Node probes
timed out. Candidate r2 uses a finite-codeword decision procedure and
conservatively refuses unproven repeated syntax: the unchanged upstream suite
has 1,917 pass / 66 differences, including safe-but-unsupported constructs.
Those differences are not a full upstream-suite pass and cannot waive actual
consumer lint/build/API/packaging gates.

The npm relative peer-override failure, stale local-file SRI caches, an overly
broad prefix guard and an unintended broad package-manager refresh were all
caught during review. Unrelated parents and metadata were restored. Keep the
clean-install, exact-source, raw scan and compatibility evidence; do not call
the discarded attempts passing qualification.

## First exact-head round and hosted watchdog finding

Candidate `1bb2dc475f22bb0799d0a8c93542b44ba128d346` passed a clean local
106-stage run: 5,937 core tests, zero failures, 34 platform skips; real Linux
isolation effects, consumer builds, workflow lint and recursive OSV/audit gates.
Packed npm and CLI binary/npm install/fixture-agent/update/uninstall journeys
also passed with genuinely separate scratch caches. An earlier outer runner
had incorrectly forced build and installed homes to share an npm cache; its
failed fresh-fetch proof is retained rather than counted as a successful run.

That candidate was pushed with a freshly verified owner identity. Hosted Supply
Chain run `44321780821`, job `134862336355`, then refused the original combined
1,500 ms Node child wall deadline (23 pass / 1 fail). No merge followed. The log
did not distinguish startup, module loading, matching or child exit; it is not
sufficient to claim either a parser bypass or harmless runner contention.
Unmodified probes pass locally on Node 20.20.2, the runner image's exact default
22.23.4 (official checksum verified), and 22.23.5. This does not erase the CI
failure or establish its root cause.

The test-only follow-up uses an asynchronous real-Node child with explicit
readiness and per-pattern checkpoints. Startup/module loading still has a
1,500 ms external deadline; **all compile/match/exit work together has a
stricter 500 ms external deadline**. The child attests its actual Node/V8/path;
Bun substitution is refused. Seeded startup and blocked-work probes prove the
watchdogs kill rather than manufacture a pass; assertion failures remain
failures. No input, parser guard or expectation was removed, and the private r2
source, tarball identity, nine lock hashes and 66 compatibility differences are
unchanged. Fresh exact-head local and hosted requalification remains required.

On follow-up `25a09239dec81fa126cbdd0dc77d37841853b53e`, local requalification
passed 5,941 core tests and all 175 native Linux Rust tests. Hosted Supply Chain
run `44326864979`, job `134880382696`, refused readiness within 1,500 ms with
no child output/events: **compile/match work was never released**. This narrows
the phase but does not distinguish process bootstrap from vendor module load or
identify a scheduling/runtime cause. The same head's CI/core and Linux/macOS
parity probes did pass (Node 22.23.4 Linux, Node 24.22.2 macOS; roughly 7–8 ms
matching), including all seeded watchdog controls. Those passes do not replace
the failed Supply Chain check.

The next focused repair explicitly provisions checksum-supported Node 22.23.5
in that job instead of relying on an unmanaged image executable; watchdog
controls are their own mandatory step. The child now emits its runtime before
vendor-module loading, so a future failure distinguishes pre-boot from module
load. The selected executable is also retained if no child output arrives.
Neither external deadline is raised (startup/module I/O 1,500 ms; complete
compile/match/exit 500 ms), and no parser, payload, input or assertion is removed.

## Outstanding acceptance (not represented as complete)

Fresh current-head unit/integration/E2E, behavioral security with real Linux isolation,
all required exact-head hosted checks, native installer journeys, guarded merge,
independent main rerun and final hashes/downloads. Debian 13 local execution
alone cannot establish older Mint/Ubuntu compatibility. Unsigned validation
packages are not production-ready; signatures, automatic/cross-version updates,
live providers, physical audio and unavailable native OS lanes remain explicit.

## Audit public-identity redaction repair

The exact `8a28c961` serial run failed the cross-process audit re-key check
(5,940 passed, one failed, 34 skipped). Its isolated home was removed and the
child verification output was not retained, so that individual failure cannot
be retrospectively attributed with certainty. Thirty-two independent fresh-home
boot/re-key/verify probes subsequently passed; they do not replace the failure.

A targeted independent reproduction demonstrated a concrete signing defect:
valid Ed25519 SPKI base64 may contain a token-shaped substring (`+sk…`). Generic
redaction changed that public key before `audit.keyed`/`audit.rekey` serialization,
while checkpoints used its original bytes. With a publicly reproducible test
seed, real CLI boot succeeded but the next `verify --crypto --json` exited 1:
chain valid, key available, signatures invalid. After preserving only internally
sourced public identity fields after ordinary detail redaction, the identical
real-process experiment exits 0 with valid signatures. Actor/note redaction,
private-key storage, verification and tamper rejection are unchanged.

The regression checks exact public bytes, close/reopen, rotation, prior-segment
identity, post-rotation append and actor-secret masking. Targeted crypto tests
passed 12/0; real CLI audit blackboxes passed 7/0 (including tampering and key
loss); typecheck passed. Existing corrupted audit history is NOT silently
rewritten or declared valid. Fresh immutable full qualification remains required.

The first full audit-repair candidate (`05da52b6`) passed the real audit
blackboxes but failed the unchanged per-module size waiver (store 2,553 versus
2,550 LOC); architecture and the canonical security runner both correctly
reported that same violation. No package/native stages ran. The identity-detail
construction is now extracted into the existing signer module, reducing the
store below its waiver without increasing thresholds/waivers. Targeted crypto
plus architecture passed 86/0; size and ownership checks pass (176,055 total LOC,
176,500 ceiling, 16 existing waivers, 251 owned areas). All-source requalification
is restarted on the resulting immutable commit; the failed report is retained.
