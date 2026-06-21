# XR Stage 11: MCP Platform — IMPLEMENTED

**Date:** 2026-06-21
**Status:** Complete, production-grade, security-first

## Executive Summary

XR now has a **first-class, secure MCP Platform**.

- Full MCP 2025-06-18 client (tools + resources + prompts)
- Multi-transport: stdio, http, sse, streamable-http
- Persistent registry + lifecycle (add/enable/disable/remove/inspect/health)
- Explicit permissions + trust model (15 scopes)
- All MCP surfaces wrapped as XR Tools with approval + audit gates
- Integrated into agent runtime, doctor, CLI, services
- Never bypasses budgets, approvals, egress, or memory controls

MCP servers are **opt-in only**, inspectable, and fail-closed.

## Audit Findings (Phase 1)

**What existed:**
- `src/mcp/client.ts` — minimal HTTP-only stub (tools/list + tools/call only)
- Plugin manifest had `mcpServers` declarations (metadata only)
- Config had deprecated `mcpServers` array (unused)
- No registry, no CLI, no health, no resources/prompts

**What was missing / fragile:**
- No real MCP registry or state
- No stdio support
- No resource or prompt support
- No lifecycle commands
- No permission model for MCP
- No health / discovery
- MCP tools never reached agent runtime
- No safety hardening

**Risks fixed:**
- No silent enablement
- No raw secret storage
- All calls go through XR approval + audit + budget

## Architecture

```
mcp/
├── types.ts          # Canonical schema + permissions
├── client.ts         # Multi-transport MCP client + XR wrappers
├── registry.ts       # Durable installed state
├── manager.ts        # Lifecycle, discovery, loading, surfacing
├── cli.ts            # xr mcp commands
services/mcp-service.ts
commands/mcp.ts

Integrated into:
- agent-service.ts (extraTools)
- index.ts (service + command registration)
- doctor.ts (MCP health)
```

All MCP invocations are:
- Approval gated (`requiresApproval: true`)
- Audited (`mcp.tool.call`, `mcp.resource.read`, etc.)
- Budget & egress aware
- Cleanly unloadable

## Key Files (Ready to Copy)

All new files are already written to the workspace.

### Validation Checklist
- [x] `xr mcp list`
- [x] `xr mcp add ...`
- [x] `xr mcp enable/disable/remove`
- [x] `xr mcp inspect`
- [x] `xr mcp tools/resources/prompts <id>`
- [x] `xr mcp health`
- [x] MCP tools appear in agent runs
- [x] Doctor reports MCP health
- [x] All calls approval + audit gated
- [x] Registry persists
- [x] Fail-closed on bad servers

## Known Limitations
- stdio servers require local binaries (npx / node / python)
- Remote MCP servers treated as higher-risk (trustLevel)
- No built-in MCP server registry catalog yet (manual add only)
- SSE / streamable-http support basic (full streaming later)

Stage 11 complete. XR is now MCP-native.
