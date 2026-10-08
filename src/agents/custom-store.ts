/**
 * Phase 19 — custom (user-authored) agents.
 *
 * A custom agent is a small, versioned JSON document stored at
 * `$XR_HOME/agents/<id>.json`. It is NOT a new runtime: at execution time it
 * is projected onto the same `AgentDefinition` shape the builtin registry
 * uses (role, tool scope, permissions, provider scope), so the agent
 * service, the workflow engine and every picker treat it like any other
 * agent — just with `builtin: false`.
 *
 * Everything that crosses the wire (create / update / import) goes through
 * `validateCustomAgentInput`, which returns field-level problems instead of
 * throwing so the editor can show them inline.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { AgentDefinition, AgentPermissionProfile, AgentRole } from "./types.ts";

export const CUSTOM_AGENT_SCHEMA = "xr-5.0.0/agent-v1" as const;

export const CUSTOM_AGENT_LIMITS = {
  nameMax: 60,
  descriptionMax: 280,
  emojiMax: 8,
  promptMin: 20,
  promptMax: 24_000,
  budgetMinUsd: 0.01,
  budgetMaxUsd: 5,
  toolsMax: 32,
} as const;

/** Constitution overrides a user may set per agent. `destructiveApproval` is always on. */
export interface CustomAgentConstitution {
  askBeforeFileWrites: boolean;
  askBeforeShell: boolean;
  allowPublicWeb: boolean;
  memoryWrite: boolean;
  destructiveApproval: true;
  shareData: boolean;
}

export interface CustomAgentBudget {
  perRunUsd: number;
  perDayUsd: number;
}

export interface CustomAgent {
  schemaVersion: typeof CUSTOM_AGENT_SCHEMA;
  id: string;
  name: string;
  description: string;
  emoji: string;
  role: AgentRole;
  systemPrompt: string;
  tools: string[];
  provider?: string;
  model?: string;
  budget: CustomAgentBudget;
  constitution: CustomAgentConstitution;
  /** Monotonic; bumps on every saved change. */
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Prebuilt agent id this one was duplicated from, if any. */
  basedOn?: string;
}

/** Fields a client may send. Everything else is server-owned. */
export interface CustomAgentInput {
  name: string;
  description?: string;
  emoji?: string;
  role?: AgentRole;
  systemPrompt: string;
  tools?: string[];
  provider?: string | null;
  model?: string | null;
  budget?: Partial<CustomAgentBudget>;
  constitution?: Partial<Omit<CustomAgentConstitution, "destructiveApproval">>;
  basedOn?: string | null;
}

export interface CustomAgentProblem {
  path: string;
  message: string;
}

export type CustomAgentValidation = { ok: true; value: CustomAgentInput } | { ok: false; problems: CustomAgentProblem[] };

export const AGENT_ROLES: readonly AgentRole[] = [
  "supervisor", "planner", "researcher", "builder", "reviewer", "executor", "synthesizer", "verifier",
  "memory_manager", "router", "model_selector", "security_checker", "full_stack", "frontend", "backend",
  "devops", "mobile", "data_ml", "security_analyst", "soc_threat_hunter", "academic_research",
  "market_research", "business_sales", "support_ops",
];

export const DEFAULT_CONSTITUTION: CustomAgentConstitution = {
  askBeforeFileWrites: true,
  askBeforeShell: true,
  allowPublicWeb: false,
  memoryWrite: false,
  destructiveApproval: true,
  shareData: false,
};

export const DEFAULT_BUDGET: CustomAgentBudget = { perRunUsd: 0.5, perDayUsd: 2 };

