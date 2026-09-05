# XR 4.2 — Platform Support & Isolation Feasibility

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


This matrix is grounded in what was **actually verified** in the reference
environment and what each backend honestly enforces. Unsupported isolation is
made **visible** and high-risk work **fails closed** — it is never silently
downgraded to in-process.

## Reference verification environment

- OS/arch: Linux x86_64 (Debian-family kernel 6.1), non-root (uid 1000)
- Runtime: Bun 1.3.14 (matches `packageManager`/`.bun-version`)
- `max_user_namespaces`: 7917 (unprivileged user namespaces enabled)
- bubblewrap: 0.11.0 installed (`/usr/bin/bwrap`) — **verified working**
- raw `unshare -Urmnp --fork --mount-proc`: **verified working**
- Docker/Podman: **not present** (container backend reports unavailable)

## Backend feasibility by platform

| Platform | Tier 0 (in-process) | Tier 1 (restricted process) | Tier 2 (namespace sandbox) | Tier 2 (container) | High-risk outcome if no Tier-2 backend |
|---|---|---|---|---|---|
| Linux (unprivileged, userns enabled) | ✅ | ✅ | ✅ **bubblewrap / unshare (verified)** | ✅ if Docker/Podman installed | enforced |
| Linux (running as root) | ✅ | ❌ refused | ❌ refused (sandbox guarantees void) | ⚠️ only with hardened runtime | **blocked** (run as unprivileged user) |
| Linux (userns disabled / hardened) | ✅ | ✅ | ❌ | ✅ if container runtime present | **blocked** unless container available |
| macOS | ✅ | ✅ (process restriction only) | ❌ no supported backend in 4.2 | ⚠️ experimental only | **blocked** (no silent fallback) |
| Windows | ✅ | ✅ (process restriction only) | ❌ no supported backend in 4.2 | ⚠️ experimental only | **blocked** (no silent fallback) |

Capability detection runs at kernel init (`EnvironmentManager.init()` →
`backend.detect()`). `TrustService.health()` reports which backends are usable so
operators can see exactly why a high-risk action is blocked.

## What each backend enforces (honest claims)

| Guarantee | in_process | restricted_process | namespace_sandbox | container |
|---|---|---|---|---|
| Kernel-level boundary | ✗ | ✗ | ✓ (namespaces) | ✓ |
| Filesystem confined **by the OS** | ✗ | ✗ (path checks only) | ✓ (minimal rebuilt root) | ✓ (ro rootfs + volumes) |
| Network confined **by the OS** | ✗ | ✗ | ✓ (net ns = none) | ✓ (`--network none`) |
| Process tree confined | ✗ | group-kill only | ✓ (PID ns) | ✓ (`--pids-limit`) |
| Ambient host env/creds NOT inherited | ✓ (stripped) | ✓ (stripped) | ✓ (stripped) | ✓ (stripped) |
| CPU/memory limits enforced | ✗ | best-effort | ✓ (`ulimit` inside) | ✓ (`--cpus/--memory`) |
| Output bounded | ✓ | ✓ | ✓ | ✓ |

## What these sandboxes do NOT protect against

Stated explicitly so "secure sandbox" is never an unqualified claim:

- **Not a guarantee against a host-kernel 0-day.** Namespaces/containers confine
  the process; they are not a defense against a kernel vulnerability.
- **Tier 1 is not a security boundary.** `restricted_process` strips env, bounds
  time/output, path-checks cwd, and kills the process group — but a compromised
  child can still read any file the XR user can read and open any socket.
- **No per-host network allowlist inside the boundary.** Local backends enforce
  `net=none` only; a Tier-2 action needing specific destinations is **blocked**
  (allowlist egress must be performed host-side via the existing egress governor,
  not from inside the sandbox).
- **macOS/Windows have no supported local Tier-2 backend in 4.2.** High-risk
  actions are blocked there rather than run unrestricted. (A future phase may add
  platform sandboxes such as Apple Seatbelt or Windows AppContainer.)
- **Workspace isolation ≠ a sandbox.** Confining an action to a workspace root by
  path checks does not create a kernel boundary; only Tier-2 backends do.
- **The plugin VM/worker is not equivalent to a container/VM boundary.** The
  existing plugin VM/worker sandbox (Phase 0.4) is a process/context membrane; it
  is not claimed as hardened OS isolation. High-risk plugin capabilities should
  route through a Tier-2 backend (wiring is part of the remaining work).
- **Secrets storage is only as strong as the platform backend.** The credential
  broker guarantees no raw secret enters records/logs/output and revokes on
  cleanup; at-rest encryption depends on the existing secrets backend and its
  file fallback (no stronger claim is made here).

## Resource controls

| Control | in_process | restricted | namespace | container |
|---|---|---|---|---|
| wall-clock timeout | ✓ | ✓ | ✓ | ✓ |
| CPU time | ✗ | best-effort | ✓ (`ulimit -t`) | ✓ |
| memory | ✗ | best-effort | ✓ (`ulimit -v`) | ✓ |
| process count | ✗ | group-kill | ✓ (`ulimit -u` + PID ns) | ✓ (`--pids-limit`) |
| output size | ✓ | ✓ | ✓ | ✓ |
| temp/disk | ✗ | ✗ | ✓ (tmpfs) | ✓ (`--tmpfs`) |

If a platform cannot enforce a limit that an action class **requires**, the
verification layer blocks that action class rather than claim a guarantee it
cannot keep.

## Installer / deployment behavior

The installer must **not** silently download or enable privileged infrastructure.
Bubblewrap/container runtimes are detected, not auto-installed. When no Tier-2
backend is present, `xr doctor`/health and the trust gate report the gap and
high-risk actions are blocked with remediation text.
