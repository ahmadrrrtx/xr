# XR — SECURITY FINDINGS REGISTER (red team)

**Date:** 2026-08-13 · **Basis:** `main @ 82402df` · **Method:** source review of the security/trust plane + targeted live probes.
Severity: Critical / High / Medium / Low / Info. Fixes proposed; none applied yet (implementation phase).

---

## New findings from this audit

| ID | Severity | Impact | Attack surface | Root cause | Fix | Regression test |
|---|---|---|---|---|---|---|
| S-2026-01 | **RESOLVED (was High)** | Prompt-injection: untrusted tool output not delimited in a non-instruction channel on the default path | Agent loop assembling model context | `core/agent.ts`: `contextMode` resolved to `legacy` without a context package; prior audit found delimiting uncalled | **Already fixed on HEAD (2026-08-13):** `core/agent.ts:569` calls `frameToolOutput()` (→ `scanUntrusted`) on every tool result, pushes delimited content, audits flags (`security.untrusted_content`) | Pinned by `test/security/tool-output-framing.test.ts` (passing) |
| S-2026-02 | **Medium** | Provider API keys remain hydrated into `process.env` for the provider plane | Any child process spawned outside the MCP/plugin allow-list | Already registered as known-limitation **#4** (owned, reviewed) | Enterprise identity work (Phase 10 roadmap) — keep documented; do not claim otherwise | Existing redaction tests; no new test required |

> No **Critical** finding was produced. The prior finding set (A-3 framing, A-4 plaintext secrets, browser `--no-sandbox`, MCP env inheritance, missing chat timeouts) is **already fixed on HEAD** and pinned by tests.

## Verified controls (spot-confirmed on HEAD)

| Control | Location | Status |
|---|---|---|
| Secret redaction before persist + output | `workspace-store.redact()`, `observability/redaction.ts` | ✅ |
| AES-256-GCM file fallback (`XRG1`) with per-install key, chmod 600 | `security/secrets.ts` | ✅ |
| OS keychain backends (macOS Keychain / Linux secret-service / Windows DPAPI) | `security/secrets.ts` | ✅ (host-dependent) |
| Hash-chained tamper-evident audit + repair path | `state/workspace-store.ts`, `commands/audit.ts` | ✅ |
| Egress proxy: scheme/host canonicalization, private/link-local/metadata block, DNS-rebinding pin, manual redirects | `security/egress-proxy.ts`, `private-ip.ts`, `guard.ts` | ✅ |
| Plugin loader: manifest validation, hash tree, static scan (defense-in-depth), worker + VM realm, trust lattice | `plugins/loader/*`, `runtime/trust/*` | ✅ |
| MCP env allow-list (PATH/XR_/MCP_/PLUGIN_ + safe vars only) | `mcp/client.ts` | ✅ |
| Shell execution via isolated trust backends (bwrap/namespace; raw-unshare fallback; hardened fail-closed) | `runtime/trust/environment/*`, `tools/system.ts` | ✅ (weaker fallback disclosed, known-lim #7) |
| Browser sandbox on by default; `--no-sandbox` requires `XR_BROWSER_UNSAFE=1` | `control/browser.ts` | ✅ |
| Dashboard binds 127.0.0.1, bearer-token auth, 401 without token | `daemon/server.ts` | ✅ (live-verified) |
| Path-traversal + absolute-path rejection in files/control tools | `tools/files.ts`, `control/*` | ✅ |
| No fabricated certification claims (SOC2/ISO/HIPAA/PCI/FedRAMP) | `release.manifest.json` prohibitedClaims + `claim-lint` | ✅ |
| Gitleaks + OSV + license + SBOM + trivy in CI | `.github/workflows/supply-chain.yml` | ✅ (wiring) |

## Residual / documented limitations (not defects of this audit — already owned)

Canonical register: `docs/security/KNOWN_LIMITATIONS.md` (rows #1–#17). The three most release-relevant:
- **#4** — env-hydrated provider keys (S-2026-02 above).
- **#5** — no independent pentest yet; exit-gate "0 critical/high" holds for the automated self-assessment only.
- **#7** — raw-`unshare` fallback weaker than bubblewrap (matrix discloses it).

## Verdict

**PASS (1 Medium open, already disclosed).** No critical or high findings remain on HEAD — the one High candidate (S-2026-01, untrusted-content channel) was already fixed in the 2026-08-13 merge and is pinned by a passing test. The single open Medium (S-2026-02) is known-limitation #4 with an owner and review date. The security surface is unusually well-engineered and honest for a self-hosted agent runtime.
