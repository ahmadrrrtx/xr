#!/usr/bin/env bash
# Stage locked inputs for the network-isolated Flatpak builder (T33.a).
# Downloads happen before flatpak-builder, from frozen Bun lockfiles and the
# Cargo lockfile; no credentials, .git directory, or node_modules are copied.
set -euo pipefail
stage="${1:?usage: prepare-flatpak-sources.sh /new/absolute/staging-directory}"
case "$stage" in /*) ;; *) echo "staging directory must be absolute" >&2; exit 2;; esac
if [ -e "$stage" ]; then echo "staging directory already exists: $stage" >&2; exit 2; fi
mkdir -p "$stage"
git archive HEAD | tar -x -C "$stage"
mkdir -p "$stage/.flatpak-cache/bun" "$stage/.flatpak-cache/cargo-vendor"
# A clean archive forces Bun to populate this cache rather than reusing a local
# node_modules tree. --ignore-scripts avoids running lifecycle scripts here.
(cd "$stage" && bun install --frozen-lockfile --ignore-scripts --cache-dir="$stage/.flatpak-cache/bun")
(cd "$stage/desktop" && bun install --frozen-lockfile --ignore-scripts --cache-dir="$stage/.flatpak-cache/bun")
rm -rf "$stage/node_modules" "$stage/desktop/node_modules"
# Cargo checks each crate against Cargo.lock before placing it in the vendor
# directory. This repo currently has no git-sourced Cargo dependencies; fail
# rather than silently create incomplete source replacement if that changes.
if grep -q '^source = "git+' "$stage/desktop/src-tauri/Cargo.lock"; then
  echo "git-sourced Cargo dependencies require explicit offline vendor configuration" >&2; exit 1
fi
(cd "$stage/desktop/src-tauri" && cargo vendor --locked --versioned-dirs "$stage/.flatpak-cache/cargo-vendor" > "$stage/.flatpak-cache/cargo-vendor-host-config.toml")
mkdir -p "$stage/desktop/src-tauri/.cargo"
cat > "$stage/desktop/src-tauri/.cargo/config.toml" <<'CONFIG'
[source.crates-io]
replace-with = "vendored-sources"
[source.vendored-sources]
directory = "/run/build/xr-desktop/.flatpak-cache/cargo-vendor"
[net]
offline = true
CONFIG
printf 'Staged locked, network-isolated Flatpak inputs at %s\n' "$stage"
