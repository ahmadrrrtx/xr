# 03 — UI/UX Design Brief
### SENTINEL · v1.0 · 2026-06-03

---

## 1. Design principles
1. **Trust is visible.** Cost, permissions, and what the agent is about to do are always on screen — never hidden.
2. **Calm, not flashy.** Users punished OpenClaw's "shiny features 99% won't use." Clean, legible, fast.
3. **Confirm before consequence.** Every risky action shows a diff/summary + cost, then asks.
4. **Keyboard-first.** Terminal-native; everything reachable without a mouse.
5. **Progressive disclosure.** Simple by default; power features one keystroke away.
6. **Honest about state.** Show thinking/working/waiting/blocked clearly; never a silent hang.

## 2. Surfaces (3, shared core)
1. **CLI / TUI** (primary) — the full experience.
2. **Telegram** (mobile) — approve/reject, history, cron, quick tasks.
3. **Desktop (Tauri)** (later) — the non-terminal gateway (Hermes Desktop lesson).

## 3. Visual language
- **Palette (terminal-safe + brand):** ink/charcoal background; **cyan** = SENTINEL/agent (matches your GitHub `#00D2FF`); **green** = safe/approved; **amber** = needs approval / over-budget warning; **red** = blocked/denied; **dim gray** = logs/secondary.
- **Type:** monospace (Fira Code vibe). Clear hierarchy via weight + color, not size.
- **Iconography (unicode):** ◆ agent · ▸ step · ⚙ tool · ✓ approved · ✗ denied · ⏸ paused · 💰 cost · 🔒 secure · ⟳ self-heal.
- **Motion:** subtle spinner while thinking; streamed tokens; no gratuitous animation.

## 4. Core screens / states (TUI)

### 4.1 First-run onboarding (≤ 60s)
```
◆ SENTINEL  v1.0
Let's get you set up. (You bring the key — we ship none.)

  How do you want to power your agent?
  ▸ Local model (Ollama)   — private, $0, recommended for privacy
    Cloud provider (BYOK)   — paste your own API key
    Both (local + cloud failover)

  [detected: Ollama running · qwen3.6:7b ✓]
  Set a spend ceiling per task:  $ 0.25   (local = $0)
  Pick a mode default:  ● Agent  ○ Plan  ○ Ask

  🔒 Your key is stored in the OS keychain, never in plaintext.
  ✓ Ready. Try:  sentinel "summarize today's AI news"
```

### 4.2 Main task view (Agent mode)
```
◆ task: "modify README to add install steps"        💰 0.4k tok ≈ $0.001 / 250 limit
─────────────────────────────────────────────────────────────────────────
▸ think  planning 3 steps…                                   model: qwen3.6 (local)
▸ tool   ⚙ read_file(README.md)                              ✓ 0.2k tok
▸ tool   ⚙ write_file(README.md)                             ⏸ needs approval
─────────────────────────────────────────────────────────────────────────
  PROPOSED DIFF  README.md
  + ## Install
  + ```bash
  + bun add -g sentinel
  + ```
─────────────────────────────────────────────────────────────────────────
  [a]pprove   [r]eview one-by-one   [e]dit   [d]eny   [?]why
```

### 4.3 Over-budget pause (the Cost Governor moment) 💰
```
⏸ PAUSED — budget guard
   This task has used 230 / 250 token-cost units (≈ $0.0009).
   Next step is estimated to exceed your ceiling.
   ▸ raise ceiling to $0.50 and continue
     finish with what we have
     stop here
```

### 4.4 Permission / security prompt 🔒
```
🔒 ACTION REQUIRES APPROVAL
   tool: shell  →  `rm build/cache`
   reason: deletes files (destructive)
   sandbox: docker · egress: blocked
   [a]pprove once   [A]lways for this skill   [d]eny   [?]explain
```

### 4.5 Self-improvement review
```
🧠 SENTINEL learned something
   skill: "deploy-preview"  (run succeeded & verified ✓)
   I want to freeze this 4-step sequence as a stable baseline.
   why: tests passed, preview URL returned 200
   [f]reeze   [v]iew steps   [s]kip
   (frozen skills are never overwritten by future learning)
```

### 4.6 Health / Self-Doctor
```
⟳ sentinel doctor
   config ........... ✓ valid (v3, migrated from v2)
   providers ........ ✓ ollama  ✓ groq   ✗ openai (no key)
   local model ...... ✓ qwen3.6:7b · grammar tool-calls ON
   injection lab .... ✓ blocked 47/50 attacks   [view report]
   last update ...... ✓ 1.0.3 (self-test passed)
```

### 4.7 Time-travel
```
⟳ sentinel history --task t_91
   step 3  write_file(README.md)   [rewind here]  [undo this change]
   step 2  read_file(README.md)
   step 1  plan
```

## 5. Telegram UX
- Inline buttons mirror TUI: ✅ Approve / ❌ Deny / 👀 Review / ⏸ over-budget options.
- Commands: `/task`, `/history`, `/cron`, `/cost`, `/doctor`, `/rollback`.
- Always shows running cost in the message footer.

## 6. Accessibility & polish
- Full color-blind-safe palette (shapes + labels, not color alone).
- `--no-color` / `--plain` / `--json` output modes.
- Every prompt has a `?` for a plain-language explanation (trust through transparency).
- Sensible defaults so a 2-word prompt works (context-engineering ethos).

## 7. Brand voice
Calm, precise, a little proud. "I paused because this would exceed your budget." Not hype, not cutesy. The vibe: *a careful senior engineer who has your back.*
