# XR 4.2 — Trust and Isolation: Architecture

Status: implemented core engine; see `VALIDATION_REPORT.md` for what is verified
and what remains. Relationship: builds on the XR 4.1 Unified Execution Fabric
and the Phase 1 runtime kernel; does **not** replace either.

## 1. The problem this phase solves

XR already had strong **application-level** governance: explicit agent
permissions, prompt-injection guards, egress allowlists, control risk
classification, approval gates, budget ceilings, a plugin VM/worker sandbox,
MCP permission behavior, tamper-evident audit, secrets backends, and workspace
scopes.

But an in-process permission check is **not** a hard security boundary. A
compromised plugin, tool, generated code path, browser process, or confused
deputy can attack the very process that owns the policy checks. A record that
says `allowed` is not sufficient if the process can still access everything.

> **Principle:** a policy decision must be bound to the authority of the
> environment that executes the action.

XR 4.2 makes trust decisions **enforceable by risk tier**: low-risk work stays
fast in-process; high-risk work runs inside an ephemeral, OS-enforced boundary
with no ambient host authority — and is **blocked** when that boundary is
unavailable. There is no silent high-risk fallback to the host process.

## 2. Risk tiers

The smallest useful model. Labels may evolve; the semantics must not.

| Tier | Name | Runs in | Examples | Hard boundary? |
|---|---|---|---|---|
| 0 | `tier0_in_process` | host process (fast path) | deterministic formatting, read-only metadata, pure transforms, non-sensitive retrieval | No (none needed) |
| 1 | `tier1_restricted` | confined child process | workspace-scoped file mutation, controlled tool ops, limited child-process work | **No** — process restriction only |
| 2 | `tier2_isolated` | ephemeral OS sandbox/container | arbitrary code/interpreter, shell with authority, hostile/untrusted content, credentials, irreversible external writes | **Yes** — kernel namespace/container |

Tier 1 is honestly labeled **process restriction**: ambient env is stripped,
cwd is path-confined, time/output are bounded, and the process group is killed
on timeout — but filesystem and network are constrained by **policy checks, not
the kernel**. A compromised Tier-1 child can still read any file the XR user can
read or open any socket. Tier 2 is required for a real boundary.

## 3. Deterministic risk classification

`src/trust/classify.ts` is a **pure, deterministic** function of objective,
adapter-supplied facts (`TrustRequest`): does it spawn a process, run arbitrary
code, touch the network, need credentials, write irreversibly, handle untrusted
content, or carry a control-plane `destructive`/`sensitive` classification.

- A model may **propose** an action but **cannot choose its tier** or downgrade
  placement. `TrustRequest` has **no** `requiredTier` field; the tier is derived
  solely from objective facts.
- Ambiguity **escalates**, never relaxes.
- Tier 2 triggers: `runsArbitraryCode`, `spawnsProcess`, `needsCredentials`,
  `irreversibleExternalWrite`, `untrustedContent`, `controlRisk === "destructive"`.
- Tier 1 triggers: filesystem mutation, network access, outside-workspace paths,
  `controlRisk === "sensitive"`, non-reversible effects.
- Dry-run performs no side effects and stays Tier 0.

The classifier also derives the required **filesystem / network / process
policies**, **resource limits**, **credential mode**, and **approval level**.

## 4. Policy-to-placement decision (fail closed)

`src/trust/policy.ts` maps `(classification, host capabilities)` to a placement:

```
Action Request
  → Risk Classification (deterministic)
  → Permission / Approval / Budget (existing fabric gates)
  → Placement Decision
  → Environment Admission
  → Verification (expected vs actual)
  → Execution
  → Cleanup / Quarantine
```

Decision rules:

- Tier 0 → `in_process_ok` (fast path, no environment).
- Tier 1 → `restricted_process` (or a stronger backend if available).
- Tier 2 → `namespace_sandbox` (preferred) or `container`; **never** in-process.
- If the required backend is unavailable → **`blocked`** with operator
  remediation. High-risk work is refused, not downgraded.
- Running as **root** voids the unprivileged sandbox guarantees → refused.
- An explicit, logged `allowTier1InProcessFallback` may let **Tier 1 only** run
  in-process with a policy-only boundary; it **never** affects Tier 2.

## 5. The environment contract & backends

`src/trust/environment/` defines `EnvironmentBackend` with **honest, declared
guarantees** (`PlacementGuarantees`) and **enforcement** facts. Backends are
ephemeral: created, used for one action, torn down before returning.

