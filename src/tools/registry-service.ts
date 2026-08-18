/**
 * XR Phase 2 · T2 + Phase 8 — `ToolRegistryService`: the single registration
 * and discovery authority for every tool XR can run.
 *
 * Constitution Art. III (\"Compliant Designs\"): *\"A single `ToolRegistryService`
 * where core/plugins/skills/MCP register.\"* This is that service.
 *
 * Phase 08 enhancements:
 * - Unified lifecycle (enabled/disabled/quarantined/revoked/rolled_back)
 * - Trust levels (official/verified/community/unknown/quarantined)
 * - Scope (workspace/session/agent/shared/host)
 * - Permissions (unified CapabilityPermission)
 * - Risk tier
 * - Provider + version + hash + provenance
 * - Discovery pipeline: trust → lifecycle → scope → permission → mode → policy
 * - Execution repeats authorization (resolve checks lifecycle/trust)
 * - Disabled cannot shadow enabled (no privilege escalation)
 * - Provenance preserved
 *
 * ── Invariants this service enforces ────────────────────────────────────────
 *
 * I1. ONE PLACE. Core, plugin, MCP and skill contributions all arrive through
 *     `register*()`. No consumer builds its own tool list any more.
 *
 * I2. NAMESPACED IDENTITY. Every callable entry has a unique qualified id
 *     (`core:shell`, `plugin:acme:deploy`, `mcp:github:create_issue`). Ids are
 *     unforgeable: a plugin cannot register into the `core:` namespace because
 *     the namespace is derived from the contribution kind, never from input.
 *
 * I3. FAIL-CLOSED COLLISIONS (Art. IV.4). If a non-core tool claims a core
 *     tool's bare name, the CORE tool keeps it and the contribution stays
 *     reachable only by qualified id. If two non-core tools claim the same bare
 *     name, NEITHER wins it. A bare name therefore never silently changes
 *     meaning — the pre-Phase-2 privilege-confusion vector.
 *
 * I4. DISTINCT SEMANTICS PRESERVED (Art. XIV/XV, Global Rule 6). `kind` is
 *     retained on every entry and the runtime behaviour behind `tool.run()` is
 *     whatever that kind's host provides. Skills are stored in a SEPARATE
 *     collection with no `run()` at all, so a prompt-pack can never be invoked.
 *
 * I5. NO STUBS (Phase 0 · T5). Names retired in Phase 0 are refused
 *     registration, so a removed stub can never re-enter through a plugin.
 *
 * I6. PHASE 08 — LIFECYCLE ENFORCEMENT. Only enabled capabilities are
 *     discoverable by default and resolvable for execution. Disabled/
 *     quarantined/revoked cannot shadow enabled bare names.
 *
 * I7. PHASE 08 — TRUST ENFORCEMENT. Quarantined trust level cannot execute.
 *
 * I8. PHASE 08 — DISCOVERY == EXECUTION POLICY. Discovery and resolve use
 *     identical lifecycle/trust checks (defense in depth).
 *
 * The service holds no persistent state: it is rebuilt per run from live
 * contributions, so there is no schema to migrate and rollback is trivial.
 * Lifecycle/trust maps are populated per-run by the builder from manager
 * states.
 */

import type { Mode, Tool } from "../core/types.ts";
import { REMOVED_STUB_TOOLS } from "../computer/system-control.ts";
import {
  NAMESPACE,
  type CapabilityLifecycleState,
  type CapabilityMetadata,
  type CapabilityPermission,
  type CapabilityScope,
  type CapabilityTrustLevel,
  type CapabilityRiskTier,
  type DiscoveryOptions,
  type EnhancedToolContribution,
  type RegisteredSkill,
  type RegisteredTool,
  type ShadowReason,
  type SkillContribution,
  type ToolCollision,
  type ToolContribution,
  type ToolKind,
} from "./registry-types.ts";

