# ADR-0014 — Capability Provenance Graph

- **Status:** accepted (Phase 7 · T1)
- **Owner:** capability ecosystem · **Review:** 2026-08-02

## Context
Constitution §10.7: every capability's origin, version, permissions,
dependencies, data access, approvals, and outcomes must be queryable —
"what did the agent use?" as a system property. Per-capability lifecycle
history existed in the metadata store, but there was no graph and no
outcome/use recording.

## Decision
Add `src/platform/capabilities/provenance.ts` — an append-only, bounded
provenance graph (nodes = capabilities, edges = depends-on/used-by/
updated-from/replaced-by/originated-from, events = install/update/enable/
disable/use/outcome/rollback/quarantine/certify/review/remove, plus per-use
outcome status). Persisted at `~/.xr/capabilities/provenance.json`
(atomic tmp+rename, write-behind flush). Tool-use recording is wired
through the canonical envelope: `ToolContext.onToolUse` (kernel type-only
callback) → `AgentService` → `CapabilityService.recordUse`.

## Consequences
- "What did the agent use?" is answerable via `whatWasUsed(runId/window/actor)`.
- Distinct runtime semantics preserved: nodes are typed (plugin ≠ skill ≠ mcp…).
- The graph is DERIVED evidence, never a second registry (Art. XIV.3); bounds
  (2k nodes / 8k events / 5k edges / 500 per capability) prevent endless data.
- Recording is best-effort by design: it can never break execution.

## Test
`test/capabilities/provenance-graph.test.ts` (7 tests: full chain, whatWasUsed,
typed semantics, descriptor indexing, boundedness, persistence round-trip).
