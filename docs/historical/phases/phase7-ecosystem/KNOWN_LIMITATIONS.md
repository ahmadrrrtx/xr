# Phase 7 — Known limitations (honest scope)

- **Hosted/operated capability marketplace:** XR's marketplace backend is a
  LOCAL store + online-registry client. There is no hosted registry,
  no central signing authority, and no "certified-by-XR" badge beyond the
  local evidence-based trust score and contract-test certification.
  A hosted registry is Phase 10. `xr capabilities rank/trust` explains
  WHY a capability ranks using local evidence only.
- **Publisher key ring:** `xr capabilities security --strict` verifies
  authorship against a locally configured publisher key ring; there is no
  built-in directory of publisher keys.
- **TUF update metadata:** the verifier/gate is implemented and tested;
  no production update repository signs capability metadata yet (the
  tooling and CLI surface exist; distribution is Phase 10).
- **Visual Studio / hosted surfaces:** visual studio integration remains
  Phase 8+ research; nothing here claims otherwise.
- **Business OS:** effect-verified and default-excluded, but "certified"
  in the ERP sense is not claimed; real systems of record integrate via
  MCP. The extension is in-repo (`extensions/business-os`) — packaging as
  a separately distributed artifact is future work.
- **MCP allowlist keys:** `xr mcp allow` generates an operator key on
  first use; key management/rotation UX is minimal by design (local-first).
