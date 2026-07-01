/** XR 2.1A — Unified Skill Loader. */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SkillMarketplace } from "./marketplace.ts";
import { installedSkillsDir } from "./marketplace-store.ts";
import type { UnifiedSkillRecord } from "./adapters.ts";
import {
  recordFromSkillDirectory,
  recordsFromLearnedSkills,
  recordsFromMcpBundles,
  recordsFromResearchPacks,
  recordsFromRolePacks,
  type LearnedSkillRow,
} from "./adapters.ts";
import type { McpRegistryEntry } from "../mcp/registry.ts";

function bundledSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");
}

function scanSkillDirs(root: string, source: UnifiedSkillRecord["source"], enabledFor: (id: string) => boolean): UnifiedSkillRecord[] {
  if (!existsSync(root)) return [];
  const rows: UnifiedSkillRecord[] = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const record = recordFromSkillDirectory(dir, source, true);
    if (!record) continue;
    record.enabled = enabledFor(record.manifest.id);
    record.health = record.enabled ? (record.errors.length ? "invalid" : "healthy") : "disabled";
    rows.push(record);
  }
  return rows;
}

export interface SkillLoaderOptions {
  mcpBundles?: McpRegistryEntry[];
  learnedSkills?: LearnedSkillRow[];
  includeResearchPacks?: boolean;
  includeRolePacks?: boolean;
}

export class SkillLoader {
  constructor(private readonly marketplace = new SkillMarketplace()) {}

  load(options: SkillLoaderOptions = {}): UnifiedSkillRecord[] {
    const catalogById = new Map(this.marketplace.catalog().map((entry) => [entry.manifest.id, entry]));
    const bundled = scanSkillDirs(bundledSkillsDir(), "bundled", (id) => catalogById.get(id)?.enabled ?? true);
    const installed = scanSkillDirs(installedSkillsDir(), "installed", (id) => catalogById.get(id)?.enabled ?? true);
    const byId = new Map<string, UnifiedSkillRecord>();
    for (const record of bundled) byId.set(record.manifest.id, record);
    for (const record of installed) byId.set(record.manifest.id, record);
    for (const record of recordsFromMcpBundles(options.mcpBundles ?? [])) byId.set(record.manifest.id, record);
    for (const record of recordsFromLearnedSkills(options.learnedSkills ?? [])) byId.set(record.manifest.id, record);
    if (options.includeResearchPacks !== false) for (const record of recordsFromResearchPacks()) byId.set(record.manifest.id, record);
    if (options.includeRolePacks !== false) for (const record of recordsFromRolePacks()) byId.set(record.manifest.id, record);
    return [...byId.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  }
}
