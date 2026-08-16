# XR — Phase 07 Security Research

**Scope:** external, authoritative research underpinning Phase 07 hardening. Every
technology below is assessed for *what it protects, enforcement layer, OS support,
minimum requirements, performance cost, deployment complexity, bypasses, portability,
and whether XR should adopt it now / research only / future.*

**Method note (honesty):** This document is grounded in (a) the five forensic
inputs provided, (b) the **actual XR source at HEAD `c8f3ed0`** (read during this
phase), and (c) fresh external research (kernel docs, OWASP MCP Top 10 2025,
OWASP LLM Top 10 2025, NCC/Craft/Cloudflare SSRF write-ups, Landlock/seccomp/gVisor
literature). Where a forensic claim conflicted with the code, the **code wins**
(see §"Reconciliation with forensic inputs").

---

## A. Kernel-level execution enforcement

### BPF LSM (eBPF as a Linux Security Module)
- **Protects:** enforces policy at LSM hooks (`file_open`, `execve`/`bprm_check`,
  `mmap`/`mmap_file`, `kernel_read_file`). Enables **content-addressable binary
  enforcement** — SHA-256 of the binary computed and cached in kernel space,
  checked on the same kernel file reference → **no TOCTOU gap**.
- **Layer:** KERNEL.
- **OS:** Linux only. Not available on macOS (Seatbelt) or Windows (WDAC/AppLocker).
- **Minimum reqs:** kernel **≥ 5.7** with `CONFIG_BPF_LSM=y`, `CONFIG_DEBUG_INFO_BTF=y`,
  and the `lsm=...,bpf` boot parameter (e.g. `lsm=lockdown,capability,yama,apparmor,bpf`).
  Requires privileged process to load the program; verification needs BTF-enabled kernel.
- **Perf cost:** low at runtime (hook runs per op; hash cached). Load-time cost only.
- **Bypasses (well documented):**
  - **Dynamic-linker / `mmap` bypass:** an LSM hook on `execve` alone is defeated by
    invoking `/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2 /usr/bin/wget` — the linker
    `mmap`s the denied binary's `.text` without an `execve`, so the hook never fires.
    **Coverage MUST include `mmap`/`mmap_file`**, not just `execve`.
  - A process already running as the user can re-`exec` or memory-load code; BPF LSM
    constrains *new* executions, not an already-running adversary with equal privilege.
- **Portability:** POOR off-Linux. Not suitable as a mandatory XR control for a
  cross-platform (Linux/Windows/macOS) local-first agent.
- **Decision:** **RESEARCH NOW / ADOPT FUTURE (Linux-only, optional, opt-in).** Do NOT
  make BPF LSM mandatory. When/if adopted, gate behind an explicit operator opt-in,
  require graceful degradation (XR reports "kernel enforcement: unavailable" rather
  than failing), and cover both `execve` and `mmap`.

### IMA / EVM (Integrity Measurement Architecture)
- Kernel-measured file hashes, extensible to exec enforcement. Similar Linux-only
  constraints and TOCTOU immunity for the *measurement* path. Heavier to operate
  (key management, policy). **Decision: RESEARCH / future, Linux-only.**

### Landlock (LSM, path-based)
- **Protects:** filesystem (5.13+) and TCP bind/connect (6.7+) access control,
  **without root, namespaces, or cgroups**. Rules are *allowlist* and **stack** (child
  = intersection of parent + own). TOCTOU-immune (kernel-enforced on every op).
- **Layer:** KERNEL (LSM) but applied at the **PROCESS** boundary (per-process restrict).
- **OS:** Linux ≥ 5.13 (fs), ≥ 6.7 (TCP). Not on macOS/Windows.
- **Perf:** native kernel speed, negligible.
- **Bypasses:** covers only paths/ports it is told; does not filter by *destination IP*
  (needs seccomp user-notification for IP allowlists). UDP/ICMP not covered by Landlock.
- **Decision:** **Strong candidate for the PROCESS-LEVEL sandbox backend** (XR already
  has `NamespaceSandboxBackend`/`RestrictedProcessBackend`; Landlock is a natural
  tightening). Adopt as an *optional, best-effort* hardening on capable Linux kernels;
  never mandatory.

### seccomp-bpf / seccomp user-notification
- Syscall filtering (deny) + supervisor for dynamic decisions (network IP checks,
  resource limits, `/proc` virtualization). Linux ≥ 5.6 for user-notif. **PROCESS layer,
  Linux-only.** Complements Landlock. **Decision: RESEARCH/ADOPT (optional Linux
  backend tightening).**

