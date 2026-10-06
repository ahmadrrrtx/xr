# Phase 15 — Voice: study notes

## Environment reality (sandbox)

- 2 vCPU / 2 GB RAM / no GPU / no audio device. `qwen2.5:0.5b` on Ollama
  (`~/.cache/ollama-bin`) is the only LLM that fits; cold TTFT 15–85 s.
- No `espeak`, `piper`, `whisper` binaries. **But** the `sherpa-onnx` npm
  package (1.13.8) is the **WebAssembly** build (`sherpa-onnx-wasm-nodejs.wasm`,
  15.4 MB unpacked, 4.3 MB tgz, zero dependencies) and resolves in Bun. With
  the zipformer-small-en int8 set (27.6 MB) + Piper `en_US-lessac-medium`
  (63.2 MB) + a **minimal espeak-ng-data** (8 files, 0.8 MB — not the 355-file
  / 18 MB directory the tar.bz2 ships) the whole offline loop runs here:
  load 2.7 s, TTS "Ready when you are." 344 ms, STT round-trip 104 ms →
  `READY WHEN YOU ARE`, RSS 271 MB. So the end-to-end test can be real.
- The zipformer-small-en transcript is UPPERCASE without punctuation; the
  engine must sentence-case it before display/LLM.
- Playwright can drive the mic with `--use-fake-device-for-media-stream
  --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=<wav>`
  (WAV must be 16-bit PCM; Chrome loops it).
- `/tmp` is a 993 MB tmpfs — large downloads go under `~/.cache`.

## What the brief assumed vs. what the repo has

