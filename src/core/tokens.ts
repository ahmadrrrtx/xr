/**
 * XR — Service Token Catalog
 *
 * The canonical, single source of truth for every service identity in the
 * runtime. Each token is declared exactly once here and referenced everywhere
 * else by import. Because tokens carry their service type, the compiler
 * guarantees that resolve(Tokens.X) returns the right type — there are no
 * string keys to mistype and no manual <T> annotations to get wrong.
 *
 * All service-type imports below are `import type` (erased at compile time),
 * so this file has zero runtime dependency on the services it catalogues.
 * That keeps tokens.ts at the bottom of the graph, free of import cycles.
 */

import { token } from "./service-registry.ts";

// Runtime infrastructure (created and owned by XRApp).
import type { XRApp } from "./app.ts";
import type { ServiceRegistry } from "./service-registry.ts";
import type { EventBus } from "./event-bus.ts";
import type { CommandRegistry } from "./command-registry.ts";
import type { LifecycleManager } from "./lifecycle.ts";
import type { WorkspaceManager } from "./workspace.ts";
import type { BackgroundServiceManager } from "./services.ts";

// State layer.
import type { WorkspaceStore } from "../state/workspace-store.ts";
import type { SessionRepo } from "../state/repos/session-repo.ts";
import type { AuditRepo } from "../state/repos/audit-repo.ts";
import type { CostRepo } from "../state/repos/cost-repo.ts";
import type { UserMemoryRepo } from "../state/repos/user-memory-repo.ts";
import type { SkillRepo } from "../state/repos/skill-repo.ts";
import type { WorkflowRepo } from "../state/repos/workflow-repo.ts";

// Domain services.
import type { ConfigService } from "../services/config-service.ts";
import type { ProviderService } from "../services/provider-service.ts";
import type { BudgetService } from "../services/budget-service.ts";
import type { PluginService } from "../services/plugin-service.ts";
import type { McpService } from "../services/mcp-service.ts";
import type { SkillService } from "../services/skill-service.ts";
import type { AgentService } from "../services/agent-service.ts";
import type { MultiAgentService } from "../services/multi-agent-service.ts";
import type { IntelligenceService } from "../intelligence/service.ts";
import type { CapabilityService } from "../platform/capabilities/service.ts";

// Cross-cutting subsystems.
import type { XRShieldService } from "../security/shield.ts";
import type { BusinessOsExtension, BusinessL0 } from "./business-l0.ts";
import type { ExecutionService } from "../execution/service.ts";
import type { TrustService } from "../runtime/trust/service.ts";
import type { ContextService } from "../context/service.ts";

/**
 * The complete service catalogue. Add new tokens here when a new stage
 * introduces a service — never declare ad-hoc tokens elsewhere.
 */
export const Tokens = {
  // ── Infrastructure ──────────────────────────────────────────────────────
  App: token<XRApp>("xr.app", "XR runtime application bootstrap"),
  Registry: token<ServiceRegistry>("xr.registry", "typed service registry"),
  Events: token<EventBus>("xr.events", "event bus"),
  Commands: token<CommandRegistry>("xr.commands", "command registry"),
  Lifecycle: token<LifecycleManager>("xr.lifecycle", "lifecycle manager"),
  Workspaces: token<WorkspaceManager>("xr.workspaces", "workspace manager"),
  BackgroundServices: token<BackgroundServiceManager>(
    "xr.background-services",
    "background service / job manager",
  ),

  // ── Storage (one unified WorkspaceStore + its typed repos) ──────────────
  Store: token<WorkspaceStore>("xr.store", "unified workspace store"),
  /** Backward-compatibility alias — same instance as Store. Resolves to the
   *  unified store so legacy code paths keep sharing one connection. */
  LegacyStore: token<WorkspaceStore>("xr.legacy-store", "alias of Store"),
  SessionStore: token<SessionRepo>("xr.session-store", "session repository"),
  AuditStore: token<AuditRepo>("xr.audit-store", "audit repository"),
  CostStore: token<CostRepo>("xr.cost-store", "cost repository"),
  UserMemoryStore: token<UserMemoryRepo>("xr.user-memory-store", "user memory repository"),
  SkillStore: token<SkillRepo>("xr.skill-store", "skill repository"),
  WorkflowStore: token<WorkflowRepo>("xr.workflow-store", "workflow repository"),

  // ── Domain services ─────────────────────────────────────────────────────
  Config: token<ConfigService>("xr.config", "configuration service"),
  Providers: token<ProviderService>("xr.providers", "LLM provider service"),
  /** XR 4.4 — Universal Intelligence Plane (capability catalog + routing). */
  Intelligence: token<IntelligenceService>("xr.intelligence", "Universal Intelligence Plane service"),
  Budget: token<BudgetService>("xr.budget", "budget / spend service"),
  Plugins: token<PluginService>("xr.plugins", "plugin service"),
  Mcp: token<McpService>("xr.mcp", "MCP service"),
  Skills: token<SkillService>("xr.skills", "skill service"),
  Agent: token<AgentService>("xr.agent", "agent service"),
  MultiAgents: token<MultiAgentService>("xr.multi-agents", "multi-agent service"),
  /** XR 5.2 — Common capability ecosystem descriptor/discovery service. */
  Capabilities: token<CapabilityService>("xr.capabilities", "Capability Ecosystem service"),

  // ── Cross-cutting subsystems ────────────────────────────────────────────
  Shield: token<XRShieldService>("xr.shield", "security shield service"),
  /** Phase 7 · T8 — Business OS extension (L5), loaded through the thin L0
   *  contract; null unless config-enabled AND effect-verified. */
  Business: token<BusinessOsExtension | null>("xr.business", "Business OS extension (governed, default-excluded)"),
  /** Phase 7 · T8 — the thin L0 record/artifact/identity/audit contract. */
  BusinessL0: token<BusinessL0>("xr.business.l0", "Business OS thin L0 contract"),
  /** Phase 7 · T8 — lazy loader for the governed extension (config + effect-verification gate). */
  BusinessLoader: token<{ load(): Promise<BusinessOsExtension | null>; status(): { loaded: boolean; reason: string | null } }>("xr.business.loader", "Business OS extension loader"),
  Execution: token<ExecutionService>("xr.execution", "Unified Execution Fabric service"),
  // XR 4.2 — Trust & Isolation (risk-tiered placement + enforceable boundaries).
  Trust: token<TrustService>("xr.trust", "Trust & Isolation service"),
  // XR 4.5 — Knowledge and Context OS (taxonomy, provenance, scope-first retrieval).
  Context: token<ContextService>("xr.context", "Knowledge and Context OS service"),
} as const;

export type ServiceTokenId = keyof typeof Tokens;
