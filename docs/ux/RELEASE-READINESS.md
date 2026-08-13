# XR UX Transformation — Release-Readiness Report

**Date:** 2026-08-13 · **Build:** 7.1.0 (Truth) + UX Phases A–G (uncommitted on
`main`) · **Prepared by:** the UX transformation program (Phases 0–3 design
architecture + Phases A–G implementation).
**Method:** every claim below was verified this session — `bun run ci` exits
0, the hermetic golden path passes, and live probes were run against the real
daemon. Nothing is asserted without evidence.

---

## 1. What changed (summary)

Phases A–G delivered the full UX transformation over the working 7.1.0
runtime, **without rewriting the runtime** (mission §32): honesty fixes,
brand alignment, GUI onboarding, chat/component architecture, TUI parity,
voice/avatar state, locality/QA, and a workspace-files coding slice.

| Phase | Core delivery |
|---|---|
| A | Fake voice buttons removed; one token source; official indigo `#6048F8`; emoji→SVG; locality badges; composer budget/context transparency; settings honesty |
| B | GUI first-run onboarding (real engines: vault key save, local-model set, budget, audit completion); IA relabels (Start/Ask/Capabilities/Guard/System); default view=Chat; sidebar/inspector toggles; empty-state hero |
| C | Byte-identical component split; **fixed a real served-script SyntaxError** (lost-backslash escaping) + parse gate; approval cards WHAT/WHY/RISK; streaming live-region + cursor; sessions search/copy-id |
| D | Official indigo reaches the TUI (RGB.violet); status bar context/spend/tokens/locality; agent-detail toggle (Ctrl+T); `?` help refresh; glyph audit (voice 🎤→♪) |
| E | Avatar state orb (idle/thinking/working — speaking/listening honestly not faked); voice panel real STT/TTS/wake + offline note; official variants curated to `assets/brand/` |
| F | Hardcoded "All modules validated" + `\|\| 96` fabricated score removed; bento screen-reader digest; first-time-user golden path verified live |
| G | **Real scoped `/api/files` routes** (list/read/diff, scope-enforced, git status); Workspace Files browser (was a static placeholder); future surfaces honestly labeled |

## 2. Major UX improvements

1. **No fake UI anywhere** (mission §31): every control maps to a real
   runtime path; the only remaining simulated paths were found and removed
   (voice buttons, hardcoded shield text, fabricated score, three never-updated
   static claims — all fixed this session).
2. **One brand** across GUI/TUI/website: official palette pixel-verified and
   enforced by a token-drift test; TUI truecolor fixed to the official indigo.
3. **First-run without a terminal**: GUI onboarding reuses the CLI wizard
   engines; a first-time user can go fresh-home → dashboard → provider/local →
   first prompt without reading docs.
4. **Chat is the heart**: default view, empty-state hero with real suggested
   prompts, composer shows honest budget/context/locality, approvals show
   WHAT/WHY/RISK, streaming is transparent (live region + cursor + code note).
5. **Honest transparency everywhere**: locality badges, real spend/tokens,
   "last 10 messages" context, offline notes for voice, honest EDR numbers.
6. **Accessibility**: aria-live streaming, keyboard-first palette/approvals,
   bento text digest, contrast-verified tokens, reduced-motion respected.
7. **Component architecture** (no-build SPA constraint honored): fragments +
   composition, byte-identical served bytes, owned split plans in the size
   waiver register.

## 3. New assets

- `assets/brand/avatar-front.png`, `assets/brand/avatar-hero.png`,
  `assets/brand/palette-reference.png` — the official supplied variants,
  curated (no redrawing).
- No new rasters otherwise; the avatar state treatment is pure CSS/SVG.

## 4. New dependencies

**None.** Runtime deps remain `zod` only (`playwright` optional). No
xterm.js / Three.js / framer-motion added — each was researched and
deliberately deferred with justification (`docs/ux/research/01/02/03`).

## 5. Architectural changes

- `src/daemon/dashboard/*` split into fragments composed by thin modules
  (client-core/chat/panels-a/b/c/runtime, page-head/panels-a/b/tail,
  style-tokens/shell/ui) — byte-identical composition.
- New daemon routes (all read-only/actions, no agent-path changes):
  `onboarding.status|provider|complete`, `files.list|read|diff` (+6 API ops,
  106 total; `api:compat` confirms no breaking changes).
- `src/ui/tokens.ts` is the single token authority; dashboard CSS consumes it
  (drift-locked by test).
- `config.getProviderEnvStatus` is vault-aware (CLI↔GUI parity).
- Onboarding health probes made parallel + bounded (2.5 s) — a real latency
  fix discovered by the release CI.
- No runtime/execution changes; the trust plane is untouched.

