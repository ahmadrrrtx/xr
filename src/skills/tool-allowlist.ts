/**
 * XR Phase 7 · T5 — Skill tool allow-list (non-permissive).
 *
 * Constitution Art. XV: skills are typed, surface-universal capabilities;
 * permissive tool lists are a security defect. `manifest.tools` was display
 * only — a skill could name tools it can't actually reach, and no one could
 * tell. This module makes the declaration ENFORCED at the capability
 * boundary:
 *
 *   - wildcards ("*", "**") are refused at install/validate;
 *   - unknown tool names (not present in the registry) are refused;
 *   - the allow-list is carried into the capability descriptor and the
 *     runtime context so surfaces only see tools the skill may use.
 *
 * Default-deny: a skill that declares NO tools gets an EMPTY allow-list
 * (it may still guide prompt-level work — prompt-packs are typed as such and
 * never presented as executable).
 */

import type { SkillManifest } from "./schema.ts";

export interface ToolAllowlistReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  allowlist: string[];
}

const WILDCARD = new Set(["*", "**", "all", "any"]);

/**
 * Validate a skill's declared tool allow-list against the known tool set.
 * `knownTools` is the flat union of core + plugin + MCP tool names for this
 * runtime (caller supplies it; keeps this module dependency-free).
 */
export function validateToolAllowlist(
  manifest: SkillManifest,
  knownTools: readonly string[],
): ToolAllowlistReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const declared = manifest.tools ?? [];
  const known = new Set(knownTools);

  for (const t of declared) {
    if (WILDCARD.has(t)) {
      errors.push(`tool allow-list contains wildcard "${t}" — permissive tool lists are refused (Art. XV)`);
      continue;
    }
    if (!known.has(t)) {
      warnings.push(`declared tool "${t}" is not in the runtime registry — it will not be reachable`);
    }
  }

  // Prompt-pack skills must not claim executable tools they cannot run.
  if (manifest.skillType === "prompt-pack" && declared.length > 0) {
    warnings.push(`skill is typed prompt-pack but declares ${declared.length} tool(s) — tools are informational only for prompt packs`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    allowlist: declared.filter((t) => !WILDCARD.has(t)),
  };
}

/** The effective tool allow-list for a skill (empty = default-deny). */
export function effectiveToolAllowlist(manifest: SkillManifest): string[] {
  return (manifest.tools ?? []).filter((t) => !WILDCARD.has(t));
}
