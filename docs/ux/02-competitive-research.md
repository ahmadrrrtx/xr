# 02 — Competitive & pattern research

**Date:** 2026-08-13. Purpose: study *why* leading AI/developer surfaces work,
then decide for XR: **BORROW / AVOID / INVENT**. Research sources cited in
`docs/ux/research/`; live product knowledge of the listed tools.

## 1. Products studied

**Agent CLIs/TUIs:** Claude Code, OpenCode, OpenClaw, Goose, Codex CLI.
**AI chat:** ChatGPT, Claude (web), Gemini, Perplexity.
**Dev tools:** VS Code, Cursor, GitHub Copilot, Linear, Raycast, Warp.
**Systems:** Vercel/Portainer-style dashboards.

## 2. Why they work (the mechanisms)

| Pattern | Why it works | XR verdict |
|---|---|---|
| **Single composer anchor** (ChatGPT/Claude) | One input = one mental model; everything else recedes | **BORROW** — composer is the center of the chat view |
| **Status line contract** (Claude Code) | Model/mode/context always visible = user confidence | **BORROW** — extend XR shell status bar with context %, real spend |
| **Plan mode as explicit state** (Claude Code, XR has agent/plan/ask) | Separates thinking from acting; reduces fear | **KEEP + surface** in GUI composer too |
| **Show the work** (all) | Streaming tokens, tool cards, progress — silence reads as broken | **BORROW** — XR has tool timeline; add visible agent-state text ("thinking/planning/running tool X") |
| **Never a blank chat box** (research consensus) | Suggested prompts teach capability in one click | **BORROW** — redesign XR empty state (F-6) |
| **Full-width flat messages, not SMS bubbles** (Claude/ChatGPT/Cursor) | Seriousness, scannability | **KEEP** — XR chat already flat; do not introduce bubbles |
| **Context transparency** (Claude Code /compact, context %; ChatGPT truncation notices) | Users manage what the model sees | **BORROW** — context % + "last N messages" hint in XR composer |
| **Tool execution transparency** (Claude Code tool calls, Cursor diffs) | Trust through visibility | **KEEP** — XR tool timeline; add status icons + durations + expandable detail |
| **Approvals as first-class UI** (Claude Code permission prompts) | Safety without fear | **KEEP** — XR Allow/Deny cards; add WHAT/WHY/RISK framing (mission §18) |
| **Keyboard-first + discoverability** (OpenCode leader keys, Raycast Cmd+K) | Power without clutter | **KEEP** — XR palette + `g <key>` mnemonics; document in `?` help |
| **Thinking-level toggle** (OpenClaw Ctrl+T none/brief/detailed) | Users control reasoning visibility | **INVENT-ADAPT** — XR reasoning display toggle (none/brief/detailed) fed by real turn data |
| **High-density status dashboard, zero blank screen** (Vercel/Portainer) | Ops trust | **KEEP** — XR bento matrix is good; keep honest readiness banner |
| **Mnemonic sequential navigation `g + key`** (Linear) | Fast muscle memory | **KEEP** — already in shell |
| **Restrained motion, state-explaining only** (Linear/Arc) | Calm, professional | **BORROW** — XR motion system (08) is minimal by design |
| **Progressive disclosure of power** (Raycast settings depth, Claude Code config) | Beginners not overwhelmed | **KEEP** — XR sidebar disclosure toggles; ensure defaults collapse advanced areas |

## 3. Anti-patterns to avoid (from research + XR audit)

1. **Fake buttons/states** (XR F-1 voice panel) — the single worst trust killer.
2. **Emoji-as-icons** and mixed icon styles (XR F-4).
3. **Modal-locking during streaming** — never block composing the next prompt.
4. **Silently dropping context** — always tell the user what the model saw.
5. **Decorative motion / particles** — no spectacle; performance first.
6. **Bubble UIs** and messenger aesthetics for a serious agent tool.
7. **Blank dashboards without action** — every card clickable/actionable.
8. **Skeuomorphism, heavy gradients on chrome** — precision 1px borders; neutrals carry the UI.
9. **Fake security indicators** — every badge maps to real runtime state.
10. **Copying Claude/ChatGPT branding** — XR has its own official identity.

## 4. What XR should INVENT (differentiation)

1. **Honesty as the product voice**: "what will this leave my machine / cost"
   locality badges (F-7) — no competitor makes this a first-class UI signal.
2. **One-identity TUI ↔ GUI**: the same brand, state language and command
   grammar (`/model`, modes, `g d`) across terminal and web (mission §39).
3. **Agent-state avatar language** (F-5): a calm state-display avatar that
   communicates listening/thinking/tools/speaking without being a mascot.
4. **Governance visibility**: budget/approval/audit as ordinary, calm UI —
   not security theater. Already a strength; double down.
5. **First-run without a terminal**: GUI onboarding for non-technical users
   (F-8) while preserving CLI wizard parity.
6. **Floating companion mode** (mission §13): minimal always-available agent
   presence — spec in `05-user-flows.md`; implement only if a real daemon
   event path exists (deferred, honest).

## 5. Pattern truth table (for quick reference)

| Need | Best pattern (from research) | XR adoption |
|---|---|---|
| First interaction | Suggested prompts + capability chips | Empty-state redesign |
| Long task | Step list / stepper, not chat | Tool timeline + agent state line |
| Code output | Diff viewer / artifacts rail | Chat artifacts exist; diff viewer future |
| Security question | WHAT/WHY/RISK + Allow/Deny | Approval card redesign |
| Settings | Categorized + search + autosave | Already good; keep |
| Model switching | One shortcut + visible chip | Alt+P / chip — keep, add locality badge |
| Sessions | Searchable history + resume | Sessions panels — keep, add search + resume |
| Voice | State ring + stop + return | Avatar voice mode (Phase E) |
