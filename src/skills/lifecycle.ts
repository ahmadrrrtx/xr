/** XR 2.1A — Skill Lifecycle Manager. */
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SkillMarketplace } from "./marketplace.ts";
import { readSkillManifest } from "./manifest.ts";
import { SkillInstaller } from "./installer.ts";
import { SkillRegistry } from "./registry.ts";
import { SkillValidator } from "./validator.ts";

export interface SkillMigrationResult {
  scanned: number;
  migrated: Array<{ id: string; file: string }>;
  skipped: Array<{ dir: string; reason: string }>;
}

export class SkillLifecycleManager {
  private readonly installer: SkillInstaller;
  private readonly validator = new SkillValidator();

  constructor(private readonly marketplace: SkillMarketplace, private readonly registry: SkillRegistry) {
    this.installer = new SkillInstaller(marketplace);
  }

  list() { return this.registry.refresh(); }
  inspect(id: string) { return this.registry.get(id); }
  validate(dir: string) { return this.validator.validate(dir); }
  enable(id: string) { return this.marketplace.enable(id); }
  disable(id: string) { return this.marketplace.disable(id); }
  installLocal(dir: string, options = {}) { return this.installer.installLocal(dir, options); }
  remove(id: string) { return this.installer.remove(id); }

  migrate(root: string): SkillMigrationResult {
    const result: SkillMigrationResult = { scanned: 0, migrated: [], skipped: [] };
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (!st.isDirectory()) continue;
        const skillMd = join(p, "SKILL.md");
        const manifestFile = join(p, "xr-skill.json");
        if (existsSync(skillMd)) {
          result.scanned += 1;
          if (existsSync(manifestFile)) {
            result.skipped.push({ dir: p, reason: "xr-skill.json already exists" });
          } else {
            const loaded = readSkillManifest(p);
            if (!loaded.ok || !loaded.manifest) result.skipped.push({ dir: p, reason: loaded.errors.join("; ") || "invalid skill" });
            else {
              writeFileSync(manifestFile, JSON.stringify(loaded.manifest, null, 2));
              result.migrated.push({ id: loaded.manifest.id, file: manifestFile });
            }
          }
        } else {
          walk(p);
        }
      }
    };
    walk(root);
    this.registry.refresh();
    return result;
  }

  doctor() {
    const records = this.registry.refresh();
    const invalid = records.filter((record) => record.health === "invalid" || record.errors.length > 0);
    const warnings = records.flatMap((record) => record.warnings.map((warning) => `${record.manifest.id}: ${warning}`));
    return { ...this.registry.health(), invalidSkills: invalid.map((record) => ({ id: record.manifest.id, errors: record.errors })), warnings };
  }
}
