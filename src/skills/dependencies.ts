/** XR 2.1A — Skill Dependency Resolver. */
import { spawnSync } from "node:child_process";
import type { SkillDependency } from "./schema.ts";
import type { UnifiedSkillRecord } from "./adapters.ts";

export interface SkillDependencyStatus {
  dependency: SkillDependency;
  satisfied: boolean;
  reason: string;
}

export interface SkillDependencyReport {
  skillId: string;
  ok: boolean;
  requiredMissing: SkillDependencyStatus[];
  optionalMissing: SkillDependencyStatus[];
  statuses: SkillDependencyStatus[];
}

function hasBinary(id: string): boolean {
  const cmd = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [id] : ["-v", id];
  const res = spawnSync(cmd, args, { stdio: "ignore", shell: process.platform !== "win32", timeout: 1500 });
  return res.status === 0;
}

export class SkillDependencyResolver {
  constructor(
    private readonly records: UnifiedSkillRecord[],
    private readonly substrateState: {
      plugins?: Set<string>;
      mcp?: Set<string>;
      providers?: Set<string>;
      models?: Set<string>;
    } = {},
  ) {}

  private status(dep: SkillDependency): SkillDependencyStatus {
    switch (dep.kind) {
      case "skill": {
        const found = this.records.some((r) => r.manifest.id === dep.id && r.enabled);
        return { dependency: dep, satisfied: found, reason: found ? "skill enabled" : "required skill not enabled or not installed" };
      }
      case "plugin": {
        const found = this.substrateState.plugins?.has(dep.id) ?? false;
        return { dependency: dep, satisfied: found || dep.optional, reason: found ? "plugin available" : "plugin availability is not confirmed by runtime" };
      }
      case "mcp": {
        const found = this.substrateState.mcp?.has(dep.id) ?? false;
        const virtual = this.records.some((r) => r.manifest.id === `mcp:${dep.id}` && r.enabled);
        return { dependency: dep, satisfied: found || virtual || dep.optional, reason: found || virtual ? "MCP server available" : "MCP server is not enabled" };
      }
      case "provider": {
        const found = this.substrateState.providers?.has(dep.id) ?? false;
        return { dependency: dep, satisfied: found || dep.optional, reason: found ? "provider available" : "provider availability is not confirmed by runtime" };
      }
      case "binary": {
        const found = hasBinary(dep.id);
        return { dependency: dep, satisfied: found || dep.optional, reason: found ? "binary found on PATH" : "binary not found on PATH" };
      }
      case "model": {
        const found = this.substrateState.models?.has(dep.id) ?? false;
        return { dependency: dep, satisfied: found || dep.optional, reason: found ? "model registered" : "model availability is not confirmed by runtime" };
      }
      case "npm":
      case "python":
      case "memory-template":
        return { dependency: dep, satisfied: dep.optional, reason: dep.optional ? "optional dependency not checked in Phase A" : "dependency requires installer/SDK phase resolution" };
      default: {
        const neverDep: never = dep.kind;
        return { dependency: dep, satisfied: false, reason: `unknown dependency kind ${neverDep}` };
      }
    }
  }

  resolve(skillId: string): SkillDependencyReport {
    const record = this.records.find((r) => r.manifest.id === skillId);
    if (!record) {
      return { skillId, ok: false, requiredMissing: [], optionalMissing: [], statuses: [] };
    }
    const statuses = record.manifest.dependencies.map((dep) => this.status(dep));
    const requiredMissing = statuses.filter((s) => !s.satisfied && !s.dependency.optional);
    const optionalMissing = statuses.filter((s) => !s.satisfied && s.dependency.optional);
    return { skillId, ok: requiredMissing.length === 0, requiredMissing, optionalMissing, statuses };
  }

  resolveAll(): SkillDependencyReport[] {
    return this.records.map((r) => this.resolve(r.manifest.id));
  }
}
