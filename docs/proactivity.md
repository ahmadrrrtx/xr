# Proactivity — governed triggers (Phase 9)

XR does not run unbounded autonomous tasks. Every scheduled, event-driven, or
watch-path action is a **trigger** in a durable table, and every fire is a
normal envelope on the **one spine** (policy, grants, budget, audit).

## What a trigger is

| Kind | Fires when |
| --- | --- |
| `cron` | 5-field expr (`m h dom mon dow`) or a natural-language schedule is due |
| `event` | `TriggerService.notify(event)` — never from the ticker |
| `watch` | watched path mtime is newer than `lastFiredAt` |

Creating one **requires**:

1. **Explicit consent** (`consentRef` — CLI `--consent`, an approval id, …)
2. **A budget declaration** (`maxUsd` and/or `maxTokens`)

Without both, create refuses. There is no implicit “just run this every morning”.

Optional: `approvalMode` (`inherit` | `require`), `quietHours` (`HH:MM-HH:MM`,
wraps midnight).

## The kill switch

`pause-all` stops **new** fires. In-flight envelopes keep their own cancel
path (A-19 `AbortController`). Pause is durable (`config.triggers.pauseAll`)
and audited (`triggers.paused` / `triggers.resumed`).

Visible from:

- `xr triggers` / `xr triggers status`
- `GET /api/triggers` (`pauseAll`, `inflight`, `triggers`)
- Telegram `/pause-all` and `/resume-all`

Not from `xr status` — that surface is frozen.

```
xr triggers pause-all
xr triggers resume-all
```

Daemon: `POST /api/triggers/pause` with `{ "pauseAll": true|false }`.

## Fire path

1. Scheduler tick (daemon loop, `config.triggers.tickMs`, default 15s) or `notify`.
2. Skip if paused / disabled / quiet / not due / already in-flight.
3. Audit `trigger.fired` with envelope id, budget, approval mode, consent.
4. Mint `agent:scheduler` identity (depth 0).
5. `executeOnSurface({ surface: "scheduler", budget: trigger.budget, signal })`.
6. Record spend on the row. Fire **history** lives in the audit chain.

Identity, budget, and approval cannot be widened at fire time.

## Telegram (channel polish)

Per-user **token bucket** (`config.telegram.rateLimit`, default burst 10,
0.2/s). Per-chat **Governor envelope** (`config.telegram.chatBudgets.maxUsd` /
`maxTokens`) — honest stop when exhausted.

## Voice v2 (flagged, default off)

On `config.voice`:

| Flag | Effect |
| --- | --- |
| `streamingStt` | partial transcripts from a streaming STT endpoint |
| `serverVad` | server-side VAD turn-taking |
| `sentenceTts` | speak reply sentence-by-sentence |
| `bargeInCancelsRun` | barge-in aborts the in-flight run (A-19) as well as TTS |
| `spokenStatus` | speak canonical `onStreamEvent` status lines |

Wake remains transcript-regex; OpenWakeWord stays an external option.

## Exit criteria

Every autonomous action is **budgeted**, **approved-or-exempt**, **audited**,
and **pausable**.
