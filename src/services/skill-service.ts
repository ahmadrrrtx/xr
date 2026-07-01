/** XR 2.1A — Unified Skill Service lifecycle integration. */
import type { LifecycleHook } from "../core/lifecycle.ts";
import { SkillMarketplace, type SkillCatalogEntry, type SkillInstallOptions, type SkillSearchOptions } from "../skills/marketplace.ts";
import { SkillSDK, type SkillCreateOptions } from "../skills/sdk.ts";
import { SkillMarketplaceStore } from "../skills/marketplace-store.ts";
import { UnifiedSkillRuntime } from "../skills/runtime.ts";

export class SkillService implements LifecycleHook {
  private readonly store = new SkillMarketplaceStore();
  private readonly marketplace = new SkillMarketplace(this.store);
  private readonly sdk = new SkillSDK(this.marketplace);
  private readonly runtime = new UnifiedSkillRuntime(this.marketplace);

  // XR 2.1A unified runtime API.
  listUnified() { return this.runtime.list(); }
  inspectUnified(id: string) { return this.runtime.inspect(id); }
  searchUnified(query: string, limit?: number) { return this.runtime.search(query, limit); }
  resolve(task: string, limit?: number) { return this.runtime.resolve(task, limit); }
  dependencyReport(id: string) { return this.runtime.dependencyReport(id); }
  permissionReport(id: string) { return this.runtime.permissionReport(id); }
  runtimeHealth() { return this.runtime.health(); }
  migrate(root: string) { return this.runtime.lifecycle.migrate(root); }
  installLocal(dir: string, options?: SkillInstallOptions) { return this.runtime.lifecycle.installLocal(dir, options); }

  // Stage 13 marketplace/package API retained for backward compatibility.
  catalog(): SkillCatalogEntry[] { return this.marketplace.catalog(); }
  search(options: SkillSearchOptions = {}): SkillCatalogEntry[] { return this.marketplace.search(options); }
  get(id: string): SkillCatalogEntry | undefined { return this.marketplace.get(id); }
  recommendations(task: string, limit?: number): SkillCatalogEntry[] { return this.marketplace.recommendations(task, limit); }
  similar(id: string, limit?: number): SkillCatalogEntry[] { return this.marketplace.similar(id, limit); }
  requiredSkills(id: string): string[] { return this.marketplace.requiredSkills(id); }
  install(source: string, options?: SkillInstallOptions) { return this.marketplace.install(source, options); }
  update(id: string, options?: SkillInstallOptions) { return this.marketplace.update(id, options); }
  remove(id: string) { return this.marketplace.remove(id); }
  enable(id: string) { return this.marketplace.enable(id); }
  disable(id: string) { return this.marketplace.disable(id); }
  favorite(id: string, value: boolean) { return this.marketplace.favorite(id, value); }
  pin(id: string, value: boolean) { return this.marketplace.pin(id, value); }
  rollback(id: string, version?: string) { return this.marketplace.rollback(id, version); }
  export(id: string, outFile?: string) { return this.marketplace.export(id, outFile); }
  importPackage(file: string, options?: SkillInstallOptions) { return this.marketplace.importPackage(file, options); }
  validate(dir: string) { return this.runtime.lifecycle.validate(dir); }
  package(dir: string, outFile?: string) { return this.marketplace.package(dir, outFile); }
  publish(dir: string, outDir?: string) { return this.marketplace.publish(dir, outDir); }
  create(options: SkillCreateOptions) { return this.sdk.create(options); }
  test(dir: string) { return this.sdk.test(dir); }
  doctor() {
    const catalog = this.catalog();
    const installed = catalog.filter((s) => s.installed).length;
    const enabled = catalog.filter((s) => s.enabled).length;
    const official = catalog.filter((s) => s.manifest.verification.level === "official").length;
    const dangerous = catalog.flatMap((s) => s.manifest.permissions.filter((p) => p.dangerous).map((p) => `${s.manifest.id}:${p.scope}`));
    const runtime = this.runtime.health();
    return { total: catalog.length, installed, enabled, official, dangerous, runtime };
  }
  executionContext(task: string, limit?: number) { return this.runtime.executionContext(task, limit); }

  async onInit(): Promise<void> {}
  async onStart(): Promise<void> { this.runtime.list(); }
  async onStop(): Promise<void> {}
}
