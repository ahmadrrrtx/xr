# XR 5.1 — Phase 8 Required Repository Audit

**Baseline verified:** XR 5.0.0 (Phase 7) at commit `d802bf6` on `main`.
**Gates run before this audit:** `bun install --frozen-lockfile` ✅ · `bun run typecheck` ✅ (0 errors) · `bun test` ✅ (977 pass / 0 fail) · `bun run ci` ✅ (set-version + baseline inventory in sync).

This audit inventories every supported environment action, its risk, reversibility,
permissions, placement, output, timeout, cancellation, and cleanup behavior, and
produces the ten deliverables required by the Phase 8 implementation prompt.

---

## 1. Environment-Action Matrix

Source of truth today: `src/control/types.ts` (`ActionSchema`), risk in
`src/control/classify.ts`, permissions in `src/control/permissions.ts`,
execution in `src/control/executor.ts`, `src/control/browser.ts`,
`src/control/files.ts`, `src/control/vision.ts`, `src/control/computer-use.ts`.

| Action (type.op) | Environment | Risk (classifier) | Reversible (declared) | Permission scope | Placement today | Output | Timeout | Cancellation | Cleanup |
|---|---|---|---|---|---|---|---|---|---|
| `app` | application | sensitive | yes (bool) | `desktop` | in-process spawn | message | 10 s proc | proc timeout kill | none |
| `close` | application | sensitive | yes (claimed) | `desktop` | in-process spawn (pkill/Stop-Process) | message | 10 s | kill | none |
| `focus` | application | safe | yes | `desktop` | in-process | message | 10 s | kill | none |
| `open` | application | sensitive → destructive if target can execute | yes/no | `desktop` | in-process `open`/`xdg-open`/Start-Process | message | 10 s | kill | none |
| `type` | desktop | sensitive → destructive if `sensitive` or shell-like | yes/no (destructive=no) | `desktop` | in-process (xdotool/osascript/SendKeys) | message | 10 s | kill | none |
| `click` | desktop | sensitive | **no** | `desktop` | in-process (coordinate) | message | 10 s | kill | none |
| `drag_drop` | desktop | sensitive | yes (claimed) | `desktop` | in-process (coordinate) | message | 10 s | kill | none |
| `move` | desktop | safe (⚠ classifier says safe; executor maps `move`→click code path — see findings) | yes | `desktop` | in-process | message | 10 s | kill | none |
| `scroll` | desktop | safe | yes | `desktop` | in-process (linux real; macOS/win no-op "ok") | message | 10 s | kill | none |
| `key` | desktop | sensitive → destructive for Enter/cmd-delete etc. | yes/no | `desktop` | in-process | message | 10 s | kill | none |
| `wait_ms` | desktop | safe | yes | `desktop` | in-process sleep | message | ≤15 s by schema | timer | n/a |
| `browser.goto` | browser | sensitive → destructive on dangerous scheme | yes/no | `browser` | single global chromium context | message | 100 ms–60 s | none (awaited) | none per nav |
| `browser.click/fill/type/press` | browser | sensitive → destructive for submit/Enter/sensitive | yes/no | `browser` | global context | message | 100 ms–60 s | none | none |
| `browser.wait` | browser | safe | yes | `browser` | global context | message | 100 ms–60 s | none | none |
| `browser.extract` | browser | safe | yes | `browser` | global context | text ≤20 000 chars | 100 ms–60 s | none | n/a |
| `browser.screenshot` | browser | safe | yes | `browser` | global context | path under cwd | 100 ms–60 s | none | file persists |
| `browser.new_tab/close_tab/switch_tab` | browser | safe | yes | `browser` | global context | message | default | none | tab close |
| `browser.upload/drag/submit` | browser | schema allows; executor has **no case** (fails `"not implemented"`) | — | `browser` | — | error | — | — | — |
| `browser.close` | browser | safe | yes | `browser` | closes global browser | message | — | — | context+browser close |
| `file.read/list` | filesystem | sensitive | yes | implicit (`files_read` auto-allowed) | in-process fs | text/list ≤200 000 chars | none | none | n/a |
| `file.write/mkdir/move/delete` | filesystem | destructive | no | `files_write` | in-process fs | message | none | none | none (no backup) |
| `editor.open` | application | sensitive | yes | `desktop` | spawn `code`/`cursor`/`vim` | message | 10 s | kill | none |
| `screenshot` (screen) | vision (capture) /desktop | safe | yes | `desktop` | screencapture/scrot/import/PS | path(+base64 in memory) | 8–10 s | kill | tmp file deleted ≤60 s |
| `system.clipboard_read / volume_get / notify` | desktop/system | safe | yes | `system` | in-process | text | 10 s | kill | n/a |
| `system.clipboard_write / volume_set` | desktop/system | sensitive | yes | `system` | in-process | message (**executor: not implemented except clipboard_read**) | 10 s | kill | n/a |
| `computer_use` | desktop+vision | destructive | no | `desktop` | loop: screenshot→cloud vision→`execute()` | text | maxSteps ≤30 | none per step (⚠ see findings) | screenshot tmp ≤60 s |

