# XR — macOS / Windows Sandbox Limitation (review item #3)

**Status:** Formal limitation doc — closes the documentation gap for KNOWN_LIMITATIONS #1.

> **Update (launch audit XR-LAUNCH-003, decision D3):** experimental Tier-2 mechanisms now exist —
> macOS Seatbelt (`src/runtime/trust/environment/seatbelt.ts`) and Windows AppContainer + Job object
> (`src/runtime/trust/environment/appcontainer.ts`). They are **off unless `XR_OS_SANDBOX=experimental`**,
> must pass a self-check before they are offered, and have only CI evidence (`os-sandbox.yml`),
> no user-hardware runs. Without the opt-in, shell commands on macOS/Windows still need Docker/Podman
> and are otherwise refused (fail closed). Security review is required before they leave experimental.
> Known gap (Windows): where the OS denies AppContainers the NUL device (Windows Server images,
> including GitHub's windows-latest), Git for Windows cannot start inside the sandbox, because it opens NUL at
> startup. XR does not widen the device's ACL; such commands fail with git's "/dev/null" error.
**Owner:** Trust/Security Lead.
**References:** [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) #1, #2, #3,
[GUARANTEE_MATRIX.md](./GUARANTEE_MATRIX.md), [SECURITY.md](../../SECURITY.md) §scope,
[THREAT_MODEL.md](./THREAT_MODEL.md) §threats-not-mitigated.

## What this document is

KNOWN_LIMITATIONS #1 honestly records that XR's macOS (Seatbelt / Apple
Containers) and Windows (container / VM) isolation backends are **not
validated**. SECURITY.md states at the top: *"XR enforces in-process
policy, not kernel or VM confinement. It is a guard rail, not a sandbox
escape boundary."* This document is the formal expansion of that
honest scoping: what exactly is unvalidated, what XR does instead
(fail closed), what hosts are affected, and what an operator must do to
get a validated sandbox boundary today.

This is **not** a fix. The fix is kernel-level isolation work that
requires native macOS and Windows test hosts in CI (Phase 5+). Until
that work lands, this document is the evidence that XR does not
overclaim.

## The trust lattice (recap)

XR's trust lattice is a 6-tier escalation ladder, from least to most
isolated:

| Tier | Backend | Status on Linux | Status on macOS | Status on Windows |
|---|---|---|---|---|
| 0 | In-process (`node:vm` realm, defense-in-depth only) | Validated | Validated | Validated |
| 1 | Restricted-process (dropped privileges + seccomp) | Validated | **Unvalidated** | **Unvalidated** |
| 2 | OS sandbox: Linux namespaces (`bwrap`/`unshare` + pivot_root); macOS Seatbelt; Windows AppContainer | Validated (bwrap); unshare pivot_root + self-check (XR-LAUNCH-004) | **Experimental, opt-in** (`XR_OS_SANDBOX=experimental`), not hardware-verified | **Experimental, opt-in**, x64 only, not hardware-verified |
| 3 | Container (Docker/Podman + seccomp + capabilities) | Validated | **Unvalidated** | **Unvalidated** |
| 4 | gVisor (`runsc` userspace kernel) | Validated when `runsc` present + opt-in | N/A | N/A |
| 5 | Firecracker / Kata microVM | **Detection hook only** (orchestration is Phase 5+) | N/A | N/A |

**The load-bearing boundary is Tier 1+** — in-process (`node:vm`) is
explicitly documented as *not* a security boundary (SECURITY.md
threat table: "V8 engine escape from VM = High residual risk"). When
Tier 1+ is unavailable or unvalidated on a host, high-risk actions
fail closed — they do not silently fall back to Tier 0.

## What "unvalidated" means concretely

### macOS

