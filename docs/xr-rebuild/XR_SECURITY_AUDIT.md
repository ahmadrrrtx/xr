# XR — Security Audit

> Evidence date 2026-09-17 · repo `main` 7ba2dc8 (v1.0.0). Tags: [OBSERVED] / [INFERRED] / [RESEARCH-BACKED] / [RECOMMENDED].
> Scope: permissions, approvals, policy, shell/file/network, secrets, MCP/plugins/skills supply chain, computer control, IPC/daemon, persistence/audit integrity, defaults, telemetry.

## 1. What XR already protects (verified)

### 1.1 Execution boundary
- **Risk-tiered placement, fail-closed.** `src/runtime/trust/policy.ts`: Tier-2 (high-risk) work is refused when no enforceable sandbox backend exists; hardened mode is default and refuses even explicitly configured tier-1 in-process fallback. Escalate-only lattice (`lattice.ts`) prevents per-run downgrade. [OBSERVED]
- **Backends:** in-process → restricted-process → namespace (bubblewrap/userns) → container → gVisor → Firecracker, with capability detection (`PlacementCapabilities`). [OBSERVED]
- **Approvals:** SQLite-persisted pending approvals (`src/control/approval-store.ts`), typed-confirm for headless, daemon `/approvals/{id}/decision`. [OBSERVED]

### 1.2 Network egress
- `src/security/egress-proxy.ts` guardedFetch: allowlist → DNS resolve-all → private/link-local/metadata block (RFC1918, 169.254.169.254, ::1, fe80::, fc00::, 100.64/10, IPv4-mapped) → **pin resolved address** (no TOCTOU/rebinding) → manual redirects revalidated (≤3) → byte cap + timeout. Fail-closed on any parse/resolve error. [OBSERVED]
- This defeats the classic SSRF/DNS-rebinding/metadata-exfil class at connection time, not argument time. Stronger than most agents in the market. [INFERRED vs RESEARCH-BACKED landscape]

### 1.3 Prompt-injection & tool-output hygiene
- `src/security/tool-output.ts` frames tool/fetched content; `src/research/content-guard.ts` + `url-guard.ts` sanitize researched content; `xr attacks` runs a prompt-injection defense benchmark in-repo. [OBSERVED]

### 1.4 Secrets
- OS keyring integration (linux-secret-service observed in doctor); `CredentialBroker` default OFF (Phase 8); secret-broker gating; `.gitleaksignore` + supply-chain workflow (license check + SBOM). [OBSERVED]

### 1.5 Audit integrity
- Ed25519-signed hash-chained audit log + anchor job; `xr audit verify --crypto`; export. [OBSERVED] Verified intact in audit run.

### 1.6 Daemon exposure
- Loopback-only default bind (0.0.0.0 only inside containers, with documented rationale); random bearer token; HttpOnly SameSite=Strict session cookie; CSP on auth page; 401 JSON otherwise. [OBSERVED]

### 1.7 Supply-chain posture (self)
- Single runtime dep (zod); optional playwright; SBOM + license gates; plugin signing (Phase 8); skill signing/verifier modules; MCP allowlist. [OBSERVED]

## 2. Findings

