# XR — PRODUCT ARCHITECTURE REVIEW

**Question posed:** *Can every important capability be represented through one coherent mental model?* 
**Answer today: No.* *The backend is unusually capable — the capability-to-concept mapping is the failure. This review inventories the concept fragmentation, judges backend suitability for the redesigned UX, and defines the target product architecture. (No implementation — design only.)*

---

## 1. The concept inventory (and what's wrong with it)

Concepts a user must currently hold in their head, by source:

| Concept | Where it lives | Count / fragmentation |
|---|---|---|
| Agent | `xr agents` (multi-agent supervisor), "agent mode", `agent.minted` audit events, dashboard (none!) | 3 meanings: a mode, a supervisor workflow, a minted identity |
| Session | `xr session`, dashboard "Chat Sessions" + "Recent Sessions", chat threads, Telegram chats | 2 panels, 1 CLI, several ids (`s_*`, `dash_*` runIds) |
| Run / Task | `xr run`, `--resume`, checkpoints, `xr execution` ("durable-execution recovery status"), runs in dashboard | Task/Run/Execution/Checkpoint all exposed as peer concepts |
| Skill | `xr skills`, marketplace, 65 bundled | overlaps Capability + Plugin |
| Tool | built-in tools + tools registry + "Tools" inside capabilities | overlaps Capability |
| Plugin | `xr plugins`, sandboxed loader, catalog | overlaps Capability |
| Capability | `xr capabilities`, 165 indexed, certified/quarantined, `capabilities.json` | the *union* of the above, exposed as its own surface |
| Provider | 26 presets + custom endpoints, `xr providers` | split with Models |
| Model | `xr models`, `localModels` config, intelligence catalog entries | split with Provider; 3 sources of routing truth |
| Routing | `defaults.provider`, `routingStrategy`, intelligence router (difficulty/fidelity/behavioral/health) | the core contradiction (see §2) |
| Node / Device | dashboard "Devices Link", Telegram, Termux copy | marketing surface only |
| Channel | Telegram bot (channels in code) | not represented in UX at all |
| Workspace | `xr workspace`, per-workspace DBs, shell modal | solid concept, over-exposed at startup |
| Memory | durable memory (`xr memory`), context plane, "RAG MEMORY" chip, context inspection (`xr context`) | 3 surfaces for one story |
| Approval | durable store, CLI prompts, dashboard widget (blind), Telegram keyboards, typed-confirm | strongest backend, weakest surface |
| Trust / Environment / Placement | trust service, 6 isolation backends, `xr trust`, `xr env` | deep machinery, near-zero user comprehension |

### 1.1 The four extension systems are one concept

Skills (declarative packs), Plugins (code in a sandbox), Capabilities (the unified index with provenance/certification — which *already includes* integrations, artifacts, tools), and MCP servers (external tool providers). The system **already has** the unifying abstraction — the capability index — but presents four parallel install/marketplace/trust UX instead of one. `capabilities.routes` even indexes skills and MCP-derived tools. The product should say: **Extension** with `kind: skill | tool | connector | mcp`, one marketplace, one permission model, one enable/disable/quarantine switch. The four engines remain implementation detail.

### 1.2 Session/Run/Task/Execution is one concept

A **Run** = one execution of a task (mode, provider, steps, checkpoints, cost, artifacts). A **Thread** = the conversational container that may hold many runs (chat sessions today). "Durable execution"/checkpoint/resume is a *state* of a Run (`interrupted`, `resumable`), not a separate CLI command (`xr execution`). Audit entries, approvals, and tool events all carry sessionId/runId today — the join keys exist.

### 1.3 Provider/Model/Routing is one concept

The user's question is *"which brain, and what does it cost?"* Today answered by `defaults.provider/model`, `localModels`, `providerEngine.routingStrategy`, the intelligence catalog, and per-surface caching — with contradictory renderings (verified: six simultaneous answers). The fix is a **single routing decision record** (see §3.2), not more machinery. The intelligence router (718 LOC + evaluator/scorer/metrics/difficulty/behavioral/health ≈ a whole subsystem) should become a policy inside the decision service with a one-sentence explanation renderer; its debug detail moves behind `--explain`.

### 1.4 Memory/Context is one concept

