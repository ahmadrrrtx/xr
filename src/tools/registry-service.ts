/**
 * XR Phase 2 · T2 — `ToolRegistryService`: the single registration and
 * discovery authority for every tool XR can run.
 *
 * Constitution Art. III ("Compliant Designs"): *"A single `ToolRegistryService`
 * where core/plugins/skills/MCP register."* This is that service.
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
 * The service holds no persistent state: it is rebuilt per run from live
 * contributions, so there is no schema to migrate and rollback is trivial.
 */

import type { Mode, Tool } from "../core/types.ts";
import { REMOVED_STUB_TOOLS } from "../computer/system-control.ts";
import {
  NAMESPACE,
  type DiscoveryOptions,
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

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a batch of callable tools from one contribution source.
   * Returns the entries actually registered (retired stubs are refused).
   */
  registerTools(contribution: ToolContribution): RegisteredTool[] {
    const registered: RegisteredTool[] = [];
    for (const tool of contribution.tools) {
      const entry = this.registerOne(contribution.kind, contribution.source, tool);
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
    let shadowed: ShadowReason = "none";
    const holderId = this.bareNames.get(tool.name);

    if (holderId === undefined) {
      this.bareNames.set(tool.name, id);
    } else if (holderId === null) {
      // Name already contested — this entry joins the contest, nobody wins.
      shadowed = "ambiguous";
      this.recordCollision(tool.name, null, id, "ambiguous");
    } else {
      const holder = this.entries.get(holderId);
      if (holder && holder.kind === "core") {
        // Core keeps its name; the contribution stays qualified-only.
        shadowed = "core_reserved";
        this.recordCollision(tool.name, holderId, id, "core_reserved");
      } else if (kind === "core") {
        // Core registered after a contribution (registration order should put
        // core first, but never rely on it): core reclaims the bare name and
        // the earlier contribution becomes qualified-only.
        this.demote(holderId, "core_reserved");
        this.bareNames.set(tool.name, id);
        this.recordCollision(tool.name, id, holderId, "core_reserved");
      } else {
        // Two non-core contributions: neither may own the bare name.
        this.demote(holderId, "ambiguous");
        this.bareNames.set(tool.name, null);
        shadowed = "ambiguous";
        this.recordCollision(tool.name, null, id, "ambiguous");
        this.recordCollision(tool.name, null, holderId, "ambiguous");
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

  // ── Discovery ─────────────────────────────────────────────────────────────

  /**
   * The tools offered to the model for this run.
   *
   * Mode scoping preserves the pre-Phase-2 rule exactly: `agent` gets
   * everything; `plan`/`ask` get the read-only CORE set and no contributions
   * (a plugin or MCP server cannot widen a read-only mode).
   *
   * Every returned `Tool` carries `exposedName` as its `name`, so a shadowed
   * entry is advertised under its qualified id — the model can never be shown
   * a bare name that resolves elsewhere.
   */
  discover(options: DiscoveryOptions): Tool[] {
    const allow = options.allow ? new Set(options.allow) : null;
    const deny = options.deny ? new Set(options.deny) : null;

    const out: Tool[] = [];
    for (const entry of this.entries.values()) {
      if (!this.inMode(entry, options.mode)) continue;
      if (allow && !allow.has(entry.name) && !allow.has(entry.id)) continue;
      if (deny && (deny.has(entry.name) || deny.has(entry.id))) continue;
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
   * Accepts a qualified id or an uncontested bare name. A contested bare name
   * resolves to NOTHING (fail closed) — the caller reports "not available"
   * rather than guessing, which is precisely the behaviour the old
   * `getTool(x) ?? extraToolMap.get(x)` chain lacked.
   */
  resolve(nameOrId: string): RegisteredTool | undefined {
    const direct = this.entries.get(nameOrId);
    if (direct) return direct;
    const holder = this.bareNames.get(nameOrId);
    if (!holder) return undefined;
    return this.entries.get(holder);
  }

  /** Every callable entry, in registration order. */
  list(): RegisteredTool[] {
    return [...this.entries.values()];
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
}
