# Known limitations register (living)

Maintained per cross-phase invariant. Every entry states the limit, the
risk, and the phase/owner where it closes. Nothing here is hidden from the
user-facing product: where a limitation touches UX, the shell says so.

## Open

| ID | Limitation | Risk | Closes in |
|---|---|---|---|
| L-01 | i18n catalog covers core chrome (nav, onboarding verbs, statusbar) only; domain screens remain English. Urdu ships LTR-rendered — full RTL mirroring is a separate design pass. | Cosmetic / market reach | P6 (post-GA localization pass) |
| L-02 | Rust-side Phase-4 additions (tray event emit, `xr://` deep-link plugin) are compile-pending: this sandbox has no Rust toolchain; CI per-OS matrix is the verifier. | Native features inert until CI-green build | repo CI (next desktop-app.yml run) |
| L-03 | Per-OS native matrix not executed in this sandbox. The lanes now EXIST (`real-device-matrix.yml`: installed + upgraded per OS, probe script asserts measured facts only) but the first green run is still owed by CI. | GA certification incomplete without it | CI (next run after merge) |
| L-04 | Voice listening loop not exercised end-to-end headless (no mic hardware); covered by engine voice corpus tests instead. | Low (engine-tested) | real-device pass |
| L-05 | Workspace lazy chunk is 658 kB (cap 750 kB). Bounded, but the diff/terminal surface should split further when it grows. | Startup on slow networks (lazy, non-entry) | next bundle pass |
| L-06 | Business routes residue is now flag-OFF (SEC-05) but still in-tree; deletion awaits the migration finishing. | Surface stays audited-but-dormant | migration completion |
| L-07 | Sandbox snapshots drop `.git` between sessions in this environment; history is re-grafted each session. Local commit hashes are therefore session-scoped until pushed. | Provenance noise | push to remote (needs operator credentials) |
| L-08 | Home screen heading order skips a level (axe `heading-order`, moderate, accepted): the brand lockup is the page `<h1>` while area cards use their own hierarchy. Cosmetic; fixing means restructuring every screen's heading tree. | Cosmetic | P6 typography pass |
| L-09 | Dev-server only: if `XR_DEV_TOKEN` and the running daemon disagree, the shell paints the window background during its splash grace window instead of an error card (engine-side auth 401 is not a link failure). Packaged app always holds a valid token, so this is an operator-config edge, not a product path. | Dev ergonomics | next dev-tooling pass |

## Closed this program

- F-1…F-11 series (see audit) — all closed except F-10 which closed here
  (light pass verified by capture, `15-light-*.png`).
- SEC-05 flag-OFF (this phase), SEC-06 parity transport (Phase 4),
  SEC-12 engine containment (Phase 1 upstream + verified).
