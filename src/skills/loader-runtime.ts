/** XR 2.1A — Unified Skill Loader. */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SkillMarketplace } from "./marketplace.ts";
import { installedSkillsDir, registryFilePath } from "./marketplace-store.ts";
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
import { cachedScan } from "../util/scan-cache.ts";

export function bundledSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");
}

/** Scan without marketplace state (cacheable): raw records, enabled=true. */
function scanSkillDirsRaw(root: string, source: UnifiedSkillRecord["source"]): UnifiedSkillRecord[] {
  if (!existsSync(root)) return [];
  const rows: UnifiedSkillRecord[] = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const record = recordFromSkillDirectory(dir, source, true);
    if (!record) continue;
    rows.push(record);
  }
  return rows;
}

function applyEnabled(records: UnifiedSkillRecord[], enabledFor: (id: string) => boolean): UnifiedSkillRecord[] {
  for (const record of records) {
    record.enabled = enabledFor(record.manifest.id);
    record.health = record.enabled ? (record.errors.length ? "invalid" : "healthy") : "disabled";
  }
  return records;
}

/**
 * Phase 3 · T4 — content-addressed incremental scan of the bundled +
 * installed skill trees. Warm boots with an unchanged tree serve the cached
 * parse (no per-file reads); the marketplace registry file is part of the
 * fingerprint so enable/disable state changes invalidate correctly.
 */
function scanBundledAndInstalled(): { bundled: UnifiedSkillRecord[]; installed: UnifiedSkillRecord[] } {
  return cachedScan({
    cacheId: "skills-records",
    roots: [bundledSkillsDir(), installedSkillsDir()],
    files: [registryFilePath()],
    load: () => ({
      bundled: scanSkillDirsRaw(bundledSkillsDir(), "bundled"),
      installed: scanSkillDirsRaw(installedSkillsDir(), "installed"),
    }),
  }).value;
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
    const enabledFor = (id: string) => catalogById.get(id)?.enabled ?? true;
    const { bundled, installed } = scanBundledAndInstalled();
    const byId = new Map<string, UnifiedSkillRecord>();
    for (const record of applyEnabled(bundled, enabledFor)) byId.set(record.manifest.id, record);
    for (const record of applyEnabled(installed, enabledFor)) byId.set(record.manifest.id, record);
    for (const record of bundled) byId.set(record.manifest.id, record);
    for (const record of installed) byId.set(record.manifest.id, record);
    for (const record of recordsFromMcpBundles(options.mcpBundles ?? [])) byId.set(record.manifest.id, record);
    for (const record of recordsFromLearnedSkills(options.learnedSkills ?? [])) byId.set(record.manifest.id, record);
    if (options.includeResearchPacks !== false) for (const record of recordsFromResearchPacks()) byId.set(record.manifest.id, record);
    if (options.includeRolePacks !== false) for (const record of recordsFromRolePacks()) byId.set(record.manifest.id, record);
    return [...byId.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  }
}