| ID | Finding | Surface | Evidence | Severity | Recommendation | Phase |
|---|---|---|---|---|---|---|
| SEC-01 | **MCP tool-description poisoning / rug-pull** is an ecosystem-class risk: hosts ingest unsanitized tool metadata; registries allow hijack/squatting; IDEs auto-executed project MCP configs (MCPoison CVE-2025-54136; TrustFall; Miasma worm; Amazon Q CVE-2026-12957/8). XR has MCP allowlist + isolation grants (Phase 8) but no description-diff/rug-pull detector. | MCP | [RESEARCH-BACKED] DSN'26 study of 67k servers (833 vulnerable, 18 suspicious descriptions); CSA research note 2026-07; OWASP MCP Top-10 #3 | HIGH | Add tool-metadata pinning: hash tool descriptions at approve-time; block silent change (re-approve on diff); scan descriptions for imperative instructions; show "what changed" in MCP UI | P2 |
| SEC-02 | **Skills/plugins supply chain**: 65 bundled skills are trusted-official; marketplace download engine + signing exist, but user-installed skills still inject prompts/tools into context. | skills/plugins | [OBSERVED] `src/skills/{signing,verifier,download-engine}.ts`; [RESEARCH-BACKED] MCP poisoning analogues | MED-HIGH | Permission badges + install-time static analysis (declared tools vs used tools), quarantine on manifest change, provenance UI in Skills library | P2 |
| SEC-03 | **Computer control blast radius**: computer_control is tier2 with approvals, but once granted, screen capture sees everything on-screen (secrets in windows). | control | [OBSERVED] `src/control/{computer-use,vision}.ts`; [RESEARCH-BACKED] Anthropic blocks banking/trading categories by default | MED | Category blocklist defaults (finance/crypto/banking/health), redaction hints, per-app grant scoping, visible "recording" indicator + stop affordance | P2 |
| SEC-04 | **Daemon token in stdout/URL**: `xr serve` prints token and `?token=` URLs; shell history/shoulder-surf risk; cookie mitigates session but first hop leaks. | daemon | [OBSERVED] run log | LOW-MED | Print token once to a permission-locked file + QR/paste flow for desktop pairing; never in URL query (use POST bootstrap, which exists for browsers) | P1 |
| SEC-05 | **Business routes residue**: `/api/v1/business/*` still served by core daemon post-satellite-extraction → larger trusted surface than documented product. | daemon | [OBSERVED] `business.routes.ts` vs ADR-0028 shims | LOW | Finish migration or feature-flag OFF by default | P2 |
| SEC-06 | **Win32 approval-pipe fragility**: child-process approval tests skipped on Windows (hang) → approval UX on Windows historically less proven. | control/tests | [OBSERVED] git log (win32 skips, watchdogs) | MED | Dedicated Windows approval transport (named pipes w/ timeouts) + CI parity before desktop GA on Windows | P2 |
| SEC-07 | **Frontend-as-boundary temptation**: dashboard renders approvals/security panels; any desktop UI must remain display+decision-forwarding only. | architecture | [INFERRED] | POLICY | Enforce: policy/approvals/audit live only in Core/daemon; UI shows backend-computed risk; CI boundary test (dependency-cruiser rule for desktop package) | P1 |
| SEC-08 | **Telemetry**: no outbound telemetry observed by default; internet "not probed by default" in doctor. Keep it that way; document. | privacy | [OBSERVED] | INFO | Preserve local-first; add privacy manifest doc | P3 |
| SEC-09 | **EU AI Act Art. 50 (transparency) binds 2026-08-02**: agents interacting with humans must disclose AI nature where not obvious. Relevant to Telegram bot + published artifacts. | channels | [RESEARCH-BACKED] zylos ambient-computing survey 2026-07 | LOW | Disclosure labels in channel outputs + docs | P3 |

## 3. Attack-surface narrative (evidence-based)

1. **Malicious repo → agent**: project MCP config auto-exec class (TrustFall/Miasma). XR mitigation posture: MCP allowlist + isolation grants + approvals; residual: repo-local config trust prompt. [RECOMMENDED] treat workspace-defined MCP/plugin/skill configs as untrusted input: require explicit per-server approve with content hash (addresses SEC-01).
2. **Fetched content → prompt injection**: egress proxy + content guards + framed tool output reduce exfil capability (no private-network reach, byte caps). Residual: model-level compliance; benchmarked via `xr attacks`. [OBSERVED]
3. **Rogue plugin/skill**: worker sandbox + signing help; rug-pull detection missing (SEC-02).
4. **Local adversary**: keyring + loopback + token; SQLite store is user-permissioned. Audit chain deters silent tampering. [OBSERVED]
5. **Runaway spend**: CostGovernor reservations + budgets + partition caps + over-budget callback. [OBSERVED]

## 4. What must never move to frontend-only security

- Risk classification, placement decisions, approval enforcement, egress enforcement, secret brokering, audit signing, budget enforcement. Desktop UI may render and forward decisions; the daemon must re-validate every request independently (it already does via route contracts). [RECOMMENDED + OBSERVED current behavior]

## 5. Security verdict

XR's security core is **ahead of the commercial field** in egress and placement rigor, and honest about limits (ADR-0027 hygiene ≠ boundary). The rebuild's security work is: (a) MCP/skill supply-chain pinning & diff-approval, (b) computer-control category guards + visible control UX, (c) pairing/token hygiene, (d) keeping the boundary in Core while the new UI makes trust *legible* to humans. [RECOMMENDED]
