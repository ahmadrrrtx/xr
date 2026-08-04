# Distribution channels — how they work (Phase 9 · T3)

`release.manifest.json → distribution` is the **single authority** for every
distribution channel: which ones exist, which OS each serves, its tier, and
the exact install/update/rollback commands shown to users. Nothing else in
the repo is allowed to invent a channel, and every user-facing surface is a
*render* of this section — stamped and drift-checked by `bun run
release:check` (Constitution Art. XXII).

## The pipeline

```
release.manifest.json ─distribution section─▶ scripts/distribution-model.ts
        │                                            │ validateDistribution (fail-closed:
        │                                            │  dup ids, unreachable tiers, unknown
        │                                            │  kinds, overclaimed stability labels)
        ▼                                            ▼
  scripts/release-manifest.ts (release:stamp / release:check)
        │
        ├──► packaging/homebrew/xr.rb        (Homebrew formula)
        ├──► packaging/scoop/xr.json         (Scoop manifest)
        ├──► packaging/winget/*.yaml         (WinGet: version/installer/singleton)
        ├──► packaging/rpm/xr.spec           (RPM spec; .deb control is in code)
        ├──► docs/release/SUPPORT_MATRIX.md  (platform truth, stamped)
        ├──► website/src/lib/distribution.ts (downloads page data, stamped)
        └──► README.md beta block, src/core/version.ts, installers (identity)
```

The stamped files carry a `__SHA256_<FILE>__` placeholder where a release
pins real digests. **A channel file with an unpinned placeholder fails
`release:check` only in release context** — locally the placeholders are the
valid checked-in state; at release time
`scripts/channel-render.ts --fill-hashes dist/release/hashes.json` refuses to
emit any file still containing a placeholder, so an unpinned channel is never
published.

## Channel kinds and who owns updates

| kind | updateOwner | meaning |
|---|---|---|
| `binary` | `xr` | XR self-updates atomically (`xr update`: download → SHA256SUMS verify → canary → swap; auto-rollback on failed canary) |
| `package-manager` / `registry` / `container` | `channel` | the PM owns update+rollback; `xr update` detects the channel and prints the exact PM commands instead of half-editing |

Detection: `src/update/channels.ts` reads `install.json` (written by installers
to both the package root and the data home), then path heuristics, then the
legacy pre-Phase-9 layout. Every channel entry carries `update` and
`rollback` strings — a channel with no honest rollback story cannot be added
to the manifest (it would fail `validateDistribution`).

## Tiers

- **Tier 1** — published on every release; failure fails the release.
- **Tier 2** — published on every release with a documented caveat
  (currently: WinGet's community review lag, RPM without a hosted repo).
  "Tier 2" is a caveat, never a silent skip: the `evidence` job in
  `release.yml` fails the workflow if any stage is not green.

## Adding or changing a channel (authoring guide)

1. **Research first.** File format, hash pinning, token model and review lag
   go into `docs/phase-9/03-RESEARCH-NOTES.md` (or its successor) with URLs.
2. **Edit `release.manifest.json → distribution.channels`.** Provide `id`,
   `kind`, `updateOwner`, `os`, `tier`, `summary`, `install`, `update`,
   `rollback`. The summary may not overclaim (fail-closed check).
3. **Add a renderer** in `scripts/distribution-model.ts` (or accept the
   generic ones) and register the stamped file as a
   `stampTarget { kind: "generated-channel" }`, so `release:stamp`
   regenerates it and `release:check` gates drift.
4. **Publish step** in `.github/workflows/release.yml` that fails loudly when
   its secret is missing, and consumes hashes **only** via
   `channel-render --fill-hashes`.
5. **Tests**: parsing/shape tests for the new channel file + a
   `channel-render` round-trip test proving placeholders are filled or the
   renderer refuses. Effect-asserting, per Art. XX.
6. **Docs**: `docs/release/INSTALLATION.md`, this file, and the known
   limitations (e.g. review lags) in the same PR. A channel without docs is
   a false card on the web surface (Art. X).

Rejections and deferrals (snap, flatpak, others) are recorded with rationale
in **ADR-0023** so "why not X?" has a permanent, citable answer.
