# Phase 28 — study notes

Written before implementation, from the repo docs (xr-CONSTITUTION,
xr-THEME-SYSTEM, xr-DESIGN-SYSTEM, xr-DEEP-DIVE-ARCHITECTURE) and the brief.

## Constitution constraints that shaped every decision

1. **Loopback default.** `resolveBindHost()` returns 127.0.0.1 unless told
   otherwise. `--lan` is the only path to 0.0.0.0, and it prints a warning that
   cannot be missed. Verified by test, not by promise.
2. **Fail closed.** Every daemon route the mobile app uses returns 401 without
   a session. `/api/meta/version` is included — it doubles as the app's
   liveness probe, so a cached 200 there would lie about reachability.
3. **Zero telemetry.** `connect-src` allows 'self' + push services only. The
   precache serves all assets after first load; there is no CDN anywhere.
4. **Honest copy.** Offline bar, pairing screen, push section in Settings: each
   states the limitation in one plain sentence ("Push requires XR desktop to be
   running on your network.").
5. **Truth in pixels.** Badges, spinners and the sync bar reflect real store
   state; the drain indicator only clears when IndexedDB's queue is empty.

## Theme system mapping

- 5 themes + System, driven by CSS custom properties on `<html data-theme>`.
  Components never fork per theme — identical rule to desktop.
- Graphite's published tokens put near-black text on a mid-grey void (fails
  4.5:1 for body text). Mobile darkens Graphite's text ramp
  (`--text-secondary: #3A3A3A` → keeps AA) and its semantic colours; noted as a
  deliberate accessibility deviation in SECURITY.md-adjacent docs and the PR.
- `--is-dark` per theme drives iOS status-bar style and the two syntax palettes
  (token colours are theme variables, so light + dark both pass contrast).

## Design system carry-overs

- Orb: smooth glossy sphere, tilted equatorial ring (silver→cyan gradient),
  core glow intensifying with state; voice rings track mic RMS. No
  segmentation — matches Phase 16 companion orb.
- Motion: 180–240 ms, ease-out, spring stiffness ~320–500. Reduce-motion kills
  pulses/orbits and keeps fades; haptics gate on the same media query.
- Icons: lucide only, 1.5–1.8 stroke.

## Decisions worth arguing about in review

1. **No react-router.** Five screens, no deep links, real push/pop + edge-swipe
   needed → a 60-line zustand stack (~1 KB gz) instead of ~16 KB of router.
2. **No shiki.** A trimmed shiki build alone would blow the 200 KB budget; the
   1.5 KB tokenizer covers ts/js/py/rs/go/sql/sh/yaml/diff and maps tokens to
   theme variables. Unknown languages degrade to escaped plain text.
3. **SameSite=Strict instead of None.** Stronger, and correct: PWA and API are
   same-origin (including SW fetches). Documented deviation.
4. **Cert fingerprint served by the daemon.** A page cannot read its own TLS
   cert. First confirmation is out-of-band (eyeball the desktop); after that
   the pin is authoritative. An attacker who can MITM *later* cannot forge the
   pin without the private key.
5. **Push TTL + post-delivery suppression.** 10-min TTL at the push service and
   a `/approvals/:id` re-check in the SW push handler: resolved approvals never
   buzz a phone.
6. **Service worker queue lock.** Both SW (Background Sync) and page can drain;
   an `inflight` timestamp in each queue item prevents a double-send race.

## What I could not test here, and how it's hedged

- Real FCM/APNS delivery: needs a real phone against a live push service. The RFC 8291/8188 layer
  is cross-validated against the reference `web-push` package (its ciphertext
  decrypts with our reader, ours round-trips, tamper detection works).
- iOS Safari specifics (MediaRecorder mime, standalone chrome, splash): coded
  to documented behaviour + graceful fallbacks (ogg→webm→mp4; mic-denied copy;
  `apple-touch-startup-image` set).
- mDNS auto-discovery: skipped (brief allows). QR + manual entry cover pairing.

## Bundle audit (final)

```
critical path  132.5 KB gz   (budget 140)
total          179.4 KB gz   (budget 200)
markdown+gfm    46.9 KB gz   lazy, only when a message contains markdown
```

## Branch context (added when the slice was replayed onto main)

This phase was authored in a workspace that had the brief and the design docs but no checkout of
the 0–27 tree, so the daemon half was written as new, self-contained modules and validated against
`tools/reference-daemon.mjs`. The branch is now replayed flat onto `main@95fadf5`: every file is a
new path except `.gitignore`, `package.json` and `README.md` — each edited by a few lines, nothing
removed or renamed. The remaining integration is mounting `handleMobileRoutes()` + `mobileGate()`
into the shipping daemon's route table and `--lan` into the CLI router; see the PR body and
`28-PR-body.md` for exactly what runs today.
