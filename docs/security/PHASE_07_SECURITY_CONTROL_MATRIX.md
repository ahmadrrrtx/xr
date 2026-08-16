# XR — Phase 07 Security Control Matrix

Maps each threat to the current control, the enforcement layer, the gap, the target
control/layer, test, telemetry, and **honest residual risk**. "Layer" uses the Phase 07
taxonomy: PROMPT / APPLICATION / PROCESS / KERNEL.

Legend for layer shorthand below: **P**=Prompt, **A**=Application, **Pr**=Process, **K**=Kernel.

| Threat | Attack Path | Current Control | Cur. Layer | Gap | Target Control | Tgt. Layer | Bypass Risk | Test | Telemetry | Residual Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| Prompt injection | Poisoned doc/web/MCP into context | `scanUntrusted` + tool-output framing `<<<XR_TOOL_DATA` | A (+P framing) | Detection is heuristic | Framing+scan+sandbox placement | A/Pr | High (heuristic) | tool-output-framing.test | audit flagged | Model can still follow; control is advisory at P level |
| MCP poisoning | Malicious tool description | `scanMcpToolDescription` (NEW) + signed allowlist | A | None pre-Phase07 | Scan+audit+warning; authority immutable | A | Low | mcp-description-poison.test | `mcp.tool_description_poisoned` | Warning is advisory; model may still obey |
| Malicious skill | Tampered skill package | `skills/signing.ts` ed25519+SHA256 | A | Re-verify on exec (TOCTOU) | Verify-at-exec or immutable store | A | Med | skills verifier | audit | Substitution between verify/exec |
| Malicious plugin | Rogue plugin code | `plugins/sandbox-worker` membrane | A/Pr | Membrane not kernel | VM membrane + declared≠authority | A/Pr | Med | plugin tests | audit | Membrane blocks raw authority; logic bugs possible |
| SSRF | URL → internal IP | `egress-proxy` resolve-all+pin+reval | A | None (present) | Same | A | Low | egress-proxy.test | `egress.blocked` | App-layer only; host net can still reach |
| Metadata access | `169.254.169.254` | `private-ip` blocks link-local | A | None (present) | Same | A | Low | egress-proxy.test | `egress.blocked` | Needs IMDSv2 at infra for full safety |
| DNS rebinding | Re-resolve after check | `egress-proxy` pins IP | A | None (present) | Same | A | Low | egress-proxy.test (injectable resolver) | `egress.blocked` | Relies on single resolution+pin |
| Redirect SSRF | 302 → private IP | `egress-proxy` revalidates each hop (max 3) | A | None (present) | Same | A | Low | egress-proxy.test | `egress.blocked` | Hop count capped; infinite-loop guard |
| Workspace config poisoning | Write malicious config | `trust-handoff` (NEW) | A | None pre-Phase07 | Classify+explicit approval | A | Med | trust-handoff.test | `write_file.trust_handoff` | Needs human to read implication |
| Git hook poisoning | Write `.git/hooks/*` | `trust-handoff` (NEW) | A | None pre-Phase07 | Classify+approval | A | Med | trust-handoff.test | `write_file.trust_handoff` | Human approval is the gate |
| Executable substitution | Swap `/usr/bin/wget` | `exec-integrity` (NEW, hash) | A | None pre-Phase07 | SHA-256 identity gate | A | Med | exec-integrity.test | `shell.exec_identity` | App-layer; kernel re-exec bypass |
| Dynamic linker bypass | `ld-linux /usr/bin/wget` | `exec-integrity` hashes argv[1] | A | None pre-Phase07 | Hash real target | A | Med | exec-integrity.test | `shell.exec_identity` | mmap-by-interpreter not enumerated |
| Interpreter bypass | `python -c`/`node -e` | `exec-integrity` hashes interpreter | A | None pre-Phase07 | Hash interpreter | A | Med | exec-integrity.test | `shell.exec_identity` | Script arg not fully enumerated |
| PATH hijacking | `PATH=/evil` then `wget` | `exec-integrity` resolves via PATH+hash | A | None pre-Phase07 | Hash resolved binary | A | Low | exec-integrity.test | `shell.exec_identity` | Only first-hop resolved |
| Symlink attacks | Symlink to approved bin | `exec-integrity` realpath→target hash | A | None pre-Phase07 | Content is identity | A | Low | exec-integrity.test | `shell.exec_identity` | Symlink to unapproved = unknown |
| Secret exfiltration | Tool/network leak | `security/secrets` + audit redaction | A | None (present) | Same | A | Low | secrets.test | redaction audit | Prompt/plugin logic bugs possible |
| Network bypass | SOCKS5 / direct socket | egress proxy allowlist+pin | A/Pr | None (present) | Same | A/Pr | Med | egress-proxy.test | `egress.blocked` | Process-level egress not kernel-enforced |
| Sandbox downgrade | Weaker backend chosen | `runtime/trust/policy.ts` fail-closed | Pr | None (present) | Refuse weaker tier | Pr | Low | trust tests | placement audit | Tier-1 degraded in-process if no sandbox |
| Audit tampering | Edit audit log | hash-chained append-only | A | None (present) | Same | A | Low | (existing) | chain verify | Needs operator key integrity |
| Supply-chain substitution | Swap artifact post-verify | skills signing + allowlist | A | Re-verify on exec | Verify-at-exec | A | Med | skills verifier | audit | TOCTOU between verify/exec |

---

## Enforcement-layer matrix (summary)

| Control | P | A | Pr | K | Final (XR) |
|---|---|---|---|---|---|
| System-prompt "data not instructions" | ● | | | | P (advisory) |
| Tool-output framing `<<<XR_TOOL_DATA` | ● | ● | | | A (framing) |
| MCP description scanning | | ● | | | A |
| Signed MCP allowlist (default-deny) | | ● | | | A |
| Egress proxy (resolve-all/pin/reval) | | ● | | | A |
| Private-IP / metadata block | | ● | | | A |
| Trust-handoff write policy | | ● | | | A |
| Content-hash execution integrity | | ● | | | A (enforce opt-in) |
| Skills ed25519 + SHA256 | | ● | | | A |
| Audit hash chain + redaction | | ● | | | A |
| Plugin VM membrane | | ● | ● | | A/Pr |
| 6 sandbox backends (ns/container/gvisor/firecracker/…) | | | ● | | Pr |
| Fail-closed sandbox downgrade | | | ● | | Pr |
| BPF LSM exec/mmap | | | | ○ | **K — DEFERRED (Linux opt-in future)** |

● = implemented & enforced · ○ = researched, not adopted

---

## Honest cross-cutting notes
- **Prompt-level controls are NOT security boundaries.** They are advisory. Every
  prompt-level control above is backed by an application- or process-level enforcement.
- **Application-level hashing is not kernel enforcement.** `exec-integrity` catches
  first-hop binary substitution; it cannot stop a process that already runs as you from
  re-exec'ing or memory-loading different code. The stronger boundary remains the
  sandbox backend.
- **SSRF is enforced at the application layer only.** XR does not (and should not, for
  cross-platform local-first use) kernel-block egress; the host network namespace can
  still reach internal addresses. Pair with OS-level egress filtering where required.
- **Human approval is the trust-handoff gate.** A model's own "approval" never counts.
