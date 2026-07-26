# Environment Interaction — User Guide (XR 5.1)

## Start here

```bash
xr env status            # one-screen truth: what's supported, live sessions, bounds
xr env capabilities      # per-environment support matrix (working/missing/remediation)
xr doctor --json         # includes the environment check
```

`xr env status` never claims a capability that isn't there. Example on a
headless Linux box: browser `supported`, desktop `unsupported` (xdotool
missing, remediation shown), voice `unsupported` (mic tools missing), vision
`partial` (tesseract missing). That honesty is the feature.

## The command surface

All subcommands accept `--json`. Session IDs come from `xr env sessions`.

| Command | What it shows/does |
|---|---|
| `xr env status` | enabled state, capability summary, live session count/details |
| `xr env capabilities` | six environments × support level, what works, what's missing, how to fix |
| `xr env sessions` | live sessions: type, lifecycle state, actions performed, cleanup state, circuit state |
| `xr env close <sessionId>` | close one session with provider cleanup (result disclosed, incl. partial/failed) |
| `xr env close-all` | sweep every non-terminal session (report per session) |
| `xr env history [limit]` | governed action records: risk, reversibility, approval, outcome — redacted |
| `xr env observations` | live observation references (never raw media; they expire fast by design) |
| `xr env policy` | the effective environment policy (defaults + your config) |

Daemon/dashboard equivalents: `GET /api/environment/{status,capabilities,
sessions,history,observations,policy}` and `POST /api/environment/close`.

## Acting in environments

Actions still use the control surface (`xr control ...`, agent tools, voice) —
5.1 routes them through the governed gate. What changes for you:

- **Approvals are honest about risk.** You will see `irreversible` and
  `unknown` distinguished. "Unknown" is not a shrug: it demands the same
  explicit confirmation as irreversible, and cannot be auto-approved.
- **Sensitive values stay secret.** Approving a password fill shows the
  length, not the password. Nothing ever echoes the value to a record, log,
  or dashboard.
- **Coordinate actions need proof.** A click requires the observation it was
  derived from (fresh — default 30 s) and at least medium confidence. That's
  why XR sometimes refuses a "simple click" and asks for a fresh screenshot
  first.
- **Perception doubt is shown, not hidden.** When confidence is low, every
  affected record says so in words.

## Voice control

See [VOICE.md](./VOICE.md) for the full model. In short: voice is push-to-talk
by default, local-first for STT/TTS (cloud is dual-consent opt-in), intents
below the confidence floor are refused audibly, and anything risky is
redirected to text mode: *"I'm not confident I understood that — please
rephrase or run it in text mode."* Spoken confirmation can release standard
approvals; **strong approvals (irreversible/unknown/sensitive-value) require
the text/dashboard channel — never voice alone.**

## Browser sessions

Governed browser work runs in **isolated, session-scoped contexts**
(no import/export of cookies or storage between sessions): domain allow/block
policy, private-network blocking (default on), per-session downloads root with
a byte cap, crash detection, and sandboxed launch (root+`--no-sandbox` is
refused; see [PLATFORM_SUPPORT.md](./PLATFORM_SUPPORT.md)). Config:

```json
"environment": {
  "browser": {
    "allowedDomains": [],           // empty = all but blocked
    "blockedDomains": ["example-ecomm.test"],
    "blockPrivateNetworks": true,
    "maxDownloadBytes": 52428800
  }
}
```

## Turning things off (rollback)

- Everything: `XR_ENVIRONMENT_DISABLED=1 xr env status`
  (or `"environment": { "enabled": false }`)
- One modality only: `"environment": { "modalities": { "browser": false } }`
- Cloud vision only: `"environment": { "vision": { "allowCloud": false } }`
  (the default — nothing leaves the device)

Core XR (chat, memory/context, workflows, daemon) keeps running with the
whole environment layer disabled. Disabling never degrades to an unsafe
fallback path — blocks are explicit and explained.

## Reading the history

`xr env history --json` records per action: environment, source actor
(cli/voice/agent/workflow…), redacted summary, risk level + reason,
reversibility class, approval required/granted (and via which channel),
observation reference + staleness, recovery attempts/circuit state, outcome
(including `uncertain`), durations, evidence refs. It's the same gate's
receipt you'd reconstruct from audit events — token-safe, secret-free.
