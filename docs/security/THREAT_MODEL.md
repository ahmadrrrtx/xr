# XR 4.2 — Threat Model & Abuse Cases

## Assets

- Host filesystem (especially `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.netrc`,
  `~/.git-credentials`, `/etc/shadow`),
- credentials/secrets (provider keys, plugin/MCP tokens),
- the XR policy/audit process itself (the "confused deputy" target),
- network (egress, private/localhost services),
- audit integrity.

## Trust boundaries

1. **Model output is untrusted.** A model may propose an action but cannot set
   its risk tier or placement (`TrustRequest` carries objective facts only).
2. **Tool/plugin/MCP output is untrusted.** Malicious output cannot downgrade a
   classification or approval.
3. **The host process is the policy authority.** High-risk work is moved *out*
   of the host process into an environment that has no ambient host authority.
4. **The sandbox interior is zero-trust.** Credentials are injected as needed and
   revoked; output is redacted; the boundary is verified before each action.

## Threats and the control that addresses each

| Threat | Control |
|---|---|
| Prompt injection escalating authority | Tier derived from objective facts; model cannot set tier; high-risk requires an enforceable environment |
| Confused deputy via tool/plugin/MCP | High-risk classes run in a sandbox with no ambient authority; approval bound to exact action |
| Path traversal / symlink escape | cwd must be within granted roots (realpath-checked); sensitive paths blocked; Tier-2 FS enforced by the OS, not path checks |
| Access outside workspace root | `touchesOutsideWorkspace` escalates tier; granted roots only; host home absent in sandbox |
| Secret path / env leakage | ambient env stripped; sensitive paths blocked; broker holds raw values in-memory only |
| Credential exfiltration via stdout/stderr/network | network = none in sandbox; `redact()` scrubs secrets from output; `assertClean()` guards persistence |
| Unauthorized network destination | net namespace (none); Tier-2 allowlist not enforceable → blocked |
| localhost / private-network access | `blockPrivateNetworks`; net ns removes the route entirely |
| Process spawning / privilege escalation | PID namespace; `ulimit -u`; not run as root |
| Child process surviving cleanup | `--die-with-parent`, `--new-session`, process-group SIGKILL on timeout |
| Sandbox escape attempts | kernel namespaces (verified); adversarial tests exercise fs/net/env confinement |
| Browser profile/cookie leakage | (browser trust-tier wiring is remaining work; existing browser sandbox defaults preserved) |
| Plugin VM/worker membrane escape | existing Phase 0.4 VM hardening tests; **Phase 8**: plugins declaring shell/process/network are forced to Tier-2 (`pluginRiskTier`) and cannot self-declare out of approval |
| MCP server inherited-env abuse | `createAllowedEnv` allow-lists stdio env; **Phase 8**: provider keys are no longer hydrated into `process.env` at all, so there is nothing to inherit |
| Malicious tool output causing policy downgrade | classification is deterministic and independent of output |
| Approval replay / approval for a different action | grant bound to execution id + capability; approval reference recorded on the grant |
| Stale authority after cancel/workspace switch | grants expire (TTL) and are revoked; workspace-bound validation; `revokeWorkspace` |
| Cleanup failure followed by unsafe reuse | backends are ephemeral per-run; cleanup failure increments quarantine; backend can be quarantined |
| Disabling isolation flags in production | no flag downgrades Tier-2; `allowTier1InProcessFallback` is Tier-1 only, explicit, and logged |
| Root / no-sandbox misuse | running as root voids restricted/isolated placement → refused |
| Malicious capability declaration vs effective authority | declaration is input only; authority is the grant + verified environment, not the declaration |
| **Argument mutation between policy and execution (TOCTOU)** | **Phase 8 · F-22**: `evaluatePolicy` mints an args-hash-bound, single-use grant; every side-effecting boundary re-derives the hash via `requireGrant` before acting. Mutating, replaying or retargeting a grant is refused (`test/security/phase8-adversarial.test.ts`) |
| **Provider credential exfiltration via the environment** | **Phase 8 · F-24**: hydration is OFF by default — XR never writes provider keys into `process.env`. Keys resolve through the broker per request; an architecture test forbids `process.env[PROVIDER_KEY]` reads outside the three-file secret plane |
| **Unsigned / supply-chain plugin code** | **Phase 8**: `plugins.requireSigned` defaults true; unsigned plugins are quarantined, trust records are ed25519-signed and bound to a tree hash, and tampering fails the whole store closed |
| **Unattributable MCP isolation escape** | **Phase 8**: `XR_MCP_ALLOW_UNISOLATED` is deleted. Running a high-risk server unisolated now requires a per-server grant inside the signed allowlist (`granted-unisolated-by:<key>`), still refused under hardened mode |
| **Silent Tier-2 approval on a headless surface** | **Phase 8**: a headless Tier-2 approval requires a typed confirmation phrase bound to the approval id + tool + args hash; only its hash is stored, and failures are audited as `approval.typed_confirm` |

## Fail-closed rules (high-risk is blocked when…)

- the required backend is unavailable;
- placement cannot be verified (expected ≠ actual, or guarantees too weak);
- credential scope cannot be enforced (required ref missing / `unavailable`);
- network/filesystem policy cannot be enforced (e.g. Tier-2 allowlist locally);
- environment health is unknown;
- cleanup from a prior high-risk op is unresolved (quarantine);
- approval does not match the exact action/authority;
- the policy decision has expired or been revoked;
- running as root (unprivileged sandboxes void).

## Adversarial tests implemented (passing)

`test/trust/namespace.test.ts` (real kernel boundary):
- filesystem confined: workspace writable + persists; **host secret absent**;
- network blocked: **no routes**, DNS resolution fails;
- **ambient host env not inherited**; sandbox PATH rebuilt;
- output bounded → truncation raises a boundary event;
- credentials injected into the sandbox then **revoked** on cleanup;
- Tier-2 network **allowlist refused** (not enforceable inside).

`test/trust/execution-integration.test.ts`:
- no `opts.trust` → XR 4.1 behavior unchanged;
- Tier-0 stays on the fast in-process path;
- Tier-2 shell runs **inside the namespace sandbox**, verified, host secret
  never in the record, workspace write persists, cleanup succeeded;
- high-risk with no executable → **blocked**, `run()` never called;
- credentials scoped, **redacted from the record**, revoked;
- high-risk **blocked when no Tier-2 backend** (remediation: install bubblewrap).

`test/trust/{classify,policy,authority,credentials,verify}.test.ts`:
deterministic classification, fail-closed placement, stale/revoked/expired
authority, reference-only credentials + redaction, and verification checks.

## Security-claim dictionary (use precisely)

- **policy check** — application-level allow/deny (necessary, not sufficient);
- **approval gate** — human consent bound to an action (necessary, not sufficient);
- **process restriction** — env strip + bounds + group-kill (Tier 1, **not** a boundary);
- **worker/VM context** — plugin membrane (process-level, **not** OS isolation);
- **container isolation** — kernel boundary via container runtime (Tier 2);
- **namespace isolation** — kernel boundary via user/mount/pid/net namespaces (Tier 2);
- **host kernel isolation** — out of scope; no claim against kernel 0-days;
- **tamper-evident audit** — existing hash-chained audit log (integrity, not secrecy).
