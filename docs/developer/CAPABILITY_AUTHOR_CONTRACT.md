# Capability Author — Placement & Authority Contract (Phase 4)

Applies to core tools, plugins, skills and MCP servers. Every capability
declares its risk facts; XR decides placement from the lattice. **A
capability can never choose a weaker placement than policy demands.**

## How placement is decided

```
classifier (objective facts)  ─┐
capability minimumTier (opt) ──┼─► max() ─► effective tier ─► backend selection
per-run escalation (state) ───┘                          (cheapest adequate)
```

## Declaring risk (tools)

Set `trustRequest(args, ctx)` on your tool. Key fields
(`src/runtime/trust/types.ts` `TrustRequest`):

| Field | Meaning |
|---|---|
| `spawnsProcess` / `runsArbitraryCode` | ⇒ tier2 — MUST provide an `EnvironmentExecutable` and use `ctx.runIsolated`, or the action is blocked |
| `networkTargets` | egress allowlist consumed at connection time by the egress proxy |
| `needsCredentials` | drives broker-mediated, task-scoped credential injection |
| `touchesOutsideWorkspace` | raises the tier |
| `untrustedContent` | raises the tier (hostile content) |
| `minimumTier` | declare HIGHER than the classifier if your capability must never run below it (e.g. a plugin that spawns interpreters) — escalate-only |

## What isolation will my capability get on each OS?

**Run the generator — do not guess:**

```bash
bun run scripts/guarantee-matrix.ts        # human table
bun run scripts/guarantee-matrix.ts --json # machine
```

The matrix is probed live on the CURRENT host and states per action class:
placement, kernel boundary, enforced FS/network/process, ambient-authority
stripping, fail-closed. On macOS/Windows the matrix honestly reports what is
NOT available (Seatbelt/container backends are not validated in Phase 4 — no
claim is made).

## Hard rules

1. **Never bypass the envelope.** Register through the one tool registry; all
   calls flow through `ToolContext` (audit/approval/budget/trust).
2. **High-risk tools use `ctx.runIsolated`.** No runner wired + hardened ⇒
   the tool must fail, not fall back (see `shellTool` for the pattern).
3. **Secrets:** call the broker; never log, never embed in args, never put in
   child env. Plugin workers get names-only bootstrap.
4. **Network:** rely on the egress proxy; never open raw sockets for
   user-supplied URLs.
5. **`node:vm` is not a boundary.** If you isolate in-process, say
   "defense-in-depth" and depend on the trust lattice for confinement.
6. **No `any`/empty-catch on trust boundaries** (Art. IV).
