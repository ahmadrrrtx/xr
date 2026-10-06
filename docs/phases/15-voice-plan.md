# Phase 15 — Voice: plan

Branch `phase/15-voice` from `main` `33c81c9`. Finish the existing loop; no new
voice stack. Order follows the brief: loop bugs → engine endpoints → mic
enumeration → settings screen → download flow → TTS voices → wake word → `⌘.`
→ Orb / Chat mic / docked / auto-exit → approvals → permission card → Tauri
voice events → shortcuts → themes → a11y.

## 1. Engine (`src/voice/`, `src/daemon/routes/voice.routes.ts`)

| Step | Change |
| --- | --- |
| E1 | `native.ts`: model layout from a catalogue (`stt/<id>/…`, `tts/<voiceId>/…`, shared `tts/espeak-ng-data`), `speak(text, speed)`, `loadNativeVoice({force, ttsVoice})`, honest `missing` lists per component. |
| E2 | New `models.ts`: catalogue (runtime / stt / tts voices, URLs + byte sizes), `installState()`, `startDownload(component,id,onProgress)` (streamed fetch → `.part` + `Range` resume, Content-Length totals, AbortController cancel, npm tgz gunzip+tar extract for the runtime), `cancelDownload()`, `clearModels()`. |
| E3 | New `transcript.ts`: `normalizeTranscript` (sentence case for all-caps STT), `maskProfanity`. |
| E4 | `types.ts`/`settings.ts`: `ttsSpeed`, `wakeSensitivity`, `profanityFilter`, `desktop{…}` UI prefs; `patchVoiceSettings` validation. |
| E5 | `pipeline.ts`: `deps.approve` override (durable approval store, `surface:'voice'`), `ttsSpeed` through `tts.speak`. |
| E6 | `voice.routes.ts`: session built from `getVoiceSettings()` + `reconfigure()`; model-missing → `error{detail:'stt-model-missing'|'tts-model-missing'|'tts-no-audio', component}`; sensitivity → RMS threshold; `download` SSE events; routes `GET /models`, `GET /voices`, `POST /download`, `POST /cancel-download`, `GET/POST /settings`, `POST /clear-models`, `POST /test-tts`; richer `/status`. Cloud STT keys also from config providers; cloud voice cost → `store.recordCost(…,'estimated')`. |
| E7 | Contract entries + `docs/api/openapi.json` regen; tests in `test/voice/` (catalogue sizes, tar extract, transcript, approval injection, status shape); size-gate ceiling raise with dated reason. |

## 2. Desktop

| Step | Change |
| --- | --- |
| D1 | `src/voice/session.tsx` — `VoiceProvider` (mounted in `App`, above the router): engine SSE via `engineFetch`+`readSse` with reconnect; capture (`getUserMedia` constraints incl. deviceId/echo/noise/AGC, `AudioWorklet`-free `ScriptProcessor` 4096 → box-filter resample to 16 kHz Int16 → 150 ms base64 flush), gain + clip detect, levels in refs (60 fps consumers), TTS playback (one `AudioContext`, resumed on gesture, `decodeAudioData`, `detune` pitch), barge-in (mic energy while speaking → stop + `/barge-in`), `played` ack, chimes (200 ms sine A4/C5), auto-exit on silence, device-change/removal handling, approvals (`approval` event → store + spoken), mode `hold/tap/always`, Tauri `voice:state-changed` emit + `orbSetState`. |
| D2 | `src/voice/voiceStore.ts` (Zustand, canonical): engine status/models/voices/settings mirror, download progress, mic permission/devices, docked flag, cost chip. `src/voice/voiceApi.ts` typed calls. |
| D3 | `screens/Voice/` SCREEN 13: `VoiceScreen` (tabs Session / Settings), `SessionHero` (cinematic `#03070D`, avatar 120 → 200, waveform canvas, captions aria-live, status chip, Start/Stop/Mute/PTT), `ModelDownloadCard`, settings sections (`MicrophoneSection`, `WakeWordSection`, `SttSection`, `TtsSection`, `TheaterSection`), `PermissionCard`. |
| D4 | `DockedVoice.tsx` pill (bottom-centre, glass, waveform, snippet, dot), `GlobalApprovalBar.tsx`; mounted in `AppShell`. |
| D5 | Wiring: `MicButton` + topbar status dot, Composer mic (setting `chatMicTarget`), `paletteCommands` start-voice, `useOrb` click/menu, `Settings → Voice` tab summary + link, `useHotkeys` (Space/Esc/M/T/P/Enter inside `/voice`), `ptt:pressed/released` listener (toggle vs hold), Bell notification on errors, `ShortcutsTab` row already exists. |
| D6 | Rust: `ptt:released` emit, `voice_set_state` (orb menu label swap + accelerator), `reveal_models_folder(path)`, `open_microphone_settings()`. |
| D7 | Themes/a11y pass; screenshots; PR. |

## 3. Tests

- Engine: `bun test test/voice/` (new: `models.test.ts`, `transcript.test.ts`,
  `routes-status.test.ts`), `bun run api:schema:generate`, `api:compat`,
  `size-gate`, `typecheck`.
- Desktop: `tsc --noEmit`, eslint on touched files, Playwright with the fake
  mic (synthesised WAV: "What is two plus two?") through the real engine +
  real models + `qwen2.5:0.5b` → `final` transcript → `tts` audio → `played`.
- Rust: scratch crate with the tauri shim (full crate too heavy here).

## 4. Out of scope (stated in PR)

Voice Theater window (Phase 16), non-English packs, cloning, speaker ID,
calls, locked-screen hotword, full duplex.
