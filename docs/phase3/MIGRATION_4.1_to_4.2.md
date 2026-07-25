# XR 4.1 → XR 4.2 Migration Guide (Trust and Isolation)

## TL;DR

XR 4.2 adds **risk-tiered execution placement**. The change is **additive**:
existing execution records, APIs, workspace data, and Phase 0–2 behavior are
preserved. Actions that do **not** opt into the trust gate (`opts.trust`) behave
exactly as in 4.1. High-risk actions that **do** opt in are placed in an
enforceable environment or **blocked** — never silently run in-process.

## What's new

- `src/trust/` — risk classifier, policy-to-placement, authority grants,
  credential broker, resource policy, environment manager + backends
  (in-process, restricted-process, namespace sandbox, container), verification,
  and the orchestrating `TrustService`.
- `ExecutionRecord.trust?` — risk tier, placement decision, authority-grant id,
  credential scope (names only), resource policy, verification, cleanup.
- `ExecuteOptions.trust?` — opt an action into the trust gate.
- `Placement` gains `restricted_process`, `namespace_sandbox`, `container`,
  `browser_isolated` (existing kinds unchanged).
- `Tokens.Trust` + `TrustServiceProvider`; wired into `ExecutionService`.
- `ToolContext.runIsolated?`; the **shell tool** runs in the namespace sandbox in
  the full runtime (legacy in-process fallback when no Trust service is wired).
- `EXECUTION_ADAPTER_VERSION`: `xr-4.1.0` → `xr-4.2.0`.

## Behavior changes to expect

1. **Shell commands are isolated in the full runtime.** In a runtime with the
   Trust service wired and a Linux namespace backend available, `shell` runs
   inside the sandbox: no host environment, workspace-confined filesystem, no
   network, bounded time/output/CPU/memory. Commands that need the network or
   files outside the workspace will fail (by design). Provide those via
   workspace files / host-side egress instead.
2. **High-risk actions block when isolation is unavailable.** On hosts without a
   Tier-2 backend (e.g. macOS/Windows in 4.2, or Linux running as root), Tier-2
   actions return `denied` with `TRUST_BLOCKED` and remediation text. This is
   intentional fail-closed behavior, not a bug.
3. **Approvals are necessary but not sufficient.** A granted approval no longer
   implies host authority for high-risk work; placement is still enforced.
4. **High-risk MCP stdio servers are isolated.** A stdio MCP server that carries
   credentials (`apiKeyEnv` or sensitive `env` keys) runs inside the namespace
   sandbox (fs-confined, env-stripped, `net=none`) for its lifetime, and is
   **blocked** if no sandbox exists unless `XR_MCP_ALLOW_UNISOLATED=1` is set
   (warned). Low-risk stdio servers keep the existing confined spawn.
5. **Plugins are classified by effective (granted) permissions.** Declaring
   `shell`/`control`/`browser` does **not** grant that authority — the VM
   membrane blocks raw process/GUI/web regardless of declaration (declared ≠
   authority). `secrets` access is Tier 2 (host-mediated, audited); `net` is
   Tier 1 (egress-gated).

## Configuration

- No flag downgrades Tier-2. There is **no** "run high-risk in-process" switch.
- `PlacementPolicyConfig.allowTier1InProcessFallback` (default **false**): lets
  **Tier 1 only** run in-process with a logged, policy-only boundary when no
  process sandbox exists. Never affects Tier-2.
- `PlacementPolicyConfig.preferContainer`: prefer Docker/Podman over the
  namespace sandbox when both are available.
- `XR_TRUST_DOCKER_IMAGE`: container image for the container backend
  (default `debian:stable-slim`).
- **MCP isolation flags**:
  - high-risk (credential-bearing) **stdio** servers are isolated automatically
    when a namespace sandbox is available, and **blocked** when it is not;
  - `XR_MCP_ISOLATE_STDIO=1` — force-isolate even low-risk stdio servers;
  - `XR_MCP_ISOLATED_NET=1` — allow network inside the isolated server
    (weakens network confinement; default is `net=none`);
  - `XR_MCP_ALLOW_UNISOLATED=1` — explicitly acknowledge running a high-risk
    stdio server with the confined (non-kernel-isolated) spawn when no sandbox
    exists (warned; mirrors the browser unsafe-dev acknowledgment pattern).
- Backends are **detected, not auto-installed**. Install `bubblewrap` for the
  recommended local Tier-2 boundary.

## Data & record compatibility

- Existing XR 4.1 workspace data opens unchanged. The execution table stores
  `placement` as text; new placement kinds are additive.
- Old records simply have no `trust` field. History remains readable.
- No second security ledger is created; trust metadata rides on the existing
  execution record and the existing tamper-evident audit chain.

## Backup / rollback

- Back up the XR home / workspace store and execution/security records before
  upgrading.
- **Code rollback:** revert to the last verified 4.1 tag. Do not delete user data.
- **Placement rollback:** low-risk work may use the 4.1 in-process path;
  high-risk work must remain **blocked**, never silently fall back.
- **Config rollback:** prior risk/placement config is preserved; new isolation
  requirements are reversible for low-risk work but not in a way that enables an
  unsafe high-risk fallback.
- **Principle:** rollback may reduce capability availability; it must **not**
  silently reduce security posture.

## Known limitations (4.2)

- Tier-2 enforcement is **Linux** (bubblewrap/user-namespaces) or a container
  runtime; macOS/Windows fail closed for high-risk actions.
- Network inside the sandbox is **none**; a per-host allowlist is not enforceable
  inside the boundary (Tier-2 allowlist actions are blocked).
- MCP/browser/plugin high-risk **routing through the trust placement** and the
  CLI/daemon/dashboard **trust UX** are remaining work (see VALIDATION_REPORT).
- No claim against host-kernel 0-days.