## 6. Tests

- `bun run ci` (full gate chain) **exits 0** — typecheck, full suite
  **2937 pass / 13 skip (live-browser a11y) / 0 fail**, claim-lint,
  release:check, channel:check, changelog:check, baseline:inventory,
  platform:parity:check, boundaries (538 modules, 0 violations), size-gate,
  hot-path-lint (0 hot-path violations), ownership:check, api:schema:check,
  client:check, api:compat (0 breaking), ci-capability-gate,
  website:marketplace:check (67 real items).
- **+61 new tests** across the program (Phase A–G suites: honesty, token
  drift, onboarding routes, phase B/C/D/E/F/G gates, served-script parse
  guard, release honesty).
- Hermetic **golden path** passes: install → first answer → audited → chain
  intact → restart preserves → recovery → uninstall keeps data.
- `verify-release` reports NOT VERIFIED only for the cosign signature (needs
  the maintainer's key — expected; no false claim made).

## 7. Performance results

- Dashboard remains a dependency-free single-page app; the component split
  is byte-identical (no bundle change). Avatar state is CSS transforms only
  (no GPU cost). `hot-path-lint`: 0 sync FS/process calls in the hot path.
- No new heavy deps; 3D/terminal deferred by design (research docs 01/02).
- Boot/load behavior unchanged for the runtime (no execution changes).

## 8. Accessibility results

- WCAG 2.2 AA targets held: contrast tokens verified by
  `test/a11y/contrast.test.ts`; static a11y suite green; keyboard-first
  palette/approvals/files browser; `aria-live` streaming + approval list +
  bento digest; reduced-motion + reduced-transparency honored.
- **Remaining honest gap:** the live browser-axe sweeps (`test/a11y/
  browser-axe.test.ts`, 13 skips) need chromium, which the sandbox lacks —
  run them in CI (a one-line workflow change) before the final green.

## 9. Remaining limitations (honest)

- Browser-axe sweeps not executed here (need chromium) — recommended CI step.
- Settings panes are read-only in the dashboard (config-write API deferred).
- In-GUI model pull, in-browser mic, embedded terminal, 3D avatar, floating
  companion, light theme: future, documented with real blockers, never faked.
- Agent-detail/shell prefs are session-scoped (persistence deferred).
- Per-file git badges in the file browser resolve at repo root (degrade to
  "—" in subdirectories).

## 10. Release-readiness checklist (mission §40)

- [x] UX is coherent — one identity across GUI/TUI/CLI; command grammar
      shared (`/model`, modes, locality words)
- [x] No fake functionality — grep-swept; parse gate; static-claim tests
- [x] Real functionality works — full suite + golden path + live probes
- [x] Offline behavior works — audit verify offline, local-first labels
- [x] Voice works where supported, honest elsewhere (terminal-driven GUI)
- [x] TUI/CLI work — shell parity tests, CLI smoke, `?` help refresh
- [x] Accessibility green (static) — contrast, live regions, keyboard
- [ ] Accessibility browser sweep — needs chromium in CI (one-line)
- [x] Performance acceptable — no bundle growth, no new deps, CSS-only
      avatar, hot-path clean
- [x] Security UX honest — WHAT/WHY/RISK approvals, real EDR numbers,
      honest readiness banner, no fake badges
- [x] New-user path verified — GUI onboarding + golden path live
- [x] docs/ux/ set + this report are the record of the program

## 11. Next step for publishing (maintainer-held credentials)

Follow [`docs/release/RELEASING.md`](../release/RELEASING.md) +
[`docs/release/LAUNCH_HANDOFF.md`](../release/LAUNCH_HANDOFF.md) — the
sandbox cannot sign or publish (no GPG/SSH key, no npm OIDC, no cosign
identity), and `verify-release` correctly refuses to claim otherwise:

1. **Commit** the UX changes on a release branch (this work is currently
   uncommitted on `main`).
2. **Bump the version** in `release.manifest.json` → `bun run release:stamp`
   (one source of truth; CI fails on drift).
3. `bun run release:check && bun run channel:sync && bun run changelog:generate`
   (fold the draft notes below into the generated changelog entry).
4. `bun run ci` (already green here) + `bun run build:binary` + `bun run
   golden-path` on the release machine.
5. **Signed tag** `v7.1.1` (or per your versioning decision) → push → the
   release workflow builds, checksums, SBOMs, signs (cosign), publishes
   (npm OIDC, GHCR) and stamps channels automatically.
6. Add a chromium runner to CI and re-run `test/a11y/browser-axe.test.ts`
   for the final accessibility green.
7. Update the GitHub Release body from `docs/release/<version>/` artifacts
   (honest supported-platform table per `SUPPORT_MATRIX.md`).