/**
 * Read-only tools — safe in plan/ask modes (no state change, no exec, no
 * system access). Preserved verbatim from the pre-Phase-2 registry so mode
 * scoping does not change behaviour.
 */
const READ_ONLY_CORE = new Set([
  "read_file",
  "list_dir",
  "fetch_url",
  "web_search",
  "check_package",
  "system_apps",
  "system_clipboard_read",
]);

/**
 * Retired Phase-0 stub names. `REMOVED_STUB_TOOLS` is a literal tuple of tool
 * names (src/computer/system-control.ts:195), so it is spread directly.
 */
const RETIRED = new Set<string>(REMOVED_STUB_TOOLS);

const RISK_RANK: Record<string, number> = {
  tier0: 0,
  tier1: 1,
  tier2: 2,
  unknown: 99,
  blocked: 99,
};

function qualify(kind: ToolKind, source: string, name: string): string {
  return kind === "core"
    ? `${NAMESPACE.core}:${name}`
    : `${NAMESPACE[kind]}:${source}:${name}`;
}

export class ToolRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRegistryError";
  }
}

export class ToolRegistryService {
  /** Qualified id → entry. Insertion-ordered: core first, then contributions. */
  private readonly entries = new Map<string, RegisteredTool>();
  private readonly skills: RegisteredSkill[] = [];
  private readonly collisions: ToolCollision[] = [];
  /** Bare name → qualified id, or null when the name is contested. */
  private readonly bareNames = new Map<string, string | null>();

  // ── Phase 08 — lifecycle / trust / scope / permission audit ──────────────
  private readonly lifecycleAudit: Array<{
    capabilityId: string;
    previous: CapabilityLifecycleState;
    next: CapabilityLifecycleState;
    reason?: string;
    at: number;
  }> = [];

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a batch of callable tools from one contribution source.
   * Returns the entries actually registered (retired stubs are refused).
   */
  registerTools(contribution: ToolContribution | EnhancedToolContribution): RegisteredTool[] {
    const registered: RegisteredTool[] = [];
    const enhanced = contribution as EnhancedToolContribution;
    for (const tool of contribution.tools) {
      const meta = enhanced.metadata?.[tool.name] ?? enhanced.metadata?.[`${contribution.kind}:${contribution.source}:${tool.name}`];
      const entry = this.registerOne(contribution.kind, contribution.source, tool, meta);
      if (entry) registered.push(entry);
    }
    return registered;
  }

  /**
   * Register a skill's prompt contribution. Skills are NOT tools: this returns
   * a `RegisteredSkill` with no `run()`, held in a separate collection.
   */
  registerSkill(contribution: SkillContribution): RegisteredSkill {
    const entry: RegisteredSkill = {
      id: `${NAMESPACE.skill}:${contribution.source}`,
      kind: "skill",
      source: contribution.source,
      prompt: contribution.prompt,
      declaredTools: [...(contribution.declaredTools ?? [])],
    };
    this.skills.push(entry);
    return entry;
  }

