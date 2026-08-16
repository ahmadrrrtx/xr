# XR — Skill / Plugin Supply-Chain Security

**Files:** `src/skills/signing.ts`, `src/skills/verifier.ts`, `src/skills/manifest.ts`,
`src/plugins/manager.ts`, `src/plugins/sandbox-worker.ts`, `src/mcp/allowlist.ts`.

## Lifecycle considered
discover → download → verify → install → resolve → load → execute → update → remove.

## What XR already enforces (verified at HEAD)
- **Skills signing:** `signing.ts` produces an ed25519 + SHA-256 envelope
  (`PackageSignatureEnvelope`). `verifyPackageSignature` checks **both** that the on-disk
  file's SHA-256 equals the envelope's `packageSha256` **and** that the signature verifies
  against the publisher public key. The cryptographic trust root is the **operator/
  publisher ed25519 key**, not a metadata flag like `"official": true`.
- **MCP allowlist:** `mcp/allowlist.ts` is a **signed (ed25519) default-deny** artifact;
  an unsigned allowlist is treated as empty; a server not on the validly-signed list is
  refused at load (fail-closed). Revocation kills live clients.
- **Plugin membrane:** `plugins/sandbox-worker.ts` is a process-level membrane that
  **blocks raw `shell`/`control`/`browser`/net authority** even if a plugin *declares*
  them. `PLUGIN_HARD_BOUNDARY_PERMS` + `assessPluginRisk` make explicit that **declared
  permission ≠ authority** (membrane-blocked). `effectiveTier` is derived from *granted*,
  not declared, permissions.
- **Verification levels:** skills carry official/verified/untrusted classification; the
  signed envelope (not a boolean flag) is the trust anchor.

## Net-new / strengthened in Phase 07
- **MCP tool-description poisoning scan** (see MCP_TOOL_DESCRIPTION_SECURITY.md) closes the
  "rug pull after approval" vector at the metadata layer.
- **Trust-handoff policy** prevents the agent from writing a malicious `package.json`/
  `Makefile`/CI file that a builder later executes (see TRUST_HANDOFF.md).

## Residual risk (documented, not hidden)
1. **TOCTOU between verify and execute.** Signing/verification happens at *download/
   install* time. If the artifact on disk is replaced (or a symlink swapped) before
   execution, the executed bytes may differ from the verified ones. *Mitigation (future):*
   re-verify content hash at execution, or store verified artifacts immutably /
   content-addressed so execution reads the same bytes that were verified.
2. **Plugin membrane is a process boundary, not a kernel boundary.** Logic bugs in the
   worker could theoretically escape; declared hard-boundary perms are blocked, but the
   membrane is not a seccomp/Landlock sandbox. Pair with the PROCESS-LEVEL sandbox
   backends where available.
3. **Marketplace/registry trust** depends on the operator's configured keys and the
   registry's transport security (TLS). A compromised publisher key undermines the chain
   — key rotation + quorum is operational guidance, not yet enforced in-code.
4. **Update path.** `update` re-runs discovery/verification; ensure updates re-verify the
   signature against the *current* trusted keys (not the previously-bundled ones).

## Tests
Existing: `test/security/mcp-allowlist.test.ts`, `test/security/secrets.test.ts`, plugin
and skills unit tests. Phase 07 added: `mcp-description-poison.test.ts`. A dedicated
skills-signing TOCTOU re-verify test is recommended as future work (flagged above).

## What XR does NOT guarantee
- That a *legitimately signed* package is *benign*. Signing proves authorship/integrity,
  not safety. XR's non-regressive skill verifier (`verifier.ts`) gates *learning*, not
  malicious-but-signed content.
- Kernel-enforced supply-chain (e.g., SLSA provenance enforced at the OS) — that is
  distribution/release scope, not Phase 07 runtime scope.
