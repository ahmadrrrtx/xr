# XR 5.1 — Phase 8 Architecture: Environment Interaction OS

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Status:** implemented design contract. Normative vocabulary for `src/environment/`.

Phase 8 turns browser, desktop, filesystem, application, voice, and vision from
separate helpers into **one governed interaction layer**. It does not add a new
browser harness, new desktop action types, a new workflow engine, or new routing.
It wraps the existing, audited primitives in one contract and one safety model.

```
                ┌────────────────────────────────────────────────────┐
                │                 Entry surfaces                      │
                │  xr env · xr control · voice pipeline · agent tools │
                └───────────────┬────────────────────────────────────┘
                                │ every consequential action
                                ▼
                ┌────────────────────────────────────────────────────┐
                │     EnvironmentService (src/environment/service)    │
                │  kill-switch → schema → capability → target proof → │
                │  privacy/consent → risk+reversibility+approval →    │
                │  permission → session → stale-check → execute →     │
                │  bounded recovery → outcome record                  │
                └───┬───────────┬───────────┬───────────┬────────────┘
                    │           │           │           │
              browser.ts   executor.ts   files.ts   vision.ts / voice/*
              (isolated    (existing     (existing  (existing helpers
               sessions)    adapters)                 + consent gates)
                    │           │           │           │
                ┌───▼───────────▼───────────▼───────────▼────────────┐
                │  Phase 2 execution fabric (record, idempotency)     │
                │  Phase 3 trust/placement (risk tier, fail-closed)   │
                │  Phase 4 durability (audit checkpoints, cancel)     │
                │  Phase 5 intelligence (local/cloud consent routing) │
                │  Phase 6 context (evidence, provenance, untrusted)  │
                │  Phase 7 workflow (tool_action nodes w/ metadata)   │
                └────────────────────────────────────────────────────┘
```

## 7.1 Universal environment-control contract

`src/environment/types.ts`. One request/assessment/record triple covers every
environment without flattening domain detail (the wrapped control `Action` keeps
its discriminated union; the environment layer adds identity, perception, and
authority metadata around it):

- `EnvironmentType` — `browser | desktop | filesystem | application | voice | vision`.
- `EnvironmentSession` — id, type, lifecycle state, workspace/task/execution
  scope, policy, resource refs (tabs, downloads root, audio), cleanup state,
  action history. Sessions never share cookies, credentials, downloads, or
  audio/video resources across scopes.
- `TargetIdentity` — `semantic` (selector/role/name + evidence), `coordinate`
  (x/y + mandatory evidence ref), `resource` (path/url), `application` (name),
  or `none`. Coordinate without evidence is rejected.
- `InteractionKind` — `semantic | coordinate | structural | stream`.
  Semantic-first is enforced where the platform supports it; coordinate actions
  carry elevated risk and approval.
- `ObservationConfidence` — `high | medium | low | unknown`. `unknown` is never
  treated as certain.
- `Reversibility` — `reversible | compensatable | irreversible | unknown`
  (with `compensation` description when compensatable). The execution layer must
  not claim rollback where none exists.
- `ApprovalStrength` — `none | standard | strong`. `strong` = irreversible /
  unknown-reversibility actions, coordinate actions with non-high confidence, and
  sensitive-value actions from any channel. Strong approvals never auto-approve
  and, from voice, require a stronger channel when policy demands it.
- `EnvironmentPolicy` — per-session: allowed/blocked domains, private-network
  blocking (default on for governed browser sessions), downloads root + cap,
  cloud consent references, credential mode (`none` — XR never injects
  credentials into environments in this phase).
- `EnvironmentOutcome` — `succeeded | failed | denied | blocked | cancelled | uncertain`
  where `uncertain` means *side effect unknown* and is always user-visible.

## 7.2 Environment lifecycle

State machine (`lifecycle.ts`), transitions validated and audited:

```
discover → provision → ready → active ⇄ paused
                            │      │
                            ▼      ▼
                 failed ──► closing ──► closed        (terminal)
                     └────► quarantined                (terminal, human-reviewable)
```

Rules: sessions are bound to `workspaceId` (+ optional task/execution ref);
`maxActiveSessions` bound; idle sweep closes idle sessions; `close()` always runs
provider cleanup and records `cleanupState` (`succeeded|partial|failed`);
an action whose side effect is unknown during teardown moves the session to
`quarantined` with a reason — quarantined sessions perform no further actions.

## 7.3 Browser model

Provider wraps the existing hardened Playwright integration:

- **Isolation:** each governed session gets its own browser context (isolated
  storage state, own `downloadsPath` under `~/.xr/browser/<sessionId>`), created
  lazily on first action. The legacy shared-context path in `control/browser.ts`
  remains for back-compat (`xr control …`) but governed sessions never share it.
- **Sandbox:** launch only through the existing secure-args path; sandbox state
  is reported (`browserSessionStatus`) and root/no-sandbox stays fail-closed.
- **Network policy:** per-session `allowedDomains` / `blockedDomains` /
  `blockPrivateNetworks` (default **true** for governed sessions) enforced at
  `validateBrowserUrl` + navigation time; redirects landing on private/localhost
  targets are blocked.
- **Credentials:** no credential injection APIs are added; sessions never receive
  `storageState` from outside and never write it back out.