Timeout base: `executor.ts` `TIMEOUT = 10 000` per spawned process; browser ops clamp
`action.timeoutMs` to 100–60 000 ms; vision capture 8 000–10 000 ms; OCR 12 000 ms;
STT network 45 000 ms (AbortSignal) and whisper CLI 120 000 ms; TTS per backend.

### Voice surface (observed)

| Capability | Backend | Consent gate | Storage | Notes |
|---|---|---|---|---|
| STT | whisper CLI, whisper.cpp, local HTTP, groq, openai | `allowCloudStt` (default **false**) or explicit `XR_VOICE_ALLOW_CLOUD_STT=1`; cloud refused without it | temp wav dir removed after each call | no confidence from whisper CLI; `SttResult.confidence` optional |
| TTS | piper, kokoro-cli, system (say/espeak/powershell), local HTTP | `allowCloudTts` (default false) | temp files removed | barge-in supported via `PlaybackHandle.stop()` |
| VAD | energy (local) / silero-external | n/a (local) | none | threshold configurable |
| Wake | transcript-side patterns / openwakeword-external | mode default `push-to-talk`; always-listen **off** by default and reset in `patchVoiceSettings` | none | deterministic |
| Intents | deterministic regex parser with confidence per kind | routes to control/memory/research/agent | transcript only when policy `local-private` (0o600 jsonl) | control intents call `runAction` directly |
| Confirmation | `parseConfirmation` over STT, 3 attempts then deny | `confirmationPolicy`: `always-risky` / `always` / `never-execute-risky` (voiceApprover, agent path only) | audit events | ⚠ not applied to deterministic control path |
| Hardware | arecord/afrecord/sox (rec), afplay/aplay/paplay; devices via pactl/osascript | missing tools degrade gracefully | none | no crash on unsupported platform |

### Vision surface (observed)

| Capability | Path | Privacy today | Limits |
|---|---|---|---|
| Screen capture | `vision.captureScreen` (screencapture/scrot/import/PS) | tmp png deleted after 60 s; base64 retained in caller memory | 8–10 s timeout; no size cap |
| OCR | `ocrImage` via local `tesseract` | local-only | `[OCR unavailable]` graceful |
| Cloud vision | `cloudVision(provider, prompt, base64)` | **no explicit vision-cloud consent check**; `vision_cloud` PermissionScope exists but is never consulted | image sent as base64 to provider chat |
| Computer-use loop | `computer-use.ts` | screen content + task embedded in prompt each step (untrusted visual content → cloud) | maxSteps ≤ 30; 800 ms pause |

---

## 2. Browser/Desktop/Voice/Vision Capability Map

