# Accessibility Authoring Guide — dashboard contributions

Rules every Control Center contribution must follow. The `a11y` CI job and
`bun test test/a11y/` enforce them; the manual pass (`MANUAL-TESTING.md`)
double-checks each release.

1. **Use native elements.** A `<button>` for actions, `<a href>` for
   navigation, `<input>/<select>/<textarea>` for fields. Never a clickable
   `<div>` — if a list row/card must activate, it gets `role="button"
   tabindex="0"` and is covered by the central Enter/Space bridge
   (see client-script "keyboard activation bridge").
2. **Every control has a name.** Visible `<label for>` or an `aria-label`.
   Placeholders are hints, never names.
3. **Decorative SVGs** carry `aria-hidden="true" focusable="false"`.
4. **Focus is sacred.** Don't remove `outline` (the global `:focus-visible`
   rule exists precisely so you don't have to). Don't move focus except on
   explicit navigation; always return focus after dialogs close.
5. **Toasts:** use `toast(msg, "info"|"warn"|"err")` — roles are wired
   (status/alert). Never `alert()`/custom popups.
6. **Dialogs:** `role="dialog" aria-modal="true" aria-label`, trap `Tab`,
   close on `Esc`, return focus to the invoker (copy the palette pattern).
7. **Targets ≥ 24×24 CSS px** (2.5.8). Check icon-only buttons especially —
   and give them `aria-label`s.
8. **Contrast:** use design tokens; text pairs must hold ≥4.5:1,
   boundaries ≥3:1 — `contrast.test.ts` recomputes from the real stylesheet,
   so new tokens land inside the gate automatically.
9. **Meaning never comes from color alone** — pair every dot/bar with text.
10. **New panels:** registered nav entry is a `<button class="nav-item">`,
    panel root keeps `tabindex="-1"`, first heading is the panel title.
11. **Motion:** respect the global `prefers-reduced-motion` collapse; don't
    invent non-token animations longer than a micro-interaction.
12. **Auth or forms:** no paste-blocking, no CAPTCHAs, no re-asking for
    information already collected this session (3.3.7/3.3.8).