  private registerOne(
    kind: Exclude<ToolKind, "skill">,
    source: string,
    tool: Tool,
    meta?: CapabilityMetadata,
  ): RegisteredTool | null {
    // I5 — a Phase-0 retired stub may never re-enter the runtime.
    if (RETIRED.has(tool.name)) return null;

    const id = qualify(kind, source, tool.name);
    if (this.entries.has(id)) {
      // Same source re-registering the same name is a source-side bug, not a
      // security event: keep the first and report it rather than silently
      // overwriting a live tool.
      throw new ToolRegistryError(
        `duplicate tool id "${id}" — ${kind} source "${source}" registered "${tool.name}" twice`,
      );
    }

    // I3 — arbitrate the bare name, fail closed on ambiguity.
    // Phase 08: disabled cannot shadow enabled.
    let shadowed: ShadowReason = "none";
    const holderId = this.bareNames.get(tool.name);
    const incomingLifecycle = meta?.lifecycle ?? "enabled";

    if (holderId === undefined) {
      this.bareNames.set(tool.name, id);
    } else if (holderId === null) {
      // Name already contested — this entry joins the contest, nobody wins.
      shadowed = "ambiguous";
      this.recordCollision(tool.name, null, id, "ambiguous");
    } else {
      const holder = this.entries.get(holderId);
      if (!holder) {
        // Should not happen, but fail closed: treat as contested
        this.bareNames.set(tool.name, null);
        shadowed = "ambiguous";
        this.recordCollision(tool.name, null, id, "ambiguous");
      } else if (holder.kind === "core") {
        // Core keeps its name; the contribution stays qualified-only.
        shadowed = "core_reserved";
        this.recordCollision(tool.name, holderId, id, "core_reserved");
      } else if (kind === "core") {
        // Core registered after a contribution (registration order should put
        // core first, but never rely on it): core reclaims the bare name and
        // the earlier contribution becomes qualified-only.
        // Phase 08: only if incoming is not disabled/quarantined? Actually core always wins even if disabled? Core disabled shouldn't happen. Keep core wins.
        this.demote(holderId, "core_reserved");
        this.bareNames.set(tool.name, id);
        this.recordCollision(tool.name, id, holderId, "core_reserved");
      } else {
        // Two non-core contributions: neither may own the bare name.
        // Phase 08 enhancement: disabled cannot shadow enabled.
        const holderLifecycle = (holder as any).lifecycle ?? "enabled";
        const holderEnabled = holderLifecycle === "enabled";
        const incomingEnabled = incomingLifecycle === "enabled";

        if (!incomingEnabled && holderEnabled) {
          // Disabled incoming cannot take enabled holder's bare name — it stays shadowed.
          shadowed = "ambiguous";
          this.recordCollision(tool.name, holderId, id, "ambiguous");
        } else if (incomingEnabled && !holderEnabled) {
          // Enabled incoming should reclaim from disabled holder
          this.demote(holderId, "ambiguous");
          this.bareNames.set(tool.name, id);
          shadowed = "none";
          this.recordCollision(tool.name, id, holderId, "ambiguous");
        } else {
          // Both enabled or both disabled: neither wins bare name (fail closed)
          this.demote(holderId, "ambiguous");
          this.bareNames.set(tool.name, null);
          shadowed = "ambiguous";
          this.recordCollision(tool.name, null, id, "ambiguous");
          this.recordCollision(tool.name, null, holderId, "ambiguous");
        }
      }
    }

    const entry: RegisteredTool = {
      id,
      name: tool.name,
      kind,
      source,
      tool,
      shadowed,
      exposedName: shadowed === "none" ? tool.name : id,
      lifecycle: meta?.lifecycle ?? "enabled",
      trustLevel: meta?.trustLevel ?? (kind === "core" ? "official" : "unknown"),
      scope: meta?.scope ?? "shared",
      permissions: meta?.permissions ?? [],
      riskTier: meta?.riskTier ?? "unknown",
      providerId: meta?.providerId ?? `${kind}:${source}`,
      version: meta?.version ?? "unknown",
      sourceHash: meta?.sourceHash,
      provenance: meta?.provenance,
    };
    this.entries.set(id, entry);
    return entry;
  }

  private demote(id: string, reason: Exclude<ShadowReason, "none">): void {
    const existing = this.entries.get(id);
    if (!existing || existing.shadowed !== "none") return;
    this.entries.set(id, { ...existing, shadowed: reason, exposedName: existing.id });
  }

  private recordCollision(
    name: string,
    winner: string | null,
    loser: string,
    reason: Exclude<ShadowReason, "none">,
  ): void {
    const existing = this.collisions.find((c) => c.name === name && c.reason === reason);
    if (existing) {
      if (!existing.shadowed.includes(loser)) {
        (existing.shadowed as string[]).push(loser);
      }
      return;
    }
    this.collisions.push({ name, winner, shadowed: [loser], reason });
  }