| Capability | macOS | Linux | Windows | Backend |
|---|---|---|---|---|
| App launch/focus/close | ✅ osascript/open | ✅ gtk-launch/xdg-open/wmctrl/pkill | ✅ PowerShell | executor |
| Keyboard type/key | ✅ osascript | ✅ xdotool | ✅ SendKeys(PS) | executor |
| Mouse click/drag/scroll | partial — click/drag need `cliclick`; scroll returns success without acting | ✅ xdotool | ✅ mouse_event; scroll returned as ok without acting | executor |
| Window focus | ✅ | ✅ wmctrl | ⚠ returns ok unconditionally | executor |
| Screenshots | ✅ screencapture | ✅ gnome-screenshot/scrot/import (cascade) | ✅ PS | vision.ts |
| OCR | ✅ tesseract if installed | ✅ | ✅ | local |
| Browser | ✅ Playwright chromium (single global session) | ✅ (root requires explicit unsafe flags) | ✅ | browser.ts |
| Clipboard R/W | ✅ (write approval-gated in tools; control executor write **not implemented**) | ✅ xclip/xsel | ✅ PS | system-control tools (impl), executor (read only) |
| Notifications | ✅ osascript (tool) | ⚠ tool returns ok without sending | ⚠ | system-control tool |
| Volume/battery/wifi/media/trash | ❌ honest stubs returning "unavailable in this build" | ❌ | ❌ | system-control |
| Voice capture/playback | ✅ afrecord/afplay | ✅ arecord/aplay (ALSA/pulse) | ⚠ limited | hardware.ts |
| STT local | ✅ whisper CLI / whisper.cpp | ✅ | ✅ | stt.ts |
| TTS local | ✅ say/piper/kokoro | ✅ espeak/piper/kokoro | ✅ powershell | tts.ts |
| Computer-use loop | any platform with screenshot+vision provider | same | same | computer-use.ts |

## 3. Platform Support Matrix (honest)

- **Full:** application launch/focus/close, keyboard, browser sessions, screenshots,
  OCR — on macOS + Linux + Windows (Windows voice capture partial).
- **Partial:** mouse on macOS (requires `cliclick`, failures are explicit); scroll on
  macOS/Windows (reports success without acting ⚠ *fixed in Phase 8 — see findings*);
  Linux requires `xdotool`/`wmctrl` (`adapter.ts` reports missing tools).
- **Unavailable (fail-closed today):** volume/media/battery/wifi/trash on all
  platforms — stubs report unavailable. Phase 8 keeps them unavailable and surfaces
  this in the capability matrix rather than pretending support.
- **Root+container:** browser launch blocked with a secure message unless
  `XR_BROWSER_DISABLE_SANDBOX=1` + `XR_BROWSER_UNSAFE_ACK=1` (+`XR_BROWSER_ALLOW_ROOT=1`)
  are explicitly set; sandbox is enabled by default (verified by
  `test/control/browser.test.ts` source assertions).

## 4. Risk / Authority / Placement Map

Current risk model = 3 levels (`safe|sensitive|destructive`) + boolean `reversible`
in `src/control/classify.ts`. Authority = coarse `PermissionScope` grants persisted
at `~/.xr/control-permissions.json`. Placement = always in-process for control
actions; the execution fabric (`control-adapter.ts`) attaches a trust record via
`controlTrustRequest` when the agent-tool path is used — **the CLI path
(`xr control …`) does not create execution records.**

Phase 3 trust model available to consume: `RiskTier` (tier0/1/2), placements
(`in_process`, `restricted_process`, `namespace_sandbox`, `container`,
`browser_isolated`), fail-closed Tier 2 (`TrustService`), credential broker
(references only).

Phase 8 gap → contract: environment actions need **reversibility classes**
(`reversible|compensatable|irreversible|unknown`) instead of a boolean,
**perception confidence**, **target identity** (semantic vs coordinate with
evidence), **approval strength** (standard vs strong), and **session scoped
placement** (isolated browser profiles; fail-closed when required isolation is
missing).

## 5. Reversibility / Compensation Map (audited vs declared)

