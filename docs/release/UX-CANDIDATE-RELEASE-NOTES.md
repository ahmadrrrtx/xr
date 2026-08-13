# XR UX Transformation — Candidate Release Notes (DRAFT)

**Status:** draft for the maintainer to fold into the next release notes
(alongside the generated CHANGELOG entry). This is the **UX delta** of the
7.1.0 baseline; version numbering and publication follow the maintainer per
`docs/release/RELEASING.md`.

---

## UX highlights

- **The dashboard is now honest by construction.** Removed every simulated
  control: the voice panel's fake "Enable Voice" / "Test loop latency"
  buttons (it now shows the real config and terminal commands), the
  hardcoded "All modules validated" shield text, the fabricated 96%
  security score (`|| 96`), and three never-updated static claims ("Safe",
  "Ready", "OK"). Every number you see is derived from a real runtime
  endpoint.
- **One brand everywhere.** The official palette is now the single token
  authority (pixel-verified from the brand assets): the dashboard CSS
  consumes `src/ui/tokens.ts`, and the TUI's truecolor violet was corrected
  to the official indigo `#6048F8`. Emoji-as-icons are gone (inline SVG),
  including the terminal voice glyph.
- **GUI first-run onboarding.** A guided flow (welcome → cloud/local/both →
  provider key via the OS keychain → local-model recommendation → security →
  budget → ready) reuses the exact engines the CLI wizard uses, and records
  completion in the audit log. No terminal required.
- **Chat is the heart.** Landing view is the chat; the empty state is a real
  hero (official avatar + suggested prompts bound to live commands);
  approvals show WHAT / WHY / RISK from the control plane; the composer
  shows honest budget spend, per-task cap, "last 10 messages" context, and a
  LOCAL/CLOUD/OFFLINE badge; streaming announces start/end/stop and shows a
  cursor + mid-code-fence note.
- **TUI parity & polish.** Status bar shows real spend, real token count,
  session context, and an explicit LOCAL/CLOUD word; Ctrl+T cycles an agent
  detail level (none/brief/detailed) that controls how much of the real
  tool timeline appears in the chat; `?` help is refreshed and verified
  against the keymap.
- **Avatar state language.** A small avatar orb in the chat header
  communicates real agent state (idle / thinking / working). Speaking and
  listening states are intentionally not faked — the GUI does not drive the
  audio pipeline (voice runs in the terminal, with an honest offline note).
- **Workspace Files browser (experimental).** The old placeholder is now a
  real, scope-enforced file browser: list, text preview, and live `git diff`
  behind three new scoped API routes — traversal is rejected, binary files
  are refused, and untracked files honestly report "no diff". Read-only by
  design; the terminal/TUI are the write surfaces.
- **Future surfaces are labeled honestly** (embedded terminal, 3D avatar,
  floating companion, in-browser mic, light theme) with their real blockers —
  nothing is advertised that does not exist.

## Fixes

- **Real served-script SyntaxError fixed.** The dashboard client did not
  parse after escaping regressions in onboarding attribute builders; a
  permanent parse gate (`new Function`) now guards the served script.
- **Onboarding status latency:** provider health probes now run in parallel
  and are bounded (~2.5 s) instead of 8 s × N providers.
- **Broken "Copy" button** on chat messages (allowlisted but never defined)
  now works.
- **`/chat` and `/dashboard` routes** now actually land on the right panel
  (the old inline-script injection never worked under CSP).
- **Provider keys saved by the CLI wizard** now show as configured in the
  dashboard (vault-aware provider status).

## Notes

- Zero new runtime dependencies; the dashboard remains a single-page,
  no-build app.
- The full test suite: **2937 pass / 13 skip / 0 fail**; `bun run ci` green;
  hermetic golden path green.
- Remaining honest gaps are documented in
  `docs/ux/RELEASE-READINESS.md` §9 (incl. the chromium-only browser-axe
  sweep recommended for CI).