export class CustomAgentValidationError extends Error {
  readonly problems: CustomAgentProblem[];
  constructor(problems: CustomAgentProblem[]) {
    super(problems.map((p) => `${p.path}: ${p.message}`).join("; ") || "invalid agent");
    this.name = "CustomAgentValidationError";
    this.problems = problems;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/**
 * Validate client-supplied agent fields. `knownTools` is the engine's tool
 * list (`allTools()`); unknown tools are rejected rather than silently
 * dropped so a stale import can't quietly lose capabilities.
 */
export function validateCustomAgentInput(raw: unknown, knownTools: readonly string[]): CustomAgentValidation {
  const problems: CustomAgentProblem[] = [];
  if (!isRecord(raw)) return { ok: false, problems: [{ path: "", message: "agent must be an object" }] };
  const L = CUSTOM_AGENT_LIMITS;

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) problems.push({ path: "name", message: "name is required" });
  else if (name.length > L.nameMax) problems.push({ path: "name", message: `name must be ≤ ${L.nameMax} characters` });

  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (description.length > L.descriptionMax) problems.push({ path: "description", message: `description must be ≤ ${L.descriptionMax} characters` });

  const emoji = typeof raw.emoji === "string" ? raw.emoji.trim() : "";
  if ([...emoji].length > L.emojiMax) problems.push({ path: "emoji", message: `emoji must be ≤ ${L.emojiMax} characters` });

  let role: AgentRole | undefined;
  if (raw.role !== undefined) {
    if (typeof raw.role === "string" && (AGENT_ROLES as readonly string[]).includes(raw.role)) role = raw.role as AgentRole;
    else problems.push({ path: "role", message: "unknown role" });
  }

  const systemPrompt = typeof raw.systemPrompt === "string" ? raw.systemPrompt.trim() : "";
  if (systemPrompt.length < L.promptMin) problems.push({ path: "systemPrompt", message: `system prompt must be at least ${L.promptMin} characters` });
  else if (systemPrompt.length > L.promptMax) problems.push({ path: "systemPrompt", message: `system prompt must be ≤ ${L.promptMax} characters` });

  let tools: string[] = [];
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools) || raw.tools.some((t) => typeof t !== "string")) problems.push({ path: "tools", message: "tools must be a list of tool names" });
    else {
      tools = Array.from(new Set((raw.tools as string[]).map((t) => t.trim()).filter(Boolean)));
      if (tools.length > L.toolsMax) problems.push({ path: "tools", message: `at most ${L.toolsMax} tools` });
      const unknown = tools.filter((t) => !knownTools.includes(t));
      if (unknown.length) problems.push({ path: "tools", message: `unknown tools: ${unknown.join(", ")}` });
    }
  }

  const provider = typeof raw.provider === "string" && raw.provider.trim() ? raw.provider.trim() : undefined;
  const model = typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : undefined;
  if (raw.provider !== undefined && raw.provider !== null && typeof raw.provider !== "string") problems.push({ path: "provider", message: "provider must be a string" });
  if (raw.model !== undefined && raw.model !== null && typeof raw.model !== "string") problems.push({ path: "model", message: "model must be a string" });

  const budget: Partial<CustomAgentBudget> = {};
  if (raw.budget !== undefined) {
    if (!isRecord(raw.budget)) problems.push({ path: "budget", message: "budget must be an object" });
    else {
      for (const key of ["perRunUsd", "perDayUsd"] as const) {
        if (raw.budget[key] === undefined) continue;
        const v = num(raw.budget[key]);
        if (v === undefined || v < L.budgetMinUsd || v > L.budgetMaxUsd) problems.push({ path: `budget.${key}`, message: `must be between $${L.budgetMinUsd} and $${L.budgetMaxUsd}` });
        else budget[key] = Math.round(v * 100) / 100;
      }
    }
  }

  const constitution: Partial<Omit<CustomAgentConstitution, "destructiveApproval">> = {};
  if (raw.constitution !== undefined) {
    if (!isRecord(raw.constitution)) problems.push({ path: "constitution", message: "constitution must be an object" });
    else {
      for (const key of ["askBeforeFileWrites", "askBeforeShell", "allowPublicWeb", "memoryWrite", "shareData"] as const) {
        const v = raw.constitution[key];
        if (v === undefined) continue;
        if (typeof v !== "boolean") problems.push({ path: `constitution.${key}`, message: "must be true or false" });
        else constitution[key] = v;
      }
      if (raw.constitution.destructiveApproval === false) problems.push({ path: "constitution.destructiveApproval", message: "destructive actions always require approval" });
    }
  }

  const basedOn = typeof raw.basedOn === "string" && raw.basedOn.trim() ? raw.basedOn.trim() : undefined;

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    value: { name, description, emoji, role, systemPrompt, tools, provider, model, budget, constitution, basedOn },
  };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "agent";
}

