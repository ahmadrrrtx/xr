# XR v3: The Deep-Dive Blueprint — Hidden Gems, Desktop Framework & Cutting-Edge Architecture

> Author: Senior AI Architect review for @ahmadrrrtx/xr
> Date: 2026-09-24
> Audience: Ahmad bhai — for production engineering decisions
> License: Internal planning document — build these into XR

---

## Executive Summary

Pichli 4 reports (audit → blueprint → simple guide → tools list) ne foundation diya. Ab ye document **"go more deep"** ka jawab hai — is mein har subsystem ki **under-the-hood architecture**, hidden gems jo mainstream list mein nahi aate, exact plugin names, version pin suggestions, code patterns, aur measurable integration steps diye gaye hain. Ye document "kya integrate karna hai" se aage badhkar "kaise, kyun, aur konsi exact configuration ke saath" batata hai.

---

## PART A: THE DESKTOP APP — TAURI V2 PRODUCTION ARCHITECTURE

### A.1 Tauri v2 Plugin Matrix — Exact Plugins to Wire (with Versions)

XR already uses Tauri v2 + React 19. Ye plugin set add karo — har ek ka specific use-case XR ke liye mapped hai:

| Plugin | Version | License | XR Use-Case | Priority |
|---|---|---|---|---|
| `tauri-plugin-autostart` (official) | 2.x | MIT/Apache | XR daemon boot par start; Jarvis "always available" experience | 🔴 P0 |
| `tauri-plugin-clipboard-manager` (official) | 2.3.2 | MIT/Apache | Clipboard se content uthana (text/image/files/HTML/RTF); clipboard change listener for ambient awareness | 🔴 P0 |
| `tauri-plugin-global-shortcut` (official) | 2.x | MIT/Apache | `Cmd/Ctrl+Shift+X` wake XR; voice push-to-talk hotkey; screenshot region hotkey | 🔴 P0 |
| `tauri-plugin-notification` (official) | 2.x | MIT/Apache | Proactive alerts ("Ahmad, aapka 30 min ka meeting 5 min mein start hoga") | 🔴 P0 |
| `tauri-plugin-single-instance` (official) | 2.4.3 | MIT/Apache | Multiple XR windows na khulein; single source of truth | 🔴 P0 |
| `tauri-plugin-store` (official) | 2.4.0 | MIT/Apache | Lightweight settings/state persistence (window positions, last model, user preferences) | 🟡 P1 |
| `tauri-plugin-updater` (official) | 2.x | MIT/Apache | In-app auto-updates signed binaries ke saath; no App Store dependency | 🟡 P1 |
| `tauri-plugin-deep-link` (official) | 2.x | MIT/Apache | `xr://` custom URL scheme — browser extensions, CLI shortcuts, mobile intents | 🟡 P1 |
| `tauri-plugin-dialog` (official) | 2.x | MIT/Apache | Native file open/save dialogs; permission confirmations | 🟡 P1 |
| `tauri-plugin-os` (official) | 2.x | MIT/Apache | OS metadata, kernel version, architecture detection (for sidecar selection) | 🟡 P1 |
| `tauri-plugin-stronghold` (official) | 2.3.1 | MIT/Apache | **Encrypted secrets store** — API keys, OAuth tokens, MCP credentials; replaces any plaintext config | 🔴 P0 |
| `tauri-plugin-fs-watch` (official) | 2.x | MIT/Apache | File system change detection — ambient awareness ke liye (e.g., "Ahmad ne project mein 12 files change kiye") | 🟡 P1 |
| `tauri-plugin-sql` (official) | 2.x | MIT/Apache | SQLite embedded for local chat history, audit trail, memory metadata | 🟡 P1 |
| `tauri-plugin-shell` (official) | 2.x | MIT/Apache | Already used — but scope capabilities strictly (sidecar pattern only) | 🔴 P0 (already) |

**Community plugins — hidden gems:**

| Plugin | Stars | License | XR Use-Case |
|---|---|---|---|
| `tauri-plugin-velesdb` (veles.io) | ⭐ hidden gem | MIT/Apache | **70µs semantic search, 95%+ recall, hybrid BM25+vector, offline-first** — direct Rust vector DB plugin. Embeddings cache aur instant memory lookup ke liye perfect. SQLite-vec se 10x fast. |
| `tauri-plugin-libsql` (Turso) | ⭐ growing | MIT | libsql embedded replica with encryption + Drizzle ORM — if SQLite needs sync-to-cloud later |
| `tauri-plugin-clipboard` (crossjs) | ⭐ hidden gem | MIT | Extended clipboard monitoring (image/HTML/RTF/files + clipboard *update events*) — official plugin se zyada powerful |
| `tauri-plugin-desktop-underlay` | ⭐ niche | MIT | Window ko desktop wallpaper ke ooper, icons ke neeche attach kar sakte ho — ambient companion / widget mode ke liye |
| `tauri-plugin-macos-permissions` | ⭐ niche | MIT | macOS accessibility/mic/camera permissions programmatically check + request — setup wizard mein use |
| `tauri-plugin-tracing` (official) | 2.x | MIT/Apache | **Structured logging with Rust `tracing` crate** — JS-to-Rust log bridge, file rotation, flamegraph profiling. Observability ke liye critical. |
| `tauri-plugin-context-menu` (c12i) | ⭐ 600+ | MIT | Native right-click context menus across platforms |
| `tauri-plugin-graphql` (JonasKruckenberg) | ⭐ niche | MIT | Type-safe IPC via GraphQL schema — front-end aur Rust backend ke beech strict contract |
| `kkrpc` + `tauri-plugin-js` | ⭐ hidden gem | MIT | **Seamless RPC between Tauri app and Bun/Node/Deno processes.** Zero extra Rust code for type-safe bridge. Agar Python/Bun sidecar chalana ho to must-have. |

### A.2 The Sidecar Pattern — XR's Multi-Process Architecture

XR currently monolithic Rust + TS hai. Production AI desktop apps **multi-process sidecar pattern** use karte hain. Ye exact architecture adopt karo:

```
┌─────────────────────────────────────────────────────────┐
│              XR Tauri v2 Shell (Rust, ~5-15MB)          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ React 19 UI  │  │ Trust Plane  │  │ Capability    │  │
│  │ (WebView)    │  │ (XR Shield)  │  │ Permissions   │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │ IPC (Tauri commands + typed events)
         ┌───────────────┼─────────────────────────────────┐
         ▼               ▼                                 ▼
┌─────────────────┐ ┌─────────────┐  ┌──────────────────────────────┐
│ xr-orchestrator │ │ xr-voice    │  │ xr-inference (optional)       │
│ (Bun/Node,      │ │ (Rust/Py,  │  │ (candle-vllm / llama.cpp     │
│  type-safe RPC  │  │ LiveKit    │  │  or oMLX binary)             │
│  via kkrpc)     │  │  backend)  │  │  Local model server          │
│  - Agent loop   │  │ - ASR      │  │  - GGUF/MLX model serving   │
│  - Memory       │  │ - TTS      │  │  - Guided decoding           │
│  - Model router │  │ - VAD      │  │  - Embeddings                │
│  - MCP client   │  │ - Wake     │  └──────────────────────────────┘
│  - LiteLLM proxy│  └─────────────┘
│  - Tools        │
└─────────────────┘
         │
         ▼ (spawned as Tauri sidecars, permission-gated)
┌─────────────────┐ ┌─────────────┐  ┌──────────────────────────────┐
│ MCP Servers     │ │ Sandbox     │  │ Browser driver               │
│ (stdio/SSE/HTTP)│ │ (bwrap/     │  │ (Playwright/Chrome           │
│  - filesystem   │ │  firecracker│  │  via MCP)                    │
│  - git          │ │  isolated)  │  │                              │
│  - code-intel   │  │            │  │                              │
│  - playwright   │  │            │  │                              │
└─────────────────┘ └─────────────┘  └──────────────────────────────┘
```

