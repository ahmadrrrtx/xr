# XR Phase 7 — Gap Analysis (STEP 2)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Maps audited reality → Phase 7 spec (Part 8 tasks) + Constitution (Art. XIV/XV/XVI/XXIV, Part Ten). Each gap is tagged with the test that proves it closed.

## G1 (T1) — Provenance graph (Part 5: "queryable provenance graph"; §10.7)
- **Gap:** no provenance graph; outcomes not recorded; "what did the agent use?" unanswerable.
- **Design:** `src/platform/capabilities/provenance.ts` — append-only provenance graph (nodes = capabilities, edges = depends-on / used-by / updated-from / replaced-by / originated-from; events = install/update/rollback/use/outcome/quarantine). Recording wired at: capability-service mutations, plugin install/rollback, skill install/rollback, envelope tool-use (action→outcome). Query API: `provenanceOf(id)`, `whatWasUsed({window|run})`, `graph()`.
- **Test:** `test/capabilities/provenance-graph.test.ts` — after install+use+rollback, `provenanceOf` returns full chain incl. outcomes; `whatWasUsed` answers the agent-use question; distinct semantics preserved (plugin vs skill vs mcp nodes typed).

## G2 (T2) — TUF-style safe update/rollback (Part 5; §10.4 "updates are versioned, verified, reversible")
- **Gap:** no signed versioned metadata; rollback/freeze/mix-and-match unprotected.
- **Design:** `src/platform/capabilities/updates.ts` — TUF-principled (not full multi-role repo): signed metadata (ed25519), roles root/targets/snapshot/timestamp with threshold (default 1, configurable), freshness window (freeze), monotonic version check (rollback), snapshot-pinned target hashes (mix-and-match), size limits (endless data). Persisted last-seen state under `~/.xr/capabilities/tuf-state.json`. Applied via staged candidate + canary + revert (reuses `applyUpdate` plan pattern) — workspace-safe + reversible. Wired to `xr capabilities update <id>` and used to gate skill/plugin updates.
- **Test:** `test/capabilities/tuf-updates.test.ts` — rollback attack (downgraded version) blocked; freeze attack (stale timestamp) blocked; mix-and-match (targets not pinned by snapshot) blocked; update+rollback round-trip green; workspace untouched on failure.

## G3 (T3) — Evidence-based marketplace trust (Part 5; Art. XV.4; §10.2)
- **Gap:** no composite scorer with explainability; no popularity-vs-evidence proof.
- **Design:** `src/platform/capabilities/trust.ts` — `EvidenceTrustScorer.score(descriptor)` = weighted composite of signatures + provenance + tests/certification + permissions (least-privilege) + maintenance + outcomes (0..1), popularity weight capped ≤ 5% and log-scaled so it can only nudge, never dominate; `explain()` returns the ranked reason list. Used by capability discover (evidence sort option) + `xr capabilities rank --why`; skills search gains an evidence sort.
- **Test:** `test/capabilities/evidence-trust.test.ts` — a high-download unsigned capability scores below a low-download signed+tested one across a popularity sweep (10x/100x/10⁶x downloads).

## G4 (T4) — Manifest security + authority diff (Part 5; §10.2 "human-readable authority diff")
- **Gap:** manifests lack SBOM/capability-statement/dependency-locks; plugin signature not enforced; no pre-enable authority diff UX.
- **Design:** `src/platform/capabilities/manifest-security.ts` — security posture scan: signed authorship (envelope verification against publisher key ring), publisher verification, SBOM reference, capability statement (declared capabilities ⊆ declared permissions mapping), dependency locks, default-deny posture (no wildcard/auto-approve markers), routing-safe description. Returns `{ok, flags, reasons}`. `src/platform/capabilities/authority-diff.ts` — human-readable before/after diff (declared/effective/denied/new-permissions/risk-tier/data-scope) rendered as Markdown; surfaced by `xr capabilities enable/update --dry-run` (authority diff shown pre-enable).
- **Test:** `test/capabilities/manifest-security.test.ts` — unsigned manifest flagged; over-permissive manifest flagged; SBOM/capability-statement/locks present ⇒ pass; authority diff renderer shows new permissions + risk-tier delta pre-enable.

## G5 (T5) — Skill quality (Art. XV: typed/surface-universal; non-permissive allowed-tools; routing-safe descriptions)
- **Gap:** no constitutional skill types; `tools` not enforced; no description-injection guard; no skill parity test.
- **Design:** add `skillType` (executable/connector/prompt-pack/knowledge-pack/experimental) to skill schema + descriptor + CLI; honest per-type counts (`xr skills list --type`, health). Enforce `manifest.tools` as allow-list at skill enable (tool references validated against registry; unknown tool ⇒ flag/refuse). Description-injection guard: capability/skill descriptions must not be able to inject authority or tool declarations (validation + test). Parity: `test/skills/surface-parity.test.ts` asserting the same enabled skill set + execution context is served to CLI/run/daemon surfaces.
- **Test:** `test/skills/quality.test.ts` — typed labels + counts honest; permissive `tools:["*"]`/unknown-tool manifest refused; description containing fake "Permissions: fs:write" or tool declarations does not alter effective authority or grant tools; parity across surfaces.