| Backend | Placement | Kernel boundary | FS enforced | Net enforced | No ambient authority | Notes |
|---|---|---|---|---|---|---|
| `InProcessBackend` | `in_process` | No | No | No | Yes (env stripped) | Uniform executor / explicit Tier-1 fallback only. **Not a boundary.** |
| `RestrictedProcessBackend` | `restricted_process` | No | No (path checks) | No | Yes | Tier 1. Process-group kill, time/output bounds. |
| `NamespaceSandboxBackend` | `namespace_sandbox` | **Yes** | **Yes** | **Yes (none)** | Yes | Tier 2. bubblewrap (primary) or raw `unshare` user+mount+pid+net namespaces (fallback). |
| `ContainerBackend` | `container` | **Yes** | **Yes** | **Yes (none)** | Yes | Tier 2. Docker/Podman when present; reports unavailable otherwise. |

### Namespace sandbox (the real Tier-2 boundary)

Runs the action inside Linux namespaces so the sandboxed process has **no
ambient host authority**:

- **user** namespace (unprivileged; mapped-root *inside only*),
- **mount** namespace with a **minimal rebuilt root** — host `/home`, SSH/AWS
  creds, `/etc/shadow`, etc. are simply **not present**; only granted workspace
  roots are bound read/write,
- **PID** namespace (sees only its own tree),
- **network** namespace with **no connectivity** (`net=none`),
- **IPC** namespace,
- ambient environment **stripped**; only explicit broker-approved env is set,
- `ulimit` cpu/memory/process limits applied inside,
- `--die-with-parent` + `--new-session` + wall-clock timeout + process-group kill.

Honest limits (also surfaced by `describe()`):

- Network is **none** inside the sandbox. A per-host **allowlist is not
  enforceable** here without userspace networking (slirp4netns); the
  verification layer **blocks** Tier-2 actions that require an allowlist.
- **Linux only.** Other platforms must use another backend or fail closed.
- It confines the process; it makes **no claim** against a host-kernel 0-day.

## 6. Authority grants (task-scoped, bounded, revocable)

`src/trust/authority.ts` issues an `AuthorityGrant` per action: actor,
execution/correlation id, workspace, capability, tier, fs/net/process policy,
resource limits, credential scope, issue/expiry, approval reference, policy
version. Grants are:

- **bound** to a specific execution and workspace (a grant for action A is
  invalid for action B; a grant for workspace X is invalid after switching to Y),
- **time-limited** (TTL; expired grants are invalid — stale authority is rejected),
- **revoked** at the end of every action (and on workspace switch),
- **not persisted** — durable authority is a Phase 4+ concern.

## 7. Credentials (reference-only, redacting)

`src/trust/credentials.ts` is a `CredentialBroker`:

- Raw secret values live **only** in an in-memory map; they are **never**
  returned by any method that feeds records or logs.
- Records see a `CredentialScope` — references + env-var **names**, never values.
- `prepareInjection()` yields raw values **transiently** to hand straight to the
  sandboxed process env (via `--setenv` / `-e`, i.e. as argv, never a shell string).
- `redact()` scrubs registered values **and** common secret shapes (AWS keys,
  GitHub/Slack tokens, JWTs, private keys, emails) from any text before logging.
- `assertClean()` throws if a registered secret appears in serialized output.
- Credentials are **revoked** on cleanup; expired refs are not injected.
- If a required credential cannot be safely provided, the action is **blocked**
  (credential mode `unavailable`), never silently exposed.

## 8. Verification & cleanup

`src/trust/verify.ts` proves, **before execution**, that the actual placement
matches the policy decision and that the backend's guarantees are strong enough
for the tier:

- placement matches the decision;
- Tier 2 requires `kernelBoundary`, `enforcedFilesystem`, `enforcedNetwork`,
  `noAmbientAuthority`;
- network policy is actually enforceable (a Tier-2 allowlist on a local backend
  **fails**);
- cwd is within granted roots; no granted path hits a blocked sensitive path;
- not running as root for unprivileged backends;
- required credentials resolve at the broker.

If verification fails, the action **does not run**.

`src/trust/environment/manager.ts` runs verification, injects credentials,
executes, and **always** revokes credentials and records a `CleanupResult`.
Boundary/uncertain states increment a quarantine counter; sustained failures can
quarantine a backend (refuse future use). Ephemeral backends tear down per-run,
so cleanup is "did the sandbox exit and were credentials revoked".

## 9. Execution-fabric integration

`src/execution/types.ts` adds (additively, type-only import from `src/trust`):

- new `Placement` kinds: `restricted_process`, `namespace_sandbox`, `container`,
  `browser_isolated` (the old `in_process`/`local`/`future` remain);
- `ExecutionRecord.trust?: TrustRecord` — risk tier + reasons, the placement
  decision, authority-grant id, credential scope (names only), resource policy,
  verification result, cleanup/quarantine result;
- `ExecuteOptions.trust?` — `{ request, executable?, credentialRefs? }` to opt an
  action into the trust gate;
- `EXECUTION_ADAPTER_VERSION` bumped `xr-4.1.0` → `xr-4.2.0`.

`src/execution/service.ts` runs the trust gate **after** policy/approval/budget
and **before** the action:

- **blocked** → `denied` outcome with `TRUST_BLOCKED` and remediation; `run()` is
  never called;
