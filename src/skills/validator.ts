/** XR 2.1A — Skill Validator. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readSkillManifest } from "./manifest.ts";
import type { SkillManifest } from "./schema.ts";

export interface SkillValidationReport {
  ok: boolean;
  manifest?: SkillManifest;
  dir?: string;
  errors: string[];
  warnings: string[];
}

export class SkillValidator {
  validate(dir: string): SkillValidationReport {
    const loaded = readSkillManifest(dir);
    const warnings: string[] = [];
    if (loaded.manifest && loaded.dir) {
      const m = loaded.manifest;
      if (!existsSync(join(loaded.dir, "xr-skill.json"))) warnings.push("legacy SKILL.md skill has no xr-skill.json; run xr skills migrate");
      if (!m.content.docs.length) warnings.push("no documentation file declared");
      if (!m.content.examples.length) warnings.push("no examples declared");
      if (!m.content.tests.length) warnings.push("no tests declared");
      if (!m.activation.phrases.length && !m.activation.slashCommands.length) warnings.push("no activation phrases or slash commands declared");
      for (const permission of m.permissions) {
        if (permission.dangerous && !permission.reason.trim()) warnings.push(`dangerous permission ${permission.scope} should explain why it is needed`);
      }
      for (const dependency of m.dependencies) {
        if (!dependency.optional && !dependency.reason) warnings.push(`required dependency ${dependency.kind}:${dependency.id} should explain why it is needed`);
      }
    }
    return { ok: loaded.ok, manifest: loaded.manifest, dir: loaded.dir, errors: loaded.errors, warnings };
  }
}