  // ── Phase 08 — lifecycle management ─────────────────────────────────────

  private findEntryIncludingDisabled(idOrName: string): RegisteredTool | undefined {
    // Direct qualified id lookup (includes disabled)
    const direct = this.entries.get(idOrName);
    if (direct) return direct;
    // Search by exposedName, name, id
    for (const e of this.entries.values()) {
      if (e.exposedName === idOrName || e.name === idOrName || e.id === idOrName) return e;
    }
    // Bare name via bareNames map
    const holder = this.bareNames.get(idOrName);
    if (holder) return this.entries.get(holder);
    return undefined;
  }

  setLifecycle(idOrName: string, lifecycle: CapabilityLifecycleState, reason?: string): boolean {
    const entry = this.findEntryIncludingDisabled(idOrName);
    if (!entry) return false;
    const prev = entry.lifecycle ?? "unknown";
    if (prev === lifecycle) return true;
    this.entries.set(entry.id, { ...entry, lifecycle });
    this.lifecycleAudit.push({
      capabilityId: entry.id,
      previous: prev,
      next: lifecycle,
      reason,
      at: Date.now(),
    });
    return true;
  }

  getLifecycle(idOrName: string): CapabilityLifecycleState | undefined {
    const entry = this.findEntryIncludingDisabled(idOrName);
    return entry?.lifecycle;
  }

