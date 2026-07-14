# XR 3.1A — Design Philosophy
> The north-star principles every implementation decision must pass.

This document is **not** a mood board. It is a list of enforceable principles. If a proposed screen, component, or interaction violates a principle below, it gets redesigned or cut.

---

## 0. The One Promise (test every decision against this)

> **"XR is one fast, trustworthy AI operating system. It always knows where you are, what it is doing, and what you have spent. It never surprises you."**

---

## 1. First Principles

### P1 — One Operating System, not a toolkit
XR is a product, not a collection of features. Every surface (TUI, dashboard, CLI, VS Code, Telegram, voice) is a **view onto the same XR**, not a separate product.

**Test:** If you showed a user the TUI on Monday and the dashboard on Tuesday, would they recognize they are in the same XR? If not, it's wrong.

### P2 — Trust is earned in microseconds, lost in one
Every approval prompt, budget warning, cost readout, error state, and command preview is a trust moment. Default to **showing the truth even when it makes XR look bad** (a failed model call, a budget overrun, an insecure setting). Never hide failure behind a spinner.

**Test:** Can a user reconstruct, from the UI, exactly what XR did, why, and what it cost? If not, it's wrong.

### P3 — Keyboard-first. Always.
XR is a tool for people who work with keyboards. Every action is reachable without a mouse. The mouse works, but is never required. This applies to TUI (obviously), dashboard (Vim/Emacs-style keys + palette), website (palette for doc navigation), and even mobile Telegram (commands, not just text chat).

**Test:** Can you do the primary task of every view with only keyboard, in ≤3 keystrokes from anywhere? If not, it's wrong.

### P4 — Feels instant; is honest
Perceived speed is more important than actual speed, but perceived speed must not lie. If something will take 10 seconds, say "this will take ~10 seconds" and show progress. Don't fake a completed animation before the thing is actually done. Use optimistic UI for local state changes, never for remote actions.

**Test:** Is there any point where XR shows "done" before work is actually done? Is there any point where the user sees a spinner for >500ms with no indication of what is happening? If so, it's wrong.

### P5 — Quiet until spoken to; articulate when asked
XR does not ping, toast, nudge, or notify unless the user needs to know right now (pending approval, task complete, error, budget ceiling). 95% of state changes belong in the status bar — not in a toast, not in a modal, not in a pop-up.

**Test:** Can a user work in XR for an hour without seeing a single modal they didn't summon? Can they glance at the status bar and see everything important? If not, it's wrong.

### P6 — Mode is visible; mode doesn't bite
XR operates in modes (agent, plan, ask, voice). The current mode is always visible. The mode never changes unless the user explicitly changes it. Mistakes due to mode confusion (e.g., running a destructive shell command because the user thought they were in "plan" mode) are considered **P0 bugs**.

**Test:** If a user walks away from XR for 10 minutes and comes back, can they tell in <1 second what mode they're in and what that mode will allow XR to do? If not, it's wrong.

### P7 — Composer is universal
There is exactly one place you tell XR what to do: the Composer. It lives at the bottom of the TUI, the bottom of the dashboard, and is the grammar of every CLI invocation (`xr "<composer content>"`). It understands natural language, slash commands, @-mentions, #-tags, file drag-drop, and voice dictation. There are no other text inputs for "tasks" vs "chat" vs "commands."