- **Observations:** every navigation/mutation records `{url, title, at}`; extracts
  are typed `untrusted_external` evidence; screenshots are artifact refs
  (path+hash), not embedded blobs.
- **Tabs:** tab identity is index-tracked per session; total tabs bounded.
- **Crash/cleanup:** page `crash`/`close` events mark the session failed; close
  attempts context+browser cleanup and reports state; unknown side effect at
  teardown → quarantine.
- **Semantic first:** `click/fill/type/press` accept Playwright selectors
  (CSS/text/role). Coordinate browser actions are not part of the browser
  contract at all — coordinate interaction is a desktop concern with stronger
  gates.

## 7.4 Desktop / application model

- Uses the existing action types only (`app, close, focus, open, type, click,
  drag_drop, move, scroll, key, wait_ms, editor, screenshot, system`).
- `TargetIdentity` required: `semantic` (window/app name) or `coordinate` with an
  observation evidence ref (screenshot/vision observation) that must be **fresh**
  (`≤ staleObservationMs`). A stale observation blocks the coordinate action with
  an explicit reason (no silent acting on old perception).
- Platform capability detection (`capabilities.ts`) drives honest availability:
  missing `xdotool`/`wmctrl`/`cliclick` → capability `unsupported` with
  remediation; actions fail closed. `move` is move-only; scroll on platforms
  without a backend reports unsupported instead of claiming success.
- Destructive classes unchanged; `computer_use` loops now run each step through
  the same governed gate (approval policy, circuit breaker) with screen
  observations framed as untrusted content.

## 7.5 Voice model

Voice is an **interface**, never an authority bypass:

- `voice` environment actions are control intents parsed by the deterministic
  parser, carrying `confidence` and `sourceActor: voice`.
- Same approval policy as text. `confirmationPolicy` is now honored on the
  deterministic control path too: `never-execute-risky` blocks any non-safe
  action from voice with a spoken refusal; `always` / `always-risky` route
  approval through the standard queue (CLI/dashboard), never a silent yes.
- High-risk actions may require confirmation in a stronger channel: when an
  action needs `strong` approval and the session is voice-sourced and unattended
  (`XR_CONTROL_FORCE_TEST` aside), the environment gate fails with a reason that
  tells the user to approve in text/dashboard. Voice confirmation itself is used
  only for the agent-path approver that already exists.
- Low-confidence refusal: `intent.confidence < env.voice.minControlConfidence`
  for control intents → spoken clarification request, no execution.
- Consent: cloud STT/TTS unchanged (default deny); transcripts only persisted
  under `local-private` (0o600); pipeline stays push-to-talk by default.

## 7.6 Vision model

- `observe()` produces an `EnvironmentObservation`: source (`screen|browser|image`),
  artifact ref (path + sha256 + bytes, capped), confidence, provenance
  (`screenshot`/`ocr`/`vision_model`), sensitivity (`private` for full-screen —
  we claim no sensitive-region detection and treat all screen captures as
  potentially sensitive), staleness (`isStale(now, staleObservationMs)`).
- Local OCR by default; cloud vision requires `environment.vision.allowCloud`
  **and** an explicit per-call consent marker — otherwise the observation stays
  local-only and the record notes the refusal.
- Vision observations are **observation, not authority**: they enter context as
  `evidence`/`untrusted_external` (Phase 6 types), and any action derived from
  them carries `confidence` forward — low-confidence vision cannot authorize a
  destructive action.

## 7.7 Recovery / self-healing (bounded)

`recovery.ts`:

- Error taxonomy → `retryable_reobserve` (stale selector, navigation timeout,
  element not found), `retryable_transient` (process spawn flake), or
  `terminal` (denied, permission, capability, validation).
- Budget: **at most one** automatic retry for `retryable_reobserve`, preceded by
  a mandatory re-observation, within the action's timeout, only when the action
  is not irreversible/unknown. Irreversible or unknown-side-effect failures never
  auto-retry.
- Circuit breaker: per-session consecutive failure count ≥ `circuitFailures`
  (default 3) opens the circuit for `circuitCooldownMs` (default 60 s); while
  open, actions fail fast with the open reason. Half-open probe allowed after
  cooldown. All transitions audited.
- Action history is preserved on the session record; nothing mutates the
  environment in a loop without a transactional human gate after threshold.

## 7.8 Reversibility contract

Every environment action carries `reversibility` + optional `compensation`:

| Class | Approval | Execution rule |
|---|---|---|
| `reversible` | per risk level | normal |
| `compensatable` | per risk level | compensation description recorded; filesystem write/mkdir gets a pre-image where feasible (`filesystem` provider) |
| `irreversible` | **strong** approval always, never auto-approved | dry-run eligible; dry-run results are marked simulated |
| `unknown` | **strong** approval, treated as irreversible | coordinate defaults here unless evidence upgrades it |

## 7.9 Design constraints honored

- Phase 3 trust/placement stays authoritative — environment layer adds policy,
  never widens authority; high-risk actions fail closed without isolation.
- No remote environment execution; no new workflow engine; no silent cloud
  audio/image transfer; no secrets in screenshots/transcripts/logs (redaction
  in `privacy.ts` + existing `control/audit.ts`); no unsupported-platform silent
  degradation — unsupported is reported and fails closed.
