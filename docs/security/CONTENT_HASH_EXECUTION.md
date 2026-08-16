# XR — Content-Hash Execution Integrity (Application-Level)

**Files:** `src/security/exec-integrity.ts` (NEW), wired into `src/tools/system.ts`
(`shellTool`).

## Principle
**CONTENT IS IDENTITY, NOT PATH.** `/usr/bin/wget` is trusted because of its *bytes*,
not its path. XR identifies an executed program by the SHA-256 of its content
(after symlink canonicalization) and compares it against an allowlist of known-good
hashes (`~/.xr/allowlist/exec-hashes.json`).

## What it does
For each shell command XR spawns via `bash -lc`, it:
1. Resolves the **interpreter** (`bash`) to an absolute, symlink-canonicalized path.
2. Best-effort extracts the **first direct executable token** from the command.
3. SHA-256s each file's content.
4. Decides per `XR_EXEC_INTEGRITY` mode (default **`audit`**):

| Mode | Behavior | Failure mode |
|---|---|---|
| `off` | no check | — |
| `audit` | record hashes + allow (no behavior change) | none (logging only) |
| `approval` | unknown hash → require human approval | human gate |
| `enforce` | unknown/unresolved hash → **deny** (fail closed) | blocked |

In `enforce` mode the hard **deny** is applied on the **host-authority (degraded)**
execution path (the only path that actually spawns on the host when `hardened` is off).
The isolated-runner path remains governed by its own environment.

## Bypass analysis (honest)
Covered:
- **Symlinks/hardlinks:** `realpathSync` → hash is the *target's* hash. A symlink to an
  approved binary shares the approved hash; a symlink to an unapproved one is "unknown".
- **Dynamic linker (`ld-linux … /usr/bin/wget`):** `resolveArgvIdentity` hashes `argv[1]`
  (the executed binary), not the linker — the classic mmap/execve bypass is handled at
  the argv level.
- **`/usr/bin/env prog`:** hashes the real program.
- **Interpreters (`python -c`, `node -e`, shebangs):** hashes the interpreter; a script
  file argument is best-effort hashed.
- **PATH substitution:** token resolved against `PATH` then hashed.

NOT covered (application-layer limits — see residual risk):
- A process already running as you can re-`exec` or `mmap` different code; the gate sees
  only what XR explicitly spawns.
- A shell command's **full transitive exec graph** is not enumerated (pipes, subshells,
  command substitution, PATH tricks). Only the interpreter + first direct token are
  hashed. Full coverage requires kernel tracing (BPF LSM covering `execve` **and**
  `mmap`).
- Corrupt/unreadable allowlist → treated as **empty** (fail-closed for `enforce`/
  `approval`: unknown hash is denied/escalated).

## Configuration
- `XR_EXEC_INTEGRITY=off|audit|approval|enforce` (default `audit`).
- Allowlist: `~/.xr/allowlist/exec-hashes.json` (`{ version, entries:[{hash,note}] }`),
  written atomically (temp+rename) with `0600`. Enroll via `recordExecHash(hash, note)`
  (intended for an operator CLI; not yet exposed as a user command in Phase 07).

## Tests
`test/security/exec-integrity.test.ts` — 14 cases: hashing, symlink canonicalization,
ld-linux/env/interpreter handling, decision per mode, allowlist match, corrupt-
allowlist fail-closed.

## Residual risk
Application-level only. Does **not** provide kernel enforcement. For kernel-grade
content-addressable enforcement, see SECURITY_RESEARCH_PHASE_07.md (BPF LSM — deferred
to a future Linux-only opt-in). Until then, the primary boundary for hostile code
remains the **sandbox backend** (`runtime/trust/environment/*`), which XR already fails
closed on downgrade.
