# UI Redesign — 2026-10-29 → 2026-10-30 (reconstructed twice, honestly)

**Scope**: Sidebar · Builder · Research + directly related shared components.
Blueprints were references, not templates. No unrelated refactoring.

> **Reconstruction note (2026-10-30).** The original work — three local
> commits (`65e2b97f` UI redesign, `dc44f6f6` avatar master + rail/focus
> hardening, `44107b5c` panel persistence + Phase 5) — was destroyed by an
> environment reset before it was ever pushed. A first faithful rebuild from
> origin/main `8e72ac6c` + the surviving executable spec
> (`tools/screenshots-ui-redesign.mjs`) was **fully re-verified** (sweep
> ALL CHECKS PASSED on the sidebar + builder legs, axe 0 violations,
> persistence probe green) and then destroyed by a SECOND environment reset
> at a turn boundary. This branch is the second rebuild — same contracts,
> same fixes, re-derived from the session record. It is one transparent
> commit, NOT byte-identical history. Lesson recorded twice: push verified
> milestones immediately; never leave significant work only in the sandbox.

## What changed

### Global / shell
- **Sidebar rail: 72 → 56px** (VS Code-style slim icon rail). Collapsed nav
  items are full-width 40px-tall hit targets, the collapse button matches,
  and the nav strip (`xr-rail-scroll`) hides its scrollbar so the 4px
  ActiveBar hugs the rail edge. Expanded width 240px unchanged.
- **Fixed a real pre-existing bug the sweep caught**: the sidebar's
  `NavLink` passed `className` as a FUNCTION, but the Radix `TooltipTrigger
  asChild` Slot merges className by string-join — the function was
  stringified into the class attribute and the quote-wrapped sizing classes
  (`"h-11`, `justify-center"`) never tokenized, so collapsed items rendered
  20px tall and left-aligned. The active route + class string are now
  computed in the component (`useLocation`, segment-boundary prefix match —
  same semantics as NavLink's default) and passed as a plain string.
- **Avatar master swap**: the owner's new front-facing render
  (`1772380044.png`) reconverted into the 512/256/128 webp + png derivatives
  (8:7 centered crop, LANCZOS); the Chat welcome state now leads with this
  bust (soft float, reduced-motion safe) instead of the idle GIF.

### Builder (VS Code workbench)
- **Preview pane is closed until opened** — unmounted, not hidden
  (`builderStore.previewVisible`, TopBar toggle `builder-preview-toggle`,
  palette "Toggle preview"). Persisted (`xr.builder.preview.visible`).
- **Bottom panel** (`builder-bottom-panel`): Terminal · Problems · Output ·
  Tests · Ports — replaces the terminal drawer + the preview's console.
  - Terminal: the same lazy xterm ↔ engine PTY.
  - Problems: live LSP diagnostics for open buffers (jump-to-file rows).
  - Output: dev-server console (filter/clear), moved from the preview pane.
  - Tests: honest — no fake runner; runs in the terminal.
  - Ports: the engine-managed dev server (url/port/pid, stop/restart).
  - Tab + open state + height persist (`xr.builder.bottom.tab`,
    `xr.builder.bottom.visible`, `xr.builder.panes.bottom`); ⌃` lands on the
    Terminal tab; `resetLayout` restores the default workbench.
  - The panel's `tablist` contains ONLY tabs (axe aria-required-children);
    spacer + close button are siblings.
- **Tab strip (a11y)**: real `tablist` — the quick-open (+) button moved
  outside it; close affordance is an aria-hidden span (no nested interactive);
  roving tabindex + ←/→; Delete/Backspace closes the focused tab.
- **CodeEditor (a11y)**: content + scroll DOM labelled, scroller focusable.
- **Chat context (A7)**: the live preview URL joins the builder context when
  the preview pane is open; the chat log is a focusable labelled region.
- **Landmarks**: BuilderScreen's editor column is a `<section>` — AppShell
  owns the single `<main>` (axe: landmark-main-is-top-level /
  landmark-no-duplicate-main).

### Research (evidence-first)
- **Stage rail** (`stage-rail`): Plan → Search → Read → Synthesize from the
  run's real phase + an Evidence shortcut (scrolls to the matrix).
- **Evidence matrix** (`evidence-matrix`): one row per cited source in
  citation order, first evidence line quoted, trust + status; rows focus the
  matching source card.
- **Grounded chat dock** (`research-chat`, ⌘J): answers FROM the run on
  screen — `research/grounded.ts` builds a bounded digest (report excerpt,
  cited sources + evidence, contradictions, open questions) handed to the
  existing chat stream (mode `ask`), so budget gates and transport are
  unchanged. `[sN]` markers in replies focus source cards.
- **SourceCard (a11y)**: plain div + real `<button class="xr-card-hit">`
  summary hit area (aria-expanded there), actions outside it.
- **Landmarks/scroll (a11y)**: article column `<main>` → `<section>`
  (AppShell owns the single main), labelled focusable scroll regions for the
  article, chat log and the live run log.

### Engine contract fixes (both verified against real clients)
- `ChatStreamRequest` declares the five fields the desktop engine client
  actually sends (`stream`, `budget`, `maxSteps`, `toolsAllow`, `toolsDeny`)
  — the strict v1 body gate was rejecting every desktop chat with HTTP 400.
- `toolParameters` normalizes legacy string property maps
  (`"path": "string (relative path)"`) into real JSON Schema — strict
  validators (ollama 0.40.x OpenAI-compat) rejected the bare-string form
  with HTTP 400 on every native-path chat. Prose is preserved as
  `description`; regression tests in `native-continuation.test.ts`.

## Verification

First rebuild (before the second environment loss), measured live against
the real app + engine:

| Gate | Result |
| --- | --- |
| UI sweep sidebar+builder legs (`SKIP_RESEARCH=1`) | **ALL CHECKS PASSED** — rail 56±0.5, 14 items, icon centering Δ≤0.5px, ActiveBar at 0.0px, expanded 240, 5 themes × 2 states, tree loads, preview starts closed → opens via toggle, iframe mounts, panel via ⌃`, all 4 tabs |
| axe (WCAG 2.2 AA) Builder | **0 violations** (after the two landmark/tablist fixes) |
| Persistence probe (set → reload → restored) | **VERIFIED** — preview on, panel open, Tests tab active, height 240 |
| PTY probe | **LIVE** — xterm mounted with rendered rows through the engine approval bridge |
| `bun test` full tree | all pass (in chunks: 3594 + 955 passes, incl. the new suites) |
| `typecheck` (root + desktop) | clean |
| `api:schema:check` / `client:check` / `api:compat` | in sync |
| ipc-acl, capability gate, sink-lint, claim-lint, placeholder-lint, hot-path-lint, ownership, boundaries, size-gate, release/channel/platform-parity/marketplace checks | all green |
| `changelog:check` | fails **identically on origin/main** (release-time gate for the unreleased 1.1.1-rc.1) — not a regression |

**Pending (needs the owner's Groq key, re-run after the second rebuild):**
research live leg (`XR_RESEARCH_RUN=1` — 3 local QEC PDFs, real citations),
grounded-chat live answer, gallery HTML, and the final re-run of the
sidebar+builder sweep on this second tree (same code, re-verified from the
same contracts; the first rebuild's measured results are above).

## Not done / out of scope
- A9 CI portable-journey leg (pending, separate).
- No merge to main, no tags, no publish (owner's call).