| Action | Declared today | Audit verdict (honest) |
|---|---|---|
| move/scroll/wait/focus/screenshot/browser read-only ops | reversible | ✅ reversible (ephemeral UI state) |
| `close` app | reversible | ⚠ truly **compensatable** (relaunch) — unsaved work may be lost |
| `open` safe target | reversible | ✅ compensatable (close what opened) |
| `app` launch | reversible | ✅ compensatable (quit) |
| `type`/`key` non-destructive | reversible | ⚠ **irreversible** once delivered into an app (chat send, form submit chain) unless app-level undo; must not claim rollback |
| `click` / `drag_drop` | irreversible / reversible | ⚠ honest class **unknown** — effect depends on target; coordinate clicks must default to `unknown` |
| `browser.fill/type/press` | reversible | ⚠ compensatable only pre-submit; after submit irreversible external write |
| `browser.submit`/Enter/`goto dangerous`/`type sensitive` | destructive, not reversible | ✅ irreversible |
| `file.write/mkdir` | destructive, irreversible | ⚠ **compensatable** when a backup/pre-image exists; Phase 8 adds pre-image compensation for write/mkdir |
| `file.move` | destructive | ✅ compensatable (move back) |
| `file.delete` | destructive | ✅ irreversible (rm, no trash) |
| `computer_use` | irreversible | ✅ irreversible/unknown per step — loop must inherit governed gates |
| voice intents | n/a | inherit the mapped control action class |

Workflow `CompensationPolicy.scope` (`none|best_effort|reversible_action|compensating_transaction`)
is the mapping target; Phase 7 `compensation` nodes can consume it.

## 6. Privacy / Credential Map

| Asset | Current protection | Gaps Phase 8 closes |
|---|---|---|
| Typed secrets (`type.sensitive`, `browser.sensitive`) | redacted in audit (`audit.ts`), preview, planner prompt instructs `sensitive:true`; executor does not log values | value redaction extended to environment records/observations |
| API keys in config | loaded to env once; audit store redacts obvious keys | unchanged |
| Cookies/sessions | one shared Playwright context; no credential injection API; `permissions: []`, no persistence (`storageState` never written) | ⚠ single global context means all tasks share cookies; Phase 8 adds session-scoped isolated contexts with cleanup on close |
| Downloads | `acceptDownloads:false`; downloadsPath under cwd default; traversal-safe screenshot path | per-session downloads root + cap added |
| Private network | blocked only when `XR_BROWSER_BLOCK_PRIVATE_IPS/LOCALHOST=1` | policy becomes part of environment session policy (fail-closed default for governed sessions) |
| Screenshots | tmp file ≤60 s; base64 in memory | no raw retention by default in records (path+hash only); cloud routing gated by `allowCloudVision` |
| Transcripts | only persisted when `transcriptPolicy=local-private`, 0o600 | unchanged; metadata-only status elsewhere |
| Cloud STT/TTS | default deny (`allowCloudStt/Tts=false`); explicit per-backend refusal message | cloud vision gets the same explicit consent gate |
| Egress | agent path honors `security.egressAllowlist` | browser sessions receive domain allow/block policy per session |
| Untrusted content | Phase 6 context taxonomy + quarantine injection | browser extract/vision observations enter as evidence/untrusted with provenance, never instructions |

## 7. Workflow / Execution Integration Map

| Phase contract | How environment actions consume it today | Phase 8 integration |
|---|---|---|
| Phase 1 kernel (ServiceRegistry) | control runs standalone | environment service resolves through same config/store; no new kernel changes |
| Phase 2 execution fabric | agent tool path: `executeControlAction` adapter creates `ExecutionRecord` w/ idempotency `unknown_unsafe`, trust request, evidence `control_record` | `runEnvironmentAction` optionally receives an `ExecutionService` and produces the record via the same adapter; CLI still works without it |
| Phase 3 trust/placement | control-adapter attaches `controlTrustRequest` (host-authority for destructive GUI, admitted with elevated gate) | high-risk environment actions map to RiskTier; Tier 2 (untrusted code) fails closed without an enforceable backend — no silent downgrade |
| Phase 4 durability | checkpoints/leases/recovery exist for executions | long-running environment sessions checkpoint via audit events (`env.session.*`), cancel cleanly via `close`, unknown side effects → `uncertain` outcome + quarantine |
| Phase 5 intelligence | cloud vision uses provider directly | voice/vision cloud routing checks consent + provider locality (`isLocal`) |
| Phase 6 context | taxonomy/injection exist | observations/extracts typed as `evidence`/`untrusted` with provenance + confidence; never instructions |
| Phase 7 workflow | `tool_action` node family `control_action` exists; engine records execution | `environment/workflow-binding.ts` factory builds canonical ToolActionNodes with riskTier/compensation/idempotency mapped from the environment assessment |