Durable memory (user-curated facts), context assembly (what the model sees), and inspection (`xr context` pending/approve/revoke) are one user story: *what XR remembers*. Surface once; keep the three engines.

---

## 2. Root architectural causes of the UX symptoms

1. **Surfaces were built against subsystems, not against a product model.** Each panel/command was wired to the module that happened to exist (capabilities index → its own panel; intelligence router → its own "why" format; MCP → a panel with no routes). Result: 26 panels mirroring 45 src/ directories.
2. **Three sources of truth for routing** (defaults / localModels / intelligence) with no reconciliation layer — every contradiction the user sees traces here.
3. **The dashboard client is a 157KB string-concatenated artifact with no contract with the API.** Field drift (`e.ts` vs `created_at`), dead endpoints (`/api/mcp`), and fake data all shipped because nothing type-checks the client against the server. The OpenAPI schema + generated typed client (`clients/daemon-client.generated.ts`, `api:schema:check`, `client:check`) exist **for the API** — the dashboard JS simply doesn't use them.
4. **Process governance outpaced product governance.** Phase/ADR/constitution discipline kept the code honest at the module level, but nothing polices concept count, panel count, or naming across surfaces (claim-lint polices *claims*, not *IA*). The size-gate is at 99.4% with 14 waivers — the structural pressure valve is welded shut.
5. **Extraction (satellites) is half-done.** Business/enterprise moved out of core, but the dashboard panel, CLI shims, and "Devices" marketing copy remain, advertising removed capability.

---

## 3. Target product architecture

### 3.1 Layer model (what the product *is*)

```
┌──────────────────────────────────────────────────────────────────┐
│ SURFACES   Chat · Runs · Extensions · Guardrails · Memory ·      │
│            Workspaces/Files · Settings   (+ CLI verbs + TUI +    │
│            Telegram + IDE — all rendering the same primitives)   │
├──────────────────────────────────────────────────────────────────┤
│ PRODUCT    RunService · ThreadService · ExtensionService ·       │
│ SERVICES   ApprovalService · SpendService · MemoryService ·      │
│ (new seam) RoutingDecisionService · ReceiptService (audit views) │
├──────────────────────────────────────────────────────────────────┤
│ ENGINES    agent loop · execution fabric · intelligence router · │
│ (existing) providers · trust/isolation · memory/context ·        │
│            skills/plugins/MCP loaders · SQLite store · daemon    │
└──────────────────────────────────────────────────────────────────┘
```

The **product-services seam is the missing layer**: thin, UI-facing services that compose engines and own the *canonical render models* (RunView, ApprovalView, RoutingDecision, SpendView, ExtensionView). Surfaces stop touching engines directly. This is the one structural change that makes every UX fix cheap and permanent.

### 3.2 Canonical records (the contracts every surface must render)

- **RoutingDecision** `{providerId, modelId, tier(local/cloud/custom), pricing: {inPerMTok, outPerMTok, priced: boolean}, strategy(prefer-local|prefer-cloud|exact), why: one sentence, whyDetail: debug, decidedAt, source(config|router|user)}` — persisted per workspace; written by user action or router; read by every surface. Contradiction becomes structurally impossible.
- **RunView** `{id, threadId, title, mode, status, routing: RoutingDecision, steps[], cost {usd, tokens, priced}, artifacts[], approvals[], receipts[], resumable}` — one rendering for CLI/TUI/dashboard/Telegram.
- **ExtensionView** `{id, kind(skill|tool|connector|mcp), name, version, publisher, permissions[], provenance, state(enabled|disabled|quarantined|available), installSource}` — hides the four engines.
- **ApprovalView** `{id, tool, args (structured, redacted), preview (diff/command), riskTier, context {runSummary, doneSoFar, nextStep}, options(allow|allow-always(scope)|deny|edit), expiresAt}` — feeds the queue, the CLI prompt, and Telegram keyboards from one store (which already exists).
- **SpendView** `{task: {usd, tokens, cap}, day, month, unpricedWarning}` — priced flag forces honesty (fixes the $0-custom-provider hole at the model level, not the pricing-table level).

### 3.3 Concept resolution table

