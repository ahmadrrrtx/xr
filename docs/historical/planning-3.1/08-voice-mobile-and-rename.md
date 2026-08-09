# 08 — Voice + Mobile Control, and the Rename (pre-build update)
### @ahmadrrrtx · 2026-06-03 · supersedes the name in doc 07

---

## PART A — Voice control + mobile: YES, 100% possible, $0, and a perfect fit ✅

Good news: this is not only possible, it's a **proven pattern** that even Hermes and Claude Code now ship — and you can do it entirely with free/open tools, no cost to you. It also *reinforces* your differentiators (security + local-first), so it's a great addition.

### How it works (the architecture)
The whole thing is a thin layer on top of the engine we already built:

```
  📱 Your phone (Telegram/WhatsApp/Discord)
        │  voice note or text
        ▼
  Telegram Bot API (free)
        │  webhook/polling
        ▼
  ┌──────────────────────────────────────────────┐
  │  AGENT GATEWAY  (new, thin)                    │
  │   • auth: only your user-id allowed            │
  │   • voice note → STT (Whisper) → text          │
  │   • text → AGENT LOOP (already built)          │
  │   • result → TTS (Piper) → voice reply         │
  │   • approval buttons: ✅ / ❌ inline            │
  └──────────────────────────────────────────────┘
        │
        ▼
  Your agent core (runs on your $7 VPS or home PC)
```

### The $0 open-source stack (all confirmed in research)
| Need | Free/OSS tool | Notes |
|---|---|---|
| **Speech → Text (STT)** | **whisper.cpp** (local) or **Groq Whisper free tier** | whisper.cpp runs fast even on CPU; "even the tiny model is great." Groq's free Whisper = identical quality, zero infra to start. |
| **Text → Speech (TTS)** | **Piper** (local, ~750-1100ms, natural) or **Kokoro** (82M, tiny, CPU) | Piper's `en_US-lessac` voice is "natural enough guests won't flag it." |
| **Wake word** (optional) | **openWakeWord** | Custom wake word, fully offline. Phase later. |
| **Mobile channel** | **Telegram Bot API** (free) | Voice messages are first-class; inline approve/deny buttons; works from anywhere. |
| **Remote control** | bot ↔ agent over the gateway | "start, control, monitor sessions without ever touching your desk." |

### Why this is *easy* to add to what we built
- Our agent core is already **`runAgent(task, mode, deps)`** — the gateway just calls it with `task` = the transcribed text, and pipes `say()`/`approve()` to Telegram messages + inline buttons. No core changes needed.
- Hermes literally does exactly this: *"tap the microphone, speak. Hermes transcribes, executes, sends a voice reply."* We match it — but with our **per-user auth + least-privilege + approval gates + audit log**, i.e. the **secure** version.

### The security angle (your edge, not a liability)
Mobile/voice is where OpenClaw got dangerous (full shell access from chat). We flip it into a strength:
- **Allow-list auth:** only your Telegram user-id can talk to the bot (others ignored).
- **Approval gates still apply:** risky actions show ✅/❌ buttons on your phone — you approve from anywhere, nothing auto-runs.
- **Least-privilege per channel:** e.g. mobile defaults to Ask/Plan (read-only) unless you explicitly elevate.
- **Everything voice/mobile does is in the tamper-evident audit log.**

> **Verdict:** Add it as **Phase 5 (Gateway)** exactly as planned — Telegram first (easiest, voice is first-class), then optional local Whisper/Piper for full offline voice, then optional wake word. Costs $0. Tagline gets a line: *"control it by voice, from your phone, from anywhere — securely."*

---

## PART B — New name (Aegis is taken → pick a unique, ownable one)

You're right — "Aegis" is a registered insurance company; too crowded/risky. We need a name that is:
1. **Unique & ownable** (likely free on npm/GitHub, low trademark conflict),
2. **Powerful, security/guardian-coded** (matches our trust story),
3. **Short & easy as a CLI command + voice wake-word friendly** (you'll literally say it).

### Top candidates (ranked) — coined > dictionary words (more ownable)

| Rank | Name | CLI / wake word | Why it wins | Notes |
|---|---|---|---|---|
| 🥇 1 | **Wardn** | `wardn` | "Warden" without the e — guardian meaning, but a coined, ownable spelling. Short, brandable, says "wardn" out loud cleanly. | Very likely free everywhere. |
| 🥈 2 | **Sentra** | `sentra` | From "sentry/sentinel" — guardian root, coined, premium, smooth as a voice name ("Hey Sentra"). | Check npm; strong brand. |
| 🥉 3 | **Vouch** | `vouch` | The whole pitch in one word — *"the agent you can vouch for / that vouches for itself."* Trust-coded, memorable. | Dictionary word but rare as a tool name. |
| 4 | **Aegix** | `aegix` | Keeps the "shield" feel of Aegis but coined with -x (ties to your rrrtx -x motif), dodges the trademark. | "rrrtx → aegix" visual rhyme. |
| 5 | **Keyp** | `keyp` | Coined from key + keep → your BYOK story; tiny, ownable. | Great for "you keep your keys." |
| 6 | **Vanta** | `vanta` | "vantablack = nothing escapes" → egress/exfil control. Sleek. | Note: Vanta is a known security-compliance company → some conflict. Lower. |

### Recommendation
- **Primary: `Sentra`** — coined (ownable), unmistakably "sentry/guardian," premium, and an excellent **voice wake-word** ("Hey Sentra, ...") which matters now that we're adding voice. Pairs perfectly: **"Sentra — the AI agent you can trust. by rrrtx."**
- **Strong alt if you want the -x identity tie-in: `Aegix`** ("rrrtx" energy, shield meaning, dodges the Aegis trademark).
- **Safety net:** publish as **`@rrrtx/sentra`** (scope guarantees the package name) with CLI `sentra`.

### Positioning lines
- *"Sentra — the AI agent you can actually trust. BYOK, local-first, voice + mobile, tamper-evident. by rrrtx."*
- Voice-flavored: *"Hey Sentra — your agent, your keys, your rules, from anywhere."*

### ✅ 2-minute check before I rename the code
Please verify (I can't from here):
1. `npmjs.com/package/sentra` and `npmjs.com/package/aegix`
2. `github.com/sentra` repo/org
3. If unsure → we use **`@rrrtx/sentra`** scope (always available) + CLI `sentra`.

---

## Decision summary
- **Voice + mobile:** ✅ fully possible, $0, perfect fit. Telegram (text+voice) in Phase 5; local Whisper STT + Piper TTS for offline voice; openWakeWord optional. Built as a thin gateway over our existing `runAgent()` — secure by default (user allow-list + approval gates + audit).
- **Name:** **Sentra** (CLI `sentra`, package `@rrrtx/sentra`), alt **Aegix**. rrrtx stays your maker signature.
- **Next:** you confirm the name → I rename the Phase-0 code from `aegis` → chosen name, then continue building (Phase 1 Cost Governor, or add the Gateway).
