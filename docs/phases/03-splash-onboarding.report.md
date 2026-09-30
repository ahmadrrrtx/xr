# Phase 3 — Splash + Onboarding (implementation report)

> Agent 4 · branch pending approval → `phase/3-splash-onboarding` · builds on Phase 2 (#139, `eb0ab3a`).

## Gates — all green

| Gate | Result |
| --- | --- |
| `tsc --noEmit` | ✅ clean |
| `eslint .` | ✅ clean (0 problems) |
| `bun run build` | ✅ built |
| `cargo check` (src-tauri) | ✅ finished dev profile |
| Playwright e2e (browser dev, mock detection) | ✅ **41/41** (`previews/implementation/phase-03/results.txt`) |
| Screenshots | ✅ 13 (11 required + splash-ready + after-start) |

## What shipped

- **Rust** (`src-tauri`): `commands/system.rs` — `detect_system` (sysinfo: OS/CPU/cores/RAM) + `detect_ollama` (ureq GET /api/tags + /api/version, 1s timeout); `commands/ollama.rs` — `ollama_pull` on a worker thread streaming NDJSON → `ollama://pull-progress` window events; Cargo +`sysinfo 0.33` +`ureq 2`.
- **Splash** (`src/screens/Splash.tsx`, `App.tsx`): same main window, forced XR-Native, new logo large + "XR" Orbitron wordmark, 280px/4px progress bar driven by real boot phases (window 0–20 / settings 20–50 / theme 50–75 / onboarding-check 75–100), status text, 28 drifting particles, min 800ms + 350ms full-bar beat, 5s hard cap, 400ms cross-fade. Reduced-motion → opacity-only.
- **Onboarding** (`src/screens/Onboarding/*`): 720×620 XR-Native modal, direction-aware spring slides (AnimatePresence custom), progress (step−1)/9, step counter, Enter continue / Alt+← or Backspace back / triple-Esc dev reset, steps 1–3 non-skippable, 4–9 skippable, 10 always. Exact copy strings from the brief (incl. "I understand — I'm in control.", "Hey {name}. I'm XR.", "Ready when you are.", "…connects in Phase 22…").
  - 3 system check: real detection (Rust sysinfo + WebGPU/WebGL GPU + enumerateDevices mic + Ollama probe), staggered rows, warnings never block.
  - 4 model: RAM-tier recommendation (<8→0.5b, 8–16→3b, 16–32→7b, ≥32→qwen2.5-coder:7b), BYO key inline expand, guest.
  - 5 download: real Ollama pull stream (mock ~6s in browser), GB counters, retry/skip, install-Ollama card + recheck when absent.
  - 6 mic: permission-aware device list, Web Audio RMS meter (15 bars), noise-suppression + wake-word (visual-only) toggles, denial → info card + Continue.
  - 7 voice: Ahmad/Nova/Atlas/Sage cards, Web Speech preview + speed slider.
  - 8 prefs: name, 5 theme swatches previewing the live page behind the modal, budget slider snapped $0/2/5/10/20/50 (default $5).
  - 9 integrations: 6 chips → "connects in Phase 22" toast, flags remembered.
  - 10 all set: Avatar idle→greeting pulse, Start chatting → `/chat` + welcome toast.
- **Persistence** (`stores/onboarding.ts`): `onboardingComplete`, `onboardedAt`, `xr.user.name`, budget, model choice, voice prefs, desired integrations — Tauri Store with localStorage write-through.
- **Routing** (`router.tsx`, `OnboardingScreen.tsx`): `/onboarding` outside the shell; `OnboardingGate` wraps AppShell (fresh install → wizard; complete → app).
- **Dev reset**: cmdk "Reset onboarding (dev)" (DEV-only) + triple-Esc — persist-only clear + reload (no animation-teardown race). Toaster moved to App root so onboarding toasts render.

## Fixed during QA

- Enter ignored when a checkbox/radio had focus (wizard now only treats text entry as typing).
- `<button>` nested in `<button>` on voice cards (DOM-nesting warning) — OptionCard is now a `role=button`/`role=radio` div (Space selects, Enter continues).
- Toaster lived in AppShell → onboarding toasts never rendered; moved to App root.
- Dev-reset raced AnimatePresence during reload → persist-only clear + immediate reload.

## Out of scope (as briefed)

Chat (14) · STT/wake word (15) · real TTS (15) · OAuth (22) · separate splash window (27).

## Next

Ahmad approves → branch `phase/3-splash-onboarding`, push, open PR, stop (no merge, no Phase 4).
