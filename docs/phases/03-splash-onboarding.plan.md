# Phase 3 — Splash + Onboarding Wizard (plan)

> Agent 4 · Branch: `phase/3-splash-onboarding` · Builds on Phase 2 (#139, merged).
> Brief: OV-7 Splash + OV-8 Onboarding (docs/SCREEN-BRIEFS.md) · DESIGN-SYSTEM §10 + §7 Motion
> · THEME-SYSTEM rule 7 (splash/onboarding = XR-Native cinematic exception).

## Research (Step 2) — 10 lines

1. `sysinfo` crate: `System::new_all()` → `total_memory()` (bytes), `cpus().len()`, `System::name()/os_version()/kernel_version()` — one Rust command covers OS+RAM+cores.
2. CPU *model name*: `sys.cpus().first().brand()` — good enough cross-platform (no per-OS branches).
3. Mic: labels only populate AFTER permission → `getUserMedia({audio:true})` once, then `enumerateDevices()`; listen to `devicechange`. Denial → NotAllowedError → explicit "permission denied" state.
4. Volume meter: Web Audio `AnalyserNode` on the live stream, RMS → 1–15 bars; stop tracks when test ends.
5. GPU: `navigator.gpu?.requestAdapter()` → `adapter.info` (GPUAdapterInfo: vendor/architecture/device — Chrome/Edge/Safari 17+). Fallback: WebGL `WEBGL_debug_renderer_info` UNMASKED_RENDERER_WEBGL string. SwiftShader/"Software" → warning state.
6. Ollama: `GET /api/tags` (installed models), `POST /api/pull {"name","stream":true}` → NDJSON lines `{status:"pulling ...", completed, total}` → real %; final line `{status:"success"}`.
7. Rust HTTP for localhost probes: **`ureq`** (blocking, rustls, ~no-dep) rather than reqwest (heavy). Pull runs on a worker thread, emits `ollama://pull-progress` window events per NDJSON line.
8. Direction-aware wizard slides: `AnimatePresence custom={direction}` + dynamic variants (`initial`/`exit` as functions) — the canonical Framer pattern (exit needs `custom` because unmounted props are frozen).
9. Tauri v2 events: `app.emit("ollama://pull-progress", payload)` + JS `listen()`; needs no extra capability (core:default covers events).
10. No new JS deps. New Rust deps: `sysinfo`, `ureq` (both light, no tokio).

## Architecture decisions

1. **Splash = same main window** (brief §plan-2): `<SplashGate>` in App renders over the router while boot tasks run, then cross-fades 400ms and unmounts. No second Tauri window this phase.
2. **Routing gate**: `OnboardingGate` layout route — reads `onboardingComplete` from the settings store (Tauri Store + localStorage fallback); false → `<Navigate to="/onboarding">`, true + at `/onboarding` → `<Navigate to="/chat">`. Splash renders *above* routing (in App) so it shows on every launch, min 800ms, hard cap 5s.
3. **Detection shape** (TS mirrors Rust):
   - `detect_system()` → `{ os, osVersion, arch, cpuBrand, cpuCores, totalMemoryGb }`
   - GPU + mic detected webview-side (`detectGpu()`, `enumerateMics()`) and merged in the store (brief 5.1: Rust returns non-GPU info).
   - `detect_ollama()` → `{ installed, version?, models: [{name, sizeGb}] }` via ureq GET /api/tags (1s timeout).
   - `ollama_pull(model)` → streams `ollama://pull-progress` events `{ status, progress?, total?, error? }`.
   - Browser dev fallback: mock module returns "Apple M3 Pro, 36GB, Ollama with qwen2.5:3b" so the full flow is testable in `bun dev` (no Tauri).
4. **Model recommendation**: RAM <8 → `qwen2.5:0.5b` (~0.5GB) · 8–16 → `qwen2.5:3b` (~2GB) · 16–32 → `qwen2.5:7b` (~4.7GB) · ≥32 → `qwen2.5-coder:7b`. Cloud/BYO always offered; guest mode = skip.
5. **Onboarding modal is XR-Native themed always** (cinematic exception); theme swatch preview in step 8 applies to the page *behind* the modal.
6. **Splash progress = real phases**: window-ready 0–20 → settings load 20–50 → theme/init 50–75 → onboarding-status check 75–100. Status text swaps per phase. Never >5s.
7. **Skip rules**: steps 1–3 not skippable (welcome/promise/system-check), 4–9 skippable, 10 always shown.
8. **Edge cases**: mic denied → informational row + Continue enabled; Ollama absent → install card + retry + skip; pull failure → error + retry + skip; no GPU → warning row; small viewport → modal `w-[92vw] max-w-[720px]`, content scrolls; browser dev → mock detection.
9. **Dev reset**: cmdk command "Reset onboarding (dev)" (DEV-gated) + triple-Esc confirm on any onboarding step — clears flags, reloads.
10. **Persistence** (`finishOnboarding()` → settings store + localStorage): `onboardingComplete`, `onboardedAt`, `userName`, `theme`, `defaultBudget`, `defaultModel`, `voice.ttsVoice`, `voice.micDevice`, `desiredIntegrations[]`.

## Files

- `src-tauri/src/commands/system.rs` — `detect_system`, `detect_ollama`
- `src-tauri/src/commands/ollama.rs` — `ollama_pull` (worker thread + window events)
- `src-tauri/Cargo.toml` — + sysinfo, ureq; `capabilities/default.json` unchanged (commands are app-defined, os:default already present)
- `src/lib/detect.ts` — typed wrappers + browser mocks
- `src/stores/onboarding.ts` — wizard state (step, direction, detections, selections, download)
- `src/screens/Splash.tsx` — boot splash (logo, wordmark, real-phase progress, particles)
- `src/screens/Onboarding/*` — wizard shell + 10 steps + `components/*` (StepCard, ProgressBar, SystemCheckRow, ThemeSwatch, ModelCard, VoiceCard)
- `src/router.tsx` — `/onboarding` route + gate
- `src/App.tsx` — splash gate wrapper
- `src/components/cmdk/CommandPalette.tsx` — dev reset command
- `src/stores/theme.ts` — expose `applyTheme` for step-8 preview (already has setTheme)

## Test checklist (Step 6)

typecheck/lint/build green · cargo check green · Playwright: splash shows ≥800ms then routes; first-run → /onboarding; steps 1–10 render with exact copy; step-2 checkbox gates Continue; step-3 rows resolve (mock in browser) + Continue enabled after done; step-4 recommendation matches RAM logic (mock 36GB → 7b-coder); step-5 progress streams (mock) + skip; step-6 meter mounts (device list may be empty headless); step-7 voice cards + Web-Speech play button; step-8 name/theme/budget persist; step-9 chips toast; step-10 greeting + Start → /chat + welcome toast; reset command restarts flow; second run skips onboarding; no console errors; screenshots 01–11.

## Out of scope

Real LLM chat (14) · STT/wake word (15) · real TTS voices (15) · OAuth (22) · orb window (27) · separate splash window (27).
