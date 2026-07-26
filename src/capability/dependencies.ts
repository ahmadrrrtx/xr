/**
 * XR 5.2.0 — Capability Dependency & Compatibility Inspection
 *
 * Dependency solving uses existing dependency structures from skills
 * and plugins, without inventing a second solver. Compatibility
 * checks runtime requirements, conflicts, and version ranges.
 */
import { DependencySchema, Dependency, CompatibilitySchema, Compatibility } from "./types.ts";

export interface DependencyResolution {
  ok: boolean;
  missing: Dependency[];
  conflicts: { dependency: Dependency; reason: string }[];
  resolved: Dependency[];
  errors: string[];
}

export function resolveDependencies(
  declared: Dependency[],
  available: Record<string, Dependency>,
  installedVersions?: Record<string, string>,
): DependencyResolution {
  const missing: Dependency[] = [];
  const conflicts: { dependency: Dependency; reason: string }[] = [];
  const resolved: Dependency[] = [];
  const errors: string[] = [];

  for (const dep of declared) {
    const key = `${dep.kind}:${dep.id}`;
    if (!available[key]) {
      if (!dep.optional) {
        missing.push(dep);
        errors.push(`required dependency missing: ${key}`);
      }
      continue;
    }

    const installed = installedVersions?.[dep.id];
    if (dep.version && installed && installed !== dep.version) {
      // Basic version check: if declared version is exact and installed differs, note conflict
      if (!dep.version.includes("^") && !dep.version.includes("~") && !dep.version.includes("*")) {
        conflicts.push({ dependency: dep, reason: `version mismatch: required ${dep.version}, installed ${installed}` });
      }
    }

    resolved.push(dep);
  }

  return {
    ok: missing.length === 0 && conflicts.length === 0,
    missing,
    conflicts,
    resolved,
    errors,
  };
}

export function checkCompatibility(
  descriptorCompatibility: Compatibility,
  environmentCapabilities: string[],
  xrVersion: string,
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (descriptorCompatibility.xrVersionMin && xrVersion < descriptorCompatibility.xrVersionMin) {
    errors.push(`XR version ${xrVersion} is below minimum ${descriptorCompatibility.xrVersionMin}`);
  }
  if (descriptorCompatibility.xrVersionMax && xrVersion > descriptorCompatibility.xrVersionMax) {
    errors.push(`XR version ${xrVersion} exceeds maximum ${descriptorCompatibility.xrVersionMax}`);
  }

  for (const req of descriptorCompatibility.runtimeRequirements) {
    if (!environmentCapabilities.includes(req)) {
      errors.push(`missing runtime requirement: ${req}`);
    }
  }

  for (const capReq of descriptorCompatibility.capabilityRequirements) {
    if (!environmentCapabilities.includes(capReq)) {
      errors.push(`missing capability requirement: ${capReq}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
