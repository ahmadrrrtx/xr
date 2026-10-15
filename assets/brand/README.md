# Brand assets — where they live now

The old `assets/brand/` curation was retired in Phase 31 · Bucket F v2.
Nothing ships from this directory any more. Current sources of truth:

- **Staging (Drive pack, gitignored):** `assets/v2/` — 223 delivered
  files, `MANIFEST.json` (sha256-verified), fetched by
  `scripts/fetch-v2-assets.sh`.
- **Desktop app:** `desktop/src/assets/` (logo/emblem/avatar rasters,
  Orb v2, avatar-state GIFs) + `desktop/src-tauri/icons/` + the
  generated icon components in `desktop/src/components/icons/`.
- **Website / PWA:** `website/public/`.
- **Repo root (README, daemon dashboard):** `assets/logo.png`,
  `assets/avatar.png`.

Do not re-add files under `assets/brand/`; the daemon dashboard reads
the repo-root files above.