| Component | State | Evidence |
|---|---|---|
| **Seatbelt (`sandbox-exec`)** | Detection hook exists; **not validated** as a trust-lattice backend. | `src/runtime/trust/` has a `seatbelt` detector that records "present" but no backend that wires high-risk actions through it. GUARANTEE_MATRIX reports `seatbelt: detected, not-validated`. |
| **Apple Containers (`containerization.framework`)** | Not implemented. macOS 26+ only; requires native Swift bridge. | No code in `src/runtime/trust/`. Listed as Phase 5+ work. |
| **Endpoint Security (ES) framework** | Not used. | Would require a signed system extension; out of scope for a user-space agent. |
| **Codesigning + Hardened Runtime** | Applied to the Tauri app bundle (notarization); does NOT extend to the Bun runtime that executes plugin code. | The Tauri shell is hardened; the agent loop runs in a Bun process spawned by the shell, which inherits only the parent's entitlements. |

**Net effect on macOS:** a plugin or tool that escapes `node:vm` (Tier 0)
runs with the full privileges of the Tauri app process. There is no
Seatbelt profile restricting its filesystem/network/syscall surface.
High-risk actions that request Tier 1+ placement **fail closed** (the
policy refuses to run them in Tier 0), which is the correct posture
but limits utility — see §"Operator guidance" below.

### Windows

| Component | State | Evidence |
|---|---|---|
| **Windows AppContainer** | Not implemented. | No code in `src/runtime/trust/`. |
| **Hyper-V dynamic containers** | Not implemented. Would require admin + virtualization support. | No code. Listed as Phase 5+ work. |
| **WDAC (Windows Defender Application Control)** | Not used. | Out of scope for a user-space agent. |
| **WDAG (Windows Defender Application Guard)** | Not used. | Out of scope. |
| **MSS (MitigationExperience)** | Applied to the Tauri process (DEP, ASLR, CFG); does NOT extend to the Bun runtime. | Same as macOS: the Tauri shell is hardened; the Bun agent-loop process inherits only the parent's mitigations. |

**Net effect on Windows:** same as macOS — a `node:vm` escape runs
with the Tauri app's privileges. High-risk actions requesting Tier 1+
**fail closed**.

### Linux (for comparison — the validated reference)

| Component | State | Evidence |
|---|---|---|
| **seccomp-bpf** | Validated. Restricted-process tier drops privileges and installs a seccomp filter. | `test/trust/canonical-shell-isolation.test.ts` |
| **bubblewrap (`bwrap`)** | Validated as the namespace tier (pivot_root + sensitive-path hiding). | `test/trust/lattice.test.ts` |
| **gVisor (`runsc`)** | Validated when `runsc` is present and the operator opts in. | GUARANTEE_MATRIX; detection + opt-in. |
| **Firecracker / Kata** | **Detection hook only** — no orchestration (rootfs, jailer, snapshot pool). | KNOWN_LIMITATIONS #2. High-risk actions requesting Tier 5 fail closed. |

Linux is the **only** host where the full Tier 1–4 ladder is validated
today. Operators running consequential automation should run XR on
Linux with `bwrap` installed (or `runsc` for gVisor) to get a real
kernel-enforced boundary.

## What XR does instead (fail-closed posture)

When a high-risk action (shell command, file write outside the
workspace, network egress to a non-allowlisted host) is requested on
a host where Tier 1+ is unavailable or unvalidated:

1. **The policy refuses the action.** The action is recorded in the
   audit log with `placement: denied` and the reason
   `"host has no validated Tier-1+ sandbox backend; high-risk actions
   require Linux with bwrap/runsc, or explicit opt-in"`.
2. **The agent loop surfaces the refusal to the user** via the
   approval queue (XR Shield). The user cannot override it from the
   UI — there is no "run anyway" button for this case.
3. **The only override** is the env var
   `XR_TRUST_ALLOW_UNVALIDATED_HOST=1`, which is loud at boot (mirrors
   `XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER` and `XR_SECRETS_ENV_COMPAT`
   warnings). It is intended ONLY for local-model workflows where the
   agent never executes consequential actions (e.g., chat-only,
   research-only, read-only tools). Documented as "you are accepting
   that a V8 escape = host compromise."

This is the same fail-closed philosophy that governs every other
unvalidated path in XR. It is not a workaround; it is the documented
posture.

## Operator guidance (what to do today)

