/** XR 2.1A — Skill Installer. */
import { existsSync } from "node:fs";
import { SkillMarketplace, type SkillInstallOptions } from "./marketplace.ts";
import type { SkillInstallation } from "./schema.ts";
import { SkillValidator } from "./validator.ts";

export class SkillInstaller {
  private readonly validator = new SkillValidator();

  constructor(private readonly marketplace: SkillMarketplace) {}

  installLocal(dir: string, options: SkillInstallOptions = {}): SkillInstallation {
    if (!existsSync(dir)) throw new Error(`local skill directory not found: ${dir}`);
    const validation = this.validator.validate(dir);
    if (!validation.ok) throw new Error(`invalid skill: ${validation.errors.join("; ")}`);
    return this.marketplace.install(dir, { enable: true, ...options });
  }

  remove(id: string): boolean {
    return this.marketplace.remove(id);
  }
}