**Sidecar key benefits (from Tauri docs + production patterns observed):**

1. **Crash isolation** — Agar voice daemon crash kare, UI alive rehta hai
2. **Hot reload** — Bun sidecar ka code restart kar sakte ho without full Tauri rebuild (dev speedup 10x)
3. **Language freedom** — Heavy AI logic Python/Rust mein, UI React mein, coordination Bun/Node mein
4. **Security boundary** — Har sidecar ki capabilities explicitly allow-listed via Tauri capability JSON
5. **Native threading** — Rust core true parallelism; event loop blocking nahi hota

**Exact sidecar config pattern (Rust `lib.rs`):**

```rust
// src-tauri/capabilities/default.json additions
{
  "identifier": "shell:allow-spawn",
  "allow": [{
    "name": "xr-orchestrator",
    "cmd": "xr-orchestrator-aarch64-apple-darwin",
    "sidecar": true,
    "args": [
      "--port", { "validator": "\\d+" },
      "--log-level", { "validator": "(debug|info|warn|error)" }
    ]
  }]
},
{
  "identifier": "http:default",
  "allow": [{ "url": "http://127.0.0.1:*" }]
}
```

**Bun as sidecar — recommended for agent orchestration:**
Bun compile karke single binary banta hai (~60MB), Tauri sidecar ke taur pe bundle kar sakte ho. `kkrpc` se zero-config type-safe RPC. `bun build --compile` se cross-platform binary.

