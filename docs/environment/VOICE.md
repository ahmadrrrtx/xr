# Voice Integration and Consent (XR 5.1)

**Voice is an interface, never an authority bypass.** Every consequential voice
command ends up in exactly the same risk/approval/trust pipeline as text.

## Activation model (unchanged defaults)

- Voice is **disabled by default** (`voice.enabled:false`); mode defaults to
  **push-to-talk**. Always-listen is opt-in only; `patchVoiceSettings` strips it
  whenever the mode isn't explicitly set. No silent activation exists.
- Wake-word handling is transcript-side deterministic matching
  (`detectWake`); openWakeWord stays an external opt-in.

## Consent: local vs cloud

| Channel | Default | How cloud becomes possible |
|---|---|---|
| STT | local-first (whisper CLI / whisper.cpp / local HTTP) | explicit backend choice AND `allowCloudStt` (voice setup), else refused with remediation |
| TTS | local (say/espeak/piper/kokoro/system) | `allowCloudTts` opt-in |
| (vision — not voice, same posture) | local OCR | `environment.vision.allowCloud` — see VISION.md |

Cloud audio is never sent by inference: backend selection + consent flag are
both required, and the refusal message says exactly how to change it.

## Transcripts

Raw transcripts persist ONLY when `transcriptPolicy = "local-private"` — written
to `~/.xr/voice-transcripts.jsonl` with mode `0600`. Under `session`/`off` only
metadata (timestamps, backends, mode) is recorded. Retention window is
`transcriptRetentionDays`.

## How voice commands become governed actions

```
audio → STT (consent-checked) → transcript → detectWake → parseVoiceIntent
  → control intents go THROUGH runEnvironmentAction with:
      sourceActor: "voice", intent confidence, confirmationPolicy
  → the same gate every channel uses
```

The deterministic intent parser emits a confidence per intent. The environment
voice gate applies, in order:

1. **Low-confidence refusal:** below `environment.voice.minControlConfidence`
   (default 0.6) → spoken "I'm not confident I understood that… please rephrase
   or run it in text mode." Nothing executes.
2. **`never-execute-risky` policy:** any action above `safe` is refused from
   voice with a spoken redirect to text mode. (Before 5.1 this policy only
   applied to the agent approver, not deterministic control intents — fixed.)
3. **Stronger channel:** actions needing `strong` approval (irreversible /
   unknown / sensitive-value) must be confirmed in the text/dashboard channel —
   voice confirmation alone never releases them.
4. Otherwise the action runs the standard approval flow — the same prompts and
   dashboard queue as any other source.

The agent-conversation approver (`voiceApprover`) still handles spoken
confirm/cancel with a 3-attempt limit and audit events, exactly as before.

## Interruption

Barge-in is on by default (`interruptionPolicy: "barge-in"`) — speaking stops
TTS playback immediately and is audited (`voice.bargein`). Spoken
`stop/cancel` halts output; control-loop cancellation follows the standard
session/close mechanisms.

## Failure behavior

- Microphone/STT/TTS tools missing → capability matrix reports `unsupported`
  with remediation; text mode never breaks because voice is unavailable.
- STT failure/empty transcript → `handled:false`, nothing routed.
- Microphone permission state is tracked in settings and surfaced in
  `xr voice status`.
