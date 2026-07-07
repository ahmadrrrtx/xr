/** XR 2.1C — Marketplace dependency solver for online Skill installs. */
import type { OnlineSkillVersion, SkillInstallPlan, SkillRegistryEndpoint } from "./marketplace-backend-types.ts";
import { SkillVersionResolver } from "./version-resolver.ts";

export class MarketplaceDependencySolver {
  constructor(private readonly resolver = new SkillVersionResolver()) {}

  solve(root: OnlineSkillVersion, registry: SkillRegistryEndpoint): SkillInstallPlan {
    const warnings: string[] = [];
    const dependencies: OnlineSkillVersion[] = [];
    const seen = new Set<string>([root.id]);

    const visit = (version: OnlineSkillVersion): void => {
      const deps = version.dependencies ?? version.manifest.dependencies ?? [];
      for (const dep of deps) {
        if (dep.kind !== "skill") {
          if (!dep.optional) warnings.push(`non-skill dependency must be satisfied by runtime/operator: ${dep.kind}:${dep.id}`);
          continue;
        }
        if (seen.has(dep.id)) continue;
        const resolved = this.resolver.resolve({ id: dep.id, range: dep.version, registryId: registry.id });
        if (!resolved.ok || !resolved.version) {
          if (dep.optional) warnings.push(`optional skill dependency not resolved: ${dep.id}@${dep.version ?? "latest"}`);
          else throw new Error(`required skill dependency not resolved: ${dep.id}@${dep.version ?? "latest"} (${resolved.reason})`);
          continue;
        }
        seen.add(dep.id);
        dependencies.push(resolved.version);
        visit(resolved.version);
      }
    };

    visit(root);
    return { root, registry, dependencies, warnings };
  }
}
