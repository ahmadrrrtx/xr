# XR — Multi-Agent Experience Plan

> Derives from existing implementation: `src/agents/` (roles, permission profiles), `src/agents/planner.ts` (workflow plans w/ phases), `src/execution/workflow/` (engine, nodes incl. human-approval/human-review nodes, versioning), partitions/leases (ownership) [OBSERVED].

## 1. Mental model (user-facing)
- **Team Run** = one Task executed by a team: Orchestrator → role agents (Researcher/Coder/Reviewer/…) → Synthesis. Roles come from planner output, not hardcoded fantasy. [OBSERVED planner phases]
- Board shows: role nodes, status ring (queued/working/waiting/blocked/done/failed), dependency edges, per-agent budget burn, failure halo, ownership chips (which files/partition each agent holds — leases [OBSERVED]).

## 2. Interactions
- Create: from Work ("run this as a team") or Agents surface (template gallery incl. `src/templates/workflows/*` [OBSERVED]).
- Steer: message an agent (injects into its next turn), pause node, cancel node, retry failed node, approve at human nodes (ApprovalSheet w/ source label).
- Inspect: per-agent transcript sheet (scoped tool timeline + cost).
- Conflict awareness: two agents claiming same path → board shows contention chip; engine leases already serialize [OBSERVED] — surface, don't reinvent.

## 3. Visibility rules (progressive)
- Level 1: single progress summary ("Team working · 3 agents · 62% · $0.41").
- Level 2: board. Level 3: per-agent transcripts/raw workflow JSON (advanced).

## 4. Budgets & safety
- Team budget = partition caps [OBSERVED cost partitions]; burn bars per agent; over-budget → orchestrator decision dialog (raise/stop) heritage of loop callback.
- Agent permission profiles displayed as chips (write/shell/network/mcp/memory/computer/secrets) — read from registry [OBSERVED]; editing profiles = advanced, engine-validated.

## 5. Failure UX
- Node failure: halo + reason + retry/skip/abort choices; workflow state machine guarantees idempotent terminal states [OBSERVED tests].
- Durable resume after crash (checkpoints) → "Team paused by restart — resume?" sheet.

## 6. Phasing
P3: board + transcripts + approvals-at-nodes + templates. P5: visual workflow editor (draft/publish versioning exists [OBSERVED]) for power users only.