### If you need consequential automation (shell, file writes, network)

**Run XR on Linux.** Specifically:

- A Linux host (bare metal or VM) with `bubblewrap` installed
  (`apt install bubblewrap` on Debian/Ubuntu; `dnf install bubblewrap`
  on Fedora). This gives you the validated Tier 2 namespace backend.
- For stronger isolation: install `runsc` (gVisor) and set
  `XR_TRUST_RUNSC=1`. This gives you Tier 4 (userspace kernel).
- Do NOT run XR on macOS or Windows for consequential automation
  today. The high-risk actions will fail closed (correct), and there
  is no path to make them work short of `XR_TRUST_ALLOW_UNVALIDATED_HOST=1`
  (which defeats the boundary).

### If you only need chat / research / read-only tools

**macOS and Windows are fine.** The fail-closed posture means:
- Chat with any provider (local or BYOK) — works everywhere.
- Research (web search + fetch) — works everywhere (egress proxy is
  in-process, not sandboxed).
- Read-only file tools (read, search) — works everywhere.
- Skills Store, Memory, Budget, Voice — work everywhere.

The boundary is only consequential actions (shell, write outside
workspace, non-allowlisted network). For those, use Linux.

### If you're a developer wanting to validate macOS/Windows backends

This is Phase 5+ work. The roadmap (not committed to a release):

1. **macOS Seatbelt backend** — write a `SeatbeltBackend` in
   `src/runtime/trust/` that generates a Seatbelt profile (allow-list
   of paths + syscall classes) and launches the worker via
   `sandbox-exec -p <profile>`. Validation requires macOS CI runners
   (currently none) + a test that confirms a worker cannot escape the
   profile (write outside allow-listed paths, fork bombs, etc.).
2. **Apple Containers backend** — macOS 26+ only; requires a Swift
   bridge via `containerization.framework`. Lower priority than
   Seatbelt (which works on older macOS).
3. **Windows AppContainer backend** — write an `AppContainerBackend`
   that launches the worker in an AppContainer with a capability
   allow-list. Validation requires Windows CI runners (currently
   none) + an escape test.
4. **CI matrix expansion** — add macOS and Windows runners to the
   `cross-platform.yml` workflow with the new backends enabled, and
   pin the GUARANTEE_MATRIX output to reflect the new validated
   surfaces.

Until that work lands, macOS and Windows remain honestly documented
as "local-models-only / no high-risk actions" per KNOWN_LIMITATIONS #1.

## Closure criteria (when this document gets retired)

KNOWN_LIMITATIONS #1 closes when ALL of the following are true:

1. A `SeatbeltBackend` exists in `src/runtime/trust/`, wired into the
   trust lattice, with an adversarial test that confirms a worker
   cannot escape the Seatbelt profile.
2. An `AppContainerBackend` exists for Windows with the same.
3. macOS and Windows CI runners exercise the new backends on every PR.
4. GUARANTEE_MATRIX reports `seatbelt: validated` and
   `appcontainer: validated`.
5. SECURITY.md §scope is updated to remove the "macOS/Windows not
   validated" caveat for Tier 1+.
6. This document is moved to `docs/historical/` with a closure note
   pointing to the PR that landed the backends.

Until then, this document is the canonical reference for "what XR
does and does not claim on macOS/Windows."

## Cross-references

- [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) #1 (macOS/Windows
  not validated), #2 (Firecracker/Kata detection-only), #3 (gVisor
  opt-in).
- [GUARANTEE_MATRIX.md](./GUARANTEE_MATRIX.md) — machine-generated
  per-host guarantee report; the source of truth for "what's
  validated on this host right now."
- [SECURITY.md](../../SECURITY.md) §scope — the top-of-file disclaimer
  that XR is in-process policy, not kernel/VM confinement.
- [THREAT_MODEL.md](./THREAT_MODEL.md) §threats-not-mitigated —
  "V8 engine escape from VM (High — plan: separate process/microVM)."
- [TRUST_HANDOFF.md](./TRUST_HANDOFF.md) — how the trust lattice
  hands off between tiers.
