# XR — Security Model (Phase 4)

**Owner:** Trust/Security Lead · **Source of truth:** this file + the
machine-generated `GUARANTEE_MATRIX.md` (never prose claims). This document
describes what XR ENFORCES, per the Constitution (Art. IX): policy is not
confinement; only OS-level isolation confines.

## 1. Risk tiers and the restrictiveness lattice

| Tier | Placement (weakest → strongest) | What runs here |
|---|---|---|
| tier0 | `in_process` | reads, in-workspace writes, egress-gated network (fast path) |
| tier1 | `restricted_process` → `namespace_sandbox` → … | medium-risk actions with an explicit workspace root |
| tier2 | `namespace_sandbox` → `container` → `browser_isolated` → `gvisor` → `firecracker` | shell/code, untrusted plugins, MCP servers, hostile content |

- **Escalate-only:** the effective tier is `max(classified, capability-declared
  minimum, per-run escalated)`. A run can only go UP (ADR-0009).
- **Selection is adequacy-based** (cheapest adequate backend — Art. XII);
  the lattice governs merges, minimums, and refusals.
- **Backends are detected live** (`EnvironmentManager`); an unavailable
  required backend ⇒ **fail closed** — the action is blocked, never
  downgraded. Hardened mode (default) extends fail-closed to tier1.

## 2. Untrusted code (plugins / MCP / shell / browser)

- **Shell/code:** the canonical loop wires the Trust service into every tool
  context; the `shell` tool executes in a verified environment or returns
  `blocked`. With hardened mode on and no backend, it does NOT fall back to
  host `bash` (proven by `test/trust/canonical-shell-isolation.test.ts`).
- **Plugins:** run in a Worker with a restricted import surface and an
  in-process `node:vm` realm — **defense-in-depth only** (Phase 4 · T8; the
  VM shares the host process). OS isolation is the boundary; the worker
  capability host is the only API.
- **MCP:** default-deny permissions; high-risk (credential-bearing) stdio
  servers run inside a namespace sandbox or are refused; the former
  `XR_MCP_ALLOW_UNISOLATED` env flag was DELETED in Phase 8 and replaced by a
  signed per-server isolation grant in the allowlist (`XR_MCP_ALLOW_UNISOLATED`
  is dead in hardened mode.
- **Browser:** sandboxed launch flags enforced; root-without-sandbox refused.

## 3. Credentials (brokered, never in sandboxes)

- Raw values live only in the `CredentialBroker` (in-memory, TTL, revocable).
- Plugin workers bootstrap with names only; `secrets.get` is proxied.
- Trust-path children get explicit env; logs/records are redacted.
- Known split: provider keys are still hydrated into `process.env` for the
  provider plane (documented limitation; eliminated with Phase 10 identity).

## 4. Egress (centralized, connection-time)

All outbound HTTP from XR flows through `security/egress-proxy.ts`:
WHATWG parse → allowlist → DNS resolve → block ANY private/link-local/metadata
address (RFC1918, 127/8, 169.254.0.0/16 incl. 169.254.169.254, ::1, fe80::/10,
fc00::/7, 100.64/10, IPv4-mapped) → connection pinning → manual redirect
revalidation (max 3) → byte/time caps. The old arg-level check remains as a
first gate; the proxy is the boundary.

## 5. Dashboard (daemon)

- One-time `?token=` bootstrap → HttpOnly/SameSite=Strict session cookie;
  the URL is redirected token-free and the HTML never embeds the token.
- Strict CSP: `script-src 'self'` (external assets), no unsafe-inline; all
  interactivity via the allowlisted `data-xr-action` dispatcher (no eval).
- CSRF/Origin: cookie-authenticated mutating requests must match the daemon
  origin; per-IP rate limits (429); body caps (413).

## 6. Supply chain

CycloneDX SBOM (locked deps) + SLSA L3 provenance + cosign keyless signatures
(Rekor) on tagged releases; gitleaks/osv/license/trivy scanning gates; npm
trusted publishing; `--ignore-scripts` everywhere. See ADR-0011 and
`docs/release/VERIFYING_RELEASES.md`.

## 7. Claims discipline

- "Isolated" is claimed only per-OS with a passing escape test on that OS.
- "Signed" is claimed only with cosign/Rekor verification evidence.
- The guarantee matrix is regenerated from live probes and CI-drifted.
- SOC2/ISO/HIPAA/enterprise compliance is Phase 10 and requires an auditor.
