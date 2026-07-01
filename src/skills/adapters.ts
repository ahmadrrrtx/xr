/**
 * XR 2.1A — compatibility adapters for the Unified Skill Runtime.
 *
 * These adapters do not replace existing systems. They create Skill-shaped views
 * over reusable expertise that already exists in XR, so the runtime can resolve
 * and orchestrate it through one interface while plugins, MCP, research, memory,
 * voice, computer control, and multi-agent remain execution substrates.
 */
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { SkillManifest } from "./schema.ts";
import { readSkillManifest } from "./manifest.ts";
import type { LoadedSkill } from "./loader.ts";
import type { McpRegistryEntry } from "../mcp/registry.ts";
import type { AgentDefinition } from "../agents/types.ts";
import { listAgents } from "../agents/registry.ts";

export type SkillAdapterKind =
  | "xr-manifest"
  | "legacy-markdown"
  | "plugin-skill"
  | "mcp-bundle"
  | "learned-skill"
  | "research-pack"
  | "role-pack";

export interface UnifiedSkillRecord {
  manifest: SkillManifest;
  dir: string;
  kind: SkillAdapterKind;
  source: "bundled" | "installed" | "local" | "plugin" | "mcp" | "learned" | "virtual";
  enabled: boolean;
  installed: boolean;
  health: "healthy" | "disabled" | "invalid" | "missing-dependency";
  errors: string[];
  warnings: string[];
}

function perm(scope: SkillManifest["permissions"][number]["scope"], reason: string, dangerous: boolean): SkillManifest["permissions"][number] {
  return { scope, reason, dangerous, optional: false, paths: [], domains: [] };
}