| Today | Becomes | Disposition |
|---|---|---|
| Agent (mode) | Mode on Run | rename in UI only |
| Agent (multi-agent) | Orchestration (advanced, inside Runs) | progressive disclosure |
| Session + Chat Session | **Thread** | merge |
| Task / Run / Execution / Checkpoint | **Run** (+ `state: interrupted/resumable`) | merge; `xr execution` → `xr runs --durable` |
| Skill + Plugin + Tool + Capability + MCP server | **Extension** (kind badge) | unify UX; keep engines |
| Provider + Model + Routing | **RoutingDecision** | unify |
| Memory + Context + RAG chip | **Memory** (with "what the model sees" tab) | merge surfaces |
| Shield + Trust + Environment/Placement + Approvals + Audit + Budget | **Guardrails**: Approvals · Spend · Audit (receipts) · Host Safety · (Advanced: Isolation, collapsed) | regroup |
| Workspace | Workspace (unchanged) | stop modal-ing at startup |
| Node/Device/Channel | Integrations (Settings) — only real ones | delete marketing |
| Research Runs | Runs with `kind: research` | merge |

### 3.4 Hiding complexity (progressive disclosure ladder)

- **Level 0 (first run):** Chat + model picker + budget. Nothing else in the nav.
- **Level 1 (default):** the 7 areas.
- **Level 2 (advanced, per-user opt-in):** Isolation/placement, capability certification/provenance, routing strategies detail, egress allowlists, webhook/trigger authoring.
- **Level 3 (operator):** doctor/deep, SBOM/verify-release, audit --crypto, seccomp profiles.
Every advanced control keeps its CLI path; the dashboard simply stops leading with it.

### 3.5 Backend suitability verdict (per subsystem, for the new UX)

| Subsystem | Suitable as-is | Needs |
|---|---|---|
| Agent loop + execution fabric | ✅ | RunView adapter (events already canonical) |
| Approval store | ✅ (excellent) | surface: queue/history/rules UI; feed it `args`; add allow-always scopes |
| Audit chain | ✅ | ReceiptService views; per-run grouping; quiet system-event noise |
| Providers (presets/custom/fallback) | ✅ | RoutingDecisionService on top; custom-provider pricing field |
| Intelligence router | ⚠️ over-engineered relative to UX payoff | demote to policy; one-sentence why; keep `--explain` |
| Skills/plugins/MCP loaders | ✅ | ExtensionService facade + unified marketplace |
| Capabilities index | ⚠️ good idea, wrong surface | becomes the Extension index; drop its own panel |
| Memory/context | ✅ | merge surfaces |
| Trust/isolation (6 backends) | ⚠️ deepest over-engineering | keep for tier-2+; hide entirely from default UX |
| Daemon + routes | ✅ | MCP routes (missing); contract-typed dashboard client |
| Dashboard client | ❌ rebuild | small SPA (or server-rendered islands) using the **existing generated client**; build step; contract tests |
| SQLite store | ✅ | split `workspace-store.ts` (2,539 LOC) along repo seams already begun |
| Telegram | ✅ | render ApprovalView/RunView; it becomes a first-class Guardrails surface |
| VS Code extension | ❌ stub | rebuild on /api/v1/chat + ActiveModelCard |

### 3.6 Risk register for the rearchitecture

1. **Big-bang dashboard rewrite risk** — mitigate: ship product-services seam + RunView first, rebuild panels incrementally behind it (see REDESIGN_PLAN).
2. **Losing the process discipline** — keep claim-lint/CI; add an "IA budget" check (max nav areas, max top-level commands visible in default help, no panel without a live API) to `bun run ci`.
3. **Satellite stragglers** — finish removal (Business panel, shims) before any new surface work.
4. **Test pollution (P1-8) must be fixed first** — otherwise every new surface test writes into real homes.

---

## 4. What NOT to change

- The trust plane stays byte-for-byte in behavior: hash chain + Ed25519 checkpoints, TTL default-deny, typed-confirm, path scoping, CSRF, seccomp.
- The engines stay: the loop, fallback, repair, checkpoint/recovery, the loaders.
- The CLI stays a first-class surface (XR's audience is terminal-native) — it just renders the same canonical records.
- The single-SQLite-per-workspace model stays.
- BYOK/local-first posture stays — it's the differentiator; the redesign should make it *legible*, not diluted.