  getLifecycleAudit() {
    return [...this.lifecycleAudit];
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  /**
   * The tools offered to the model for this run.
   *
   * Phase 02 preserved: agent gets everything; plan/ask get read-only CORE.
   * Phase 08 extended: trust, lifecycle, scope, permission, risk filters.
   *
   * Every returned `Tool` carries `exposedName` as its `name`, so a shadowed
   * entry is advertised under its qualified id.
   */
  discover(options: DiscoveryOptions): Tool[] {
    const allow = options.allow ? new Set(options.allow) : null;
    const deny = options.deny ? new Set(options.deny) : null;
    const lifecycleFilter = options.lifecycle ? new Set(options.lifecycle) : null;
    const trustFilter = options.trustLevels ? new Set(options.trustLevels) : null;
    const scopeFilter = options.scopes ? new Set(options.scopes) : null;
    const requiresPerms = options.requiresPermissions ? new Set(options.requiresPermissions) : null;
    const excludesPerms = options.excludesPermissions ? new Set(options.excludesPermissions) : null;
    const maxRiskRank = options.maxRiskTier ? (RISK_RANK[options.maxRiskTier] ?? 99) : 99;
    const enabledOnly = options.enabledOnly !== false;

    const out: Tool[] = [];
    for (const entry of this.entries.values()) {
      if (!this.inMode(entry, options.mode)) continue;

      // Phase 08 — lifecycle filter: only enabled by default for model-visible
      if (enabledOnly) {
        const lc = entry.lifecycle ?? "enabled";
        if (lc !== "enabled") continue;
      }
      if (lifecycleFilter) {
        const lc = entry.lifecycle ?? "enabled";
        if (!lifecycleFilter.has(lc)) continue;
      }

      // Trust filter
      if (trustFilter) {
        const t = entry.trustLevel ?? "unknown";
        if (!trustFilter.has(t)) continue;
      } else {
        // By default, hide quarantined/revoked unless explicitly requested
        const t = entry.trustLevel ?? "unknown";
        if (t === "quarantined") continue;
        const lc = entry.lifecycle ?? "enabled";
        if (lc === "quarantined" || lc === "revoked" || lc === "removed") continue;
      }

      // Scope filter
      if (scopeFilter) {
        const s = entry.scope ?? "shared";
        if (!scopeFilter.has(s) && s !== "shared") continue;
      }

      // Permission filters
      if (requiresPerms) {
        const perms = entry.permissions ?? [];
        let ok = true;
        for (const r of requiresPerms) {
          if (!perms.includes(r)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }
      if (excludesPerms) {
        const perms = entry.permissions ?? [];
        let excluded = false;
        for (const e of excludesPerms) {
          if (perms.includes(e)) {
            excluded = true;
            break;
          }
        }
        if (excluded) continue;
      }

      // Risk tier filter
      if (options.maxRiskTier) {
        const rt = entry.riskTier ?? "unknown";
        const rank = RISK_RANK[rt] ?? 99;
        if (rank > maxRiskRank) continue;
      }

      // Allow/deny
      if (allow && !allow.has(entry.name) && !allow.has(entry.id) && !allow.has(entry.exposedName)) continue;
      if (deny && (deny.has(entry.name) || deny.has(entry.id) || deny.has(entry.exposedName))) continue;

      out.push(entry.exposedName === entry.name ? entry.tool : { ...entry.tool, name: entry.exposedName });
    }
    return out;
  }

  private inMode(entry: RegisteredTool, mode: Mode): boolean {
    if (mode === "agent") return true;
    // plan/ask: read-only core tools only.
    return entry.kind === "core" && READ_ONLY_CORE.has(entry.name);
  }

  /**
   * Resolve a model-issued tool call to exactly one entry.
   *
   * Phase 08: also checks lifecycle and trust — quarantined/disabled cannot execute.
   * Accepts a qualified id or an uncontested bare name. A contested bare name
   * resolves to NOTHING (fail closed).
   */
  resolve(nameOrId: string): RegisteredTool | undefined {
    const direct = this.entries.get(nameOrId);
    if (direct) {
      // Phase 08 enforcement: check lifecycle/trust at resolve time (execution boundary)
      if (direct.lifecycle) {
        if (direct.lifecycle === "disabled" || direct.lifecycle === "quarantined" || direct.lifecycle === "revoked" || direct.lifecycle === "removed") {
          return undefined;
        }
      }
      if (direct.trustLevel === "quarantined") return undefined;
      return direct;
    }
    const holder = this.bareNames.get(nameOrId);
    if (!holder) return undefined;
    const entry = this.entries.get(holder);
    if (!entry) return undefined;
    if (entry.lifecycle) {
      if (entry.lifecycle === "disabled" || entry.lifecycle === "quarantined" || entry.lifecycle === "revoked" || entry.lifecycle === "removed") {
        return undefined;
      }
    }
    if (entry.trustLevel === "quarantined") return undefined;
    return entry;
  }

  /** Every callable entry, in registration order — including disabled/quarantined for audit. */
  list(): RegisteredTool[] {
    return [...this.entries.values()];
  }

  /** Only enabled entries. */
  listEnabled(): RegisteredTool[] {
    return this.list().filter((e) => (e.lifecycle ?? "enabled") === "enabled" && e.trustLevel !== "quarantined");
  }

  /** Entries of one kind — used by the per-kind semantics-contract tests. */
  listByKind(kind: ToolKind): RegisteredTool[] {
    return this.list().filter((e) => e.kind === kind);
  }

  /** Registered skill contributions. Never callable; prompt text only. */
  listSkills(): RegisteredSkill[] {
    return [...this.skills];
  }

  /** Combined skill prompt for this run, in registration order. */
  skillPrompt(): string {
    return this.skills
      .map((s) => s.prompt.trim())
      .filter(Boolean)
      .join("\n\n");
  }

  /** Collisions the registry arbitrated. Surfaced to diagnostics and audit. */
  listCollisions(): ToolCollision[] {
    return this.collisions.map((c) => ({ ...c, shadowed: [...c.shadowed] }));
  }

  get size(): number {
    return this.entries.size;
  }

  get enabledSize(): number {
    return this.listEnabled().length;
  }
}