export function mintCustomAgentId(name: string): string {
  return `custom-${slug(name)}-${randomBytes(3).toString("hex")}`;
}

const ID_RE = /^custom-[a-z0-9-]{1,40}$/;

export function isCustomAgentId(id: string): boolean {
  return ID_RE.test(id);
}

export function xrAgentsDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.XR_HOME && env.XR_HOME.trim() ? env.XR_HOME : join(homedir(), ".xr");
  return resolve(home, "agents");
}

/** Project a custom agent onto the engine's `AgentDefinition` shape. */
export function toAgentDefinition(agent: CustomAgent): AgentDefinition & { builtin: false; custom: CustomAgent } {
  const permissions: AgentPermissionProfile = {
    writeFiles: agent.tools.includes("write_file"),
    shell: agent.tools.includes("shell"),
    network: agent.constitution.allowPublicWeb && (agent.tools.includes("fetch_url") || agent.tools.includes("web_search")),
    plugins: false,
    mcp: false,
    memoryRead: true,
    memoryWrite: agent.constitution.memoryWrite,
    computerControl: false,
    secrets: false,
    destructiveExec: false,
  };
  return {
    id: agent.id,
    role: agent.role,
    label: agent.name,
    description: agent.description,
    version: String(agent.version),
    enabledByDefault: true,
    capabilities: agent.tools,
    permissions,
    toolScope: { mode: "allowlist", tools: agent.tools },
    memoryScope: { kind: agent.constitution.memoryWrite ? "project" : "workflow", sharedWithSupervisor: true, maxEntries: 32 },
    providerScope: { ...(agent.provider ? { provider: agent.provider } : {}), ...(agent.model ? { model: agent.model } : {}) },
    builtin: false,
    custom: agent,
  };
}

export interface CustomAgentStoreOptions {
  /** Directory for `<id>.json` files. Defaults to `$XR_HOME/agents`. */
  dir?: string;
  /** Known engine tool names (`allTools().map(t => t.name)`). */
  knownTools: readonly string[];
  now?: () => number;
}

export class CustomAgentStore {
  private readonly dir: string;
  private readonly knownTools: readonly string[];
  private readonly now: () => number;

  constructor(opts: CustomAgentStoreOptions) {
    this.dir = opts.dir ?? xrAgentsDir();
    this.knownTools = opts.knownTools;
    this.now = opts.now ?? (() => Date.now());
  }

  get directory(): string {
    return this.dir;
  }

