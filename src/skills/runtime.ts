/** XR 2.1A — Unified Skill Runtime. */
import { SkillMarketplace } from "./marketplace.ts";
import { SkillLoader } from "./loader-runtime.ts";
import { SkillRegistry } from "./registry.ts";
import { SkillResolver } from "./resolver.ts";
import { SkillLifecycleManager } from "./lifecycle.ts";
import { SkillDependencyResolver } from "./dependencies.ts";
import { SkillPermissionManager } from "./permissions.ts";
import { readSkillInstructions } from "./manifest.ts";
import type { UnifiedSkillRecord } from "./adapters.ts";
import type { SkillInstallation } from "./schema.ts";

export interface SkillRuntimeContext {
  records: UnifiedSkillRecord[];
  prompt: string;
}

export class UnifiedSkillRuntime {
  readonly marketplace: SkillMarketplace;
  readonly loader: SkillLoader;
  readonly registry: SkillRegistry;
  readonly resolver: SkillResolver;
  readonly lifecycle: SkillLifecycleManager;
  readonly permissions = new SkillPermissionManager();

  constructor(marketplace = new SkillMarketplace()) {
    this.marketplace = marketplace;
    this.loader = new SkillLoader(marketplace);
    this.registry = new SkillRegistry(this.loader);
    this.resolver = new SkillResolver(this.registry);
    this.lifecycle = new SkillLifecycleManager(marketplace, this.registry);
  }

  list(): UnifiedSkillRecord[] { return this.registry.refresh(); }
  inspect(id: string): UnifiedSkillRecord | undefined { return this.registry.get(id); }
  search(query: string, limit = 10): UnifiedSkillRecord[] { return this.registry.search(query, limit); }
  resolve(task: string, limit = 4) { return this.resolver.resolve(task, limit); }

  dependencyReport(skillId: string) {
    return new SkillDependencyResolver(this.registry.list()).resolve(skillId);
  }

  permissionReport(skillId: string, installation?: SkillInstallation) {
    const record = this.registry.get(skillId);
    if (!record) return null;
    return this.permissions.report(record.manifest, installation);
  }

  executionContext(task: string, limit = 4): SkillRuntimeContext {
    const result = this.resolve(task, limit);
    const records = result.selected;
    const index = this.registry
      .list()
      .filter((record) => record.enabled && record.health === "healthy")
      .slice(0, 100)
      .map((record) => `- ${record.manifest.id}: ${record.manifest.description} [${record.kind}; ${record.manifest.categories.join(", ")}]`)
      .join("\n");

    const loaded = records.map((record) => {
      const body = record.dir.includes(":") ? record.manifest.description : readSkillInstructions(record.dir, record.manifest);
      const deps = new SkillDependencyResolver(this.registry.list()).resolve(record.manifest.id);
      const perms = this.permissions.report(record.manifest);
      return [
        `## Active Skill: ${record.manifest.name} (${record.manifest.id})`,
        `Adapter: ${record.kind}`,
        body,
        `Declared tools: ${record.manifest.tools.join(", ") || "none"}`,
        `Dependencies: ${deps.statuses.map((s) => `${s.dependency.kind}:${s.dependency.id}=${s.satisfied ? "ok" : "missing"}`).join(", ") || "none"}`,
        `Permissions: ${[...perms.safe, ...perms.dangerous].map((p) => `${p.scope}${p.dangerous ? "!" : ""}`).join(", ") || "none"}`,
      ].join("\n");
    }).join("\n\n");

    return {
      records,
      prompt: [
        "XR 2.1A Unified Skill Runtime",
        "Skills orchestrate reusable expertise. Core systems, plugins, MCP, providers, memory, voice, research, computer control, and multi-agent remain execution substrates. A Skill may guide use of substrates, but it never bypasses XR safety, approvals, budgets, egress controls, memory policy, or audit logging.",
        index ? `Available Skill Index:\n${index}` : "No enabled skills are available.",
        loaded ? `Loaded Relevant Skills:\n${loaded}` : "No relevant Skill was selected for this task.",
      ].join("\n\n"),
    };
  }

  health() {
    const registry = this.registry.refresh();
    const dependencyReports = new SkillDependencyResolver(registry).resolveAll();
    const missingRequired = dependencyReports.flatMap((report) => report.requiredMissing.map((missing) => `${report.skillId}:${missing.dependency.kind}:${missing.dependency.id}`));
    return { ...this.registry.health(), missingRequired };
  }
}
