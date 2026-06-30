/** XR Stage 13 — Skill Service lifecycle integration. */
import type { LifecycleHook } from "../core/lifecycle.ts";
import { SkillMarketplace, type SkillCatalogEntry, type SkillInstallOptions, type SkillSearchOptions } from "../skills/marketplace.ts";
import { SkillSDK, type SkillCreateOptions } from "../skills/sdk.ts";
import { SkillMarketplaceStore } from "../skills/marketplace-store.ts";

export class SkillService implements LifecycleHook {
  private readonly store = new SkillMarketplaceStore();
  private readonly marketplace = new SkillMarketplace(this.store);
  private readonly sdk = new SkillSDK(this.marketplace);

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
  validate(dir: string) { return this.marketplace.validate(dir); }
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
    return { total: catalog.length, installed, enabled, official, dangerous };
  }
  executionContext(task: string, limit?: number) { return this.marketplace.executionContext(task, limit); }

  async onInit(): Promise<void> {}
  async onStart(): Promise<void> {}
  async onStop(): Promise<void> {}
}