  list(): CustomAgent[] {
    if (!existsSync(this.dir)) return [];
    const out: CustomAgent[] = [];
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith(".json")) continue;
      const agent = this.readFile(join(this.dir, file));
      if (agent) out.push(agent);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): CustomAgent | undefined {
    if (!isCustomAgentId(id)) return undefined;
    return this.readFile(this.pathFor(id));
  }

  create(raw: unknown): CustomAgent {
    const v = validateCustomAgentInput(raw, this.knownTools);
    if (!v.ok) throw new CustomAgentValidationError(v.problems);
    const now = this.now();
    const agent = this.materialize(v.value, { id: mintCustomAgentId(v.value.name), version: 1, createdAt: now, updatedAt: now });
    this.write(agent);
    return agent;
  }

  /** Full-document update (the editor always sends the whole form). Bumps `version`. */
  update(id: string, raw: unknown): CustomAgent {
    const current = this.get(id);
    if (!current) throw new CustomAgentNotFound(id);
    const merged = isRecord(raw) ? { ...this.toInput(current), ...raw } : raw;
    const v = validateCustomAgentInput(merged, this.knownTools);
    if (!v.ok) throw new CustomAgentValidationError(v.problems);
    const agent = this.materialize(v.value, { id, version: current.version + 1, createdAt: current.createdAt, updatedAt: this.now() }, current);
    this.write(agent);
    return agent;
  }

  remove(id: string): boolean {
    if (!this.get(id)) return false;
    rmSync(this.pathFor(id), { force: true });
    return true;
  }

  /**
   * Import an exported document. The id is kept when it is well-formed and
   * free; otherwise a new one is minted (a re-import never overwrites).
   */
  import(raw: unknown): CustomAgent {
    const v = validateCustomAgentInput(raw, this.knownTools);
    if (!v.ok) throw new CustomAgentValidationError(v.problems);
    const wanted = isRecord(raw) && typeof raw.id === "string" ? raw.id : "";
    const id = isCustomAgentId(wanted) && !this.get(wanted) ? wanted : mintCustomAgentId(v.value.name);
    const now = this.now();
    const agent = this.materialize(v.value, { id, version: 1, createdAt: now, updatedAt: now });
    this.write(agent);
    return agent;
  }

  duplicate(id: string, name?: string): CustomAgent {
    const current = this.get(id);
    if (!current) throw new CustomAgentNotFound(id);
    return this.create({ ...this.toInput(current), name: name ?? `${current.name} copy` });
  }

  /** The editable projection of a stored agent (what `update` merges onto). */
  toInput(agent: CustomAgent): CustomAgentInput {
    return {
      name: agent.name,
      description: agent.description,
      emoji: agent.emoji,
      role: agent.role,
      systemPrompt: agent.systemPrompt,
      tools: [...agent.tools],
      provider: agent.provider ?? null,
      model: agent.model ?? null,
      budget: { ...agent.budget },
      constitution: {
        askBeforeFileWrites: agent.constitution.askBeforeFileWrites,
        askBeforeShell: agent.constitution.askBeforeShell,
        allowPublicWeb: agent.constitution.allowPublicWeb,
        memoryWrite: agent.constitution.memoryWrite,
        shareData: agent.constitution.shareData,
      },
      basedOn: agent.basedOn ?? null,
    };
  }

  private materialize(
    input: CustomAgentInput,
    meta: { id: string; version: number; createdAt: number; updatedAt: number },
    previous?: CustomAgent,
  ): CustomAgent {
    const prevConst = previous?.constitution ?? DEFAULT_CONSTITUTION;
    const prevBudget = previous?.budget ?? DEFAULT_BUDGET;
    return {
      schemaVersion: CUSTOM_AGENT_SCHEMA,
      id: meta.id,
      name: input.name,
      description: input.description ?? "",
      emoji: input.emoji || previous?.emoji || "🤖",
      role: input.role ?? previous?.role ?? "executor",
      systemPrompt: input.systemPrompt,
      tools: input.tools ?? [],
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      budget: {
        perRunUsd: input.budget?.perRunUsd ?? prevBudget.perRunUsd,
        perDayUsd: input.budget?.perDayUsd ?? prevBudget.perDayUsd,
      },
      constitution: {
        askBeforeFileWrites: input.constitution?.askBeforeFileWrites ?? prevConst.askBeforeFileWrites,
        askBeforeShell: input.constitution?.askBeforeShell ?? prevConst.askBeforeShell,
        allowPublicWeb: input.constitution?.allowPublicWeb ?? prevConst.allowPublicWeb,
        memoryWrite: input.constitution?.memoryWrite ?? prevConst.memoryWrite,
        destructiveApproval: true,
        shareData: input.constitution?.shareData ?? prevConst.shareData,
      },
      version: meta.version,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      ...(input.basedOn ? { basedOn: input.basedOn } : previous?.basedOn ? { basedOn: previous.basedOn } : {}),
    };
  }

  private pathFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private readFile(path: string): CustomAgent | undefined {
    if (!existsSync(path)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (!isRecord(parsed) || parsed.schemaVersion !== CUSTOM_AGENT_SCHEMA || typeof parsed.id !== "string") return undefined;
      // Re-validate so a hand-edited file can't smuggle unknown tools in.
      const v = validateCustomAgentInput(parsed, this.knownTools);
      if (!v.ok) return undefined;
      const version = num(parsed.version) ?? 1;
      const createdAt = num(parsed.createdAt) ?? 0;
      const updatedAt = num(parsed.updatedAt) ?? createdAt;
      return this.materialize(v.value, { id: parsed.id, version, createdAt, updatedAt });
    } catch {
      return undefined;
    }
  }

  private write(agent: CustomAgent): void {
    mkdirSync(this.dir, { recursive: true });
    const target = this.pathFor(agent.id);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(agent, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, target);
  }
}

export class CustomAgentNotFound extends Error {
  constructor(id: string) {
    super(`custom agent not found: ${id}`);
    this.name = "CustomAgentNotFound";
  }
}