## G6 (T6) — MCP quality (Art. XV.3; §10.6)
- **Gap:** no signed allowlist; no revocation test.
- **Design:** `src/mcp/allowlist.ts` — signed allowlist artifact (`~/.xr/mcp/allowlist.json`, ed25519-signed by the operator key or XR publisher key): default-deny — a server not on the allowlist is refused at load even if `enabled`; `xr mcp allow <id>` / `xr mcp revoke <id>` (re-signs); revocation kills live clients. Isolation already present (namespace sandbox fail-closed) — add test.
- **Test:** `test/security/mcp-allowlist.test.ts` — unlisted server refused; unsigned allowlist refused; listed server loads; revoke ⇒ load refused + live client killed; unisolated high-risk spawn fails closed.

## G7 (T7) — Lifecycle + certification gate (Art. XX; §10.4)
- **Gap:** no CI capability certification/scanning gate; no capability crash-isolation test.
- **Design:** `scripts/ci-capability-gate.ts` (runs manifest-security scan over bundled plugins+skills and capability certification smoke) wired into `bun run ci`; crash-isolation test for a crashing plugin worker/skill load (host survives, capability quarantined).
- **Test:** `test/capabilities/lifecycle.test.ts` — full local lifecycle (discover→inspect→verify→install→enable→use→update-review→rollback→quarantine→uninstall) with effects asserted; `test/capabilities/crash-isolation.test.ts` — crashing capability leaves host alive.

## G8 (T8) — Business OS decoupling (Art. XVI; Part Eight; Art. XXIV deletion budget)
- **Gap:** `src/business/**` (36 files / 10,777 LOC) in kernel; direct `BusinessOS` import in kernel provider/tokens/commands/daemon; simulated execution; no effect-verification; unproven modules not excluded.
- **Design:**
  1. **Thin L0 contract** `src/core/business-l0.ts` — record/artifact/identity/audit primitives over the workspace store (no domain schema): `putRecord/readRecord/queryRecords`, `putArtifact/readArtifact`, `identityFor(actor)`, `auditEvent`, `l0SchemaVersion`, `BUSINESS_L0_VERSION`.
  2. **Move** `src/business/**` → `extensions/business-os/**` as a governed extension package with `extensions/business-os/manifest.json` (id/version/L0-contract version/permissions/effect-verification spec).
  3. **Effect-verification harness** `extensions/business-os/effect-verification.ts` — per-module deterministic effect tests (create contact ⇒ row exists; record expense ⇒ ledger delta; etc.) run against a scratch DB.
  4. **Default-exclusion:** kernel `BusinessServiceProvider` loads the extension only when (a) config enables it AND (b) effect-verification passes; otherwise excluded with a recorded reason. Unproven modules never load.
  5. **Execution:** `ExecutionBridge` effect-verification — a business action reports `succeeded` only after a verifiable effect (record written/hash-chained); no simulated success (Art. XVI.4, §"No simulated success").
  6. **Data preserved:** same workspace store + `biz_*` tables; migration keeps rows; reversible (env `XR_BUSINESS_LEGACY=1` fallback path not needed — the extension reads the same DB; documented).
  7. Kernel keeps CLI command + daemon routes, resolving the extension through the L0 contract when active; when excluded they report the exclusion reason.
- **Tests:** `test/business/decoupling.test.ts` — kernel has zero imports of `extensions/business-os` and zero business domain schema (import-map check); extension excluded by default; enabled+verified ⇒ loads; unverified module excluded; `test/business/effect-verification.test.ts` — each module's effects verified; no `ok:true` without effect; `test/business/data-preservation.test.ts` — pre-existing `biz_*` rows survive the move and are readable through L0.

## Constitution check (no redesign needed)
- Art. XIV (installation≠trust; one registry; envelope non-bypass): preserved — new layers are metadata/verification only; execution stays in each plane + canonical envelope.
- Art. XV (typed skills; MCP default-deny; evidence trust): directly implemented by G5/G6/G3.
- Art. XVI (Business OS = governed extension; effect-verified; no second engine; default-excluded): implemented by G8; modules keep using canonical workflows/execution (no new engine).
- Art. XXIV (deletion budget): G8 removes ~10.8k LOC from the kernel; no net-new feature added (all tasks strengthen existing surface).
- No Phase 8 (UX/observability) or Phase 10 (hosted marketplace) work is introduced: trust scoring is local; the marketplace backend remains the existing local backend.
