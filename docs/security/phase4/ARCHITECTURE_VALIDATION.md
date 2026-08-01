# XR Phase 4 — Step 4: Architecture Validation (per task)

Validation against the Constitution (Art. IX, XIV, XXI, XXII, IV) and the Phase 4 scope. A plan that fails any check is redesigned — nothing below ships unless it passes.

## T1 — Restrictiveness lattice + sandbox backends
- **Risk tier:** tier2 (policy + isolation). **Enforcement point:** `TrustService.evaluate` + `decidePlacement`.
- **Design:** `lattice.ts` with a total order `firecracker > gvisor > container > bwrap(namespace) > unshare(namespace) > restricted-process > in-process`; per-capability declared tier and per-run escalated tier; **merge = max (most restrictive)**; a capability may request *higher* isolation than classified (escalate), never lower; the recorded envelope placement is the *effective* (enforced) placement, not a label.
- **Fail-closed:** if the decided placement's backend is unavailable at run time → `blocked` (existing `EnvironmentManager.executeInEnvironment` behavior preserved).
- **Backends:** Linux bwrap + seccomp blocklist (new), unshare fallback (existing), container docker/podman (existing), gVisor `runsc` container-runtime detection (new hook, fail-closed), Firecracker/Kata (documented gap, detection hook). macOS Seatbelt: detection stub + documented gap (no macOS runner in this environment → no validation → **no claim**). Windows: documented gap.
- **Constitution check:** passes Art. IX.2 (isolation follows risk), IX.5/6 (fail-closed), IV.4. No net-new feature: the lattice enforces the existing tier model.

## T3 — Mandatory isolation for untrusted plugins/MCP/shell/code/browser
- **Enforcement point:** canonical loop `toolCtx.runIsolated` (wired unconditionally from `Tokens.Trust` in `AgentService`); `McpManager`/`McpClient` spawn path; plugin worker bootstrap.
- **Design:** shell/code (arbitrary code) always classified tier2 by `shellTrustSpec` → enforced placement or **blocked** when `security.hardened` (default true); the legacy host-authority fallback becomes an explicit, logged, config-gated opt-out (compat path; never the default). MCP: `XR_MCP_ALLOW_UNISOLATED` honored only when hardened=false; default-deny verified for permission grants; high-risk stdio servers isolated or refused.
- **Escape tests** per backend assert the boundary holds (host secret invisible, no host writes, net=none), and that with the backend removed the action fails closed — on the audit host the unshare mechanism is exercised live (bwrap tests skip honestly when absent, per existing convention).
- **Constitution check:** Art. XIV.1 (untrusted code isolated, policy≠confinement), XIV.5 (failure isolated). No bypass of envelope: tools still flow through registry → loop → audit.

## T4 — Centralized egress + credential brokering
- **Enforcement point:** `security/egress-proxy.ts` wired into `web.ts` tools and plugin `net` capability; `CredentialBroker` mediation for plugin workers and trust-path children.
- **Design:** egress = policy arg-check (defense-in-depth, existing `checkAction`) **plus** connection-time enforcement (DNS resolve → private/metadata block → pin → redirect revalidation → byte/time caps). Credentials = broker refs; raw values only in the broker's in-memory map; plugin workers get names + proxied fetch; no raw value in workerData/logs/records/children env.
- **Migration/compat (Part 17):** `getSecret*` APIs unchanged; `hydrateSecrets` retained but trust paths stop relying on `process.env`; broker `register` is the new injection path. No schema change; reversible.
- **Constitution check:** Art. IX.5 (secrets scoped/revocable/never logged), IX.7 (canonical URL resolution — WHATWG + real DNS).

## T5 — Dashboard hardening
- **Enforcement point:** daemon server + router + dashboard bundle.
- **Design:** hash-based CSP (script bundle hashed at request time; no `unsafe-inline`); one-time bootstrap token → HttpOnly/Secure/SameSite=Strict session cookie; mutating requests require Origin/Referer match; per-route rate limits (429); route caps (body size, output bytes, timeout); all `innerHTML` sinks replaced with escaped builders.
- **Constitution check:** Art. X (authority legible, honest state), IX recommended practices (strict CSP). No net-new feature.

## T6 — Supply chain
- **Enforcement point:** CI/release workflows + scripts.
- **Design:** CycloneDX SBOM (locked deps, hashes) + SLSA provenance (slsa-github-generator L3) + cosign keyless sign-blob (GH OIDC) on every tagged release; verification via `cosign verify-blob` (Rekor-backed in CI; local test with ephemeral key here); CI scanning jobs (gitleaks secrets, dep vulns, license, container image) gate the release; `--ignore-scripts` installs; npm trusted publishing with provenance.
- **Honesty:** in this environment, the *pipeline* is implemented and the verify path is exercised with an ephemeral key; the public-Rekor keyless proof requires a GitHub Actions run with OIDC — explicitly documented as pending, never claimed as done.

## T7 — Independent pentest
- **Design:** scope + findings register + remediation workflow shipped; self-assessment tests (escape/SSRF/CSP/secret-absence) run as pre-audit evidence. **Independent** pentest requires an external party — documented as the remaining item with exact work required.

## T8 — node:vm posture
- **Design:** wording corrected in code headers and docs ("defense-in-depth"); grep test prevents regression. No behavior change to the VM realm itself.

## Cross-cutting rejections (as required)
- ❌ Any design that describes `node:vm` as a boundary — rejected (T8).
- ❌ Any design that brokers secrets *into* a sandbox — rejected (T4).
- ❌ Any silent downgrade from an unavailable backend — rejected (T1/T3 fail-closed).
- ❌ Any claim not testable on the host (Seatbelt/Firecracker enforcement, Rekor public log, independent pentest) — not claimed; documented as pending with rationale.
- ❌ No Phase 5 (routing quality) or Phase 6 (context integrity) work.
