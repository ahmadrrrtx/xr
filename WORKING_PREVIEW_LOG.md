# XR Preview 7 working log

Date: 2026-11-28 UTC. Branch: `arena/dc530879-xr`, base `f983809628a2bc7b86ff70ecae835173719ebb31`.

This is the command/evidence ledger for the Preview 7 mission. Only completed evidence is marked verified; a missing provider credential, network path, or hardware journey is marked not reproduced/owner-blocked rather than inferred.

## Phase 0 — distribution and public-install reproduction

### Channel facts (queried before changes)

Commands:

```sh
npm view @rrrtx/xr dist-tags --json
gh release list --repo ahmadrrrtx/xr --limit 12
```

Output:

```text
{
  "beta": "1.2.0-preview.6",
  "latest": "1.0.0"
}
XR v1.2.0-preview.6    Pre-release    v1.2.0-preview.6
XR v1.2.0-preview.5    Pre-release    v1.2.0-preview.5
XR v1.2.0-preview.4    Draft          v1.2.0-preview.4
XR 1.1.0 — Windows x64 private test drop   Draft   win-x64-drop-2026-10-23
v1.1.0                  Latest         v1.1.0
XR v1.0.0                              v1.0.0
XR v1.0.0-beta.1        Pre-release    v1.0.0-beta.1
XR v                                  Draft          v1.0.0-beta.1
```

Thus the public default npm dist-tag is the 1.0.0 package while `beta` is preview.6; GitHub Latest is v1.1.0 while preview.6 is pre-release. This confirms the distribution mismatch before any changes.

### Clean-HOME installs

Commands (HOME and npm prefix/cache isolated per channel):

```sh
HOME=/tmp/xr-phase0/home-latest npm_config_prefix=/tmp/xr-phase0/home-latest/npm-global npm install -g @rrrtx/xr
HOME=/tmp/xr-phase0/home-beta npm_config_prefix=/tmp/xr-phase0/home-beta/npm-global npm install -g @rrrtx/xr@beta
```

Observed package versions from package metadata and `xr --version` after adding pinned Bun 1.4.2 to PATH (the default npm package does not bundle Bun):

```text
latest: @rrrtx/xr package.json version = 1.0.0
latest: xr --version = v1.0.0 (Truth)
beta:   @rrrtx/xr package.json version = 1.2.0-preview.6
beta:   xr --version = v1.2.0-preview.6 (Preview 6)
```

Before Bun was on PATH both installs produced `/usr/bin/env: 'bun': No such file or directory`; this is an environment prerequisite, not a version result. Bun used for follow-up was `@oven/bun-linux-x64@1.4.2`, installed in each temporary isolated HOME (not globally). Exact phase0 install transcripts remain in the tool output/history; no npm credentials were used.

### First-message budget/provider symptom

The isolated old install was attempted with `xr --provider openai --model gpt-4o-mini 'hello'`. Exact result:

```text
▸ think  (step 1/12) · OpenAI · 💰 0 tok ≈ $0.0000 / $0.25 cap
✗ error: Provider openai error: unknown certificate verification error
! ended: Provider openai error: unknown certificate verification error
Provider openai error: unknown certificate verification error
› incomplete run checkpointed — continue with: xr run --resume s_70vwmfzt
exit=1
```

Then with dummy-only AWS/Hugging Face credentials (`phase0` values, not valid credentials), the old install was forced to Bedrock and Hugging Face and each first message ended in `Network failure contacting provider ...`; outbound provider DNS/TLS is not available in this environment. Neither reproduced the reported literal false `budget` stop; there was no real hosted provider credential or reachable provider to complete the expected reproduction. The old Bedrock run showed `AWS Bedrock` and `$0.0000 / $0.25 cap` before failing on network.

Preview.6 was attempted with the same dummy AWS credentials:

```text
› Loaded AGENTS.md as project rules
! 0 files changed · 0 commands completed successfully
ended: unpriced
✕ Stopped before sending anything: price unavailable: configure sourced/operator-declared rates or choose a known-priced/local model; no request sent — raising the budget will not help. XR refuses to run a model it cannot price: declare the rate under providerEngine.providerCapabilities.<provider>.models.<model>.cost (known, inPerMTok, outPerMTok, source), or pick a known-priced or local model.
exit=1
```

This proves the Preview.6 unpriced stop is distinguished from a budget stop on this path and gives an actionable rate declaration. The Hugging Face attempt was rejected before inference because the chosen model lacked the agent's required `tool-use` capability; it is not evidence of pricing behavior.

### Preview.6 daemon, cost and voice endpoints

