# XR — MCP & Plugins Connection Plan

> Base: `src/mcp/` (client/manager/registry/allowlist), `src/plugins/` (host, sandbox-worker, protocol, signing, catalog), daemon routes (repo; npm drift BUG-001) [OBSERVED].
> Research: tool poisoning/rug-pull/auto-exec ecosystem failures [RESEARCH-BACKED DSN'26, CSA, OWASP MCP Top-10].

## 1. MCP experience ("Connections")
- **Connect flow:** source type (stdio command / local URL / remote URL) → engine probes → tool list preview w/ descriptions → grant sheet (which tools enabled, network scopes, env vars needed — secrets via keyring) → approve → live.
- **Connection card:** status (healthy/degraded/down), tool count, activity sparkline, last-used, permissions, health probe button, enable/disable, remove.
- **Tool grants:** per-tool toggle (allowlist heritage); granted tools appear in composer pin chips + capability inventory.
- **Pinning (SEC-01):** engine stores hash of tool metadata at approve time; any change (names/descriptions/schemas) → connection amber "changed" → diff sheet → re-approve or disable. Rug-pull protection by construction.
- **Project-defined configs:** workspace `mcp.json`-style files treated as untrusted proposals: appear in Connections as "workspace suggests" w/ content hash + approve-once/always (addresses TrustFall/Miasma class).
- **Advanced:** raw config editor under Settings→Advanced (warned), logs per server.

## 2. Plugins experience
- Install from catalog/URL → manifest+signature verify → sandbox placement shown (worker sandbox [OBSERVED]) → permissions sheet → enable.
- Plugin card: provenance chip, version, commands contributed (appear in palette), health (crash count), auto-quarantine notice w/ restore flow.
- Signing: unsigned = blocked by default w/ explicit override in Advanced (logged+audited).

## 3. Integrations (capability catalog)
- Library→Integrations lists discovered integration capabilities (165 inventory heritage) w/ "how to enable" paths delegating to MCP/plugins/keys/triggers — one browse surface, no dead ends.

## 4. Security invariants
- Engine enforces: allowlists, isolation grants, egress proxy for HTTP MCP, secret broker for env secrets, audit on grant changes. UI displays + forwards only (SEC-07).
- MCP tool outputs framed as untrusted (tool-output framing heritage).

## 5. Phasing
P3: connections UI + grants + cards. P4: pinning/diff re-approval + workspace-suggest flow + quarantine UX. P5: registry health badges (optional external scans w/ consent), remote-server OAuth flows engine-side.