function titleCase(id: string): string {
  return id
    .replace(/^@/, "")
    .split(/[\s_:/.-]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function virtualManifest(input: {
  id: string;
  name?: string;
  description: string;
  category: SkillManifest["categories"][number];
  tags?: string[];
  publisher?: string;
  tools?: string[];
  permissions?: SkillManifest["permissions"];
  workflows?: SkillManifest["contributions"]["workflows"];
}): SkillManifest {
  const id = input.id.toLowerCase().replace(/[^a-z0-9@/._:-]+/g, "-");
  return {
    schemaVersion: 1,
    id,
    name: input.name ?? titleCase(id),
    version: "1.0.0",
    description: input.description,
    publisher: input.publisher ?? "xr-compat",
    license: "MIT",
    categories: [input.category],
    tags: input.tags ?? [],
    keywords: [...(input.tags ?? []), id, input.name ?? titleCase(id)],
    compatibility: { xr: ">=1.0.0", os: ["any"], providers: [], modes: ["agent", "plan", "ask"] },
    activation: { phrases: [id, input.name ?? titleCase(id), ...(input.tags ?? [])], intents: [id], fileGlobs: [], slashCommands: [id.replace(/[/:_]/g, "-")], auto: true },
    content: { instructions: "SKILL.md", knowledge: [], promptTemplates: [], examples: [], tests: [], docs: [], assets: [] },
    contributions: {
      commands: [{ name: id.replace(/[/:_]/g, "-"), title: input.name ?? titleCase(id), description: input.description, prompt: `Use ${input.name ?? titleCase(id)} capability through XR's unified skill runtime.` }],
      voiceIntents: [],
      chatActions: [{ id, title: input.name ?? titleCase(id), description: input.description, requiredPermissions: [] }],
      slashCommands: [{ name: id.replace(/[/:_]/g, "-"), title: `/${id.replace(/[/:_]/g, "-")}`, description: input.description }],
      computerActions: [],
      researchModes: [],
      planners: [],
      agentBehaviors: [],
      workflows: input.workflows ?? [],
      uiPanels: [],
      dashboardWidgets: [],
    },
    tools: input.tools ?? [],
    mcp: [],
    plugins: [],
    memoryTemplates: [],
    dependencies: [],
    permissions: input.permissions ?? [],
    settings: [],
    verification: { level: "community" },
  };
}

export function recordFromSkillDirectory(dir: string, source: UnifiedSkillRecord["source"], enabled = true): UnifiedSkillRecord | null {
  const loaded = readSkillManifest(dir);
  if (!loaded.manifest || !loaded.dir) {
    return loaded.errors.length
      ? {
          manifest: virtualManifest({ id: basename(dir), description: `Invalid skill at ${dir}`, category: "productivity" }),
          dir,
          kind: "legacy-markdown",
          source,
          enabled: false,
          installed: source !== "local",
          health: "invalid",
          errors: loaded.errors,
          warnings: [],
        }
      : null;
  }
  const hasManifest = existsSync(join(loaded.dir, "xr-skill.json"));
  return {
    manifest: loaded.manifest,
    dir: loaded.dir,
    kind: hasManifest ? "xr-manifest" : "legacy-markdown",
    source,
    enabled,
    installed: source !== "local",
    health: enabled ? "healthy" : "disabled",
    errors: loaded.ok ? [] : loaded.errors,
    warnings: hasManifest ? [] : ["legacy SKILL.md compatibility adapter active; run xr skills migrate to create xr-skill.json"],
  };
}

export function recordsFromPluginSkills(pluginId: string, skills: LoadedSkill[], enabled = true): UnifiedSkillRecord[] {
  return skills.map((skill) => ({
    manifest: virtualManifest({
      id: `plugin:${pluginId}/${skill.id}`,
      name: titleCase(skill.id),
      description: `Skill contributed by plugin ${pluginId}.`,
      category: "workflow",
      tags: ["plugin", pluginId, ...skill.tools],
      publisher: pluginId,
      tools: skill.tools,
      permissions: [perm("skill:execute", `Execute plugin skill ${skill.id} through plugin ${pluginId}.`, false)],
    }),
    dir: `plugin:${pluginId}`,
    kind: "plugin-skill",
    source: "plugin",
    enabled,
    installed: true,
    health: enabled ? "healthy" : "disabled",
    errors: [],
    warnings: [],
  }));
}

export function recordsFromMcpBundles(entries: McpRegistryEntry[]): UnifiedSkillRecord[] {
  return entries.map((entry) => ({
    manifest: {
      ...virtualManifest({
        id: `mcp:${entry.id}`,
        name: entry.name || titleCase(entry.id),
        description: entry.description || `MCP bundle ${entry.id} exposed as an XR Skill capability surface.`,
        category: "mcp",
        tags: ["mcp", entry.transport, entry.source, ...(entry.tools ?? []).map((t) => t.name)],
        publisher: entry.source,
        tools: (entry.tools ?? []).map((t) => `mcp.${entry.id}.${t.name}`),
        permissions: [perm("mcp", `Use MCP server ${entry.id} through XR's MCP platform.`, true)],
      }),
      mcp: [{ id: entry.id, required: true, tools: (entry.tools ?? []).map((t) => t.name), reason: `Runtime MCP bundle for ${entry.name}` }],
    },
    dir: `mcp:${entry.id}`,
    kind: "mcp-bundle",
    source: "mcp",
    enabled: entry.enabled,
    installed: true,
    health: entry.enabled ? (entry.health === "healthy" || entry.health === "unknown" ? "healthy" : "missing-dependency") : "disabled",
    errors: entry.health === "error" || entry.health === "unreachable" ? [entry.healthDetail ?? entry.health] : [],
    warnings: entry.health === "unknown" ? ["MCP health has not been checked yet"] : [],
  }));
}

export interface LearnedSkillRow {
  id: string;
  version: number;
  source: string;
  why: string | null;
  active: number;
}

export function recordsFromLearnedSkills(rows: LearnedSkillRow[]): UnifiedSkillRecord[] {
  return rows.map((row) => ({
    manifest: virtualManifest({
      id: `learned:${row.id}`,
      name: titleCase(row.id),
      description: row.why || `Learned XR skill ${row.id}, preserved by the non-regressive skill engine.`,
      category: "workflow",
      tags: ["learned", row.source],
      publisher: "xr-autolearn",
      permissions: [perm("skill:execute", `Replay learned behavior ${row.id}.`, false)],
    }),
    dir: `learned:${row.id}`,
    kind: "learned-skill",
    source: "learned",
    enabled: row.active === 1,
    installed: true,
    health: row.active === 1 ? "healthy" : "disabled",
    errors: [],
    warnings: [],
  }));
}

export function recordsFromResearchPacks(): UnifiedSkillRecord[] {
  const packs = [
    ["research:deep", "Deep Research Pack", "Plan, search, rank, synthesize, and report research through XR's Research Engine."],
    ["research:academic", "Academic Research Pack", "Academic source discovery, paper analysis, citation-aware synthesis, and uncertainty tracking."],
    ["research:market", "Market Research Pack", "Market, competitor, segment, and positioning research using XR's Research Engine."],
  ] as const;
  return packs.map(([id, name, description]) => ({
    manifest: virtualManifest({
      id,
      name,
      description,
      category: "research",
      tags: ["research", "pack", "substrate"],
      publisher: "xr-core",
      tools: ["research"],
      permissions: [perm("net", `${name} may use approved research/search egress.`, true)],
    }),
    dir: id,
    kind: "research-pack",
    source: "virtual",
    enabled: true,
    installed: true,
    health: "healthy",
    errors: [],
    warnings: [],
  }));
}

function recordFromAgent(agent: AgentDefinition): UnifiedSkillRecord {
  return {
    manifest: virtualManifest({
      id: `role:${agent.id}`,
      name: agent.label,
      description: agent.description,
      category: "agent",
      tags: ["role", agent.role, ...agent.capabilities],
      publisher: "xr-core",
      tools: agent.toolScope.mode === "allowlist" ? agent.toolScope.tools : [],
      permissions: [perm("skill:execute", `Use role behavior ${agent.label} through the multi-agent runtime.`, false)],
      workflows: [{
        id: `role:${agent.id}:workflow`,
        title: `${agent.label} role workflow`,
        description: agent.description,
        steps: [
          { id: "scope", title: "Scope", instruction: `Operate only within the ${agent.role} role and declared tool scope.`, expectedOutput: "Scoped plan" },
          { id: "execute", title: "Execute", instruction: `Execute as ${agent.label}. Capabilities: ${agent.capabilities.join(", ")}. Tool scope: ${agent.toolScope.mode} ${agent.toolScope.tools.join(", ") || "none"}.`, expectedOutput: "Role-specific output" },
          { id: "handoff", title: "Handoff", instruction: "Summarize decisions, risks, and downstream handoff requirements.", expectedOutput: "Handoff summary" },
        ],
      }],
    }),
    dir: `role:${agent.id}`,
    kind: "role-pack",
    source: "virtual",
    enabled: true,
    installed: true,
    health: "healthy",
    errors: [],
    warnings: [],
  };
}

export function recordsFromRolePacks(): UnifiedSkillRecord[] {
  try {
    return listAgents().map(recordFromAgent);
  } catch {
    return [];
  }
}