Command: start the isolated preview.6 install with `xr serve --port 33141`; poll authenticated APIs using the token in the isolated HOME's `.xr/daemon/token`.

Daemon stderr/startup:

```text
⚠ XR: no OS keychain was found ... secrets are being stored in the encrypted file fallback
XR — Local Server
✓ Listening on http://127.0.0.1:33141
✓ Dashboard http://127.0.0.1:33141/
✓ Chat http://127.0.0.1:33141/chat
Binding: 127.0.0.1 only — not exposed to the network
```

It remained running for the entire API probe and was stopped cleanly using the process manager. Authenticated endpoints:

```text
GET /api/cost -> HTTP 200
{"totalUsd":0,"totalTokens":0,"byModel":[],"recent":[]}

GET /api/voice/status -> HTTP 200
{"state":"idle","available":false,"stt":{"loaded":false,"backend":"auto","name":"No local STT found. Install whisper CLI / whisper.cpp, or configure XR_STT_URL for a local STT endpoint.","model":"base.en","missing":["encoder-epoch-99-avg-1.int8.onnx","decoder-epoch-99-avg-1.int8.onnx","joiner-epoch-99-avg-1.int8.onnx","tokens.txt"]},"tts":{"loaded":false,"backend":"system","name":"No local TTS found. Install Piper, Kokoro, espeak, or configure XR_TTS_URL.","voice":"piper-kusal","label":"Ahmad","hasAudio":false,"missing":["en_US-kusal-medium.onnx","tokens.txt","en_US-kusal-medium.onnx.json","espeak-ng-data"]},"runtime":{"installed":true,"detail":"sherpa-onnx present but no models installed"},"firstRun":{"pending":[{"id":"sherpa-onnx-wasm","component":"runtime","name":"sherpa-onnx 1.13.8 (WebAssembly runtime)","bytes":4320484},{"id":"sherpa-small-en","component":"stt","name":"sherpa-onnx zipformer small · English","bytes":27586985},{"id":"espeak-ng-data","component":"tts","name":"espeak-ng phoneme data · English","bytes":816251},{"id":"piper-kusal","component":"tts","name":"Piper en_US-kusal-medium","bytes":63207230}],"bytes":95930950},"download":null,...}
```

The full status also returned voice settings and `modelDir=/tmp/xr-phase0/home-beta/.xr/voice`, `nativeDir=/tmp/xr-phase0/home-beta/.voice-native`. `/api/health` returned `{"ok":true,...}` HTTP 200. Daemon stderr recorded successful `cost.get`, `voice.status`, and `health.get` requests (HTTP 200). No model download or fixture STT/TTS was triggered in Phase 0; the report's download-failure symptom remains unverified here.

### Phase 0 conclusion / remaining evidence gaps

- **Distribution root cause confirmed:** `latest`=1.0.0, `beta`=preview.6, and GitHub Latest=v1.1.0.
- **False budget:** old 1.0.0 exact false-budget symptom not reproduced due blocked provider network/no valid hosted key; captured provider/model/error above, not relabeled as budget evidence. Preview.6 Bedrock produced the intended `unpriced` stop with a remediation path.
- **Engine crash on shutdown:** this is a desktop/Tauri lifecycle journey; no graphical desktop session is available in this Phase 0 runner. Preview.6 known-limitations explicitly documents NEW-23 open; it remains a Phase 1 task.
- **Voice download failure:** status probe confirms model assets are pending, but no CDN download could be safely characterized as successful/failed in Phase 0. Trigger and daemon-survival regression are left for Phase 4 with explicit failure injection.

## Phase 1 onward

Append each fix's regression test, exact local command/result, commit SHA, push/head, CI run URL, and any blocker here before proceeding to the next item. Do not claim CI or public publication until the evidence exists.

### Phase 1.1 — NEW-2 pricing / Bedrock default

Research source facts (official pages fetched 2026-11-28):

- AWS Bedrock pricing: `https://aws.amazon.com/bedrock/pricing/` lists Amazon Nova Micro at **$0.035 per 1M input tokens** and **$0.14 per 1M output tokens** for standard on-demand, with its Nova pricing region table. The same page's current Anthropic table no longer lists the old Claude 3 Sonnet default; no stale rate was reused.
- AWS Nova model ID and InvokeModel format: `https://docs.aws.amazon.com/nova/latest/userguide/getting-started-converse.html` identifies Nova Micro's supported inference ID; `https://docs.aws.amazon.com/nova/latest/userguide/prompting-structured-output.html` documents `messages-v1` and tool configuration; `https://docs.aws.amazon.com/nova/latest/userguide/tool-use-invocation.html` documents `toolUse` results and IDs.
- Hugging Face pricing: `https://huggingface.co/docs/inference-providers/pricing` says the router passes through its selected provider's rate (and rates depend on the model/provider); there is no one honest fixed router price. Preview 6's operator-declared per-model rate fields already exist in config. The docs now give the exact config path and JSONC shape with placeholders, not invented prices.

