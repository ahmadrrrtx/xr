# XR UI/UX Transformation — Design Review

**Date:** 2026-08-13 · **Build:** 7.1.0 "Truth" · **Status:** DESIGN
APPROVED FOR PHASED IMPLEMENTATION (Phase A first — honesty & tokens).

## 1. What is changing

| Area | Change | Why |
|---|---|---|
| **Honesty** | Fake voice buttons replaced with real states/commands | Mission §31 "no fake UI" — current Voice panel simulates activation & test results |
| **Tokens** | Single source of truth; dashboard CSS derived from `tokens.ts`; brand secondary corrected to official indigo `#6048F8` | F-2/F-3 drift between styles.ts, tokens.ts, and the official palette |
| **Icons** | Emoji → centralized inline SVG set | F-4; ui-ux-pro-max rule; consistency & a11y |
| **Locality** | LOCAL/CLOUD/OFFLINE/DEGRADED badges fed by `probeHealth` | Mission §26 offline-first clarity; P1/P2 trust |
| **Chat** | Empty-state hero + suggested prompts; composer context/budget transparency; approval cards WHAT/WHY/RISK; streaming polish | Mission §8/§18/§21; research: never blank chat box, context transparency, show the work |
| **Onboarding** | GUI first-run flow reusing CLI wizard engines | Mission §11; non-technical users never see a terminal |
| **IA/labels** | Sidebar relabeled (Start/Ask/Capabilities/Guard/System), default view = Chat | Mission §7/§8: chat is the heart; user language |
| **Avatar** | State-driven 2D treatment (idle/thinking/tools/speaking/listening) + hero usage | Mission §12/§13; avatar communicates state |
| **A11y** | Live regions, focus traps, bento summary, reduced-motion support | Mission §24; F-11 |
| **TUI** | Status bar context/spend/locality; reasoning display toggle; brand-secondary parity | Mission §14/§39 |

## 2. What remains unchanged (deliberately)

- **Runtime architecture**: execution envelope → runner → agent loop; trust
  plane (policy/approvals/budget/egress/secrets/audit); provider registry;
  skills/plugins/MCP loaders; memory/research/voice engines; multi-agent.
- **All working dashboard panels and API routes** — the UI is a control layer;
  no route contract changes unless a phase needs a read-only addition
  (e.g., onboarding route).
- **TUI shell behavior, CLI command surface, onboarding wizard logic** —
  parity, not rewrite.
- **The official logo and avatar art** — never redrawn; only the supplied
  variants are curated into `assets/brand/`.
- **Dark-first product** (existing 3.1 rule).

## 3. Architecture impact

- Dashboard remains a dependency-free single-page app (HTML+CSS+JS served by
  the daemon, CSP `script-src 'self'`). Component architecture is
  function→HTML-string + `data-xr-action` delegation (formalizing the
  existing pattern), **not** a framework migration.
- `src/ui/tokens.ts` becomes the single authority; `styles.ts` consumes it
  (drift-locked by test).
- New daemon routes are **read-only/actions only** (e.g.,
  `onboarding.routes.ts` reusing existing engines) — the agent execution path
  is untouched.

## 4. Runtime integration points

| UI feature | Runtime path |
|---|---|
| Suggested prompts | real slash commands + chat route |
| Provider test | `presets.ts` `health()` |
| Local model cards | `local/hardware.ts`, `local/recommend.ts`, `local/ollama.ts` |
| Locality badge | `install/system.ts probeHealth()` |
| Budget meter | `src/cost/*` via `/api/budget` |
| Context meter | `src/context/*` via `/api/context` |
| Approvals | `/api/control/pending` + approve route |
| Voice states | `src/voice/*` capability probe (honest: CLI-only today) |
| Onboarding | `onboard.ts` engines over daemon routes |
| Audit/bento | existing `/api/*` routes (unchanged) |

## 5. Dependencies

- **No new runtime dependencies.** Website already has framer-motion/lucide/
  Tailwind (kept). xterm.js and Three.js are explicitly **deferred** (Phase G,
  future, lazy-loaded, with justification).
- New files: `assets/brand/*` (curated official variants), possibly
  `src/daemon/routes/onboarding.routes.ts`.

## 6. Performance implications

- Avatar treatment = CSS transforms/filters on existing PNG + SVG rings —
  negligible GPU cost; lazy where large.
- No new bundle: dashboard stays single-file; icons centralized reduces
  duplication (markup currently re-inlines SVG per occurrence).
- Streaming buffering avoids layout thrash (CLS) — matches existing `perf`
  culture (size-gate, hot-path-lint remain green).
- No 3D until a GLB exists and perf-gate passes (research 02).

## 7. Accessibility implications

- Target WCAG 2.2 AA; closes F-11 (live regions, focus traps, contrast
  already improved, reduced-motion).
- Every new component ships with its a11y spec (10-component-architecture.md).

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Dashboard is one 2k-line script — refactor could regress behavior | Phase C is pure-structure refactor; tests exist (daemon tests, axe); per-phase manual pass |
| Token change (`#6048F8`) touches TUI + website | One commit, drift-lock test, ANSI mapping update |
| GUI onboarding duplicates CLI logic | Reuse engines via routes; `onboarding --yes` parity test |
| Fake-UI removal leaves a sparse voice panel | Honest states + copyable `xr voice …` commands; roadmap E-2 |
| Scope creep into runtime rewrite | Gate: no backend changes except read-only/action routes; mission §32 |
| Perf regression from motion | Motion utility classes globally disableable; reduced-motion honored |

## 9. Migration strategy

1. Land Phase A on `main` (or a `ux/` branch) — small, verifiable, no
   behavior change beyond honesty fixes + tokens.
2. Phases B–F each land with the gate (typecheck/tests/lint/manual/live) and
   the phase log entry.
3. No data migration required: config keys, stores, and API contracts are
   untouched; dashboard chat state (localStorage) is preserved.
4. Website updated in Phase A token change (brand consistency) — claim-lint
   stays green.
5. Release notes document the UX transformation as 7.2.0-ux or similar per
   maintainer decision; CHANGELOG updated per repo rules.

## 10. Review verdict

The plan transforms the experience layer without touching the runtime's
proven trust architecture; it fixes genuine honesty violations (fake voice
buttons), aligns every pixel to the official brand, and elevates the four
surfaces into one coherent product identity. **Proceed to Phase A.**