| Brief assumed | Reality (`main` @ `33c81c9`) |
| --- | --- |
| `desktop/src/voice/{session.tsx,DockedVoice.tsx,GlobalApprovalBar.tsx}`, `screens/Voice.tsx` | **None exist.** They are old-generation files (`git show c61fc29:desktop/src/voice/session.tsx` — EventSource + ScriptProcessor + base64 PCM; 227-line `screens/Voice.tsx` with state titles/hints; 29-line docked pill; 26-line approval bar). `screens/Voice/index.tsx` is a `PlaceholderScreen`. |
| engine `src/voice/{stt,tts,vad,endpointing,wake,pipeline,audio,hardware,settings,types}.ts` | All exist, plus `native.ts` (sherpa-onnx binding, fixed model paths), `intents.ts`, `v2.ts` (sentence split, ServerVad), `cli.ts`, `index.ts` (CLI `VoiceSession`, a *different* class from the daemon's). |
| `src/daemon/routes/voice.routes.ts` with SSE state/final/tts/tts_stop/approval/status/error | Exists (415 lines): `POST /audio {pcm:base64}`, `GET /events` (SSE, 20 s keepalive), `POST /session {action}`, `/barge-in`, `/played`, `/say`, `GET /status`. Canonical mount is **`/api/v1/voice/*`** (legacy `/api/voice/*` adds deprecation headers). Every route id needs a `contract.ts` entry (`test/api/openapi.test.ts`, `v1-versioning.test.ts`) and `docs/api/openapi.json` is a committed snapshot (`bun run api:schema:generate`). |
| Download endpoints, `/settings`, `/models`, `/voices` | Missing. |
| `~/xr/models/voice/` | Engine convention is `voiceModelDir()` = `XR_VOICE_MODEL_DIR` or `~/.xr/voice`; the wasm/npm package is looked up from `XR_VOICE_NATIVE_DIR` or `~/.voice-native`. Keep the engine convention (prod `XR_HOME` **is** `~/.xr`), expose the real path in `/status`. |
| Phase 8 Settings → Voice tab, `⌘.` global | `VoiceTab.tsx` (383 lines) already has mic pick + 5 s meter (`detectMics`), browser `speechSynthesis` voice pick (not the engine), PTT chord recorder. Rust `commands/settings.rs` registers **`Cmd+.` / `Ctrl+.` with `Alt+Shift+P` fallback** at boot (`init_ptt`), persists overrides (`xr.ptt.shortcut`), and emits `ptt:pressed` — **nothing listens**, and only `Pressed` is emitted (hold-to-talk needs `Released`). Shortcuts tab already renders a re-recordable "Push-to-talk (global)" row. |
| Orb click → voice | `useOrb.ts` toasts "Voice coming in Phase 15"; the orb context menu has a static "Start Voice Session" item → `orb:voice-requested` (also toasts). `orbSetState(AvatarState)` exists (7 states: idle/listening/thinking/speaking/waiting-approval/error/sleeping). |
| Chat mic | `Composer.tsx` mic button + "voice theater" button both toast; `Topbar.tsx` `MicButton` toasts. `paletteCommands.ts` `start-voice` toasts. |

## Engine gaps found (voice loop)

1. **Settings are ignored by the daemon session.** `voiceSessionFor()` builds
   `new VoiceSession(store)` with `defaultVoiceSettings()`, never
   `getVoiceSettings()` (config `voice` block) — the CLI's `xr voice setup`
   choices and anything the desktop saves would not apply. `/status` probes
   with defaults too.
2. **Voice approvals are auto-denied.** `VoicePipeline.processText` passes
   `approve: this.voiceApprover()`, which needs `deps.listen` (CLI mic);
   without it the first attempt returns `false` → every risky tool from a
   voice run is denied *after* saying "Say confirm or cancel". The daemon
   session must inject a durable-store `approve` (the chat route's pattern:
   `approvalStore.request({surface:'voice'})` → await outcome) so the 1.5 s
   `announceApprovals` poll + spoken confirm/cancel actually decide it.
3. **No model-missing signalling.** With no models the session simply goes
   thinking → listening; `stt.transcribe` returns `ok:false` with a detail
   string nobody forwards. Need `{type:'error', detail:'stt-model-missing',
   component}` events and a `/status` the desktop can gate on.
4. **`native.ts` is hard-wired** to one STT set and one TTS voice (fixed
   paths, `speed: 1.0`), returns `sampleRate` in a `TtsResult` that doesn't
   declare it, and `loadNativeVoice()` caches the first probe forever (a
   download finishing never becomes visible without `force`).
5. **System TTS (`say`/`espeak`) plays on the engine host** and returns
   `audio: null` — nothing reaches the desktop. Acceptable fallback on the
   CLI, but the desktop must say so honestly (`tts-no-audio`).
6. **Echo guard** is a wall-clock window (`audio.length / 44` ms) — fine; but
   `feedAudio` ignores audio in every state except `listening`, so barge-in
   detection must be desktop-side (energy over TTS) → `POST /barge-in`.
7. Transcript casing (see above); no profanity filter; `SPEECH_RMS` constant
   (0.02) is the only "sensitivity".
8. Cloud STT keys come from `process.env` only (`GROQ_API_KEY`,
   `OPENAI_API_KEY`); cloud TTS is not implemented (only a generic
   `http` adapter). Cloud voice costs are never recorded.

## Desktop gaps found

- Transport: the old `session.tsx` used `EventSource` on a relative URL.
  Phase 14's `engine/transport.ts` resolves sidecar vs dev-proxy and sends
  the bearer; `EventSource` cannot set headers → use `engineFetch` +
  `readSse` (same as chat).
- Capture: naive decimation (aliasing), `number[]` PCM buffers, 250 ms
  flush. Need a box-filter downsampler to 16 kHz, `Int16Array` chunks,
  ~150 ms flush, gain + clipping, `track.getSettings()` to report the real
  noise-suppression state.
- `settingsStore.voice` holds `micDeviceId, inputVolume, ttsVoiceUri, rate,
  wakeWord, alwaysListen, soundsVolume, muted` — several of these now belong
  to the engine (`ttsVoice`, `ttsSpeed`, wake). One canonical owner per
  field: engine `config.voice` for anything the engine consumes; the desktop
  store mirrors for instant UI and keeps device/gain/UI prefs.
- Approvals: `approvalStore.decide(id, 'approve'|'deny', rule?, meta)`;
  engine approvals arrive through `engine/approvals.ts` sync (5 s poll) with
  the engine id — the voice `approval` event carries the same id.
- Notifications: `useNotificationStore.add({id,type,title,body,createdAt,read})`.
- Runs feed: `runs/bridge.ts` — the voice run is an engine run (`dash_…` id);
  the daemon tags `surface:'voice'` on the approval record and the audit
  entries, so the Shield/Runs surfaces inherit it.
- Previews `16-voice-setup.png` / `02-voice-theater.png` are **absent** →
  one generated reference mock allowed (`previews/implementation/phase-15/voice-settings.png`).

## Model sources (measured `Content-Length`, Hugging Face `resolve/main`, stable)

| Component | Files | Bytes |
| --- | --- | --- |
| runtime `sherpa-onnx` 1.13.8 (wasm) | `registry.npmjs.org/sherpa-onnx/-/sherpa-onnx-1.13.8.tgz` | 4 320 484 (15.4 MB unpacked) |
| STT `sherpa-onnx-zipformer-small-en-2023-06-26` int8 | encoder 26 015 366 · decoder 1 307 236 · joiner 259 335 · tokens 5 048 | 27 586 985 |
| espeak-ng-data (shared, English only) | phontab 55 796 · phonindex 39 074 · phondata 550 424 · intonations 2 040 · en_dict 166 944 · lang/gmw/{en,en-US,en-GB-x-rp,en-GB-scotland,en-029,…} ≈ 2 KB | ≈ 816 000 |
| TTS Piper `en_US-lessac-medium` ("Ahmad") | `.onnx` 63 201 425 · `tokens.txt` 921 · `.onnx.json` 4 885 | 63 207 231 |
| Piper `en_US-amy-medium` (Nova, F·US) / `en_GB-alan-medium` (Atlas, M·UK) / `en_GB-jenny_dioco-medium` (Sage, F·UK) | one `.onnx` + tokens each | ≈ 63.2 MB each |

First-run bundle = runtime + STT + espeak + default voice ≈ **96 MB** (the
brief's "≈80 MB" is not truthful; the card shows the measured total).
Gender/accent labels verified against the Piper voice library (Lessac M·US,
Amy F·US, Alan M·UK, Jenny F·UK). No Pakistani-English Piper voice exists —
"Ahmad" is labelled as a neutral US-English voice, honestly.

## Decisions

- Reuse `src/voice/` end to end; no second stack. New engine code goes in
  **new modules** (`src/voice/models.ts` catalogue + downloader,
  `src/voice/transcript.ts` casing/profanity) — `agent.ts` is at its waiver.
- Daemon routes gain: `GET /voice/models`, `GET /voice/voices`,
  `POST /voice/download {component,id}`, `POST /voice/cancel-download`,
  `GET/POST /voice/settings`, `POST /voice/clear-models`, `POST /voice/test-tts {text, voice?}`;
  `/status` grows `{available, stt:{loaded,name,downloadProgress?}, tts:{…}, wakeEnabled, modelDir}`.
  SSE gains `download` and typed `error.detail` codes.
- `/voice` = SCREEN 13 (session hero + settings, 50/50); Settings → Voice tab
  becomes a short summary that links there (one canonical control set).
- Pitch for Piper voices is applied on playback (`detune` + tempo
  compensation) and labelled as such; speed is native (`generate({speed})`).
- Wake word stays transcript-side (`detectWake`), documented honestly:
  "XR keeps listening and checks each phrase on this device"; sensitivity
  maps to the speech energy threshold.