Changes for NEW-2:

- `bedrock` now defaults to `nova-micro`, mapped to `us.amazon.nova-micro-v1:0` and priced from the official AWS page above.
- Added native Nova `messages-v1` InvokeModel payload construction, tool-result ID preservation, tool-call response parsing, and truthful completion/usage reporting. Empty responses and max-token truncations cannot report `done: true`.
- Hugging Face remains explicitly unpriced by default, with the existing per-model override path now explained in `docs/budget-semantics.md`.

Regression tests / local verification:

```text
bun test test/cost-budget-truth.test.ts
34 pass / 0 fail / 127 assertions

bun test test/providers/bedrock-nova.test.ts
3 pass / 0 fail / 12 assertions

bun run typecheck
exit 0 (root + desktop TypeScript)

bun run claim-lint
exit 0 — 20 evidenced claims; model facts in date; v1.2.0-preview.6

bun run boundaries
exit 0 — 819 modules; 1 existing no-orphans warning (src/cost/pricing-types.ts), 0 errors

git diff --check
exit 0
```

A local test initially caught an empty Nova `end_turn` incorrectly being completed; the implementation was corrected before verification. No CI attempt has been made yet for this item. Commit/push and required CI evidence will be added before beginning the next Phase 1 item.

CI for Phase 1.1 (`3518da4dd076a3f7df7e805288ef9c5caaa17e92`, PR #231) completed green before beginning the next fix. Required aggregate checks:

- Quality Gate: https://github.com/ahmadrrrtx/xr/actions/runs/46101953717/job/140847206468
- Cross-Platform gate: https://github.com/ahmadrrrtx/xr/actions/runs/46101953684/job/140849050743
- Supply Chain gate: https://github.com/ahmadrrrtx/xr/actions/runs/46101953677/job/140846359942
- npm Pack Smoke gate: https://github.com/ahmadrrrtx/xr/actions/runs/46101953678/job/140847170306
- Desktop gate (bundles + latest.json + journey): https://github.com/ahmadrrrtx/xr/actions/runs/46101953760/job/140854842751
- Clean-Machine Journey gate: https://github.com/ahmadrrrtx/xr/actions/runs/46101953671/job/140847108119

All six are `pass`; CI run attempt count for NEW-2 remains 0 failed.

### Phase 1.2 — unpriced UX in dashboard and desktop

Inspection showed the CLI already had a true `unpriced` stop path and regression test (`test/cli/coder/routing-and-events.test.ts`, 23/0); the direct B4 test also covers the CLI's unpriced wording. Preview 6's daemon emits `unpriced_stopped` and its governor reason includes the rate path. The dashboard did **not** display canonical `type:error` JSON frames: it threw on them and its catch intentionally ignored JSON payloads, leaving an empty assistant response. Desktop preserved the engine's error detail but used the generic title "The model run failed.".

Fixes:

- The dashboard now renders `unpriced` as "This model has no known price. Pick a priced model or set a rate." plus the engine reason; it also retains budget stops as budget, and status details for unpriced/budget are announced instead of dropped.
- The desktop error card gives `code: unpriced` its own warning title and points to the documented per-model rate declaration path. It does not tell users to raise their budget.
- Added regression tests that execute the served dashboard's formatter and exercise the desktop card copy.

Local verification:

```text
bun test test/daemon/unpriced-chat-ux.test.ts  -> 2 pass / 0 fail / 7 assertions
bun test test/desktop/unpriced-chat-ux.test.ts -> 2 pass / 0 fail / 7 assertions
bun test test/cli/coder/routing-and-events.test.ts -> 23 pass / 0 fail / 50 assertions
bun test test/daemon/phase-c.test.ts -> 26 pass / 0 fail / 77 assertions (including served script syntax parse)
bun run typecheck -> exit 0 (root + desktop TypeScript)
bun run desktop:sink-lint -> exit 0 (510 renderer files, 0 violations)
git diff --check -> exit 0
```

The dashboard formatter was also evaluated against an unpriced message; it returned a literal two-line actionable message and no budget wording. Phase 1.2 CI attempt count: 0 (not yet pushed at this log entry).
