#!/usr/bin/env bash
# XR — give a GitHub-hosted Ubuntu runner the HOST capability the governed
# security gate needs, and nothing more.
#
# `bun run security:check` refuses to be green on mocks: `linux-kernel-isolation`
# requires at least one REAL mechanism (bwrap or unshare) to pass its own
# confinement self-check (scripts/verify-security.ts). A stock ubuntu-24.04
# runner cannot do that:
#
#   * bubblewrap is not installed, and
#   * Ubuntu 24.04 ships kernel.apparmor_restrict_unprivileged_userns=1, which
#     lets an unprivileged process create a user namespace only if an AppArmor
#     profile grants it (Ubuntu does that for Chrome, podman, …; not bwrap).
#
# Repair order is least-privilege first, and every step is re-probed with the
# PRODUCT's own detect() — not with a hand-written bwrap command:
#
#   1. install bubblewrap (the mechanism the product prefers);
#   2. if it still cannot create namespaces, load a userns-granting AppArmor
#      profile scoped to /usr/bin/bwrap (Ubuntu's own pattern);
#   3. last resort, this throwaway VM only: apparmor_restrict_unprivileged_userns=0
#      and unprivileged_userns_clone=1, which also unblocks the `unshare`
#      fallback mechanism.
#
# Nothing here can make the gate green on its own: the confinement self-check,
# the effect tests and the dependency audit still run for real. If provisioning
# does not work the gate stays BLOCKED — the honest outcome — and this script
# has already printed why.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

# The product's own answer, not ours. Prints "unshare=<bool> bwrap=<bool>".
detect() {
  # shellcheck disable=SC2016 # the JS is deliberately single-quoted: no shell expansion inside it
  bun -e '
    const { NamespaceSandboxBackend, nativeSelfCheckDiagnostic } =
      await import("./src/runtime/trust/environment/namespace.ts");
    const u = await new NamespaceSandboxBackend({ only: "unshare" }).detect();
    const b = await new NamespaceSandboxBackend({ only: "bwrap" }).detect();
    console.log(`unshare=${u} bwrap=${b}${u || b ? "" : ` (${nativeSelfCheckDiagnostic()})`}`);
  ' 2>/dev/null
}
usable() { [ -n "${1:-}" ] && [[ "$1" != *"unshare=false bwrap=false"* ]]; }

probe() {
  local state
  state="$(detect || true)"
  echo "detect: ${state:-(probe failed)}"
  usable "$state"
}

echo "── before ───────────────────────────────────────────────"
if command -v bwrap >/dev/null 2>&1; then bwrap --version; else echo "bwrap: not installed"; fi

if probe; then
  exit 0
fi

# 1. bubblewrap — the product's primary mechanism.
if ! command -v bwrap >/dev/null 2>&1; then
  echo "── installing bubblewrap ────────────────────────────────"
  sudo apt-get update -qq || true
  sudo apt-get install -y -qq bubblewrap || true
  if probe; then exit 0; fi
fi

# 2. Scoped AppArmor grant: let /usr/bin/bwrap create user namespaces, exactly
#    as Ubuntu does for its own applications. Narrower than the sysctl below,
#    and the profile dies with the runner like everything else here.
echo "── loading the bwrap userns AppArmor profile ─────────────"
profile_src=""
for candidate in \
  /usr/share/apparmor/extra-profiles/bwrap-userns-restrict \
  /etc/apparmor.d/bwrap-userns-restrict; do
  if [ -f "$candidate" ]; then profile_src="$candidate"; break; fi
done
if [ -n "$profile_src" ]; then
  sudo install -m 0644 "$profile_src" /etc/apparmor.d/bwrap-userns-restrict || true
else
  # No packaged profile on this image: write the minimal one. `flags=(unconfined)`
  # keeps bwrap itself unconfined; the single rule grants user namespaces.
  sudo tee /etc/apparmor.d/bwrap-userns-restrict >/dev/null <<'PROFILE' || true
abi <abi/4.0>,
include <tunables/global>

profile bwrap-userns-restrict /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap-userns-restrict>
}
PROFILE
fi
sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict 2>/dev/null \
  || sudo systemctl reload apparmor 2>/dev/null || true
if probe; then exit 0; fi

# 3. Last resort, ephemeral VM only: remove Ubuntu's userns restriction. This
#    also lets the `unshare` fallback mechanism be tested for real.
echo "── relaxing unprivileged userns (throwaway runner) ──────"
if [ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 || true
fi
if [ -e /proc/sys/kernel/unprivileged_userns_clone ]; then
  sudo sysctl -w kernel.unprivileged_userns_clone=1 || true
fi
probe
echo "── done (informational — security:check owns the verdict) ─"
exit 0