### AppArmor / SELinux
- Profile/label-based MAC. AppArmor path-based (easier), SELinux label-based
  (stronger, complex). Linux-only, usually distro-provided profiles. **Decision:**
  RESEARCH / optional (operator-managed profile), not XR-enforced by default.

### macOS Seatbelt (`sandbox-exec`) / sandbox
- Kernel-enforced SBPL profiles. **PROCESS/KERNEL layer, macOS only.** Codex-style
  agents use it. XR should research a macOS sandbox backend (XR already has a
  `runtime/trust/environment` backend system). **Decision: RESEARCH/ADOPT (macOS
  backend, optional).** Note the documented "allow-default gap": purpose-built
  allowlists must be explicit, not permissive-by-default.

### Windows WDAC / AppLocker / Restricted Tokens / Job Objects
- WDAC = kernel code-integrity/execution control (closest to content-hash exec at OS
  level). AppLocker = executable/path rules. Restricted Tokens + ACLs + Job Objects =
  process-level confinement. **PROCESS/KERNEL layer, Windows only.** **Decision:
  RESEARCH / future Windows backend.** Do not make mandatory.

---

## B. Container / microVM isolation (PROCESS/VM layer)

### Containers (namespace + cgroup), gVisor, Firecracker
- XR **already implements** `ContainerBackend`, `GVisorBackend`, `FirecrackerBackend`,
  `NamespaceSandboxBackend`, `RestrictedProcessBackend` in `src/runtime/trust/environment/`.
- **gVisor:** user-space kernel, partial syscall compat, higher syscall overhead.
- **Firecracker:** separate guest kernel, needs KVM + root, strong isolation.
- **Containers:** shared host kernel, needs root/daemon; overlay FS.
- **Decision:** keep as PROCESS-LEVEL backends; the key property already enforced is
  **fail-closed downgrade** (see `runtime/trust/policy.ts`): a weaker placement than
  the required tier is refused, never silently downgraded.

---

## C. SSRF defenses (research)
- **Threat:** attacker-supplied URL reaches internal/loopback/metadata endpoints.
- **Canonical defense (NCC/Craft/Cloudflare):** parse URL → resolve DNS **once** →
  validate **every** resolved A/AAAA address against the blocklist → **pin** the
  resolved IP → connect to the pinned IP (Host header = original) → **revalidate every
  redirect** hop. Block `file://`, `gopher://`, `dict://`, etc.
- **Bypasses that MUST be covered:**
  - **DNS rebinding / TOCTOU:** validator resolves → safe IP; fetcher re-resolves →
    metadata IP. Defeated only by **pinning** (no second resolution). Real:
    Craft CMS CVE-2026-27127, Ollama CVE-2024-28224.
  - **IPv4-mapped IPv6** `[::ffff:169.254.169.254]` — validator string-checks "169.254…"
    but client accepts mapped form (CVE-2026-35409 Directus). Must parse IPv6 and
    unwrap mapped addresses.
  - **Decimal/hex/octal/localhost aliases**, `0x7f.0.0.1`, `2130706433`, `*.nip.io`.
  - **CRLF/Host-header smuggling**, Linkerd `l5d-dtab`, Azure metadata CRLF.
- **Decision:** XR's `src/security/egress-proxy.ts` **already implements** resolve-all +
  refuse-any-blocked + pin + redirect revalidation (max 3) + byte caps + timeout. This
  is the correct architecture. Phase 07 adds **tests** (see SSRF_DEFENSE.md), not a
  rewrite. Metadata `169.254.169.254` and all private ranges are blocked in
  `src/security/private-ip.ts`.

---

## D. MCP / tool-description prompt injection (research)
- **OWASP MCP Top 10 (2025):** **MCP03 Tool Poisoning** (rug pulls, schema poisoning,
  tool shadowing) and **MCP06 Intent Flow Subversion** are top risks. Tool *descriptions*
  are placed into the agent context as if trusted instructions — a poisoning vector.
- **Real incidents:** Anthropic Git MCP CVE-2025-68143/44/45 (code exec/exfil via repo
  content); Cursor CVE-2025-54135 (README → RCE); OpenClaw/ClawHavoc (1,184 malicious
  skills, ~4,000 machines).
- **Mitigations (defense-in-depth):** signed/pinned tool definitions; **description
  scanning** with audit + model-facing warning; treat descriptions as DATA not
  instructions; **never let a description change permissions/allowlists/credentials**;
  immutable tool definitions; OAuth2 enforcement; per-server least privilege.
- **Decision:** XR already has the **signed default-deny MCP allowlist** (`mcp/allowlist.ts`,
  ed25519). Phase 07 **adds description scanning** at discovery (`scanMcpToolDescription`
  in `guard.ts`, wired in `mcp/manager.ts`) + the invariant that descriptions cannot
  alter authority (enforced by architecture: the `Tool` type has no authority fields;
  `wrapMcpTool` hard-codes `requiresApproval: true` and ignores description for policy).