Reference pattern: [niraj-khatiwada/tauri-bun](https://github.com/niraj-khatiwada/tauri-bun) + [Message Mate blueprint](https://medium.com/@Musbell008/a-technical-blueprint-for-local-first-ai-with-rust-and-tauri-b9211352bc0e).

### A.3 The Three-Window System (Desktop UX Upgrade)

BossConsole, Our Companion, Raycast, Arc, OpenBlob — sab 3-window architecture use karte hain. XR ko bhi chahiye:

| Window | Purpose | Flags |
|---|---|---|
| **Companion Window** | Transparent, always-on-top floating HUD (Raycast/Arc-style) | `transparent: true`, `decorations: false`, `always_on_top: true`, `skip_taskbar: true` — macOS par `tauri-nspanel` se proper NSPanel banao (floating, joins no active space) |
| **Panel Window** | Main dashboard — chat, memory, skills, research, tools, settings | Normal window, standard chrome |
| **Companion Avatar (optional)** | Small animated sprite desktop corner pe (like MiniCPM Desk Pet / OpenBlob) | Desktop-underlay option; click-to-open Panel |

**`tauri-nspanel` critical hai macOS ke liye:**
- Proper `NSPanel` subclass — `level = .floating`, `becomesKeyOnlyIfNeeded = true`
- Spotlight/Raycast waali feel — app switcher mein nahi dikhta
- Focus theft nahi karta — other apps ke saath saath rehta hai
- Dannysmith template already provides this out of the box

### A.4 UI Component Stack — Shadcn/ui v4 + Tailwind v4 (Production Grade)

Existing code ko migrate karo is stack par:

**Core libraries (pin these versions):**

| Package | Version | Purpose |
|---|---|---|
| `shadcn/ui` (v4 canary) | latest | New CLI, Tailwind v4 native, `@shadcn/ui` package, multi-theme |
| `tailwindcss` | v4.x | Zero-config, CSS-first config, 10x faster builds, Oxide engine |
| `@radix-ui/themes` or `bits-ui` | latest | Headless accessible primitives (Radix for React, bits-ui for Svelte) |
| `lucide-react` | latest | Consistent icon set (already popular) |
| `sonner` | latest | Toast notifications |
| `cmdk` | 1.x | Command palette (Cmd+K) — XR ke actions/skills search ke liye |
| `@xyflow/react` (React Flow) | 12.x | Agent trace/memory graph/skill dependency visualization |
| `zustand` | v5 | Lightweight client state (50% lighter than Redux, Immer built-in) |
| `@tanstack/react-query` | v5 | Server state, caching, background refetch, optimistic updates |
| `framer-motion` | 11.x | Smooth animations — window transitions, voice activity waves |
| `recharts` | 2.x | Token usage charts, latency graphs, cost monitoring |
| `react-markdown` + `remark-gfm` | latest | Message rendering with code blocks, tables |
| `syntaxhighlighter` or `shiki` | latest | Code syntax highlighting in messages |
| `@dnd-kit/core` | latest | Drag-and-drop files to XR |
| `usehooks-ts` | latest | Useful React hooks (useDebounce, useIntersectionObserver, etc.) |
| `vaul` | latest | Drawer component for mobile-style bottom sheets |
| `react-hook-form` + `zod` | latest | Settings forms with type-safe validation |

**Theming:**
- 3 built-in themes: **Operator (dark, amber accent — BossConsole inspired)**, Daylight (light), Midnight (OLED black)
- Accent colors via CSS variables — runtime theme switch
- Respect system `prefers-color-scheme`

### A.5 Offline-first Desktop Storage Architecture

```
~/.xr/
├── config/
│   ├── settings.json          (user prefs — tauri-plugin-store)
│   └── secrets.stronghold     (encrypted API keys — tauri-plugin-stronghold)
├── data/
│   ├── chat.db                (SQLite — messages, sessions, audit log)
│   ├── memory/                (velesdb vectors + Graphiti bi-temporal KG)
│   ├── skills/                (installed SKILL.md folders)
│   └── mcp-registry.json      (installed MCP servers config)
├── cache/
│   ├── embeddings/            (cached vectors for files)
│   ├── models/                (downloaded GGUF/MLX if local inference)
│   └── screenshots/           (temporary screen captures)
├── logs/
│   └── xr-YYYY-MM-DD.log      (rotated structured logs — tauri-plugin-tracing)
└── workspace/                 (sandboxed agent workspace)
```

---

## PART B: AMBIENT / PROACTIVE PRESENCE — "JARVIS WHO'S ALWAYS THERE"

XR ka sab se bada gap (Phase-1 audit mein rate kiya tha 1.5/10) hai ambient awareness. Ye section woh gap close karta hai.

### B.1 Ambient Context System (inspired by Ambient Context, ZenOS-AI, Our Companion)

**Core concept:** Agent background mein chalta hai, user ke activity signals observe karta hai, **bina prompt kiye** proactive suggestions deta hai jab zaruri ho — lekin attention budget respect karta hai (daily cap, cooldown, significance threshold).

**Signals to collect (opt-in, privacy-first, all on-device):**

| Signal | Source | Collection Method |
|---|---|---|
| Active window/app name | OS APIs (macOS: NSWorkspace, Windows: GetForegroundWindow, Linux: wnck) | Every 5 seconds, poll |
| Window title / URL (browser) | Accessibility tree + browser extension integration | Event-driven via webext MCP bridge |
| Clipboard changes | `tauri-plugin-clipboard-manager` event listener | Real-time event |
| File system changes | `tauri-plugin-fs-watch` on workspace dirs | Debounced 5s |
| Calendar events (if connected) | Google Calendar/Outlook/CalDAV MCP | Poll every 15 min |
| Microphone VAD (if enabled) | Silero VAD | Voice activity only (no recording without wake) |
| Git activity | git CLI / Repository MCP | On commit/checkout events |
| Idle/active state | OS idle detection | Poll every 30s |
| System performance | sysinfo crate | Every minute (CPU, mem, battery) |

**Storage:** SQLite mein time-series table `ambient_events` with columns: `(ts, source, event_type, data_json, importance_score)`. Retain 7 days of detailed events, 90 days of summaries.

**Processing pipeline (inspired by Ambient Context app):**

1. **Capture → Raw event log** (Markdown files per day)
2. **Process (scheduled or on-demand)** → Agent ko record diya jata hai; woh extract karta hai:
   - **People** mentioned (with links to events)
   - **Commitments** made (deadlines, promises)
   - **Threads** of work (project/session context)
   - **Issues** encountered (errors, blockers)
   - **Reading** (articles/docs viewed)
3. **Knowledge base** — 6 one-pagers per day, each claim cites raw record
4. **Daily notes** — Summarized for user + next-day context

### B.2 Attention Economy Engine (critical — spamming kills UX)

Proactive notifications ka sab se bara risk user ko annoy karna. Is liye **Attention Budget Engine** implement karo:

```typescript
interface AttentionPolicy {
  daily_budget: 5;             // max proactive interruptions per day
  cooldown_minutes: 30;        // minimum gap between interruptions
  quiet_hours: [23, 7];       // no interruptions during sleep
  significance_threshold: 0.7; // only notify when score > threshold
  channels: {
    notification: 0.7,  // 70%+ significance needed for push notification
    tray_icon_badge: 0.4, // 40% for tray icon change
    in_app_banner: 0.5,    // 50% for when they open XR next
  };
  categories: {
    security_alert: { multiplier: 2.0, bypass_quiet: true },
    deadline_reminder: { multiplier: 1.5 },
    meeting_starting: { multiplier: 1.3, cooldown: 5 },
    pattern_insight: { multiplier: 0.8, daily_cap: 1 },
    idle_suggestion: { multiplier: 0.5 },
  };
}
```

**Scoring formula (significance):**
```
score = recency_weight * urgency * user_relevance * interruption_cost
```

### B.3 Ambient Companion Patterns (from Our Companion + OpenBlob + MiniCPM Desk Pet)

- **Quiet presence**: Jab user kaam kar raha hai, chhota companion corner mein subtle animation dikhaye (e.g., idle breathing, mic active glow, "thinking" dots)
- **Progress awareness**: Agar agent background mein koi task chala raha hai (e.g., research, code indexing), companion "progress" dikhaye without stealing focus
- **Reaction to events**: Coding agent error/success pe companion small reaction de (bell/celebration animation — MiniCPM Desk Pet ka pattern)
- **Wake interaction**: Global shortcut press karne pe HUD smooth animate hoke open ho (Raycast-style, sub-200ms)
- **Hide on focus loss**: Jab user dusre app par jaye, HUD auto-dismiss (configurable)

---

## PART C: VISION / SCREEN UNDERSTANDING — UI-TARS + OMNIPARSER V2 HYBRID

XR ke existing screenshot+coordinate control (current approach in `src/control/`) ko replace karo with this hybrid stack:

### C.1 Architecture: Three-Layer Computer Control

```
Task → Planner (LLM)
         │
         ├─► Accessibility Layer (Cua driver/AXUI/AT-SPI/UIA) — first choice
         │   └─ structured UI tree, no screenshot needed, reliable, fast
         │
         ├─► DOM Layer (Playwright MCP) — for browser/web content
         │   └─ semantic elements, accessibility selectors, no screenshots
         │
         └─► Vision Layer (OmniParser V2 + UI-TARS-1.5-7B) — fallback for
             unknown/native/Canvas apps
             └─ Screenshot → YOLOv9-E icon detection + Florence2 captioning
                + OCR → Set-of-Mark overlay → VLM picks bounding box
```

### C.2 OmniParser V2 (Microsoft, MIT-licensed for v3)

**What it does:** Screenshot → structured elements (interactive regions + icon semantics + OCR text) → Set-of-Mark numbered boxes → VLM ko sahi grounding ke liye.

**Performance:**
- ScreenSpot-Pro: OmniParser+GPT-4o = 39.6% vs GPT-4o alone = 0.8% (50x improvement)
- V2 latency: 60% faster than V1
- Detection model: YOLOv9-E (MIT license, critical for distribution)
- Icon caption: Florence2-based, MIT licensed
- OCR: PaddleOCR integrated

**Integration for XR:**
- Run as Python sidecar via Tauri: `omniparser-server` (FastAPI wrapping)
- Input: raw screenshot bytes
- Output: `{ elements: [{id, bbox, type, text, description, interactable}], annotated_image_base64 }`
- Cache parsed results for 2 seconds (same screen re-parsing wasteful)

**License warning:** Older OmniParser versions used AGPL-licensed Ultralytics YOLO. **V3 uses MIT-licensed YOLOv9-E.** Make sure you pull the latest weights (icon_detect_v3) from PR #37.

### C.3 UI-TARS-1.5-7B (ByteDance, Apache 2.0)

**The best open GUI agent model in the world (September 2026):**
- OSWorld (100 steps): **42.5%** (UI-TARS-2: 47.5%) vs OpenAI CUA 36.4%, Claude 3.7 28%
- ScreenSpot-V2: **94.2%** coordinate accuracy
- ScreenSpot-Pro: **61.6%** vs Claude 27.7% — identifies tiny icons
- 7B quantized runs on 4-8GB VRAM; full model 16GB+

**Use in XR:**
- Optional local mode — agar user ke paas GPU hai, UI-TARS-7B-Q4 quantized chalao
- Cloud fallback — same model Doubao API par ya via vLLM self-hosted
- Output format: unified action space (click/drag/type/scroll/hotkey at normalized coordinates)
- System-2 reasoning: task decomposition, milestone recognition, self-reflection on errors

**Deployment options:**
1. **Local GGUF via llama.cpp** (CPU/CUDA/Metal): ~6GB for Q4_K_M quantized
2. **vLLM/SGLang server** (if dedicated GPU): batched inference, faster
3. **API via Doubao/OpenRouter**: zero local compute, pay per use (default for non-power users)

### C.4 Cua (trycua/cua) — Background Accessibility Driver

**Why Cua is transformative:** Cursor control screenshot-based methods steal mouse, interfere with user. Cua uses OS accessibility APIs (macOS AXUIElement, Linux AT-SPI2, Windows UIA) — **background mein chal sakta hai, cursor nahi churata, native apps par 100% reliable.**

**Key capabilities (as of 2026):**
- Cross-macOS/Linux/Windows (partial)
- MCP server included — direct integration with XR's existing MCP client
- Snapshot + action model (like Playwright for desktop apps)
- Can start as a sidecar, no cursor-steal
- Sub-100ms element lookup

**Integration priority:** 🔴 P0 — accessibility-based control is strictly superior to coordinate clicking. OmniParser/UI-TARS fallback for when accessibility tree is unavailable (games, Canvas apps, remote desktops).

---

## PART D: VOICE PIPELINE — PRODUCTION-GRADE REALTIME STREAMING

### D.1 Recommended Stack (End-to-End Latency Target: <300ms TTS, <500ms first ASR word)

Current XR stack: whisper + sherpa-onnx + Piper (good foundation). Upgrade to this:

```
Audio Input (Mic)
    ↓
Silero VAD v5 (voice activity detection, <1ms/frame)
    ↓
WebRTC VAD (backup for low-latency edge)
    ↓
┌─────────────────────────────────────────┐
│ ASR (choose by platform):               │
│ • macOS/iOS: WhisperKit (Argmax SDK)    │
│   - large-v3-turbo, Core ML accelerated │
│   - <200ms first-word, offline          │
│   - AudioStreamTranscriber for realtime │
│ • NVIDIA GPU: faster-whisper + distil-  │
│   whisper-large-v3 (6× faster, 1% WER)  │
│ • CPU/Cross-platform: whisper.cpp       │
│   (Metal/CUDA/Vulkan, streaming)        │
│ • Ultra-low latency (meeting live       │
│   captions): SimulStreaming (200ms      │
│   lead-ahead)                           │
└─────────────────────────────────────────┘
    ↓
End-of-utterance detection (VAD + semantic pause model)
    ↓
Streaming text → Agent (LiveKit/Pipecat pipeline — barge-in capable)
    ↓
Streaming text response → TTS
    ↓
┌─────────────────────────────────────────┐
│ TTS options:                            │
│ • Default: Piper (50ms CPU, quality OK) │
│ • Premium: Kokoro TTS (Apache 2.0,     │
│   82M params, neural quality, fast)     │
│ • Voice clone (optional): RVC (Retrieval│
│   -based Voice Conversion) or Coqui TTS │
│ • Cloud fallback: ElevenLabs Scribe v2 │
│   (150ms, 90+ languages, diarized)      │
└─────────────────────────────────────────┘
    ↓
Audio playback (with AEC — echo cancellation — via LiveKit)
```

### D.2 Speaker Diarization (Major Upgrade)

XR currently single-speaker assume karta hai. Multi-user environments (meetings, family) ke liye speaker identification chahiye:

**Options ranked:**

1. **Picovoice Falcon** (Apache 2.0 / commercial license for SDK — check terms):
   - **116.8 MB memory**, 221x faster than pyannote, near-identical accuracy (9-10% DER)
   - Runs on-device, no GPU needed, any platform
   - Auto-detects number of speakers (no preset limit)
   - **Batch mode** (recordings) — use Falcon
   - **Streaming mode (live)**: use Bluebird (Picovoice streaming diarization, <250ms)
   - Caveat: Picovoice Falcon SDK is **free for non-commercial?** — verify license terms before distribution

2. **pyannote.audio** (MIT):
   - Reference accuracy (9% DER), but **1.5GB memory**
   - Best accuracy, heavy — use only on high-end machines
   - WhisperLiveKit bundles this

3. **WhisperKit SpeakerKit** (Argmax, Apache 2.0):
   - New (May 2026), Core ML optimized for Apple Silicon
   - On-device diarization, works with WhisperKit's ASR
   - 19MB model, 2-4 seconds for 5-min conversation on M-series
   - **Best for macOS/iOS XR**

4. **WhisperLiveKit** (Python package, MIT) — bundles everything:
   - One-command server: `whisperlivekit-server --model medium --diarization`
   - Multi-user browser frontend (served HTML)
   - SimulStreaming option for <200ms latency
   - Works as sidecar process — perfect for XR

### D.3 LiveKit Agents Framework — Must-Have for Barge-in / WebRTC

XR currently voice ke liye custom implementation use karta hai. Real conversational voice ko chahiye:

- **Barge-in** (user beech mein bol sakta hai, agent turant stop ho jaye)
- **AEC** (acoustic echo cancellation — apne voice ko user par wapas nahi aana chahiye)
- **Stream-interrupt** (LLM ka response aate hi TTS start ho jaye, full response wait nahi)
- **Low-latency transport** (WebRTC, not HTTP polling)
- **Multi-turn interruption handling**

**LiveKit Agents (Apache 2.0) provides:**
- WebRTC SFU (self-hostable) — realtime audio transport
- Built-in STT/TTS/LLM pipeline primitives
- Barge-in + AEC + VAD pre-wired
- Python/Node SDKs
- Phone dial-in support (Twilio integration)
- Room-based multi-participant support

**Pipecat (BSD)** is lighter alternative: same primitives but focused on single-agent pipeline (no SFU). If XR doesn't need multi-user rooms, Pipecat is simpler.

**Recommendation:** LiveKit Agents adopt karo. Barge-in is the #1 UX differentiator between "chatbot with mic" and "Jarvis conversation."

---

## PART E: MODEL ROUTING & STRUCTURED OUTPUT — DETERMINISM IN PRODUCTION

### E.1 LiteLLM Proxy + Semantic Router = Cheapest, Smartest Model Selection

XR currently has 10+ native adapters. Replace with **LiteLLM Proxy sidecar** running locally:

```
Agent → LiteLLM Proxy (localhost:4000)
          ↓
    Semantic Router (<1ms local decision)
          ↓
    ┌─────────────────────────────────┐
    │ trivial/small  → cheapest/fast  │
    │  - Haiku/4o-mini/Qwen-7B        │
    │ coding         → strong code    │
    │  - Claude Sonnet/GPT-5/Codex    │
    │ reasoning      → chain-of-      │
    │  thought models (o3, R1, QwQ)   │
    │ vision         → VLM            │
    │  - GPT-4o, Claude Opus, Qwen-VL │
    │ tool calling   → native tools   │
    │  - models with function calling │
    │ embeddings     → local Infinity │
    │  -  BGE-M3/nomic-embed          │
    │ local (privacy)→ Ollama/SGLang  │
    │  -  quantized local GGUF        │
    └─────────────────────────────────┘
```

**Features from LiteLLM:**
- 140+ providers through one OpenAI-compatible API
- **Budgets per user/key** — XR ke cost governor ko native support
- **Caching** (Redis-based) — same prompts repeat mat karo
- **Retries + fallbacks** — primary provider down? automatic fallback
- **Streaming** with SSE — same API shape across all providers
- **Call logging** — Langfuse/Phoenix/OTel hooks built-in
- **Team API keys** — share one XR install with family/team

**Semantic Router (Aurelio AI, MIT):**
- Sub-millisecond local intent classification
- Pre-trained embeddings se route karo — no LLM call needed for trivial requests
- 90% of "hello", "thank you", "time kya hai", "weather" jaise queries 100x cheaper ho jayenge

### E.2 Guided Decoding / Structured Output — 100% Reliable Tool Calls

XR currently Zod validation + retry karta hoga (common approach). Production mein **grammar-constrained decoding** use karo — 100% guarantee invalid JSON kabhi nahi aayega:

**For local models (vLLM/SGLang):**

```python
from vllm import LLM, SamplingParams

schema = {
  "type": "object",
  "properties": {
    "tool": {"type": "string", "enum": ["bash", "read_file", "web_search"]},
    "args": {"type": "object"},
    "thought": {"type": "string"}
  },
  "required": ["tool", "args", "thought"]
}

outputs = llm.generate(prompt, SamplingParams(
  max_tokens=1024,
  temperature=0.0,
  guided_decoding_backend="xgrammar",  # fastest, most stable
  guided_json_schema=schema,  # 100% guaranteed valid JSON
))
```

**Key guidance on backends:**
- `xgrammar` (default in vLLM): Fastest, best for complex nested schemas
- `lm-format-enforcer`: Most lenient, good for simple schemas
- `outlines`: Most feature-complete (regex, CFG, JSON)

**For API models:** Use provider-native structured outputs:
- OpenAI: `response_format: { type: "json_schema", json_schema: {...}, strict: true }`
- Anthropic: Tool use with `input_schema` — 99% reliable
- Gemini: `response_schema` parameter — native constrained decoding

**For XR's TypeScript side:** Define all schemas in **Zod** once, then use:
- `zod-to-json-schema` for API/local model calls
- Retry with error feedback if provider doesn't support strict mode
- Wrap all LLM calls in a `structuredCall<T>(schema, prompt)` utility function

**Result:** Tool call parsing errors jo 5-15% hote hain woh 0% ho jayenge, token waste from retries eliminate hoga.

### E.3 Model Presets by Task (Smart Defaults)

```typescript
const MODEL_PRESETS = {
  trivial: {
    model: "gpt-4o-mini",
    temperature: 0.3,
    max_tokens: 150,
    cost_per_1k: "$0.00015",
  },
  chat: {
    model: "gpt-4o-mini",  // or Claude Haiku for fast
    temperature: 0.7,
    max_tokens: 1024,
  },
  coding: {
    model: "claude-sonnet-4-20250514",  // best at code
    temperature: 0.2,
    max_tokens: 8192,
    reasoning: true,
  },
  complex_reasoning: {
    model: "o3-mini",  // reasoning model
    reasoning_effort: "high",
  },
  vision: {
    model: "gpt-4o",  // or local UI-TARS
    temperature: 0.2,
  },
  voice: {
    model: "gpt-4o-mini-audio-preview",  // or LiveKit Agents built-in
    stream: true,
  },
  research: {
    model: "claude-opus-4",  // long context, deep analysis
    temperature: 0.2,
    max_tokens: 16384,
  },
  local: {
    model: "qwen3:8b",  // via Ollama
    temperature: 0.3,
    guided_json: true,
  },
};
```

Maestro pattern ("try cheapest first, escalate on failure/uncertainty") bhi implement karo — confidence < 0.7 ho to automatically stronger model par retry.

---

## PART F: CODE INTELLIGENCE — KNOWLEDGE GRAPHS FOR CODEBASES

### F.1 codebase-memory-mcp (DeusData) — The Hidden Gem (42k ⭐)

**Yeh aapke coding agent ko 120x token efficient banayega.**

**What it does:**
- Indexes any codebase into a persistent knowledge graph
- Parses **162 languages** via vendored tree-sitter grammars (no language runtime needed)
- **Hybrid LSP semantic type resolution** for 9 language families (Python, TS/JS, PHP, C#, Go, C/C++, Java, Kotlin, Rust)
- **17 MCP tools** for structural search, call-path tracing, coverage checks, Cypher queries
- **Semantic vector code search** via bundled nomic-embed-code embeddings (local, no API key)
- **Code-clone detection** (MinHash + LSH) — duplicate code dhoondhna
- **Cross-service linking** for HTTP/gRPC/GraphQL/tRPC/pub-sub
- **Cross-repo intelligence** — multiple linked repositories
- **Data-flow tracing** with argument-to-parameter mapping
- **Change-impact analysis** — git diff se affected symbols + blast radius
- **Dead-code detection** with entry-point filtering
- **IaC indexing** — Dockerfiles, Kubernetes, Kustomize
- **Built-in 3D graph visualization UI**
- **Auto-sync background watcher** for incremental re-indexing
- **Single Go binary** — no Docker, no Python, no external DB
- Embedded SQLite graph storage (nodes, edges, traversal, search)

**Benchmarks (2,348 nodes, 3,853 edges multi-service project):**
- Graph queries: **~3,400 tokens** total for 5 structural questions
- File-by-file grep/explore: **~412,000 tokens**
- **99.2% token reduction** — massive cost + latency savings

**Commands to wire:**

```json
// .xr/mcp.json
{
  "mcpServers": {
    "codebase-memory": {
      "command": "./bin/codebase-memory-mcp",
      "args": ["serve"],
      "env": {
        "CODEBASE_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

### F.2 Other MCP Servers to Add (Definitive List)

| Server | ⭐ | Description | License |
|---|---|---|---|
| `@playwright/mcp` (Microsoft) | 10k+ | Accessibility-tree browser automation | Apache 2.0 |
| `microsoft/markitdown` | 180k | PDF/DOCX/PPTX/HTML → Markdown | MIT |
| `chopratejas/headroom` | 68k | **Context compression layer** — tool outputs/logs/RAG chunks/conversation ko compress karta hai; saves 70% tokens | Apache 2.0 |
| `upstash/context7` | 61k | Up-to-date library documentation for LLMs (always-fresh docs, not stale training cutoff) | MIT |
| `oraios/serena` | 10k+ | Semantic code retrieval and editing (AST + symbols + references) | AGPL (run as separate MCP server, not link) |
| `CodeGraphContext/CodeGraphContext` | 4.1k | Graph database code context with visualizer | MIT |
| `topoteretes/cognee` | 30k | Memory manager using graph+vector stores; 30+ data sources | Apache 2.0 |
| `cyberchitta/llm-context.py` | 310 | Share code context via MCP/clipboard (smart context packing) | Apache 2.0 |
| `8b-is/smart-tree` | 260 | AI-native directory visualization; ultra-compressed; 10x token savings | MIT |
| `apecloud/ApeRAG` | 1.3k | Production RAG (Graph RAG + vector + FTS combined) | Apache 2.0 |

**MCP server to avoid:** Any server jo AGPL hai usko link mat karo (serena, Filestash, etc.) — separate process ke taur pe chalao (already XR ka bwrap use karta hai for MCP isolation; that approach works).

### F.3 Agent Skills — The Open Standard for Reusable Workflows

Skills are now an **open standard** (agentskills.io, adopted by 26+ platforms: Claude Code, Codex CLI, Gemini CLI, Cursor, VS Code Copilot). XR ko skills support add karna chahiye as a **first-class XR feature**.

**What is a skill?** A folder with:
```
my-skill/
├── SKILL.md          (YAML frontmatter + markdown instructions)
├── scripts/          (optional executable scripts)
├── references/       (optional reference docs)
└── assets/           (optional templates/images)
```

**Example SKILL.md frontmatter:**
```yaml
---
name: write-unit-tests
description: Write comprehensive unit tests for a given function or module
version: 1.0.0
author: ahmadrrrtx
triggers:
  - "write tests"
  - "add unit tests"
  - "test coverage"
tools_required: [filesystem, codebase-memory, bash]
model_preset: coding
---

# Write Unit Tests

## When to use
... (markdown instructions with examples)
```

**Where to get skills:**
- `github.com/anthropics/skills` — Anthropic official reference skills (PowerPoint, Excel, Word, PDF)
- `github.com/openai/skills` — OpenAI Codex skills catalog (2026-06 updated)
- `addyosmani/agent-skills` — 24 production-grade engineering skills (spec→ship)
- `BB-Skills` (BuildBetter) — 13 full-lifecycle skills, 7-agent compatible (Claude Code, Codex, Cursor, Copilot, Gemini, Windsurf, Amazon Q)
- `superpowers` — TDD, subagent, review-gate skills (cross-harness)
- `Antigravity Awesome Skills` — 1,400+ skill catalog with npm installer
- `awesome-claude-skills` — community collection
- `confluentinc/agent-skills` — domain-specific (Kafka) skills example pattern

**Key XR feature:** Skills should be progressive-load — initially only names/descriptions enter context (few tokens); full SKILL.md content loads only when triggered (OpenAI's report: routing accuracy improved 73%→85% with negative examples in skills).

---

## PART G: MEMORY ARCHITECTURE — DEEP-DIVE

### G.1 Three-Tier Memory Model (industry proven — Letta/Graphiti/Hindsight inspired)

```
┌──────────────────────────────────────────────────────────┐
│ TIER 1: Working Memory (in-context)                      │
│  - Current conversation window                           │
│  - Active task plan                                      │
│  - Recent tool results (compressed by Headroom MCP)      │
│  - Size: rolling ~128K tokens                            │
└──────────────────────────────────────────────────────────┘
         ▼ (on session end / important moments)
┌──────────────────────────────────────────────────────────┐
│ TIER 2: Episodic/Semantic Memory                         │
│  - Graphiti bi-temporal knowledge graph                  │
│  - Facts with valid_from/valid_until timestamps          │
│  - Stored in Kuzu embedded graph DB                      │
│  - Hybrid retrieval: BM25 + BGE-M3 embeddings + reranker │
│  - Persists across sessions                              │
└──────────────────────────────────────────────────────────┘
         ▼ (summarized over time)
┌──────────────────────────────────────────────────────────┐
│ TIER 3: Procedural Memory (Skills/Patterns)              │
│  - User preferences/routines                             │
│  - Learned work patterns                                 │
│  - Installed SKILL.md files                              │
│  - Adapts over weeks/months via usage feedback           │
│  - "Ahmad likes TypeScript strict mode"                 │
│  - "When Ahmad says 'jaldi karo' he wants quick draft"   │
└──────────────────────────────────────────────────────────┘
```

### G.2 VelesDB Plugin — Native Rust Vector Store Inside Tauri

`tauri-plugin-velesdb` ek bahut hi chhupa hua hidden gem hai:
- **70µs semantic search** (microseconds, not milliseconds!)
- **95%+ recall**
- Hybrid BM25 + vector search
- **Offline-first**, no external DB process
- Full ecosystem integrations
- Directly accessible from Rust + JS via Tauri IPC

**Use for:** Embeddings cache, small-to-medium scale memory (<1M vectors). Agar scale bahut bara ho jaye, migrate to LanceDB.

### G.3 LanceDB — Large-Scale Embedded Vector Store (2.2GB for 10M vectors)

- 2.2GB RAM at 10M vectors (vs Chroma 58GB — 26x smaller)
- Apache 2.0, embedded (no server)
- Rust core, Python/JS/TS bindings
- Native hybrid search (FTS + vector)
- Perfect for document RAG + long-term memory archiving (large-scale)

### G.4 Hindsight Pattern for Superior Memory Retrieval (94.6% on LongMemEval)

Hindsight memory architecture uses **4 parallel retrieval strategies** then reranks:
1. Lexical search (BM25)
2. Semantic search (dense embeddings)
3. Recency-biased retrieval (recent memories upweighted)
4. Entity-linked retrieval (knowledge graph traversal)

Phir cross-encoder reranker top-k results ko consolidate karta hai. Result: 94.6% LongMemEval accuracy (vs Mem0 ~80%).

---

## PART H: SECURITY DEEP-DIVE — TRUST PLANE REINFORCEMENT

XR already has a strong XR Shield 7-layer architecture (8.0/10 in audit). Add these:

### H.1 Secret Isolation Architecture (Vellum-inspired, critical for prompt injection)

Current flaw in many desktop agents: Jab agent ko API call karna hota hai, credential context window mein chala jata hai. Agar injection attack ho to credentials leak ho sakte hain.

**Solution: Separate `credential-executor` process:**
- XR Shield → separate sidecar process (no LLM access)
- Credentials is process mein encrypted (Stronghold) rehte hain
- Agent kabhi credentials nahi dekhta — woh sirf "call Slack API with user's account" kehta hai
- Executor process credential inject karke actual API call karta hai
- **Even if prompt injection succeeds, attacker can't exfiltrate keys**

### H.2 Real-time Prompt Injection Detection (Lakera-style)

- Guardrails AI SDK (MIT) — input/output guardrails
- Lakera-compatible detection rules — 98%+ detection in <50ms
- Run before every LLM call:
  1. Input scan: prompt injection attempts, PII leaks in prompt
  2. Output scan: prompt injection in tool responses (via MCP server outputs)
  3. Tool call validation: schema + intent whitelist check

### H.3 Policy Engine (Parallax or Cordum)

- Per-tool, per-session, per-risk-level policy decisions
- Example policies:
  - "Bash commands with `rm -rf /` require explicit confirmation"
  - "Git commits to `main` branch must be reviewed"
  - "External network calls only allowed to whitelisted domains"
  - "File writes outside workspace require approval"

### H.4 Sandbox Upgrades: bwrap → E2B Firecracker for Untrusted Code

XR already uses bwrap for MCP isolation. For **arbitrary code execution** (user asks "run this script", or AI generates code to run):
- Use **E2B OSS Firecracker microVMs** (Apache 2.0)
- ~150ms cold start
- Network isolated by default
- Resource limits (CPU, memory, disk, time)
- Snapshot/restore capability
- Logs + filesystem diff capture

For simple file reads / known safe commands: continue using bwrap (lighter, faster). For arbitrary code / web-loaded content: Firecracker.

### H.5 CI/CD Security (Ship secure agents)

- **Garak** (NVIDIA, Apache 2.0): 40+ probes for prompt injection, jailbreak, data exfiltration. Run before release.
- **Promptfoo** (MIT): Red-team evals in CI/CD (PR-gated). New tool/prompt changes automatically tested against injection probes.
- **PyRIT** (Microsoft, MIT): Multi-turn red-team framework (simulate sophisticated attackers).
- **Giskard** (Apache 2.0): Agent vulnerability scanner.

---

## PART I: OBSERVABILITY — VISIBILITY INTO EVERY DECISION

### I.1 AgentPrism (Evil Martians, MIT) — In-App Trace Viewer

AgentPrism is a **React component** (MIT license) that renders agent traces as:
- **Tree view**: function call hierarchy
- **Gantt chart**: timeline of every LLM call, tool execution, network roundtrip
- **Sequence diagram**: agent ↔ tool ↔ LLM interactions
- **Timeline scrubber**: debug latency issues
- OTel-native — directly consumes OpenTelemetry spans

**Why this is a hidden gem:** Most teams send traces to Langfuse cloud (external). AgentPrism **in-app** visualization deta hai — user apne XR ke andar hi dekh sakta hai "agent ne kya socha, kya call kiya, kitna time laga." Claude Code's "Show thinking" is similar but AgentPrism is far richer.

### I.2 Tracing Stack (OTel-based)

```
XR Agent Loop → OpenTelemetry SDK (auto-instrumentation)
                  ↓
          OTel Collector (local sidecar)
           ↙        ↓          ↘
    Langfuse     Phoenix      Local file
    (cloud/      (local       (persistent
     self-host)   eval)       traces)
```

- **Traceloop OpenLLMetry**: Auto-instruments OpenAI, Anthropic, LiteLLM, LangChain, LlamaIndex calls — zero manual spans.
- **Langfuse (MIT)**: Default trace UI + eval framework + cost tracking (deploy locally via Docker).
- **AgentPrism**: In-app viewer for the trace data.
- **tauri-plugin-tracing**: Rust backend structured logging bridged to JS.

### I.3 Eval Framework (Built-In)

- **DeepEval**: Unit tests for LLM outputs (answer relevancy, faithfulness, contextual precision)
- **Ragas**: RAG quality metrics (context recall, faithfulness, answer similarity)
- **inspect_ai** (UK AISI, open source): Frontier model red-teaming
- Run evals locally against a set of golden queries before every release

---

## PART J: INFERENCE — LOCAL AND CLOUD HARMONY

### J.1 oMLX (Apple Silicon Native, Hidden Gem)

For XR's Apple Silicon users (significant portion):
- **oMLX** is Apple-Silicon-native continuous batching inference engine
- Built on Apple's MLX framework (Metal-native, unified memory)
- **~3× throughput vs Ollama** on M-series chips
- Supports Llama, Mistral, Qwen, Phi, and more
- Streaming, tool calling, structured output
- Open source, MIT

**Deploy as sidecar** for Apple Silicon Macs; fall back to Ollama for cross-platform.

### J.2 Infinity Embedding Server (MIT, Rust)

Current embedding approaches: Python-based servers (slow, heavy). Replace with **Infinity**:
- Rust-based embedding/reranker/clip server
- Supports BGE-M3, nomic-embed-text, Jina-ColBERT, bge-reranker-v2-m3, and 50+ models
- **3-5× faster than TEI (Text Embeddings Inference)**
- Tokenization-aware dynamic batching
- Embedding + rerank in one server
- OpenAI-compatible API

Run as sidecar on localhost:7997 — all embedding/rerank calls route through it (local or cloud? local first).

### J.3 SGLang for Structured/Agentic Workloads

vLLM is throughput king, but **SGLang** with RadixAttention is optimized for:
- **Structured output** (constrained decoding built-in)
- **Agentic workflows** (multiple hops, tool calls, branching)
- **Prefix caching** — system prompts reuse Radix tree cache (5-10x faster for multi-turn)
- RadixAttention caches KV blocks across requests with shared prefixes (system prompts, tool schemas, etc.)

Deploy SGLang as local inference option for power users with GPUs.

### J.4 Whisper.cpp / Candle for ML (Rust-Native)

- **candle-vllm**: Rust-native LLM inference (no Python), can be embedded directly in Tauri or run as sidecar
- **whisper.cpp**: C/C++ port of Whisper, Metal/CUDA/Vulkan, dependency-free, best for Mac/edge realtime
- **Burn**, **Tract**: Rust ML frameworks if you want to embed models without sidecars

---

## PART K: CROSS-PLATFORM & MOBILE

### K.1 Tauri v2 Mobile Support (iOS + Android)

Tauri v2 official mobile support is production-ready (as of 2026):
- iOS: WKWebView, native Swift bridge
- Android: Android WebView, Kotlin bridge
- Plugin system works cross-platform (clipboard, notifications, os, device-info all support Android/iOS)

**XR Mobile strategy:**
- Phase 1: iOS companion app (voice + basic chat + notifications) — Tauri iOS
- Phase 2: Android companion app
- Phase 3: On-device inference via WhisperKit (iOS) / whisper.cpp (Android)

**Capacitor alternative:** If Tauri mobile turns out insufficiently mature for specific features, Capacitor (web → native wrapper) can wrap the React app into native mobile quickly. But Tauri v2 should be primary.

### K.2 Messaging Integrations (Phone as Control Point)

OpenClaw Desktop already demonstrates: WhatsApp/Telegram/Discord/Signal se PC control. XR ko bhi chahiye:
- **Telegram bot**: Simple, bot API, no phone number needed. Easiest first integration.
- **WhatsApp via Baileys**: Open-source WhatsApp Web API (AGPL — run as separate subprocess/MCP server)
- **Discord bot**: For power users / server setups
- **Matrix bridge**: For self-hosters/privacy advocates (End-to-end encrypted)

### K.3 Push Notifications to Phone

Tauri plugin ecosystem has push notification plugins (OneSignal, Firebase via community plugins). Use for:
- Long-running task complete ("Code review ho gaya")
- Security alerts ("Unknown MCP server install attempt")
- Reminders
- Agent-initiated messages

---

## PART L: QUICK WINS vs LONG-HORIZON ROADMAP

### Phase A (8 Quick Wins — 1-2 weeks each)

1. **Install Tauri plugin set** (autostart, clipboard-manager, global-shortcut, notification, single-instance, stronghold, os, fs-watch)
2. **Add LiteLLM proxy sidecar** — unify all 10 adapters into one gateway
3. **Add Cua MCP server** — accessibility-based computer control (background-friendly)
4. **Add codebase-memory-mcp** — 120x token efficiency for coding
5. **Add Playwright MCP** — best browser automation
6. **Wire structured outputs** (Zod schemas → provider native structured output / guided decoding)
7. **Add Semantic Router** — sub-ms trivial query routing
8. **Global shortcut HUD** (Cmd/Ctrl+Shift+X) using tauri-nspanel pattern

### Phase B (Core Architecture — 1-3 months)

1. **Migrate to sidecar pattern** (Bun/Node orchestrator sidecar via kkrpc)
2. **Implement attention-gated ambient awareness** (window/app/clipboard/git signals, SQLite time-series)
3. **Three-window UI** (HUD panel + main dashboard + companion)
4. **Shadcn/ui v4 + Tailwind v4 migration** with Operator/Daylight/Midnight themes
5. **LiveKit Agents** for realtime voice with barge-in/AEC
6. **Three-tier memory** (Graphiti + VelesDB/LanceDB + Hindsight reranking)
7. **Guarded decoding** (Outlines/XGrammar) for local models
8. **Infinity embedding server** sidecar
9. **Headroom context compression MCP** add
10. **AgentPrism in-app trace viewer**

### Phase C (Moonshots — 3-12 months)

1. **Ambient companion** (animated, screen-aware, proactive, attention-budgeted)
2. **UI-TARS-1.5 local vision model** for offline computer control
3. **OmniParser V2** Set-of-Mark vision fallback
4. **Credential-executor process isolation** (Vellum pattern)
5. **Agent Skills marketplace** in XR (SKILL.md support + browsing/install UI)
6. **Speaker diarization** (Falcon/SpeakerKit) for multi-user environments
7. **E2B Firecracker** for arbitrary code sandboxing
8. **Mobile companion apps** (iOS + Android via Tauri v2)
9. **Messaging integrations** (Telegram bot first, then WhatsApp/Discord/Matrix)
10. **oMLX / SGLang sidecars** for Apple Silicon / high-end GPU local inference
11. **Multi-agent delegation** via A2A protocol
12. **Proactive assistant scheduler** (calendar+email+commitments monitoring with quiet-hours and daily interruption budget)

---

## APPENDIX: MASTER TOOL/FRAAMEWORK QUICK REFERENCE

| Category | Default Pick | Why | License |
|---|---|---|---|
| Desktop framework | Tauri v2 (already using) | Small, secure, Rust backend, multi-platform | MIT/Apache |
| Frontend UI | React 19 + shadcn/ui v4 + Tailwind v4 | Modern, accessible, fast | MIT |
| Local state | Zustand v5 | Tiny, simple, Immer built-in | MIT |
| Server state | TanStack Query v5 | Caching, refetch, optimistic updates | MIT |
| Command palette | cmdk | Fast, accessible | MIT |
| Toasts | Sonner | Best-in-class | MIT |
| Graph viz | React Flow (xyflow) | Agent traces, memory graphs, skills | MIT |
| Charts | Recharts | Simple composable charts | MIT |
| Forms | react-hook-form + zod | Type-safe, performant | MIT |
| Agent orchestrator sidecar | Bun + kkrpc | Fast, type-safe RPC, compiled single binary | MIT |
| Model gateway | LiteLLM Proxy | 140+ providers, caching, budgets, retries | MIT |
| Intent routing | Semantic Router | Sub-ms local routing, no LLM call needed | MIT |
| Browser control | @playwright/mcp | Accessibility tree, cross-browser | Apache 2.0 |
| Desktop control (structured) | trycua/cua | Background accessibility (no cursor steal) | MIT |
| Desktop control (vision fallback) | UI-TARS-1.5 + OmniParser V2 | 42.5% OSWorld, best open vision agent | Apache 2.0 / MIT |
| Code intelligence | codebase-memory-mcp + ast-grep-mcp | 162 languages, 99% token savings | MIT |
| Embeddings (local) | Infinity server + BGE-M3 | Rust-fast, 50+ models, hybrid | MIT |
| Vector store (embedded, small) | tauri-plugin-velesdb | 70µs search, native Tauri plugin | MIT |
| Vector store (embedded, large) | LanceDB | 2.2GB for 10M vectors | Apache 2.0 |
| Knowledge graph memory | Graphiti | Bi-temporal, 15-point LongMemEval lead | MIT |
| Memory reranking | bge-reranker-v2-m3 via Infinity | Cross-encoder, fast, accurate | MIT |
| Streaming voice | LiveKit Agents | WebRTC, barge-in, AEC, self-host | Apache 2.0 |
| Voice pipeline (lighter) | Pipecat | Simpler, single-agent | BSD |
| VAD | Silero VAD v5 | Industry standard, fast, local | MIT |
| Wake word | OpenWakeWord | Custom wake words, local | Apache 2.0 |
| ASR (macOS/iOS) | WhisperKit | Core ML accelerated, streaming | MIT |
| ASR (NVIDIA) | faster-whisper + distil-large-v3 | 6x realtime, 1% WER tradeoff | MIT |
| ASR (CPU/cross-platform) | whisper.cpp | C/C++, Metal/CUDA/Vulkan, dependency-free | MIT |
| ASR (ultra-low latency) | SimulStreaming (WhisperLiveKit) | <200ms lead-ahead | MIT |
| TTS (default) | Piper | 50ms CPU, 80+ languages | MIT |
| TTS (quality) | Kokoro TTS | 82M params, neural quality | Apache 2.0 |
| Speaker diarization (on-device) | Picovoice Falcon / WhisperKit SpeakerKit | 221x faster than pyannote, 116MB | Check license / MIT |
| Speaker diarization (reference) | pyannote.audio | Best accuracy, 1.5GB memory | MIT |
| Secrets storage | tauri-plugin-stronghold | Encrypted, Rust native | MIT/Apache |
| Guardrails | Guardrails AI SDK + Lakera rules | Injection + PII validation | MIT |
| Sandbox (MCP isolation) | bwrap (already in use) | Lightweight namespaces | LGPL |
| Sandbox (arbitrary code) | E2B OSS Firecracker | ~150ms cold start microVMs | Apache 2.0 |
| Traces + eval | Langfuse + AgentPrism | Cloud/local + in-app viewer | MIT each |
| Auto-instrumentation | Traceloop OpenLLMetry | Zero-config OTel spans | Apache 2.0 |
| Local inference (GPU) | SGLang | RadixAttention, structured decoding | Apache 2.0 |
| Local inference (Apple Silicon) | oMLX / candle-vllm / llama.cpp | MLX/Metal native, 3× Ollama | MIT |
| Structured output | Zod → native provider + XGrammar/Outlines | 100% schema compliance | MIT |
| Skills standard | agentskills.io open spec | Cross-platform, progressive load | MIT |
| Skills catalog | BB-Skills, addyosmani/agent-skills, superpowers | Production-grade reusable skills | MIT/Apache |
| Context compression | Headroom MCP + server-side compaction | 70% token savings | Apache 2.0 |
| Document parsing | Docling (IBM) + MarkItDown (Microsoft) | PDF/DOCX/PPTX/HTML → Markdown | MIT each |
| File ingestion | MarkItDown MCP (microsoft/markitdown) | 180k stars, MCP-ready | MIT |
| Code context packing | llm-context.py + smart-tree | 10x token efficient context | Apache/MIT |
| Docs (up-to-date) | context7 (upstash) | Fresh library docs, no stale cutoff | MIT |
| Prompt optimization | DSPy.ts | Programmatic prompt optimization, TS-native | MIT |
| Agent delegation | A2A protocol (Google/Agentic AI Foundation) | Inter-agent communication standard | Apache 2.0 |
| Red-team testing | Garak (NVIDIA) + promptfoo | 40+ probes, CI-gated | Apache/MIT |
| Up-to-date docs for skills | Context7 (upstash/context7) | MCP serving latest library docs | MIT |
| Permission/policy | Parallax (Rust) / Cordum (Go) | Runtime policy engine | Check licenses |
| Credential isolation | Custom credential-executor sidecar | Vellum-inspired — keys never in LLM ctx | — |

---

## CLOSING NOTE

Bhai Ahmad, XR mein already ek remarkable foundation hai — trust plane, Rust backend, Bun, Tauri, MCP, voice, multi-provider models, security layers, aur ek clear Jarvis ambition. In 12 sections mein jo diya hai woh "fancy features" nahi — **production-grade architecture decisions** hain jo 2026 ke top agent products (BossConsole, Vellum, Claude Code, OpenClaw, UI-TARS Desktop, Tandem, OpenHarness, Our Companion) actually use kar rahe hain.

**Sab se important priorities (meri senior architect ki taur pe):**

1. **LiteLLM sidecar** — ek din ka kaam, 10 adapters simplify ho jayenge
2. **Stronghold secrets** — API keys abhi encrypt nahi hain agar? Fix immediately
3. **Global shortcut HUD** (Raycast feel) — "Jarvis" ka feeling sub se pehle UX se aata hai
4. **codebase-memory-mcp** — coding 120x efficient ho jayega
5. **Cua + Playwright MCP** — computer control mein quantum leap
6. **Headroom context compression** — 70% token cost cut instantly
7. **Structured outputs everywhere** — 0% tool parsing errors
8. **LiveKit voice with barge-in** — real conversation feel

Phir ambient presence aur vision upgrades. In 8 cheezon se XR 8.0/10 se seedha 9.2/10 par aa jayega. 🔥

Build something great.