## 8. Failure / Recovery Matrix (audited)

| Failure | Current behavior | Phase 8 behavior |
|---|---|---|
| Playwright missing | `browserAvailable()` always reports `available:true` (⚠ fallback branch unreachable-optimistic) | capability probe reports honestly; actions fail closed with remediation |
| Root launch | blocked with secure message | unchanged (kept) |
| Browser crash | `page.isClosed()` checked next call; no crash listener; global cache may return dead page | session provider listens for crash; session → `failed`; cleanup attempted; quarantine on unknown side effect |
| Selector not found | Playwright timeout error string | classified `recoverable:reobserve` → **one** bounded retry with fresh observation |
| Navigation timeout | error string | same bounded retry budget; then circuit |
| Repeated failures | none (caller loop decides) | per-session circuit breaker (3 consecutive failures → open 60 s, actions fail with reason) |
| Missing desktop tools | `isControlReady` blocks with missing-tools message | unchanged; capability matrix reports remediation |
| Mic/STT/TTS unavailable | graceful `ok:false` detail strings | unchanged; surfaced in env capabilities |
| STT low confidence / empty | `handled:false` | explicit low-confidence refusal path for control intents (`env.voice.minControlConfidence`) |
| Vision provider error | string returned | observation confidence `unknown`; no action claimed |
| Screenshot tool missing | explicit failure message | unchanged; platform matrix honest |
| `computer_use` step failure | logs; loop continues | loop steps now pass through governed gates (approval per policy), circuit breaker applies, unrecoverable → stop |
| Process kill of browser | global `cached` dangling | `closeAllSessions()` best-effort + session registry marks `closed`/`failed` |
| Cleanup failure | swallowed (`catch{}`) | cleanup state recorded (`partial`/`failed`) + audit; quarantine option |

## 9. File-by-File Proposal

### New module `src/environment/`
| File | Purpose |
|---|---|
| `types.ts` | Universal environment contract: environment types, lifecycle states, session, target identity, interaction kind, confidence, reversibility, approval strength, observation, outcome, policy, records (zod where parsed externally) |
| `lifecycle.ts` | Session state machine (discover→provision→ready→active→paused/failed→closing→closed/quarantined), valid-transition table, registry (workspace-scoped, max-active bound, idle sweep) |
| `classify.ts` | Map control `Action` → environment profile: interaction kind, target identity, reversibility class, approval strength, coordinate-evidence requirements, perception confidence checks |
| `privacy.ts` | Secret redaction for records/observations, cloud-consent gate (stt/tts/vision), transcript/screenshot retention policy helpers |
| `recovery.ts` | Bounded retry budget, recoverable-error classification, per-session circuit breaker, unknown-side-effect guard (never auto-retry irreversible/unknown) |
| `capabilities.ts` | Platform capability detection per environment (desktop tools, playwright import, screenshot, audio, STT/TTS), honest partial/unsupported report, fail-closed assert |
| `sessions.ts` | Session registry merge with lifecycle; close-all; quarantine |
| `service.ts` | `runEnvironmentAction` governed entry: kill-switch → validate → capability → target/evidence → privacy → risk+reversibility → permission → session → approval → stale-check → execute (control path / optional ExecutionService record) → bounded recovery → record outcome; `observe` for vision; `closeSession` |
| `audit.ts` | `env.*` audit events (session lifecycle, action assessed/approved/executed/denied, recovery, circuit, privacy block, quarantine) |
| `workflow-binding.ts` | ToolActionNode factory + risk/compensation/idempotency mapping |
| `cli.ts` + `../commands/environment.ts` | `xr env` group: status, capabilities, sessions, close, history (--json everywhere) |
| `providers/browser.ts` | Session isolation, per-session URL/network policy, observations (url/title), crash→failed, downloads root, cleanup |
| `providers/desktop.ts` | Desktop/application capability checks + observation capture for coordinate evidence |
| `providers/filesystem.ts` | Workspace-root scoping + pre-image capture for write/mkdir compensation |
| `providers/voice.ts` | Voice consent/confidence gate used by `src/voice/intents.ts` (no hardware access here) |
| `providers/vision.ts` | Observation records: source, policy consent, size bounds, redaction decision, stale check, local/cloud routing decision |
| `index.ts` | Public exports |

