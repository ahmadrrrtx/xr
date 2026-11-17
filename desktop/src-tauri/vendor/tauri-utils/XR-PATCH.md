# XR's minimal tauri-utils dependency-feature patch

## Upstream identity and integrity

This is the production source of **tauri-utils 2.10.0**, from the crates.io
archive recorded in `XR-PROVENANCE.json`. That archive was SHA-256 verified
against the checksum of the previously locked registry package:

```
4dd257082deff79550de3409ed146104aeaf86fe38649615b04a304144939677
```

Both upstream licenses are retained. The provenance file records the upstream
VCS identity and hashes of every included upstream file. `Cargo.toml.upstream`
is the untouched normalized manifest; `Cargo.toml.orig` is the upstream
workspace manifest for reference. The upstream crate's independent Cargo.lock
and Cargo's local cache marker are deliberately not copied: the shell's
committed Cargo.lock is the resolution authority.

## The entire patch

Only the normalized manifest's serde_with dependency changes:

```toml
[dependencies.serde_with]
version = "3"
default-features = false
features = ["macros"]
```

All upstream Rust and JavaScript source is byte-for-byte unchanged. In this
version, the only uses of serde_with are `skip_serializing_none` imports in
`src/config.rs` and `src/config_v1/mod.rs`. That attribute is supplied by the
macros feature; Tauri does not use serde_with's runtime adapters here. The
macro output and Tauri's configuration serialization are unchanged.

The upstream default std/alloc features weakly reference optional chrono.
Cargo consequently retains chrono in Cargo.lock even when its feature is
inactive (https://github.com/rust-lang/cargo/issues/10801). Chrono's
RUSTSEC-2026-0543 notice has no fixed release. Enabling only the macro removes
that unnecessary dependency through Cargo's normal resolver rather than
hand-editing the lock or adding an OSV exception.

The shell separately uses GIO's trash API on Linux, preserving recoverable
contents, escaped original paths, and freedesktop deletion timestamps. It
keeps trash-rs's existing Windows/macOS backends without their irrelevant
Linux chrono feature. Disabling chrono in the Linux freedesktop backend alone
would silently omit DeletionDate; that is not the repair used here.

## Regression and maintenance requirements

- `test/supply-chain/tauri-utils-provenance.test.ts` checks every included file
  against its upstream hash and limits the manifest diff to the two settings.
- `test/supply-chain/chrono-advisory.test.ts` rejects chrono anywhere in the
  shell lock and checks the selected platform dependencies and patch.
- Native `platform_trash` tests use process-isolated XDG homes and check real
  trash metadata/content, name collisions, symlinks, and failure safety.
- The existing locked shell checks, clippy, native tests and packaging lanes
  remain required; no workflow, security exception or performance limit is
  relaxed for this patch.

When updating Tauri, re-verify the new upstream archive and all serde_with
uses. Retire the local patch when upstream narrows the same dependency
features (or removes the dependency). Until then, keep the vendored version,
provenance, patch and parent lock reviewed together. A newer registry version
must not silently replace this copy: the lock/provenance regression tests
must remain green, and whole-repository OSV scanning must pass.
