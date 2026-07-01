/** XR 2.1A — Skill Resolver. */
import type { UnifiedSkillRecord } from "./adapters.ts";
import { SkillRegistry } from "./registry.ts";

export interface SkillResolveResult {
  task: string;
  selected: UnifiedSkillRecord[];
  considered: Array<{ id: string; enabled: boolean; health: string; reason: string }>;
}

export class SkillResolver {
  constructor(private readonly registry: SkillRegistry) {}

  resolve(task: string, limit = 4): SkillResolveResult {
    const selected = this.registry.search(task, Math.max(limit * 2, 8)).filter((record) => record.enabled && record.health === "healthy").slice(0, limit);
    const considered = this.registry.search(task, 12).map((record) => ({
      id: record.manifest.id,
      enabled: record.enabled,
      health: record.health,
      reason: record.enabled ? "matched local search index" : "matched but disabled",
    }));
    return { task, selected, considered };
  }
}