### Modified existing files (minimal, behavior-preserving)
| File | Change |
|---|---|
| `src/control/browser.ts` | Add isolated session API (`openBrowserSession/closeBrowserSession/browserSessionStatus` + per-session policy: url validation w/ private-network + domain allow/block, downloads root, crash listener, observation getter). Keep legacy global path untouched. Export `validateBrowserUrl`. |
| `src/control/executor.ts` | Fix `move` (currently clicks) to move-only; make scroll report honestly on macOS/Windows (`skipped` unsupported instead of fake success); system op unsupported → honest failure (keep clipboard_read). |
| `src/control/computer-use.ts` | Route each step through the governed environment path (risk/approval/circuit), pass observation refs + confidence, stop on denial/circuit; inject untrusted-content framing in prompt. |
| `src/control/vision.ts` | Add image byte cap + explicit cloud consent parameter (no behavior change for local OCR); keep base64 retention caller-side only. |
| `src/voice/intents.ts` | Route control intents through `runEnvironmentAction` (voice-sourced) honoring `confirmationPolicy: never-execute-risky` and `minControlConfidence`; unchanged memory/provider/model/budget behavior. |
| `src/config/config.ts` | CONFIG_VERSION 15→16, additive `environment` block + migration 15→16 (defaults preserve existing posture: cloud consent off, private-network block on for governed sessions). |
| `src/cli/catalog.ts`, `src/cli/router.ts` | Register `env` command. |
| `src/daemon/server.ts` + new `src/daemon/environment-api.ts` | `/api/environment/status|sessions|capabilities|history|close`. |
| `src/commands/doctor.ts` | Add environment capability summary check. |
| `MIGRATION.md`, `CHANGELOG.md`, `README.md` | 5.0→5.1 docs. |
| `package.json`, `src/core/version.ts`, `website/src/lib/site.ts` | version 4.5.0→5.1.0 via `scripts/set-version.ts`. |

### New tests `test/environment/`
`types.test.ts`, `lifecycle.test.ts`, `classify.test.ts`, `privacy.test.ts`,
`recovery.test.ts`, `capabilities.test.ts`, `service.test.ts`,
`adversarial.test.ts`, `migration.test.ts`, `workflow-binding.test.ts`,
`computer-use.test.ts`.

### New docs
`docs/environment/{README,BROWSER,DESKTOP,VOICE,VISION,REVERSIBILITY,RECOVERY,PLATFORM_SUPPORT,TESTING,USER_GUIDE}.md`,
`docs/phase8/{PHASE8_ARCHITECTURE.md,PHASE8_AUDIT_REPORT.md,PHASE8_RELEASE_VALIDATION.md}`.

## 10. Deferred Phase 9+ Issues (explicitly NOT in this phase)

- Remote/browser workers, remote desktop execution (scalability note in roadmap).
- Mobile clients.
- Visual workflow editor.
- Capability ecosystem / marketplace certification for environment providers.
- Enterprise control plane (central policy server, RBAC).
- Automatic model routing changes (Phase 5 owns routing; we only consume).
- New memory/context architecture (Phase 6 owns; we only emit typed evidence).
- New workflow engine features (Phase 7 owns; we only bind nodes).
- Real desktop accessibility-tree automation APIs (macOS AX, UIA) — platform
  matrix stays partial-honest; semantic-first applies to browser (Playwright
  role/text selectors usable today) and desktop where OS tools support it.
- Always-on wake-word audio processing (openWakeWord stays external, opt-in).
- Cloud transcription by default; silent telemetry of any audio/image.
- Trash/volume/media/wifi implementations (stubs stay honest-unavailable).