**Test:** Is there any place in XR where the user types instructions that isn't the Composer? If yes, it's wrong (settings forms and search boxes are not instructions — they're configuration).

### P8 — Progressive disclosure of power
The first 90% of users only need:
1. A text box to talk to XR
2. A model picker
3. A budget indicator
4. Approve/Deny buttons

The other 500 features (skills marketplace, MCP servers, egress allow-list, Business OS, Shield, RBAC, voice wake word) are **one layer away** — discoverable via the palette, sidebar, or settings — but never cluttering the primary experience.

**Test:** Can a brand-new user start their first task within 60 seconds without reading documentation? Can a 3-month power user reach every advanced feature in ≤2 keystrokes? If either is false, it's wrong.

### P9 — Local-first, cloud-respectful
XR treats the user's machine as the primary computer. Cloud models are tools XR can call, not places where your data lives. This is a moral position as well as a technical one:
- Nothing leaves the machine without an explicit route (provider call with the user's key, or plugin/MCP the user enabled).
- Local models are always the cheapest, fastest, and most private default when they can do the job.
- Fallback to cloud is *visible* ("routing to cloud because local model is too small for this task" — not silent).
- Secrets live in OS keychain or encrypted file; never logged, never displayed back.

**Test:** Is there any place data leaves the user's machine without an explicit user action and an auditable log entry? If yes, it's wrong.

### P10 — The Budget is a Promise, not a suggestion
XR's most distinctive feature is that its spend ceiling is **code-enforced before every model call**. The UX must reinforce this promise:
- Budget is always visible.
- When XR is within 10% of a ceiling, the indicator turns amber.
- When a call would breach the ceiling, the *execution stops and asks* — it never silently continues.
- The user can see per-call cost, per-session cost, per-day cost, per-provider cost.
- The user can export a cost report from the audit chain.

**Test:** Can a user wake up to a $500 surprise bill because XR kept calling a model? If yes, every layer of the UX has failed.

### P11 — Beauty is a feature, not a coating
XR's cybernetic-guardian aesthetic (deep black, cyan→violet glow, monospaced accents, precision geometry) is part of the product. It is not decorative — it signals "this is a serious, precise, trustworthy system." Beauty here means:
- **Restraint**: no gratuitous animation, no confetti, no loud gradients on core work surfaces.
- **Precision**: 1px borders, sharp geometry, consistent 4px grid alignment.
- **Motion as signal**: animation only to explain state changes (a panel opening, a task completing, an approval needed). Motion for motion's sake is noise.
- **Glow as meaning**: the cyan glow appears on elements that require attention (primary action, active view, streaming indicator). It is not an ambient effect.

**Test:** Remove every animation and gradient from a screen. Does the hierarchy and meaning still survive? If not, the design is relying on decoration. It's wrong.

### P12 — Keyboard muscle memory is sacred
XR does not hijack keys that mean something in the user's terminal/muscle memory. Specifically:
- All Emacs/readline bindings (Ctrl+A/E/K/U/W/Y/P/N/F/B/D/L) work in the composer.
- Tab / Shift+Tab behave as completion/focus-cycle (NOT view-switch).
- Ctrl+C is interrupt, not quit.
- Ctrl+D is EOF/exit (only on empty input, with confirmation in TUI).
- Vim-style navigation keys (h/j/k/l, g, gg) work in lists/panels when enabled.
- Universal chords: Ctrl/Cmd+K = palette, Ctrl/Cmd+, = settings, ? = help, / = in-composer commands, Esc = dismiss/back.

**Test:** Can a bash user type a long instruction, edit it with Ctrl+A, kill a word with Ctrl+W, recall previous input with Ctrl+P, and send it — without a single surprise? If not, it's wrong.

### P13 — No dead ends
Every screen has a clear primary action and a clear way back. Error states explain:
1. What happened (in plain language)
2. Why it happened
3. How to fix it (with a one-click/keystroke action when possible)

There are no "contact support" dead ends — XR is open source; the fix is either a config change, a command to run, or a link to a doc/issue.

**Test:** Is there any error message that ends with "please try again later" without a remediation path? If yes, it's wrong.

### P14 — Transparent by default; private by design
- Audit log is on by default, stored locally, hash-chained.
- Memory only remembers what you explicitly ask it to remember (never auto-saves).
- Voice is opt-in; push-to-talk default, never always-listen.
- Screen sharing/computer vision requires an explicit "start looking" action and shows a pulsing indicator while active.
- Plugins and skills declare their permissions up front, in plain language, before installation.

**Test:** Is there any data flow that a reasonable user would be surprised to learn about? If yes, it needs an explicit disclosure and opt-in or it's wrong.

### P15 — Space matters
XR is used in terminals that can be 80 columns and in browsers on 4K monitors. Layouts must be **liquid** — they don't break at narrow widths, they don't waste space at wide widths.
- At 80×24: single pane, status bar, no inspector.
- At 120×40: three-pane (sidebar, main, inspector) is comfortable.
- At 160×50+: generous whitespace, but still no "air for air's sake" — productivity density increases with screen real estate.

**Test:** Does any surface break, scroll horizontally, or hide critical actions when resized to 80×24 or 1024×768? If yes, it's wrong.

---

## 2. Anti-principles (things XR will NOT do)

To be explicit:

1. **No skeuomorphic chrome.** No fake LCD panels, fake LED indicators, fake terminal scan lines, or fake "boot sequence" progress bars that don't represent real work. The startup *does* animate because it's loading real state, but each frame corresponds to a real phase, not a fake delay.
2. **No anthropomorphic chat.** XR is not your friend, not your assistant-with-a-face, not a person. It is a precise, powerful tool. The avatar represents it (cybernetic guardian) but the voice is concise, technical when technical is right, warm when warmth is right — never chatty, never apologetic without cause, never uses emojis unprompted.
3. **No confetti, no celebratory motion.** Tasks completing is the expected behavior, not a celebration.
4. **No dark patterns.** No forced account creation, no dark-pattern opt-outs, no "upgrade to pro" paywalls inside the app (XR is MIT-licensed; BYOK means no billing surface).
5. **No feature-shaming.** Free/tier-1/local users get the *same UI* as power users; advanced features are *discoverable*, not *gated behind upsells*.
6. **No telemetry without opt-in.** XR does not phone home. The only network calls XR makes are: (a) to the provider you configured, (b) to the plugin/skill registries you enabled, (c) to the MCP servers you configured. There is no XR analytics endpoint. Period.
7. **No modal-for-modal's-sake.** If something can be an inline expansion or a popover, it is not a modal. Modals are reserved for destructive confirmation and blocking error states.
8. **No arbitrary rearrangement of panels.** Panel positions are stable (Lazygit rule). The user builds spatial muscle memory and it is never violated.
9. **No breaking changes to keyboard shortcuts in minor releases.** Once a binding is shipped in a 3.x release, it stays through the 3.x line.
10. **No reading documentation to do the obvious.** Every primary action is obvious; docs are for advanced features, not for "how do I send a message."

---

## 3. Voice and Tone

XR speaks in one voice across every surface. The spec (full writing guidelines will live in a contributor doc) is:

- **Concise.** Say "Provider unreachable. Check your key and network." not "Oh no! It looks like XR couldn't reach the provider you selected. Please double-check your API key and network connection and try again!"
- **Precise.** Use the same nouns consistently (see canonical vocabulary in the IA doc).
- **Technical but not jargon-heavy.** Target an experienced developer audience, but never use unexplained acronyms on first mention in a surface.
- **Active, not passive.** "XR will run `npm install`" not "`npm install` will be run."
- **Honest about uncertainty.** "I'm not sure about this answer. Here's my reasoning — please verify." rather than confident hallucination.
- **No exclamation points in status messages or errors.** One is allowed in celebration of a successful install (just one).
- **In code/UI labels:** sentence case ("Command palette", "Budget ceiling"), not Title Case ("Command Palette"), except where proper nouns apply.

### Example
- ❌ "Oops! We couldn't connect to your model right now :( Maybe check your internet?"
- ✅ "Model unreachable. Ollama is not running. Start it with `ollama serve` or switch to a cloud provider in the model picker."

---

## 4. The 5-Second Fresh-Eyes Test

Any screen in XR must pass this test: sit a first-time user who knows what AI agents are in front of the screen for 5 seconds, then take it away. Ask them:

1. What does this screen do?
2. What is XR doing right now?
3. Where are you (workspace/session/surface)?
4. What's the most important thing you can do next?
5. How do you get help?

If they cannot answer all five, the screen fails. This applies to:
- The TUI home screen
- The dashboard overview
- A session/chat screen
- The marketplace
- The settings screen
- The audit log
- The website landing page
- The onboarding welcome

---

## 5. Design Philosophy in 12 words

> **Fast. Quiet. Precise. Trustworthy. One. Keyboard-first. Beautifully restrained. Local by default.**

That is XR.