- **ran_in_environment** → dispatches the `executable` into the verified
  environment, normalizes the observation, records verification/cleanup;
- **in_process_ok** (Tier 0) → unchanged fast path.

When no `TrustService` is wired, or an action supplies no `opts.trust`, behavior
is **identical to XR 4.1** — the change is fully additive.

## 10. Kernel & tool integration

- `Tokens.Trust` registered via `TrustServiceProvider` (process-scoped; its
  `onInit` detects available backends; `onStop` revokes credentials). The
  `ExecutionServiceProvider` resolves it and passes it into `ExecutionService`.
- `TrustService.health()` exposes backend availability, active environments,
  cleanup failures, quarantine count, and active credential/grant counts — no
  secrets, no sensitive paths.
- `ToolContext.runIsolated?` lets a high-risk tool run a command inside a
  verified environment, failing closed when isolation is unavailable. The
  tool-adapter populates it when a Trust service is wired; otherwise the tool
  uses its legacy in-process path. The **shell tool** uses it: every shell
  command is treated as Tier-2 arbitrary code execution and runs in the
  namespace sandbox (or is blocked) in the full runtime.

### Adapter-level risk classification (recorded on every consequential action)

Each execution adapter declares objective risk facts (`trustRequest`) so the
fabric classifies and records a tier + placement decision:

- **Core tools** — `read_file`/`git_status`/`git_diff`/`git_log` → Tier 0;
  `write_file`/`git_commit`/`git_branch`/`git_stash`/`fetch_url`/`web_search`/
  `check_package` → Tier 1 (network tools carry an allowlist). Shell isolates
  itself via `runIsolated` (Tier 2).
- **Control / computer-use / browser** — mapped from the existing
  safe/sensitive/destructive classifier to Tier 0/1/2. Destructive actions drive
  the real host display/browser, so they are flagged `requiresHostAuthority`:
  admitted with an explicit elevated gate (full approval + audit + recorded),
  never treated as low-risk and never wrongly blocked. The browser's own
  hardened sandbox/root policy is preserved, not duplicated.
- **MCP** — tool calls → Tier 1, resource/prompt reads → Tier 0 (network
  transports add an allowlist). The MCP client confines the stdio child
  environment (allow-listed env, no shell metacharacters) **and**, in XR 4.2,
  runs **high-risk (credential-bearing) stdio servers inside the namespace
  sandbox for their whole lifetime** (stdio pipes pass through bwrap; verified).
  High-risk servers **fail closed** when no sandbox exists unless the operator
  explicitly acknowledges an unisolated spawn (`XR_MCP_ALLOW_UNISOLATED=1`,
  warned). Low-risk stdio servers keep the confined spawn (or isolation when
  forced via `XR_MCP_ISOLATE_STDIO=1`). HTTP/SSE servers are egress-gated
  network clients (Tier 1).
- **Plugins / skills** — classified by their **effective (granted)**
  permissions. Hard-boundary capabilities (`shell`/`control`/`browser`) are
  Tier 2 and **membrane-blocked**: declared permission is **not** authority — the
  VM denies raw process/GUI/web regardless of declaration (the "or blocked"
  outcome). `secrets` is Tier 2 (host-mediated, audited, redacted); `net` is
  Tier 1 (egress-gated by the host); confined fs/memory are Tier 0/1. The plugin
  VM/worker is honestly a process membrane, **not** a hard OS boundary; running
  plugin VM code itself inside a kernel namespace is a future hardening.

### User visibility (UX)

- **CLI**: `xr trust` (backend availability + health), `xr trust classify <cmd>`
  (risk tier + placement for an action), both with `--json`.
- **Daemon**: `GET /api/trust` (health, secret-free) and `POST /api/trust/classify`
  (tier + placement), bearer-token gated.
- **Dashboard**: a **Trust & Isolation** card in the System Health bento matrix
  shows whether a Tier-2 sandbox is ready (green) or only restricted/in-process
  is available (red), populated from `/api/trust`; the `/status` chat view
  reports the same backend list and the Tier-2 fail-closed posture.

## 11. Platform support & limitations

See `PLATFORM_SUPPORT.md`. Summary: Tier 2 is enforced on **Linux** via
bubblewrap/user-namespaces (verified) or a container runtime. macOS/Windows have
no supported local Tier-2 backend in this phase and **fail closed** for
high-risk actions rather than degrade. This is local isolation only — no remote
or multi-tenant placement.

## 12. Explicit Phase 4+ non-goals

Not implemented here: durable agent restart/replay/resume, event sourcing,
automatic model/provider routing, memory/context redesign, mailbox/team
messaging, visual workflow editor, new browser/voice/vision capabilities,
marketplace certification, remote/cloud execution, multi-tenant control plane,
enterprise compliance certification as a substitute for technical isolation.
The environment contract is **extensible** toward future worker/container/remote
backends, but only supported **local** placements ship in 4.2.
