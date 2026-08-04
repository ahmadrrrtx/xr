# ADR-0023 — Package managers own their channels; store submissions are honest about lag; snap/flatpak rejected for now

- **Status:** accepted (Phase 9 · T3/T5)
- **Owner:** release engineering · **Review:** 2026-08-04

## Context

Pre-Phase-9 the updater (`src/install/system.ts`) rewrote an installation
in place regardless of how it was installed — half-editing brew/apt-managed
prefixes and leaving the PM's own metadata inconsistent. The Phase-9
contract demanded per-channel update/rollback/error semantics. Separately,
the "which stores do we submit to?" question needed durable answers instead
of ad-hoc enthusiasm: WinGet has a community-review model with real lag, and
snap/flatpak carry sandboxing and store-governance properties that interact
with XR's own update model.

## Decision

1. **Channels are classified by who owns mutation.** `updateOwner: "xr"`
   (direct binary, npm, git checkout) uses XR's atomic blue-green updater:
   verified download → canary self-test → swap, auto-rollback on failed
   canary. `updateOwner: "channel"` (Homebrew, Scoop, WinGet, deb, rpm,
   container) is **owned by the package manager**: `xr update` detects the
   channel (`install.json` → path heuristics → legacy layout) and prints the
   PM's exact update + rollback commands instead of touching the files.
   Every manifest channel carries tested `update`/`rollback` strings; a
   channel without an honest rollback story fails manifest validation.
2. **A failed or unconfigured channel fails the release.** The Release
   workflow checks each channel's secret before attempting publication and
   the `evidence` job fails the workflow when any stage is not green —
   "channel skipped silently" is the one outcome the design forbids
   (Art. XXII).
3. **WinGet ships as tier 2 with the lag disclosed.** The community-registry
   review takes one cycle after each release; the downloads page, the
   manifest summary and INSTALLATION.md all say so. Hiding the lag would be
   a false card (Art. X).
4. **No hosted apt/dnf repositories.** The `.deb`/`.rpm` carry the same
   signed binary; update means fetching the new package. A repo service
   (mirroring, retention, signing key custody) is a Phase-10-class operating
   commitment, recorded as a known limitation.
5. **snap and flatpak are REJECTED for now** (review at 9.0.0 planning —
   to be proposed, not re-litigated):
   - Both impose confinement models (strict snap interfaces; flatpak
     portals) that intersect XR's own in-process policy gate and its
     honest "policy is not isolation" documentation — packaging XR into a
     second confinement story would ship two answers to one question and
     invite the assumption that the package's sandbox makes XR safe, which
     is exactly the claim the constitution forbids.
   - Snap's `snap revert` conflicts with XR's atomic updater model only for
     `updateOwner: "xr"` channels; making snap `updateOwner: "channel"` is
     possible but duplicates the `.deb` path for a smaller honest gain.
   - Store publishing requires developer accounts/credentials outside the
     repository (Launchpad/Flathub), and Flathub's review pipeline does not
     fit the tag-triggered single-pipeline release model without a second
     release authority.

## Consequences

- Users on PM channels get correct-by-construction updates; users on XR-owned
  channels get verified atomic updates with automatic rollback.
- The downloads page cannot drift into fiction: distribution data is stamped
  from the manifest, and fictional-channel assertions run in CI
  (`test/release/downloads-page.test.ts`).
- "Why no snap?" has one citable answer (this ADR) instead of scattered chat.

## Tests

`test/release/channels.test.ts` (manifest validation, renderer output,
placeholders), `test/release/channel-update.test.ts` (detection precedence,
PM command-pair generation for every channel id, verified atomic update
with three tamper refusals), `test/release/release-workflow.test.ts`
(secret presence checks, evidence job), `test/release/downloads-page.test.ts`.
