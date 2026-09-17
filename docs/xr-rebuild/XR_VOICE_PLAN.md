# XR — Voice Mode Plan

> Base: `src/voice/` pipeline (VAD, wake, STT, TTS, intents, hardware probe, v2 streaming states) [OBSERVED]; requires ffmpeg/whisper/piper (doctor-guided) [OBSERVED].
> Research: state-machine presence, barge-in pipeline, latency budgets, confirmation integrity [RESEARCH-BACKED futureagi/callsphere/famulor].

## 1. Experience
Voice is a **mode of Work**, not a separate product: same tasks, same approvals, same runs; spoken transcript mirrors into the task transcript.

## 2. Presence state machine (avatar orb)
`idle → listening → thinking → working → speaking → (interrupted → listening) | stopped | error | waiting-approval`
- Orb treatments over official avatar (Asset Audit): breath idle, cyan ring listening, violet pulse thinking/working, wave-form speaking, amber hold waiting-approval, red flash error, dim stopped.
- Waiting-approval: barge-in disabled; spoken summary + on-screen ApprovalSheet; decision only via explicit "allow once / deny" phrase w/ double-confirm or click (confirmation integrity).

## 3. Turn-taking & interruption
- Push-to-talk default; wake-word opt-in (existing wake module).
- Barge-in: VAD energy→voice-classify→min-duration; backchannel vs content classifier; semantic end-of-turn; TTS flush ≤60 ms, LLM cancel ≤40 ms targets; interrupted utterance stashed (resume-aware).
- In-flight tools on interrupt: read-only finish & keep result; mutating pause+confirm (work-preserving rule; checkpoints make resume native [OBSERVED]).
- Latency budget: turn gap p95 ≤700 ms w/ visible thinking signal (orb); measure per-turn telemetry.

## 4. Audio architecture
- Capture in shell (mic permission) → stream to engine voice pipeline over local WS (NEW `/api/v1/voice/stream`); STT/TTS engine-side (local whisper/piper default; cloud STT/TTS opt-in w/ consent sheet).
- Devices/settings in Settings→Voice; hardware probe heritage (doctor) shown as readiness chips.
- Recordings: local-only, retention default off; transcripts retained per memory policy.

## 5. Spoken UX writing
- Status lines from `spokenStatusLine` heritage [OBSERVED v2]; concise (<12 words) updates; long results summarized + "details on screen".
- Multi-task: voice binds to focused task; "new task" phrase spawns.

## 6. Phasing
P4: mode overlay, PTT, states, barge-in v1, approvals-in-voice, settings. P5: wake-word polish, duplex streaming, per-conversation-type barge-in policy table, voice shortcuts ("stop", "approve", "read that again").

## 7. Tests
- State-machine unit (existing v2 tests extended), latency harness (loopback audio), barge-in corpus (backchannel/noise/interrupt), approval-integrity negative tests, device matrix per OS.
