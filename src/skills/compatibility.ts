/** XR 2.1C — Compatibility checks for marketplace installs. */
import { CORE_VERSION } from "../core/version.ts";
import type { SkillManifest } from "./schema.ts";
import { satisfiesSemver } from "./semver.ts";

export interface CompatibilityReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function checkSkillCompatibility(manifest: SkillManifest, runtimeVersion = CORE_VERSION, platform = process.platform): CompatibilityReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const xrRange = manifest.compatibility.xr;
  if (!satisfiesSemver(runtimeVersion, xrRange)) errors.push(`XR ${runtimeVersion} does not satisfy skill compatibility ${xrRange}`);
  const os = manifest.compatibility.os;
  if (os.length && !os.includes("any") && !os.includes(platform as any)) errors.push(`platform ${platform} is not supported by this skill (${os.join(", ")})`);
  if (manifest.compatibility.providers.length) warnings.push(`skill declares provider preferences: ${manifest.compatibility.providers.join(", ")}`);
  return { ok: errors.length === 0, errors, warnings };
}
