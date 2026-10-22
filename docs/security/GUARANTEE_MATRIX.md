# XR — Per-OS / Per-Action Isolation Guarantee Matrix

> **Generated from live host probes** — `bun run scripts/guarantee-matrix.ts`. 
> This document is a machine output, not prose; it regenerates on every run.
> It is a SNAPSHOT OF THE HOST THAT LAST RAN `--write`: rows are per-host by design
> (a host with Docker selects `container`; one without selects `namespace_sandbox` or
> fails closed). CI validates the generator and this document's structure, not cross-host
> row equality. Language follows the Constitution: "data scope" ≠ "security isolation";
> only OS-level boundaries are called boundaries.

**Host:** `linux/x64` · **root:** `false` · **hardened mode:** on (fail-closed)

## Isolation backends detected on this host

| Backend | Available |
|---|---|
| `in-process` | ✅ |
| `restricted-process` | ✅ |
| `namespace-sandbox` | ✅ |
| `container-docker` | ❌ (fail-closed if required) |
| `gvisor-runsc` | ❌ (fail-closed if required) |
| `firecracker` | ❌ (fail-closed if required) |

## Guarantees per action class (what IS enforced on this host)

| Action class | Risk tier | Placement | Kernel boundary | FS enforced | Network enforced | Process enforced | No ambient authority | Fail-closed |
|---|---|---|---|---|---|---|---|---|
| read / list in-workspace | tier0_in_process | `in_process` | ❌ | ❌ | ❌ | ❌ | ✅ | — |
| in-workspace write | tier1_restricted | `restricted_process` | ❌ | ❌ | ❌ | ❌ | ✅ | — |
| network fetch (allow-listed) | tier1_restricted | `restricted_process` | ❌ | ❌ | ❌ | ❌ | ✅ | — |
| git mutation | tier1_restricted | `restricted_process` | ❌ | ❌ | ❌ | ❌ | ✅ | — |
| shell / arbitrary code | tier2_isolated | `namespace_sandbox` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| plugin (untrusted) | tier2_isolated | `namespace_sandbox` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| MCP stdio server | tier2_isolated | `namespace_sandbox` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| browser | tier2_isolated | `namespace_sandbox` | ✅ | ✅ | ✅ | ✅ | ✅ | — |

## Honest limitations

- A placement without a kernel boundary (in-process / restricted-process) is **not** isolation; it is policy + defense-in-depth.
- `namespace_sandbox` may be bubblewrap **or** raw user namespaces. Since XR-LAUNCH-004 the raw-unshare fallback pivot_roots into a minimal root (system dirs + granted roots + private /tmp, read-only skeleton); every mount step is checked and a detect-time self-check must prove the confinement, otherwise Tier 2 is refused. The fallback does not apply the bwrap seccomp blocklist.
- gVisor/Firecracker are selected only when the runtime is actually present; otherwise the next-strongest tier-adequate backend is used or the action fails closed.
- macOS Seatbelt and Windows AppContainer mechanisms exist (XR-LAUNCH-003) but are **experimental, opt-in (`XR_OS_SANDBOX=experimental`) and not hardware-verified**; without the opt-in Tier 2 fails closed on those OSes. CI evidence: `os-sandbox.yml`. See KNOWN_LIMITATIONS.md.
- `node:vm` is defense-in-depth inside the plugin worker, never a security boundary (T8).
