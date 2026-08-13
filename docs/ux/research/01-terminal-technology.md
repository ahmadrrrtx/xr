# Terminal technology research — what XR should use and when

Researched 2026-08-13. Scope: the **TUI** (native terminal, already built with
ANSI) and a possible **embedded terminal** inside the web dashboard.

## 1. The XR TUI already exists and is native

XR's fullscreen shell (`src/interfaces/shell/app.ts`, `render.ts`) renders
straight to the terminal with its own ANSI engine (`src/ui/theme.ts`,
`src/ui/ansi.ts`, `src/ui/brand.ts` — official logo/avatar rasterized to
truecolor ANSI frames). It supports truecolor / 256 / 16 / mono / NO_COLOR.
**No xterm.js is needed for the TUI — it is not a browser surface.**

## 2. When XR would need a web terminal: the dashboard

`xr serve` already ships a token-authed dashboard (`src/daemon/`). If XR later
embeds a live terminal panel (PTY-backed shell, `xr run` output, live tool
logs), a browser terminal emulator is required. Candidates (2026 state):

| Option | Renderer | Accessibility | Notes |
|---|---|---|---|
| **xterm.js** | DOM (default) / WebGL / Canvas addon | Screen-reader + minimum-contrast modes built in | The safe, mature choice — VS Code, Tabby, Hyper use it. Largest ecosystem, zero deps, GPU-accelerated renderer. Known limitation: scroll-jumping with TUI apps that repaint the alternate screen (same issue VS Code has). |
| **wterm** (Zig+WASM core) | Native DOM text nodes + dirty-row tracking | DOM-first, good selection/search | Newer; fixes xterm.js scroll/accessibility issues, but smaller ecosystem, alpha risk. |
| **libghostty** | wgpu/Metal/GL via Zig SIMD parser | varies | Fastest parser, native Kitty protocol, but alpha and no official WASM distribution — too risky for XR today. |
| **hterm** | DOM | decent | Simpler, Google-backed, fewer features. |

### Recommendation

- **TUI:** keep the native ANSI shell (no change). It is faster, lighter, and
  already accessible.
- **Dashboard terminal (future/optional):** use **xterm.js** when it lands.
  Pin a version, load it lazily only when the Terminal panel is opened
  (never on dashboard boot), and keep the PTY on the daemon side behind the
  same auth token used by the rest of the API. Only add it if a real need
  exists (live `xr run`/shell visibility); do not add a decorative terminal.
- **Do not** embed a web terminal in the main chat flow — the TUI and CLI are
  the terminal-first surfaces, and the dashboard chat is the calm surface.

## 3. Terminal UX patterns worth copying (from research)

- **Status-line contract** (Claude Code): model/provider, mode, context
  percentage, session name in one compact bar. XR's shell already has a status
  bar — extend it with context/token usage (real, from `src/cost/`), not fake.
- **Plan mode as a state** (Claude Code `Shift+Tab`): XR shell already has
  `agent / plan / ask` modes — keep, and surface the mode in the status bar
  and dashboard composer identically.
- **Leader-key command set** (OpenCode/OpenClaw): `g <key>` mnemonic
  navigation already exists in the XR shell (`g d`, `g c`, `g s`, …). Keep and
  document it; add a `?` help overlay (already present).
- **Thinking-levels toggle** (OpenClaw `Ctrl+T`: none/brief/detailed) — a real
  UX win for XR: users control how much reasoning the agent shows. XR's shell
  `state.mode` and turn-repair machinery can support this honestly.

## 4. Anti-patterns to avoid

- Terminal-in-terminal decorative embedding; fake typing animation in the
  TUI; slow re-render of the whole screen per token (render deltas only);
  ignoring `NO_COLOR`/`XR_COLOR`; unreadable 16-color fallbacks.