---

## E. Supply-chain (skills / plugins / marketplace)
- XR **already implements** `skills/signing.ts` (ed25519 + SHA-256 envelope,
  `verifyPackageSignature` checks hash match **and** signature) and a plugin
  **sandbox-worker membrane** that blocks `shell`/`control`/`browser`/net raw authority
  (declared permission ≠ authority). Trust root = operator/publisher ed25519 keys.
- **Residual risk (documented):** verification happens at *load/install* time; a
  TOCTOU/artifact-substitution between verification and execution is possible if the
  artifact is later replaced on disk. Mitigation: re-verify on execution or keep
  verified artifacts immutable + content-addressed. Flagged in SUPPLY_CHAIN_SECURITY.md.

---

## F. Trust handoff (research)
- **Pattern (Pillar Security "Week of Sandbox Escapes"):** agent obeys every rule but
  writes a config/hook that a *trusted external component* later executes outside the
  sandbox. Examples: Cursor CVE-2026-48124 Stop hook (CVSS 8.5); GitPwned
  `git show --output=./.git/config` (CVSS 8.6); Antigravity macOS Seatbelt gap;
  VS Code task execution.
- **Mitigation:** treat workspace files as untrusted; **never auto-execute local config**
  without signature/approval; require explicit, informed human approval showing the
  trusted consumer + execution implication. **Decision: implemented** in
  `src/security/trust-handoff.ts` (Phase 07), wired into `writeFileTool`.

---

## G. Decision matrix (portability × XR adoption)

| Mechanism | OS | Protection | Portability | Complexity | XR now? |
|---|---|---|---|---|---|
| BPF LSM exec/mmap | Linux ≥5.7 | KERNEL exec identity | Poor (Linux-only) | High (kernel cfg) | Research / future opt-in |
| IMA/EVM | Linux | KERNEL integrity | Poor | High | Research / future |
| Landlock | Linux ≥5.13/6.7 | KERNEL/PROCESS fs+net | Linux-only | Med | Optional backend tightening |
| seccomp-bpf | Linux ≥5.6 | PROCESS syscalls | Linux-only | Med | Optional backend tightening |
| AppArmor/SELinux | Linux | KERNEL MAC | Linux-only | High | Operator profile (opt) |
| macOS Seatbelt | macOS | KERNEL/PROCESS | macOS-only | Med | Research / future macOS backend |
| Windows WDAC | Windows | KERNEL exec ctrl | Windows-only | High | Research / future |
| Containers/gVisor/Firecracker | Linux | PROCESS/VM | Linux (KVM for Firc) | High | Already present (backends) |
| Egress proxy (resolve-all+pin+reval) | All | APPLICATION net | Excellent | Low | **Present** |
| Signed MCP allowlist | All | APPLICATION | Excellent | Low | **Present** |
| Content-hash exec gate (app) | All | APPLICATION | Excellent | Low | **Added (Phase 07)** |
| Trust-handoff policy | All | APPLICATION | Excellent | Low | **Added (Phase 07)** |
| Tool-description scan | All | APPLICATION | Excellent | Low | **Added (Phase 07)** |
| Skills ed25519+SHA256 | All | APPLICATION | Excellent | Low | **Present** |

**Conclusion (valid deliverable):** Move boundaries *downward* only where justified and
portable. Today XR's realistic, cross-platform enforcement is **APPLICATION-LEVEL**
(allowlists, policy, approvals, SSRF guard, path validation, MCP signatures, plugin
verification, content hashes, audit chain) backed by **PROCESS-LEVEL** sandbox backends
where the OS supports them. **KERNEL-LEVEL** (BPF LSM) is explicitly **deferred** to a
future, Linux-only, opt-in phase. This is an honest, defensible position — not a
failure to implement.

---

## Reconciliation with forensic inputs
The provided forensic docs (01/05/09/10) describe a "1.0.0 Truth" snapshot. At HEAD
(post-Phase-06) the codebase is materially further along: SSRF private-IP/metadata/DNS-
rebinding/redirect defenses, tool-output framing, signed MCP allowlist, skills signing,
secret storage, and **fail-closed sandbox downgrade** already exist. Phase 07 therefore
*verified and strengthened* rather than *from-scratch built* most controls; the genuine
net-new gaps addressed this phase are: (1) trust-handoff write policy, (2) application-
level content-hash execution integrity, (3) MCP tool-description poisoning scan. See
PHASE_07_SECURITY_CONTROL_MATRIX.md.
